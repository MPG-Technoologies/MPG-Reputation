import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveCurrentServerOrganization } from '@/lib/workspace/server-active-organization'
import { PageHeader, PageShell } from '@/components/layout/page-shell'
import { Panel } from '@/components/layout/panels'
import { ScopedBusinessNav } from '@/components/workspace/scoped-business-nav'

export const dynamic = 'force-dynamic'
const MAX_ROWS = 50

export default async function ScopedDestinations({
  params,
}: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params
  const access = await resolveCurrentServerOrganization(organizationId)
  if (access.outcome === 'AUTH_REQUIRED') redirect('/login')
  if (access.outcome !== 'SELECTED') return <PageShell>
    <PageHeader title="Google Destination unavailable" />
    <p role="alert">Business access could not be verified. No destination records were read.</p>
  </PageShell>
  const org = access.organization
  const supabase = await createClient()
  const [locations, destinations] = await Promise.all([
    supabase.from('locations')
      .select('id,name').eq('organization_id', org.organizationId),
    supabase.from('review_destinations')
      .select('id,location_id,status', { count: 'exact' })
      .eq('organization_id', org.organizationId)
      .order('created_at', { ascending: true })
      .limit(MAX_ROWS),
  ])
  if (locations.error || destinations.error ||
      !Array.isArray(locations.data) || !Array.isArray(destinations.data) ||
      destinations.count === null) return <PageShell>
    <PageHeader title="Google Destination unavailable" />
    <p role="alert">Destination status could not be verified. No information is displayed.</p>
  </PageShell>
  const names = new Map(locations.data.map(loc => [loc.id, loc.name]))
  if (destinations.data.some(row => !names.has(row.location_id))) return <PageShell>
    <PageHeader title="Google Destination unavailable" />
    <p role="alert">Destination location binding could not be verified.</p>
  </PageShell>
  return <PageShell>
    <PageHeader title="Google Review Destinations"
      subtitle={`${org.organizationName} · ${destinations.count} destination(s)`}
      actions={<Link href="/workspace/organizations" className="text-blue-300 underline">
        Change business
      </Link>} />
    <ScopedBusinessNav org={org} current="review-destination" />
    <Panel className="p-6">
      <h2 className="font-semibold">Confirmation status by location</h2>
      {destinations.data.length === 0
        ? <p className="mt-3 text-sm text-slate-400">No Google review destinations configured.</p>
        : <ul className="mt-4 divide-y divide-[#2A3A62]">
          {destinations.data.map(row => <li key={row.id}
            className="flex justify-between gap-4 py-3 text-sm">
            <span>{names.get(row.location_id)}</span>
            <span className="text-slate-400">{row.status.replaceAll('_',' ')}</span>
          </li>)}
        </ul>}
      {destinations.count > MAX_ROWS && <p className="mt-3 text-xs text-amber-200">
        Showing the first {MAX_ROWS} of {destinations.count} destinations.
      </p>}
    </Panel>
    <p className="mt-5 text-sm text-slate-400">
      Read-only. Destination URLs, confirmation and external messaging controls are not exposed here.
    </p>
  </PageShell>
}
