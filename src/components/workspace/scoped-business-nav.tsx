import Link from 'next/link'
import type { WorkspaceOrganizationChoice } from '@/domain/workspace/active-organization-policy'

/** Navigation hints only. Destination pages always revalidate current auth,
 * tenant membership and role; links never authorize an action. */
export function ScopedBusinessNav({ org, current }: {
  org: WorkspaceOrganizationChoice
  current: 'dashboard' | 'customers' | 'locations' | 'review-destination' | 'usage' | 'billing'
}) {
  const base = `/workspace/organizations/${org.organizationId}`
  const tabs = [
    { slug: 'dashboard', label: 'Dashboard' },
    { slug: 'customers', label: 'Customers' },
    { slug: 'locations', label: 'Locations' },
    { slug: 'review-destination', label: 'Google Destination' },
    { slug: 'usage', label: 'Usage & Trial' },
    ...(['OWNER', 'ADMIN'].includes(org.role)
      ? [{ slug: 'billing', label: 'Billing' }] : []),
  ]
  return <nav aria-label="Selected business views" className="mb-5 flex flex-wrap gap-3 text-sm">
    {tabs.map(tab => <Link key={tab.slug} href={`${base}/${tab.slug}`}
      aria-current={current === tab.slug ? 'page' : undefined}
      prefetch={false}
      className="rounded-md border border-[#2A3A62] px-3 py-2 text-blue-200 hover:text-white">
      {tab.label}
    </Link>)}
  </nav>
}
