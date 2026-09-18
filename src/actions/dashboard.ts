'use server'

import { createClient } from '@/lib/supabase/server'
import type {
  DashboardSnapshot,
  AttentionItem,
  SystemStatus,
  ActivityRequestItem,
} from '@/lib/dashboard/realtime-types'

export async function getDashboardSnapshot(
  organizationId: string
): Promise<DashboardSnapshot | null> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return null
  }

  // Tenant authorization: verify user is a member of the organization
  const { data: membership } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return null
  }

  const [
    { count: completedCount },
    { count: eligibleCount },
    { count: scheduledCount },
    { count: sentCount },
    { count: clickedCount },
    { count: failedCount },
    { count: outboxFailedCount },
    { count: ineligibleCount },
    { data: locations },
    { data: destinations },
    { data: recentRequests },
  ] = await Promise.all([
    supabase
      .from('customer_completion_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'SCHEDULED'),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .in('status', ['SENT', 'DELIVERED', 'CLICKED']),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'CLICKED'),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'FAILED'),
    supabase
      .from('domain_event_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'FAILED'),
    supabase
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('event_type', 'review_request.ineligible'),
    supabase
      .from('locations')
      .select('id, name, status')
      .eq('organization_id', organizationId),
    supabase
      .from('review_destinations')
      .select('id, location_id, status, canonical_url')
      .eq('organization_id', organizationId),
    supabase
      .from('review_requests')
      .select('id, customer_id, channel, status, token, created_at, sent_at, clicked_at, error_message')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const confirmedLocationIds = new Set(
    (destinations || [])
      .filter((d) => d.status === 'CONFIRMED')
      .map((d) => d.location_id)
  )

  const locationsNeedingDestination = (locations || []).filter(
    (loc) => !confirmedLocationIds.has(loc.id)
  )

  const inactiveLocations = (locations || []).filter((loc) => loc.status !== 'ACTIVE')

  let systemStatus: SystemStatus = 'SETUP_REQUIRED'
  let statusDescription = ''

  if (!locations || locations.length === 0) {
    systemStatus = 'SETUP_REQUIRED'
    statusDescription = 'Initial setup required: No locations configured.'
  } else if (locationsNeedingDestination.length > 0) {
    systemStatus = 'SETUP_REQUIRED'
    statusDescription = `${locationsNeedingDestination.length} location(s) require a confirmed Google review destination.`
  } else if ((failedCount && failedCount > 0) || (outboxFailedCount && outboxFailedCount > 0)) {
    systemStatus = 'NEEDS_ATTENTION'
    statusDescription = 'Operational issues detected in recent dispatches or outbox.'
  } else if ((sentCount ?? 0) === 0) {
    systemStatus = 'READY_FOR_SYNTHETIC_TEST'
    statusDescription =
      'All locations configured with confirmed review destinations. Ready for synthetic validation.'
  } else {
    systemStatus = 'RUNNING'
    statusDescription = 'Review request workflow actively processing completions.'
  }

  const attentionItems: AttentionItem[] = []

  if (!locations || locations.length === 0) {
    attentionItems.push({
      id: 'missing-location',
      severity: 'error',
      title: 'No Locations Configured',
      description:
        'Your organization requires at least one primary location to record customer completions.',
      actionLabel: 'Set Up Location →',
      actionHref: '/app/settings/location',
    })
  } else if (locationsNeedingDestination.length > 0) {
    attentionItems.push({
      id: 'missing-destination',
      severity: 'warning',
      title: 'Review Destination Missing',
      description: `${locationsNeedingDestination.length} location(s) require a confirmed Google review destination before customer invitations can be dispatched.`,
      actionLabel: 'Configure Destination →',
      actionHref: '/app/settings/review-destination',
    })
  }

  if (inactiveLocations.length > 0) {
    attentionItems.push({
      id: 'inactive-location',
      severity: 'warning',
      title: 'Inactive Location Detected',
      description: `${inactiveLocations.length} location(s) are marked inactive. Completions submitted for inactive locations will be skipped by the eligibility engine.`,
      actionLabel: 'Manage Locations →',
      actionHref: '/app/settings/location',
    })
  }

  if (failedCount && failedCount > 0) {
    attentionItems.push({
      id: 'failed-requests',
      severity: 'error',
      title: 'Workflow Dispatch Failed',
      description: `${failedCount} review request dispatch(es) recorded delivery failures. Please check email provider logs.`,
    })
  }

  if (outboxFailedCount && outboxFailedCount > 0) {
    attentionItems.push({
      id: 'outbox-failed',
      severity: 'error',
      title: 'Background Events Awaiting Recovery',
      description: `${outboxFailedCount} background event(s) encountered errors and are awaiting automated recovery.`,
    })
  }

  if (ineligibleCount && ineligibleCount > 0) {
    attentionItems.push({
      id: 'ineligible-suppressed',
      severity: 'info',
      title: 'Completions Bypassed by Policy',
      description: `${ineligibleCount} customer completion(s) were safely bypassed due to missing customer consent, recent request cooldown, or suppression.`,
    })
  }

  const customerIds = Array.from(new Set((recentRequests || []).map((r) => r.customer_id)))
  let customerMap: Record<
    string,
    { first_name: string; last_name: string | null; email: string | null }
  > = {}

  if (customerIds.length > 0) {
    const { data: customers } = await supabase
      .from('customers')
      .select('id, first_name, last_name, email')
      .in('id', customerIds)

    if (customers) {
      customerMap = Object.fromEntries(customers.map((c) => [c.id, c]))
    }
  }

  const activityItems: ActivityRequestItem[] = (recentRequests || []).map((req) => {
    const cust = customerMap[req.customer_id]
    return {
      id: req.id,
      customer_id: req.customer_id,
      channel: req.channel,
      status: req.status,
      token: req.token,
      created_at: req.created_at,
      sent_at: req.sent_at,
      clicked_at: req.clicked_at,
      error_message: req.error_message,
      customerName: cust ? `${cust.first_name} ${cust.last_name || ''}`.trim() : 'Customer',
      recipientEmail: cust?.email || 'unknown',
    }
  })

  return {
    kpis: {
      completedCount: completedCount ?? 0,
      eligibleCount: eligibleCount ?? 0,
      scheduledCount: scheduledCount ?? 0,
      sentCount: sentCount ?? 0,
      clickedCount: clickedCount ?? 0,
      failedCount: failedCount ?? 0,
      outboxFailedCount: outboxFailedCount ?? 0,
      ineligibleCount: ineligibleCount ?? 0,
    },
    recentRequests: activityItems,
    systemStatus,
    statusDescription,
    attentionItems,
    locationsNeedingDestinationCount: locationsNeedingDestination.length,
  }
}

export async function getActivityRowProjection(
  organizationId: string,
  requestId: string
): Promise<{ customerName: string; recipientEmail: string; token: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) return null

  const { data: membership } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return null

  const { data: req } = await supabase
    .from('review_requests')
    .select('customer_id, token')
    .eq('id', requestId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!req) return null

  const { data: cust } = await supabase
    .from('customers')
    .select('first_name, last_name, email')
    .eq('id', req.customer_id)
    .maybeSingle()

  return {
    customerName: cust ? `${cust.first_name} ${cust.last_name || ''}`.trim() : 'Customer',
    recipientEmail: cust?.email || 'unknown',
    token: req.token,
  }
}

export async function getCompletionActivityProjection(
  organizationId: string,
  completionEventId: string
): Promise<{ customerName: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) return null

  const { data: membership } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return null

  const { data: completion } = await supabase
    .from('customer_completion_events')
    .select('customer_id')
    .eq('id', completionEventId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!completion) return null

  const { data: cust } = await supabase
    .from('customers')
    .select('first_name, last_name')
    .eq('id', completion.customer_id)
    .maybeSingle()

  return {
    customerName: cust ? `${cust.first_name} ${cust.last_name || ''}`.trim() : 'Customer',
  }
}
