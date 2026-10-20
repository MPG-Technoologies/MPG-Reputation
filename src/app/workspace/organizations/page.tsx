import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader, PageShell } from '@/components/layout/page-shell'
import { Panel } from '@/components/layout/panels'
import { resolveCurrentServerOrganization } from '@/lib/workspace/server-active-organization'

export const dynamic = 'force-dynamic'

/**
 * Authenticated, RLS-scoped navigation only. These are current membership
 * choices, not permanent grants or mutation authority. The chosen route is
 * revalidated against fresh membership by the destination page.
 */
export default async function BusinessChooserPage() {
  const result = await resolveCurrentServerOrganization()
  if (result.outcome === 'AUTH_REQUIRED') redirect('/login')

  if (result.outcome !== 'SELECTED' && result.outcome !== 'SELECTION_REQUIRED') {
    return <PageShell>
      <PageHeader title="Choose a business" subtitle="Your businesses could not be verified." />
      <p role="alert" className="text-amber-200">
        Business access is unavailable. No organization records were opened.
      </p>
    </PageShell>
  }

  const organizations = result.outcome === 'SELECTED'
    ? [result.organization] : result.choices

  return <PageShell>
    <PageHeader title="Choose a business"
      subtitle="Select a business to review its operational dashboard, customers, locations, Google destinations, trial usage and TEST billing. Every page verifies current membership." />
    <div className="grid gap-4 sm:grid-cols-2">
      {organizations.map(org => {
        const base = `/workspace/organizations/${org.organizationId}`
        const canViewBilling = org.role === 'OWNER' || org.role === 'ADMIN'
        return <Panel className="p-6" key={org.organizationId}>
          <h2 className="text-lg font-semibold text-white">{org.organizationName}</h2>
          <p className="mt-1 text-xs text-slate-400">Membership role: {org.role}</p>
          <div className="mt-5 flex flex-wrap gap-4 text-sm">
            {[
              ['dashboard','Dashboard'],
              ['customers','Customers'],
              ['locations','Locations'],
              ['review-destination','Google Destination'],
            ].map(([slug,label]) =>
              <Link key={slug} href={`${base}/${slug}`}
                className="text-blue-300 hover:text-white underline">{label}</Link>)}
            <Link href={`${base}/usage`} className="text-blue-300 hover:text-white underline">
              Usage &amp; Trial
            </Link>
            {canViewBilling
              ? <Link href={`${base}/billing`} className="text-blue-300 hover:text-white underline">
                  Billing overview
                </Link>
              : <span className="text-slate-400">Billing requires owner or administrator</span>}
          </div>
        </Panel>
      })}
    </div>
    <p className="mt-6 text-sm text-amber-200">
      Scoped read-only engineering access. No payment, checkout, plan change or paid entitlement is enabled.
    </p>
  </PageShell>
}
