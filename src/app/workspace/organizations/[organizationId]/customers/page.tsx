import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveCurrentServerOrganization } from '@/lib/workspace/server-active-organization'
import { PageHeader, PageShell } from '@/components/layout/page-shell'
import { Panel } from '@/components/layout/panels'
import { ScopedBusinessNav } from '@/components/workspace/scoped-business-nav'

export const dynamic = 'force-dynamic'
const MAX_ROWS = 20

/** Minimal read-only customer history: no emails, phones, customer tokens,
 * privacy actions or completion mutations enter the scoped route. */
export default async function ScopedCustomers({
  params,
}: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params
  const access = await resolveCurrentServerOrganization(organizationId)
  if (access.outcome === 'AUTH_REQUIRED') redirect('/login')
  if (access.outcome !== 'SELECTED') return <PageShell>
    <PageHeader title="Customers unavailable" />
    <p role="alert">Business access could not be verified. No customer records were read.</p>
  </PageShell>
  const org = access.organization
  const supabase = await createClient()
  const { data: rows, error, count } = await supabase.from('customers')
    .select('id,first_name,last_name,permission_email', { count: 'exact' })
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)
  if (error || !Array.isArray(rows) || count === null) return <PageShell>
    <PageHeader title="Customers unavailable" />
    <p role="alert">Customer records could not be verified. No information is displayed.</p>
  </PageShell>
  return <PageShell>
    <PageHeader title="Customers"
      subtitle={`${org.organizationName} · ${count} customer record(s)`}
      actions={<Link href="/workspace/organizations" className="text-blue-300 underline">
        Change business
      </Link>} />
    <ScopedBusinessNav org={org} current="customers" />
    <Panel className="p-6">
      <h2 className="font-semibold">Most recent customers</h2>
      {rows.length === 0 ? <p className="mt-3 text-sm text-slate-400">No customer records found.</p>
        : <ul className="mt-4 divide-y divide-[#2A3A62]">
          {rows.map(row => <li key={row.id} className="flex justify-between gap-4 py-3 text-sm">
            <span className="text-white">
              {row.first_name === '[Deleted Customer]' ? 'Deleted customer'
                : [row.first_name, row.last_name].filter(Boolean).join(' ')}
            </span>
            <span className="text-slate-400">Email consent: {row.permission_email}</span>
          </li>)}
        </ul>}
      {count > MAX_ROWS && <p className="mt-3 text-xs text-amber-200">
        Showing only the latest {MAX_ROWS} of {count} customers.
      </p>}
    </Panel>
    <p className="mt-5 text-sm text-slate-400">
      Read-only overview; contact details, exports and erasure controls are not available from this page.
    </p>
  </PageShell>
}
