import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveCurrentServerOrganization } from '@/lib/workspace/server-active-organization'
import { PageHeader, PageShell } from '@/components/layout/page-shell'
import { Panel } from '@/components/layout/panels'
import { ScopedBusinessNav } from '@/components/workspace/scoped-business-nav'

export const dynamic = 'force-dynamic'
const MAX_ROWS = 50

export default async function ScopedLocations({
  params,
}: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params
  const access = await resolveCurrentServerOrganization(organizationId)
  if (access.outcome === 'AUTH_REQUIRED') redirect('/login')
  if (access.outcome !== 'SELECTED') return <PageShell>
    <PageHeader title="Locations unavailable" />
    <p role="alert">Business access could not be verified. No location records were read.</p>
  </PageShell>
  const org = access.organization
  const supabase = await createClient()
  const { data: rows, error, count } = await supabase.from('locations')
    .select('id,name,status', { count: 'exact' })
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS)
  if (error || !Array.isArray(rows) || count === null) return <PageShell>
    <PageHeader title="Locations unavailable" />
    <p role="alert">Location records could not be verified. No information is displayed.</p>
  </PageShell>
  return <PageShell>
    <PageHeader title="Locations"
      subtitle={`${org.organizationName} · ${count} location(s)`}
      actions={<Link href="/workspace/organizations" className="text-blue-300 underline">
        Change business
      </Link>} />
    <ScopedBusinessNav org={org} current="locations" />
    <Panel className="p-6">
      <h2 className="font-semibold">Location status</h2>
      {rows.length === 0 ? <p className="mt-3 text-sm text-slate-400">No locations configured.</p>
        : <ul className="mt-4 divide-y divide-[#2A3A62]">
          {rows.map(row => <li key={row.id} className="flex justify-between gap-4 py-3 text-sm">
            <span>{row.name}</span><span className="text-slate-400">{row.status}</span>
          </li>)}
        </ul>}
      {count > MAX_ROWS && <p className="mt-3 text-xs text-amber-200">
        Showing the first {MAX_ROWS} of {count} locations.
      </p>}
    </Panel>
    <p className="mt-5 text-sm text-slate-400">Read-only. Location creation and configuration are not enabled here.</p>
  </PageShell>
}
