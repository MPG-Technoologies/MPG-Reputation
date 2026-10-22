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

    if (authError || !user || user.is_anonymous) {
      return { success: false, error: 'Authentication required' }
    }

    // Verify tenant membership
    const { data: membership, error: membershipError } = await supabase
      .from('organization_users')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (membershipError || !membership) {
      return { success: false, error: 'Access denied' }
    }

    // Fetch entitlement state
    const { data: entitlementRow, error: entitlementError } = await supabase
      .from('organization_entitlements')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (entitlementError || entitlementRow === undefined) {
      return { success: false, error: 'Usage details could not be verified' }
    }
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

    if (locationsRes.error || destinationsRes.error ||
        !Array.isArray(locationsRes.data) ||
        !Array.isArray(destinationsRes.data)) {
      return { success: false, error: 'Usage details could not be verified' }
    }
    const readiness = deriveActivationReadiness(
      locationsRes.data,
      destinationsRes.data
    )

    const hasReadyLocation = readiness.readyLocationIds.length > 0
    const hasConfirmedDestination = hasReadyLocation
    const isNotStarted = !entitlementRow || entitlementRow.status === 'NOT_STARTED'
    const canStartTrial = isNotStarted && hasReadyLocation

    // Fetch usage ledger records (factual usage only)
    const { data: usageRows, error: usageError } = await supabase
      .from('usage_ledger')
      .select('id, event_type, channel, units, entity_type, entity_id, idempotency_key, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(200)

    // Missing/error ledger data must not be misreported as genuine zero usage.
    if (usageError || !Array.isArray(usageRows)) {
      return { success: false, error: 'Usage details could not be verified' }
    }
    const rows = usageRows

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
  } catch {
    // A database exception must never leak internal details or invent usage.
    return { success: false, error: 'Usage details could not be verified' }
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
 * Deprecated tenant mutation endpoint, preserved as a fail-closed compatibility
 * response so stale clients cannot use a previously privileged service-role
 * proxy to reset or extend a trial. No database operation is performed.
 */
export async function provisionOrganizationTrialAction(
  _organizationId: string,
  _allocatedRequests: number = DEFAULT_TRIAL_REQUESTS,
  _durationDays: number = DEFAULT_TRIAL_DURATION_DAYS,
): Promise<{ success: boolean; error?: string; data?: unknown }> {
  return { success: false, error: 'Trial allowance changes are managed by MPG support.' }
}

const TRIAL_ORG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Tenant requests a review only. The user's cookie-backed client and RLS
 * enforce ownership; no service-role, entitlement or approval RPC is involved.
 */
export async function requestTrialExtensionAction(
  organizationId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  if (typeof organizationId !== 'string' || !TRIAL_ORG_UUID.test(organizationId) ||
      typeof reason !== 'string' || reason.trim().length < 20 ||
      reason.trim().length > 500) {
    return { success: false, error: 'Provide a valid request reason (20–500 characters).' }
  }
  try {
    const client = await createClient()
    const { data: { user }, error: authError } = await client.auth.getUser()
    if (authError || !user || user.is_anonymous) {
      return { success: false, error: 'Authentication required.' }
    }
    const org = organizationId.toLowerCase()
    const { data: member, error: memberError } = await client
      .from('organization_users')
      .select('organization_id, user_id, role')
      .eq('organization_id', org)
      .eq('user_id', user.id)
      .maybeSingle()
    if (memberError || !member ||
        member.organization_id !== org || member.user_id !== user.id ||
        !['OWNER', 'ADMIN'].includes(member.role)) {
      return { success: false, error: 'Trial extension requests require business owner or administrator access.' }
    }

    const { error } = await client.from('trial_extension_requests').insert({
      organization_id: org,
      requested_by: user.id,
      reason: reason.trim(),
    })
    if (error?.code === '23505') {
      return { success: false, error: 'A trial extension request is already pending for this business.' }
    }
    if (error) {
      return { success: false, error: 'Unable to submit the extension request.' }
    }
    revalidatePath('/app/settings/usage')
    return { success: true }
  } catch {
    return { success: false, error: 'Unable to submit the extension request.' }
  }
}
