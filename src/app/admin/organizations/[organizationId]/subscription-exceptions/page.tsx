import { headers } from 'next/headers'
import { getSupportSubscriptionExceptionCases } from '@/lib/support/subscription-exceptions'
import {
  AdminEmpty, AdminFacts, AdminFailure, AdminNotice, AdminSection,
  AdminStatus, AdminTable, OrganizationHeader, adminStyles as ui,
} from '@/components/admin/admin-ui'

export const dynamic = 'force-dynamic'

export default async function SupportSubscriptionExceptionsPage({
  params,
}: { params: Promise<{ organizationId: string }> }) {
  const h = await headers()
  if (h.has('next-router-prefetch') ||
      h.has('next-router-segment-prefetch') ||
      /prefetch/i.test(h.get('purpose') ?? '') ||
      /prefetch/i.test(h.get('sec-purpose') ?? '')) {
    return <p>Open this page directly to inspect synthetic subscription reviews.</p>
  }

  const { organizationId } = await params
  const result = await getSupportSubscriptionExceptionCases(organizationId)
  if (result.status === 'DISABLED') {
    return <AdminFailure unavailable>This internal synthetic subscription review is disabled.</AdminFailure>
  }
  if (result.status === 'DENIED') {
    return <AdminFailure>Subscription exception inspection is not available to you.</AdminFailure>
  }
  if (result.status === 'UNAVAILABLE') {
    return <AdminFailure unavailable>Review cases could not be inspected and audited.</AdminFailure>
  }
  if (result.status !== 'AVAILABLE') {
    return <AdminFailure unavailable>Review snapshot is unavailable.</AdminFailure>
  }

  return (
    <>
      <OrganizationHeader organizationId={organizationId}
        active="subscriptionExceptions" title="Subscription exception reviews"
        snapshotAt={result.snapshotAt}
        description="Read-only local synthetic review cases under scoped MPG support authorization." />
      <AdminFacts metrics items={[
        {label:'Open synthetic cases',value:result.cases.length},
        {label:'Payment recovery',value:result.cases.filter(c => c.reason === 'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW').length},
        {label:'Dispute/review holds',value:result.cases.filter(c => c.reason.includes('DISPUTE') || c.reason.includes('REFUND')).length},
      ]} />
      <AdminNotice tone="warning" title="Investigation only — not payment evidence">
        Every case is synthetic and unverified. This view cannot approve payments,
        recover subscriptions, settle disputes, authorize paid access, or close a case.
        Real provider and financial verification are separate future steps.
      </AdminNotice>
      <AdminSection title="Open subscription exception cases"
        description="Minimum internal identifiers only; no provider payloads or customer information.">
        {result.truncated && (
          <AdminNotice tone="warning">Only the first 20 cases are displayed.</AdminNotice>
        )}
        {result.cases.length === 0 ? (
          <AdminEmpty>No open synthetic subscription exception cases for this organization.</AdminEmpty>
        ) : (
          <AdminTable caption="Open synthetic subscription exception review cases"
            headings={['Case ID','Subscription record','Review reason','Status','Opened (UTC)']} wide>
            {result.cases.map(item => (
              <tr key={item.id}>
                <th scope="row"><span className={ui.id}>{item.id}</span></th>
                <td><span className={ui.id}>{item.subscriptionRecordId}</span></td>
                <td>{item.reason.replaceAll('_',' ')}</td>
                <td><AdminStatus tone="warning">OPEN</AdminStatus></td>
                <td><time dateTime={item.openedAt}>{item.openedAt}</time></td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminSection>
    </>
  )
}
