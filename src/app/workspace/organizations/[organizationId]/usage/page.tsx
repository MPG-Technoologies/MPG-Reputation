import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader, PageShell } from '@/components/layout/page-shell'
import { Panel } from '@/components/layout/panels'
import { getOrganizationUsageSummary } from '@/actions/usage'
import { resolveCurrentServerOrganization } from '@/lib/workspace/server-active-organization'

export const dynamic = 'force-dynamic'

export default async function ScopedUsagePage({
  params,
}: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params
  const access = await resolveCurrentServerOrganization(organizationId)
  if (access.outcome === 'AUTH_REQUIRED') redirect('/login')
  if (access.outcome !== 'SELECTED') return <PageShell>
    <PageHeader title="Usage unavailable" />
    <p role="alert" className="text-amber-200">
      Business access could not be verified. No usage or trial records were read.
    </p>
  </PageShell>

  const org = access.organization
  // Independent fresh tenant authorization remains mandatory at this action.
  const usage = await getOrganizationUsageSummary(org.organizationId)
  if (!usage.success || !usage.data || usage.data.organizationId !== org.organizationId) {
    return <PageShell>
      <PageHeader title="Usage unavailable" />
      <p role="alert" className="text-amber-200">
        Usage details could not be verified. No trial actions are available.
      </p>
    </PageShell>
  }

  const { entitlement, ledgerCounts } = usage.data
  const base = `/workspace/organizations/${org.organizationId}`
  return <PageShell>
    <PageHeader title="Usage & Trial"
      subtitle={`${org.organizationName} · ${org.role} · server-authoritative 30 Free Review Requests trial`}
      actions={<Link href="/workspace/organizations" className="text-blue-300 underline">
        Change business
      </Link>} />
    <nav aria-label="Business financial views" className="mb-5 flex gap-5 text-sm">
      {(org.role === 'OWNER' || org.role === 'ADMIN') &&
        <Link href={`${base}/billing`} className="text-blue-300 underline">
          Billing overview
        </Link>}
    </nav>
    <div className="grid gap-4 sm:grid-cols-2">
      <Panel className="p-6">
        <h2 className="font-semibold">Trial entitlement</h2>
        <p className="mt-3 text-lg text-blue-200">{entitlement.effectiveStatus}</p>
        <p className="mt-2 text-sm text-slate-300">
          {entitlement.remainingRequests} remaining of {entitlement.allocatedRequests} review requests
        </p>
        <p className="mt-2 text-xs text-slate-400">
          {entitlement.consumedRequests} consumed · Trial changes are not available here
        </p>
      </Panel>
      <Panel className="p-6">
        <h2 className="font-semibold">Usage ledger</h2>
        <p className="mt-3 text-sm text-slate-300">
          {ledgerCounts.initialRequestsCreated} initial requests · {ledgerCounts.remindersCreated} reminders
        </p>
        <p className="mt-2 text-sm text-slate-300">
          {ledgerCounts.providerSendAttempts} provider attempts · {ledgerCounts.trackedClicks} tracked clicks
        </p>
      </Panel>
    </div>
    <p className="mt-5 text-sm text-amber-200">
      Read-only business-specific usage. This view cannot reset trials or grant paid access.
    </p>
  </PageShell>
}
