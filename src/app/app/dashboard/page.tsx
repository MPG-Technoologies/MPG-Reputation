import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

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
    return <div>No active organization found.</div>
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

  // 3. Recent activity list
  const { data: recentRequests } = await supabase
    .from('review_requests')
    .select('id, status, created_at, sent_at, clicked_at, channel, customer_id')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(10)

  const customerIds = (recentRequests || []).map((r) => r.customer_id)
  const customerMap: Record<string, { first_name: string; last_name: string | null; email: string | null }> = {}

  if (customerIds.length > 0) {
    const { data: customers } = await supabase
      .from('customers')
      .select('id, first_name, last_name, email')
      .in('id', customerIds)

    ;(customers || []).forEach((c) => {
      customerMap[c.id] = c
    })
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{orgName} Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">
            Truthful activity and automation metrics for the current period.
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

      {/* Needs Attention Banner */}
      {locationsNeedingDestination.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-800/60 p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="text-amber-400 font-bold text-lg">⚠️</span>
            <div>
              <h3 className="text-sm font-semibold text-amber-200">Needs Attention: Destination Missing</h3>
              <p className="text-xs text-amber-300/80 mt-0.5">
                {locationsNeedingDestination.length} location(s) require a confirmed Google review destination URL before review requests can be delivered.
              </p>
            </div>
          </div>
          <Link
            href="/app/settings/review-destination"
            className="text-xs font-medium bg-amber-800 hover:bg-amber-700 text-amber-100 px-3 py-1.5 rounded transition-colors whitespace-nowrap"
          >
            Configure Destination →
          </Link>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-lg">
          <span className="text-xs font-medium text-slate-400">Completed Customers</span>
          <div className="mt-2 text-2xl font-bold text-white">{completedCount ?? 0}</div>
          <span className="text-xs text-slate-500 mt-1 block">Quick Complete events</span>
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
          <span className="text-xs text-slate-500 mt-1 block">Redirected to Google</span>
        </div>
      </div>

      {/* System Status Summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
        <h2 className="text-base font-semibold text-white mb-4">Automation &amp; Integrity Status</h2>
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
      </div>

      {/* Recent Activity Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Recent Review Solicitations</h2>
          <span className="text-xs text-slate-500">Last 10 events</span>
        </div>

        {!recentRequests || recentRequests.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No review solicitation activity recorded yet.
            <div className="mt-2">
              <Link href="/app/quick-complete" className="text-blue-400 hover:underline">
                Submit your first customer via Quick Complete
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950 text-xs uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-3">Customer</th>
                  <th className="px-6 py-3">Channel</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Created</th>
                  <th className="px-6 py-3">Clicked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {recentRequests.map((req) => {
                  const cust = customerMap[req.customer_id]
                  const customerName = cust ? `${cust.first_name} ${cust.last_name || ''}`.trim() : 'Customer'

                  return (
                    <tr key={req.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-6 py-4 font-medium text-white">
                        {customerName}
                        <span className="block text-xs text-slate-400">{cust?.email}</span>
                      </td>
                      <td className="px-6 py-4 uppercase text-xs text-slate-400">{req.channel}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            req.status === 'CLICKED'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : req.status === 'SENT'
                              ? 'bg-blue-950 text-blue-400 border border-blue-800'
                              : req.status === 'FAILED'
                              ? 'bg-rose-950 text-rose-400 border border-rose-800'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-400">
                        {new Date(req.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-400">
                        {req.clicked_at ? new Date(req.clicked_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
