import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

interface AttentionItem {
  id: string
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  // Fetch user active organization
  const { data: memberships } = await supabase
    .from('organization_users')
    .select('organization_id')
    .eq('user_id', user.id)

  const orgId = memberships?.[0]?.organization_id
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

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .single()

  const orgName = org?.name || 'Organization'

  // 1. Fetch counts
  const { count: completedCount } = await supabase
    .from('customer_completion_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)

  const { count: eligibleCount } = await supabase
    .from('review_requests')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)

  const { count: scheduledCount } = await supabase
    .from('review_requests')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'SCHEDULED')

  const { count: sentCount } = await supabase
    .from('review_requests')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .in('status', ['SENT', 'DELIVERED', 'CLICKED'])

  const { count: clickedCount } = await supabase
    .from('review_requests')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'CLICKED')

  const { count: failedCount } = await supabase
    .from('review_requests')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'FAILED')

  const { count: outboxFailedCount } = await supabase
    .from('domain_event_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'FAILED')

  const { count: ineligibleCount } = await supabase
    .from('audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('event_type', 'review_request.ineligible')

  // 2. Fetch locations and review destinations
  const { data: locations } = await supabase
    .from('locations')
    .select('id, name, status')
    .eq('organization_id', orgId)

  const { data: destinations } = await supabase
    .from('review_destinations')
    .select('id, location_id, status, canonical_url')
    .eq('organization_id', orgId)

  const confirmedLocationIds = new Set(
    (destinations || [])
      .filter((d) => d.status === 'CONFIRMED')
      .map((d) => d.location_id)
  )

  const locationsNeedingDestination = (locations || []).filter(
    (loc) => !confirmedLocationIds.has(loc.id)
  )

  const inactiveLocations = (locations || []).filter(
    (loc) => loc.status !== 'ACTIVE'
  )

  // Derive truthful readiness status
  let systemStatus: 'SETUP_REQUIRED' | 'READY_FOR_SYNTHETIC_TEST' | 'RUNNING' | 'NEEDS_ATTENTION' = 'SETUP_REQUIRED'
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
    statusDescription = 'All locations configured with confirmed review destinations. Ready for synthetic validation.'
  } else {
    systemStatus = 'RUNNING'
    statusDescription = 'Review request workflow actively processing completions.'
  }

  // Build Needs Attention items
  const attentionItems: AttentionItem[] = []

  if (!locations || locations.length === 0) {
    attentionItems.push({
      id: 'missing-location',
      severity: 'error',
      title: 'No Locations Configured',
      description: 'Your organization requires at least one primary location to record customer completions.',
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

  // 3. Recent activity list - including token
  const { data: recentRequests } = await supabase
    .from('review_requests')
    .select('id, customer_id, channel, status, token, created_at, sent_at, clicked_at, error_message')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(10)

  const customerIds = Array.from(new Set((recentRequests || []).map((r) => r.customer_id)))
  let customerMap: Record<string, { first_name: string; last_name: string | null; email: string | null }> = {}

  if (customerIds.length > 0) {
    const { data: customers } = await supabase
      .from('customers')
      .select('id, first_name, last_name, email')
      .in('id', customerIds)

    if (customers) {
      customerMap = Object.fromEntries(customers.map((c) => [c.id, c]))
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{orgName} Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">
            Truthful activity, automation state, and operational metrics for V0.2 Controlled Staging.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/app/quick-complete"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            + Quick Complete
          </Link>
        </div>
      </div>

      {/* Truthful System Readiness Status Banner */}
      <div className={`p-4 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
        systemStatus === 'SETUP_REQUIRED'
          ? 'bg-amber-950/40 border-amber-800/60'
          : systemStatus === 'NEEDS_ATTENTION'
          ? 'bg-rose-950/40 border-rose-800/60'
          : systemStatus === 'READY_FOR_SYNTHETIC_TEST'
          ? 'bg-blue-950/40 border-blue-800/60'
          : 'bg-emerald-950/40 border-emerald-800/60'
      }`}>
        <div className="flex items-start gap-3">
          <span className="text-lg">
            {systemStatus === 'SETUP_REQUIRED' && '⚙️'}
            {systemStatus === 'NEEDS_ATTENTION' && '⚠️'}
            {systemStatus === 'READY_FOR_SYNTHETIC_TEST' && '🧪'}
            {systemStatus === 'RUNNING' && '✅'}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">
                {systemStatus}
              </span>
              <span className="text-xs text-slate-400">V0.2 Controlled Staging</span>
            </div>
            <p className="text-xs text-slate-300 mt-1">{statusDescription}</p>
          </div>
        </div>
        {locationsNeedingDestination.length > 0 && (
          <Link
            href="/app/settings/review-destination"
            className="text-xs font-medium bg-amber-800 hover:bg-amber-700 text-amber-100 px-3 py-1.5 rounded transition-colors whitespace-nowrap"
          >
            Configure Destination →
          </Link>
        )}
      </div>

      {/* Needs Attention Section (Section 9) */}
      {attentionItems.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span>⚠️</span> Needs Attention
            </h2>
            <span className="text-xs text-slate-500">{attentionItems.length} condition(s) detected</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {attentionItems.map((item) => (
              <div
                key={item.id}
                className={`p-4 rounded-md border text-sm flex flex-col justify-between ${
                  item.severity === 'error'
                    ? 'bg-rose-950/30 border-rose-800/60 text-rose-200'
                    : item.severity === 'warning'
                    ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                    : 'bg-blue-950/30 border-blue-800/60 text-blue-200'
                }`}
              >
                <div>
                  <div className="font-semibold text-white mb-1">{item.title}</div>
                  <p className="text-xs opacity-90 leading-relaxed">{item.description}</p>
                </div>
                {item.actionHref && item.actionLabel && (
                  <div className="mt-3">
                    <Link
                      href={item.actionHref}
                      className="text-xs font-medium underline hover:text-white transition-colors"
                    >
                      {item.actionLabel}
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Metric Cards (Section 8) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-lg">
          <span className="text-xs font-medium text-slate-400">Completed Customers</span>
          <div className="mt-2 text-2xl font-bold text-white">{completedCount ?? 0}</div>
          <span className="text-xs text-slate-500 mt-1 block">Quick Complete jobs</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-lg">
          <span className="text-xs font-medium text-slate-400">Eligible Requests</span>
          <div className="mt-2 text-2xl font-bold text-white">{eligibleCount ?? 0}</div>
          <span className="text-xs text-slate-500 mt-1 block">Passed consent &amp; rules</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-lg">
          <span className="text-xs font-medium text-slate-400">Requests Scheduled</span>
          <div className="mt-2 text-2xl font-bold text-white">{scheduledCount ?? 0}</div>
          <span className="text-xs text-slate-500 mt-1 block">Awaiting cooldown delay</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-lg">
          <span className="text-xs font-medium text-slate-400">Requests Sent</span>
          <div className="mt-2 text-2xl font-bold text-white">{sentCount ?? 0}</div>
          <span className="text-xs text-slate-500 mt-1 block">Neutral emails dispatched</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-lg">
          <span className="text-xs font-medium text-slate-400">Review Links Clicked</span>
          <div className="mt-2 text-2xl font-bold text-white">{clickedCount ?? 0}</div>
          <span className="text-xs text-slate-500 mt-1 block">Verified 302 redirects</span>
        </div>
      </div>

      {/* System Invariants Guard Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
        <h2 className="text-base font-semibold text-white mb-4">Automation &amp; Integrity Invariants</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span className="text-slate-300">Neutral Solicitation: <strong className="text-white">Active</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span className="text-slate-300">Review Gating: <strong className="text-white">Disabled (Strict)</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${failedCount ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
            <span className="text-slate-300">Failed Dispatches: <strong className="text-white">{failedCount ?? 0}</strong></span>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-4">
          Truthful Guarantee: MPG Reputation never fabricates reviews received, star ratings, or ROI metrics. A tracked click is recorded only as a link click.
        </p>
      </div>

      {/* Recent Activity Table with Tracked Link Testing & Email Representation */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Recent Review Solicitations</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Inspect sent requests, view development email previews, and test tracked redirects.
            </p>
          </div>
          <span className="text-xs text-slate-500">Last 10 events</span>
        </div>

        {!recentRequests || recentRequests.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No review solicitation activity recorded yet.
            <div className="mt-2">
              <Link href="/app/quick-complete" className="text-blue-400 hover:underline">
                Submit your first customer via Quick Complete →
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {recentRequests.map((req) => {
              const cust = customerMap[req.customer_id]
              const customerName = cust ? `${cust.first_name} ${cust.last_name || ''}`.trim() : 'Customer'
              const recipientEmail = cust?.email || 'unknown'
              const trackingUrl = `/r/${req.token}`

              return (
                <div key={req.id} className="p-6 hover:bg-slate-800/30 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-white text-base">{customerName}</span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            req.status === 'CLICKED'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : req.status === 'SENT'
                              ? 'bg-blue-950 text-blue-400 border border-blue-800'
                              : req.status === 'FAILED'
                              ? 'bg-rose-950 text-rose-400 border border-rose-800'
                              : req.status === 'SCHEDULED'
                              ? 'bg-amber-950 text-amber-400 border border-amber-800'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {req.status}
                        </span>
                        <span className="text-xs text-slate-500 uppercase">{req.channel}</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1 flex items-center gap-4">
                        <span>Email: {recipientEmail}</span>
                        <span>Created: {new Date(req.created_at).toLocaleString()}</span>
                        {req.clicked_at && (
                          <span className="text-emerald-400 font-medium">
                            Clicked: {new Date(req.clicked_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {req.token && req.status !== 'FAILED' && req.status !== 'SCHEDULED' && (
                        <a
                          href={trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition-colors"
                        >
                          Test Link ↗
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Inline Development Email Representation (Section 6 & Section 7) */}
                  {req.token && (
                    <details className="mt-4 text-xs group">
                      <summary className="cursor-pointer text-slate-400 hover:text-slate-200 select-none flex items-center gap-1.5">
                        <span className="transition-transform group-open:rotate-90">▸</span>
                        <span className="font-medium underline">Inspect Development Email Representation</span>
                        <span className="text-slate-500 font-normal">(ConsoleEmailProvider / Live Disabled)</span>
                      </summary>

                      <div className="mt-3 p-4 bg-slate-950 border border-slate-800 rounded-md font-mono text-slate-300 space-y-2">
                        <div className="text-slate-500 text-[11px] pb-1 border-b border-slate-900 flex justify-between">
                          <span>DEVELOPMENT EMAIL PREVIEW</span>
                          <span>Channel: {req.channel}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">To:</span> {recipientEmail}
                        </div>
                        <div>
                          <span className="text-slate-500">Subject:</span> How was your experience with {orgName}?
                        </div>
                        <div className="pt-2 text-slate-200 whitespace-pre-line border-t border-slate-900">
                          {`Hi ${cust?.first_name || 'there'},

Thanks for choosing ${orgName}.

If you'd like to share your experience, we'd appreciate your honest feedback.

Leave a review:
${trackingUrl}

Thank you,
${orgName}`}
                        </div>
                        <div className="pt-2 text-[11px] text-slate-500 border-t border-slate-900 flex items-center justify-between">
                          <span>Delivery Provider: ConsoleEmailProvider</span>
                          <a
                            href={trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline"
                          >
                            Click to test tracked 302 redirect →
                          </a>
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
