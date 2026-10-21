import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveCurrentServerOrganization } from '@/lib/workspace/server-active-organization'
import { deriveActivationReadiness } from '@/domain/activation'
import { PageHeader, PageShell } from '@/components/layout/page-shell'
import { Panel } from '@/components/layout/panels'
import { ScopedBusinessNav } from '@/components/workspace/scoped-business-nav'

export const dynamic = 'force-dynamic'

export default async function ScopedDashboard({
  params,
}: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params
  const access = await resolveCurrentServerOrganization(organizationId)
  if (access.outcome === 'AUTH_REQUIRED') redirect('/login')
  if (access.outcome !== 'SELECTED') return <PageShell>
    <PageHeader title="Dashboard unavailable" />
    <p role="alert">Business access could not be verified. No operational records were read.</p>
  </PageShell>
  const org = access.organization
  const supabase = await createClient()
  const [
    customers, completions, requests, locations, destinations,
  ] = await Promise.all([
    supabase.from('customers').select('id', { count: 'exact', head: true })
      .eq('organization_id', org.organizationId),
    supabase.from('customer_completion_events').select('id', { count: 'exact', head: true })
      .eq('organization_id', org.organizationId),
    supabase.from('review_requests').select('id', { count: 'exact', head: true })
      .eq('organization_id', org.organizationId),
    supabase.from('locations').select('id,name,status')
      .eq('organization_id', org.organizationId),
    supabase.from('review_destinations').select('location_id,status,canonical_url')
      .eq('organization_id', org.organizationId),
  ])
  if (customers.error || completions.error || requests.error ||
      customers.count === null || completions.count === null || requests.count === null ||
      locations.error || destinations.error ||
      !Array.isArray(locations.data) || !Array.isArray(destinations.data)) {
    return <PageShell><PageHeader title="Dashboard unavailable" />
      <p role="alert">Operational data could not be verified. No totals are displayed.</p>
    </PageShell>
  }
  const readiness = deriveActivationReadiness(locations.data, destinations.data)
  return <PageShell>
    <PageHeader title="Business dashboard"
      subtitle={`${org.organizationName} · ${org.role} · read-only operational overview`}
      actions={<Link href="/workspace/organizations" className="text-blue-300 underline">
        Change business
      </Link>} />
    <ScopedBusinessNav org={org} current="dashboard" />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[
        ['Customers', customers.count],
        ['Recorded completions', completions.count],
        ['Review requests', requests.count],
        ['Active locations', readiness.activeLocationCount],
        ['Locations needing Google destination', readiness.locationsNeedingDestinationCount],
      ].map(([label, count]) => <Panel key={label} className="p-6">
        <h2 className="text-sm text-slate-300">{label}</h2>
        <p className="mt-2 text-2xl font-semibold text-white">{count}</p>
      </Panel>)}
    </div>
    <p className="mt-5 text-sm text-amber-200">
      Business-specific reporting only. No completion dispatch, messaging or trial action is enabled here.
    </p>
  </PageShell>
}
