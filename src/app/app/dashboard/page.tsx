import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { deriveActivationReadiness, deriveDashboardSystemStatus } from '@/domain/activation'
import { LiveDashboard } from './live-dashboard'
import type {
  DashboardSnapshot,
  AttentionItem,
  ActivityRequestItem,
} from '@/lib/dashboard/realtime-types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  // Fetch user active organization and joined organization in one query
  const { data: memberships } = await supabase
    .from('organization_users')
    .select('organization_id, organizations(id, name)')
    .eq('user_id', user.id)

  const activeMembership = memberships?.[0]
  const orgId = activeMembership?.organization_id
  if (!orgId) {
    return (
      <div className="p-8 text-center text-slate-400">
        No active organization found. Complete{' '}
        <Link href="/onboarding" className="text-blue-400 underline">
          onboarding
        </Link>{' '}
        to get started.
      </div>
    )
  }

  const orgData = activeMembership.organizations as { id: string; name: string } | null
  const orgName = orgData?.name || 'Organization'

  // Performance Optimization: Parallelize all independent count, location, destination, and activity queries
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
      .eq('organization_id', orgId),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'SCHEDULED'),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('status', ['SENT', 'DELIVERED', 'CLICKED']),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'CLICKED'),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'FAILED'),
    supabase
      .from('domain_event_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'FAILED'),
    supabase
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('event_type', 'review_request.ineligible'),
    supabase
      .from('locations')
      .select('id, name, status')
      .eq('organization_id', orgId),
    supabase
      .from('review_destinations')
      .select('id, location_id, status, canonical_url')
      .eq('organization_id', orgId),
    supabase
      .from('review_requests')
      .select('id, customer_id, channel, status, token, created_at, sent_at, delivered_at, reminded_at, clicked_at, error_message')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const readiness = deriveActivationReadiness(
    locations || [],
    destinations || []
  )

  const inactiveLocations = (locations || []).filter(
    (loc) => loc.status !== 'ACTIVE'
  )

  const { systemStatus, statusDescription } =
    deriveDashboardSystemStatus({
      readiness,
      failedCount: failedCount ?? 0,
      outboxFailedCount: outboxFailedCount ?? 0,
      sentCount: sentCount ?? 0,
    })

  // Build Needs Attention items
  const attentionItems: AttentionItem[] = []

  if (readiness.activeLocationCount === 0) {
    attentionItems.push({
      id: 'missing-location',
      severity: 'error',
      title: 'No Active Locations Configured',
      description:
        'Your organization requires at least one active location before the review workflow can be used.',
      actionLabel: 'Set Up Location →',
      actionHref: '/app/settings/location',
    })
  } else if (readiness.locationsNeedingDestinationCount > 0) {
    attentionItems.push({
      id: 'missing-destination',
      severity: 'warning',
      title: 'Review Destination Missing',
      description: `${readiness.locationsNeedingDestinationCount} active location(s) require a confirmed Google review destination before customer invitations can be dispatched.`,
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

  // 3. Customer map for recent activity list
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
      delivered_at: req.delivered_at,
      reminded_at: req.reminded_at,
      clicked_at: req.clicked_at,
      error_message: req.error_message,
      customerName: cust ? `${cust.first_name} ${cust.last_name || ''}`.trim() : 'Customer',
      recipientEmail: cust?.email || 'unknown',
    }
  })

  const initialSnapshot: DashboardSnapshot = {
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
    locationsNeedingDestinationCount: readiness.locationsNeedingDestinationCount,
    setupChecklist: readiness.checklist,
  }

  return (
    <LiveDashboard
      initialSnapshot={initialSnapshot}
      orgId={orgId}
      orgName={orgName}
    />
  )
}
