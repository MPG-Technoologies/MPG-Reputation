import { headers } from 'next/headers'
import { getSupportTrialExtensionRequests } from '@/lib/support/trial-extension-requests'
import {
  AdminEmpty, AdminFacts, AdminFailure, AdminNotice, AdminSection,
  AdminStatus, AdminTable, OrganizationHeader, adminStyles as ui,
} from '@/components/admin/admin-ui'

export const dynamic = 'force-dynamic'

export default async function SupportTrialRequestsPage({
  params,
}: { params: Promise<{ organizationId: string }> }) {
  const h = await headers()
  // Prefetch must not cause a privileged inspection read or audit event.
  if (h.has('next-router-prefetch') || h.has('next-router-segment-prefetch') ||
      /prefetch/i.test(h.get('purpose') ?? '') ||
      /prefetch/i.test(h.get('sec-purpose') ?? '')) {
    return <p>Open this page directly to inspect trial extension requests.</p>
  }

  const { organizationId } = await params
  const result = await getSupportTrialExtensionRequests(organizationId)
  if (result.status === 'DISABLED') {
    return <AdminFailure unavailable>Local synthetic trial request inspection is disabled.</AdminFailure>
  }
  if (result.status === 'DENIED') {
    return <AdminFailure>Trial request inspection is not available to you.</AdminFailure>
  }
  if (result.status === 'UNAVAILABLE') {
    return <AdminFailure unavailable>Trial request records could not be verified and audited.</AdminFailure>
  }
  if (result.status !== 'AVAILABLE') {
    return <AdminFailure unavailable>Trial request snapshot is unavailable.</AdminFailure>
  }

  const { context, requests, truncated, snapshotAt } = result
  return (
    <>
      <OrganizationHeader organizationId={organizationId} active="trialRequests"
        title="Trial extension requests" snapshotAt={snapshotAt}
        description="MPG support-only, read-only view of pending requests in local synthetic testing." />
      <AdminFacts metrics items={[
        { label: 'Business', value: context.businessName },
        { label: 'Trial status', value: <AdminStatus>{context.trialStatus}</AdminStatus> },
        { label: 'Review requests used', value: `${context.consumed} / ${context.allocated}` },
        { label: 'Trial duration', value: `${context.durationDays} days` },
        { label: 'Trial expiry (UTC)', value: context.expiresAt ?? 'Not started' },
        { label: 'Pending requests shown', value: requests.length },
      ]} />
      <AdminNotice tone="warning" title="Review only — no trial changes">
        Requests do not grant free review requests, extend a trial, or activate a subscription.
        Approval, denial, reset, and entitlement mutation controls are not available.
        Staff access must be explicitly granted for each organization.
      </AdminNotice>
      <AdminSection title="Pending business requests"
        description="Reasons are visible only to authorized MPG support staff. Do not copy these notes to logs.">
        {truncated && (
          <AdminNotice tone="warning">Only the first 20 requests are shown.</AdminNotice>
        )}
        {requests.length === 0 ? (
          <AdminEmpty>No pending trial-extension requests for this business.</AdminEmpty>
        ) : (
          <AdminTable caption="Read-only pending trial extension requests"
            headings={['Request ID', 'Reason for extension', 'State', 'Requested (UTC)']} wide>
            {requests.map(item => (
              <tr key={item.id}>
                <th scope="row"><span className={ui.id}>{item.id}</span></th>
                <td className="whitespace-pre-wrap break-words">{item.reason}</td>
                <td><AdminStatus tone="warning">{item.status}</AdminStatus></td>
                <td><time dateTime={item.requestedAt}>{item.requestedAt}</time></td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminSection>
    </>
  )
}
