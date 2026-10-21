import { headers } from 'next/headers'
import { getSupportBillingRecoveryCases } from '@/lib/support/billing-recovery'
import {
  AdminEmpty, AdminFacts, AdminFailure, AdminNotice, AdminSection,
  AdminStatus, AdminTable, OrganizationHeader, adminStyles as ui,
} from '@/components/admin/admin-ui'

export const dynamic = 'force-dynamic'

export default async function SupportBillingRecoveryPage({
  params,
}: { params: Promise<{ organizationId: string }> }) {
  const requestHeaders = await headers()
  if (
    requestHeaders.has('next-router-prefetch') ||
    requestHeaders.has('next-router-segment-prefetch') ||
    /prefetch/i.test(requestHeaders.get('purpose') ?? '') ||
    /prefetch/i.test(requestHeaders.get('sec-purpose') ?? '')
  ) {
    return <p>Open this page directly to inspect billing recovery requests.</p>
  }

  const { organizationId } = await params
  const result = await getSupportBillingRecoveryCases(organizationId)

  if (result.status === 'DISABLED') {
    return <AdminFailure unavailable>This internal TEST billing review is disabled.</AdminFailure>
  }
  if (result.status === 'DENIED') {
    return <AdminFailure>Billing recovery inspection is not available to you.</AdminFailure>
  }
  if (result.status === 'UNAVAILABLE') {
    return <AdminFailure unavailable>Billing recovery records could not be inspected and audited.</AdminFailure>
  }

  return (
    <>
      <OrganizationHeader organizationId={organizationId} active="billingRecovery"
        title="Billing recovery reviews" snapshotAt={result.snapshotAt}
        description="Read-only local TEST review intake, under scoped MPG support authorization." />
      <AdminFacts metrics items={[
        { label: 'Open requests', value: result.cases.length },
        { label: 'Customer setup', value: result.cases.filter(c => c.kind === 'CUSTOMER_SETUP').length },
        { label: 'Checkout', value: result.cases.filter(c => c.kind === 'CHECKOUT').length },
      ]} />
      <AdminNotice tone="warning" title="Investigation only">
        An open request is not payment confirmation or authorization to reset a Stripe
        Customer, Checkout Session, subscription, or reservation. No recovery or
        entitlement-changing action is available on this page.
      </AdminNotice>
      <AdminSection title="Open recovery requests"
        description="Cases are derived from saved TEST reservation conditions, not Stripe settlement evidence.">
        {result.truncated && (
          <AdminNotice tone="warning">
            Only the first 20 cases are displayed.
          </AdminNotice>
        )}
        {result.cases.length === 0 ? (
          <AdminEmpty>
            No open TEST billing recovery review requests were found for this organization.
          </AdminEmpty>
        ) : (
          <AdminTable caption="Open TEST billing review requests"
            headings={['Case ID', 'Workflow', 'Reason', 'Status', 'Requested (UTC)']}>
            {result.cases.map(item => (
              <tr key={item.id}>
                <th scope="row"><span className={ui.id}>{item.id}</span></th>
                <td>{item.kind === 'CUSTOMER_SETUP' ? 'Customer setup' : 'Checkout'}</td>
                <td>{item.reason.replaceAll('_', ' ')}</td>
                <td><AdminStatus tone="warning">OPEN</AdminStatus></td>
                <td><time dateTime={item.requestedAt}>{item.requestedAt}</time></td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminSection>
    </>
  )
}
