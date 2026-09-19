'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  TrialStatus,
  deriveTrialLifecycle,
  DEFAULT_TRIAL_REQUESTS,
  DEFAULT_TRIAL_DURATION_DAYS,
} from '@/domain/entitlement'
import { deriveActivationReadiness } from '@/domain/activation'

export interface OrganizationUsageSummary {
  organizationId: string
  entitlement: {
    status: TrialStatus
    effectiveStatus: TrialStatus
    allocatedRequests: number
    consumedRequests: number
    remainingRequests: number
    durationDays: number
    startedAt: string | null
    expiresAt: string | null
    statusReason: string | null
    isEligibleForInitialRequest: boolean
    isEligibleForReminder: boolean
  }
  ledgerCounts: {
    initialRequestsCreated: number
    remindersCreated: number
    providerSendAttempts: number
    providerSendSuccesses: number
    providerSendFailures: number
    trackedClicks: number
    completionsReceived: number
  }
  recentEvents: Array<{
    id: string
    eventType: string
    channel: string
    units: number
    entityType: string
    entityId: string
    idempotencyKey: string
    createdAt: string
  }>
  hasConfirmedDestination: boolean
  hasReadyLocation: boolean
  canStartTrial: boolean
}

/**
 * Returns factual usage summary and entitlement state for an organization.
 * Read access is permitted for any active member of the organization.
 * Tenant users receive strictly factual usage metrics with zero internal COGS.
 */
export async function getOrganizationUsageSummary(
  organizationId: string
): Promise<{ success: boolean; data?: OrganizationUsageSummary; error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Authentication required' }
    }

    // Verify tenant membership
    const { data: membership } = await supabase
      .from('organization_users')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership) {
      return { success: false, error: 'Access denied' }
    }

    // Fetch entitlement state
    const { data: entitlementRow } = await supabase
      .from('organization_entitlements')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle()

    const derived = deriveTrialLifecycle(entitlementRow)

    // Authoritative MR-2 activation readiness check: evaluate locations and destinations
    const [locationsRes, destinationsRes] = await Promise.all([
      supabase
        .from('locations')
        .select('id, status')
        .eq('organization_id', organizationId),
      supabase
        .from('review_destinations')
        .select('location_id, status, canonical_url')
        .eq('organization_id', organizationId),
    ])

    const readiness = deriveActivationReadiness(
      locationsRes.data || [],
      destinationsRes.data || []
    )

    const hasReadyLocation = readiness.readyLocationIds.length > 0
    const hasConfirmedDestination = hasReadyLocation
    const isNotStarted = !entitlementRow || entitlementRow.status === 'NOT_STARTED'
    const canStartTrial = isNotStarted && hasReadyLocation

    // Fetch usage ledger records (factual usage only)
    const { data: usageRows } = await supabase
      .from('usage_ledger')
      .select('id, event_type, channel, units, entity_type, entity_id, idempotency_key, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(200)

    const rows = usageRows || []

    const ledgerCounts = {
      initialRequestsCreated: 0,
      remindersCreated: 0,
      providerSendAttempts: 0,
      providerSendSuccesses: 0,
      providerSendFailures: 0,
      trackedClicks: 0,
      completionsReceived: 0,
    }

    for (const row of rows) {
      const units = Number(row.units) || 1
      if (row.event_type === 'initial_request_created') ledgerCounts.initialRequestsCreated += units
      else if (row.event_type === 'reminder_created') ledgerCounts.remindersCreated += units
      else if (row.event_type === 'provider_send_attempt') ledgerCounts.providerSendAttempts += units
      else if (row.event_type === 'provider_send_success') ledgerCounts.providerSendSuccesses += units
      else if (row.event_type === 'provider_send_failure') ledgerCounts.providerSendFailures += units
      else if (row.event_type === 'tracked_click') ledgerCounts.trackedClicks += units
      else if (row.event_type === 'completion_received') ledgerCounts.completionsReceived += units
    }

    const recentEvents = rows.slice(0, 50).map((r) => ({
      id: r.id,
      eventType: r.event_type,
      channel: r.channel,
      units: r.units,
      entityType: r.entity_type,
      entityId: r.entity_id,
      idempotencyKey: r.idempotency_key,
      createdAt: r.created_at,
    }))

    return {
      success: true,
      data: {
        organizationId,
        entitlement: {
          status: (entitlementRow?.status || 'NOT_STARTED') as TrialStatus,
          effectiveStatus: derived.effectiveStatus,
          allocatedRequests: entitlementRow?.allocated_requests ?? DEFAULT_TRIAL_REQUESTS,
          consumedRequests: entitlementRow?.consumed_requests ?? 0,
          remainingRequests: derived.remainingRequests,
          durationDays: entitlementRow?.duration_days ?? DEFAULT_TRIAL_DURATION_DAYS,
          startedAt: entitlementRow?.started_at || null,
          expiresAt: entitlementRow?.expires_at || null,
          statusReason: entitlementRow?.status_reason || null,
          isEligibleForInitialRequest: derived.isEligibleForInitialRequest,
          isEligibleForReminder: derived.isEligibleForReminder,
        },
        ledgerCounts,
        recentEvents,
        hasConfirmedDestination,
        hasReadyLocation,
        canStartTrial,
      },
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch organization usage summary'
    return { success: false, error: msg }
  }
}

/**
 * Explicitly starts an organization's trial entitlement.
 * Requires OWNER or ADMIN role and satisfied activation prerequisites (confirmed destination).
 * Atomically transitions NOT_STARTED -> ACTIVE with stable started_at and expires_at.
 * Idempotent: repeated start cannot reset or extend the trial.
 */
export async function startOrganizationTrialAction(
  organizationId: string
): Promise<{
  success: boolean
  error?: string
  reason?: string
  data?: {
    status: string
    startedAt: string | null
    expiresAt: string | null
    alreadyActive?: boolean
  }
}> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Authentication required', reason: 'UNAUTHENTICATED' }
    }

    // Role check: OWNER or ADMIN only
    const { data: membership } = await supabase
      .from('organization_users')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      return { success: false, error: 'Unauthorized: Owner or Admin role required', reason: 'UNAUTHORIZED' }
    }

    // Authoritative MR-2 activation readiness evaluation:
    // Requires at least one location passing deriveActivationReadiness (active location + confirmed valid Google destination)
    const [locationsRes, destinationsRes] = await Promise.all([
      supabase
        .from('locations')
        .select('id, status')
        .eq('organization_id', organizationId),
      supabase
        .from('review_destinations')
        .select('location_id, status, canonical_url')
        .eq('organization_id', organizationId),
    ])

    if (locationsRes.error || destinationsRes.error) {
      return { success: false, error: 'Failed to verify activation readiness', reason: 'VERIFICATION_FAILED' }
    }

    const readiness = deriveActivationReadiness(
      locationsRes.data || [],
      destinationsRes.data || []
    )

    if (readiness.readyLocationIds.length === 0) {
      return {
        success: false,
        error: 'ACTIVATION_NOT_READY: Organization has no activation-ready locations. A confirmed, valid Google review destination on an active location is required.',
        reason: 'ACTIVATION_NOT_READY',
      }
    }

    // Call service-role activate_organization_trial RPC
    const adminClient = createAdminClient()
    const { data: actRes, error: actErr } = await adminClient.rpc(
      'activate_organization_trial',
      {
        p_org_id: organizationId,
      }
    )

    if (actErr) {
      return { success: false, error: actErr.message }
    }

    const result = actRes as {
      success: boolean
      status: string
      already_active?: boolean
      started_at: string | null
      expires_at: string | null
      reason?: string
    }

    if (!result.success) {
      return {
        success: false,
        error:
          result.reason === 'CANNOT_REACTIVATE'
            ? 'Trial has already concluded and cannot be reactivated.'
            : 'Failed to activate trial',
      }
    }

    revalidatePath('/app/dashboard')
    revalidatePath('/app/settings/usage')

    return {
      success: true,
      data: {
        status: result.status,
        startedAt: result.started_at,
        expiresAt: result.expires_at,
        alreadyActive: result.already_active,
      },
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start trial'
    return { success: false, error: msg }
  }
}

/**
 * Provision or re-provision organization trial entitlement parameters.
 * Restricted strictly to authorized OWNER and ADMIN roles.
 * Note: Provisions in NOT_STARTED state awaiting explicit activation.
 */
export async function provisionOrganizationTrialAction(
  organizationId: string,
  allocatedRequests: number = DEFAULT_TRIAL_REQUESTS,
  durationDays: number = DEFAULT_TRIAL_DURATION_DAYS
): Promise<{ success: boolean; error?: string; data?: unknown }> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Authentication required' }
    }

    // Role check: OWNER or ADMIN
    const { data: membership } = await supabase
      .from('organization_users')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      return { success: false, error: 'Unauthorized: Owner or Admin role required' }
    }

    const adminClient = createAdminClient()
    const { data: result, error: rpcErr } = await adminClient.rpc(
      'provision_organization_trial',
      {
        p_org_id: organizationId,
        p_allocated_requests: allocatedRequests,
        p_duration_days: durationDays,
      }
    )

    if (rpcErr) {
      return { success: false, error: rpcErr.message }
    }

    revalidatePath('/app/settings/usage')
    revalidatePath('/app/dashboard')

    return { success: true, data: result }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to provision trial'
    return { success: false, error: msg }
  }
}
