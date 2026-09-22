import { headers } from 'next/headers'
import { getSupportExceptionQueue } from '@/lib/support/exception-queue'
import { retryOutboxExceptionAction } from './actions'
import {
  AdminEmpty, AdminFacts, AdminFailure, AdminNotice, AdminSection, AdminStatus,
  AdminTable, OrganizationHeader, adminStyles as ui, type AdminTone,
} from '@/components/admin/admin-ui'

export const dynamic = 'force-dynamic'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function recoveryNotice(
  status: string | undefined
): {
  tone: AdminTone
  message: string
} | null {
  switch (status) {
    case 'DISPATCHED':
      return {
        tone: 'success',
        message:
          'The eligible pending outbox event was dispatched. The refreshed queue reflects the latest stored state.',
      }

    case 'RETRY_FAILED':
      return {
        tone: 'warning',
        message:
          'The retry attempt failed and the event remains pending. Raw provider or transport errors are not displayed here.',
      }

    case 'NO_LONGER_ELIGIBLE':
      return {
        tone: 'neutral',
        message:
          'The record changed before mutation and was no longer eligible for the bounded retry.',
      }

    case 'OUTCOME_UNKNOWN':
      return {
        tone: 'warning',
        message:
          'The recovery outcome could not be confirmed. Do not retry blindly; inspect the refreshed queue and audit action ID.',
      }

    case 'OUTCOME_UNAVAILABLE':
      return {
        tone: 'warning',
        message:
          'The action may have occurred, but the mandatory result audit could not be confirmed. Do not retry blindly.',
      }

    case 'UNAVAILABLE':
      return {
        tone: 'danger',
        message:
          'Recovery could not proceed because a required support dependency was unavailable.',
      }

    case 'NOT_ELIGIBLE':
      return {
        tone: 'neutral',
        message:
          'That record is not eligible for the bounded recovery action.',
      }

    case 'DENIED':
      return {
        tone: 'danger',
        message:
          'Support authorization was not current when the recovery action ran.',
      }

    case 'CONFIRMATION_REQUIRED':
      return {
        tone: 'warning',
        message:
          'Explicit retry confirmation is required before this support action can run.',
      }

    default:
      return null
  }
}

function ageLabel(ageMinutes: number): string {
  if (ageMinutes < 60) {
    return `${ageMinutes} min`
  }

  const hours = Math.floor(ageMinutes / 60)
  const minutes = ageMinutes % 60

  return minutes > 0
    ? `${hours}h ${minutes}m`
    : `${hours}h`
}

export default async function SupportExceptionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>
  searchParams: Promise<{
    recovery?: string | string[]
    action?: string | string[]
  }>
}) {
  const requestHeaders = await headers()

  if (
    requestHeaders.has('next-router-prefetch') ||
    requestHeaders.has('next-router-segment-prefetch') ||
    /prefetch/i.test(requestHeaders.get('purpose') ?? '') ||
    /prefetch/i.test(requestHeaders.get('sec-purpose') ?? '')
  ) {
    return (
      <p>
        Open this page directly to inspect operational exceptions.
      </p>
    )
  }

  const { organizationId } = await params

  const query = await searchParams

  const recovery =
    typeof query.recovery === 'string'
      ? query.recovery
      : undefined

  const action =
    typeof query.action === 'string'
      ? query.action
      : undefined

  const notice =
    recoveryNotice(recovery)

  const safeActionId =
    action && UUID.test(action)
      ? action
      : null

  const result = await getSupportExceptionQueue(
    organizationId
  )

  if (result.status === 'DENIED') {
    return (
      <AdminFailure>
        This exception queue is not available to you.
      </AdminFailure>
    )
  }

  if (result.status === 'UNAVAILABLE') {
    return (
      <AdminFailure unavailable>
        Operational exception data is temporarily unavailable.
        No queue snapshot is displayed.
      </AdminFailure>
    )
  }

  const {
    outbox,
    webhooks,
    reviewRequests,
    truncated,
    snapshotAt,
  } = result.snapshot

  const total =
    outbox.length +
    webhooks.length +
    reviewRequests.length

  return (
    <>
      <OrganizationHeader organizationId={organizationId} active="exceptions"
        title="Operational exceptions" snapshotAt={snapshotAt}
        description="Operational signals requiring inspection." />
      {notice && (
        <AdminNotice tone={notice.tone} title="Recovery result">
          <p>{notice.message}</p>
          {safeActionId && <p className={ui.id}>Action ID: {safeActionId}</p>}
        </AdminNotice>
      )}
      <AdminFacts metrics items={[
        { label: 'Total visible', value: total },
        { label: 'Outbox', value: outbox.length },
        { label: 'Webhooks', value: webhooks.length },
        { label: 'Failed requests', value: reviewRequests.length },
      ]} />
      <AdminNotice title="Bounded recovery">
        MR-6D permits only one audited retry of an eligible pending customer.completed
        outbox record. Webhook replay, FAILED reset, bulk recovery, review-request
        resend, and billing mutation remain unavailable.
      </AdminNotice>
      {total === 0 && (
        <AdminEmpty>
          <h2>No current operational exceptions</h2>
          <p className={ui.description}>
            No exception matched the current bounded MR-6B rules at snapshot time.
            This is not a claim that every external dependency is healthy.
          </p>
        </AdminEmpty>
      )}
      <AdminSection title="Outbox exceptions" description="Retrying work, stale untouched work, and explicit failed records. Raw payloads and error strings are not displayed.">
        {truncated.outbox && <AdminNotice tone="warning">Outbox results are truncated. Additional matching records exist.</AdminNotice>}
        {outbox.length === 0 ? <AdminEmpty>No outbox exceptions.</AdminEmpty> : (
          <AdminTable wide caption="Operational outbox exceptions"
            headings={['State', 'Event', 'Aggregate', 'Attempts', 'Age', 'Recovery']}>
            {outbox.map((item) => (
              <tr key={item.id}>
                <td><AdminStatus tone={item.kind === 'FAILED' ? 'danger' : 'warning'}>{item.kind}</AdminStatus></td>
                <th scope="row">
                  <div>{item.eventType}</div>
                  <span className={ui.id}>{item.id}</span>
                </th>
                <td>
                  <div>{item.aggregateType}</div>
                  <span className={ui.id}>{item.aggregateId}</span>
                </td>
                <td className={ui.number}>{item.attemptCount}</td>
                <td className={ui.number}>{ageLabel(item.ageMinutes)}</td>
                <td>
                  {(
                    (
                      item.kind === 'RETRYING' ||
                      item.kind === 'STALE'
                    ) &&
                    item.eventType === 'customer.completed' &&
                    item.aggregateType ===
                      'customer_completion_event'
                  ) ? (
                    <form
                      action={retryOutboxExceptionAction.bind(
                        null,
                        organizationId,
                        item.id
                      )}
                      className={ui.recovery}
                    >
                      <label className={ui.confirmation}>
                        <input
                          type="checkbox"
                          name="confirmation"
                          value="retry"
                          required
                        />

                        <span>
                          Confirm one bounded retry
                        </span>
                      </label>

                      <button
                        type="submit"
                        className={ui.retryButton}
                      >
                        Retry pending event
                      </button>
                    </form>
                  ) : (
                    <span className={ui.unavailableAction}>
                      Not available
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminSection>
      <AdminSection title="Incomplete provider webhooks" description="Provider events that remain incomplete beyond the MR-6B observation window.">
        {truncated.webhooks && <AdminNotice tone="warning">Webhook results are truncated. Additional matching records exist.</AdminNotice>}
        {webhooks.length === 0 ? <AdminEmpty>No incomplete provider webhook exceptions.</AdminEmpty> : (
          <AdminTable caption="Incomplete provider webhook exceptions"
            headings={['Provider', 'Event', 'Stored status', 'Review request', 'Age']}>
            {webhooks.map((item) => (
              <tr key={item.id}>
                <td>{item.provider}</td>
                <th scope="row">{item.eventType}</th>
                <td>{item.status}</td>
                <td><span className={ui.id}>{item.reviewRequestId}</span></td>
                <td className={ui.number}>{ageLabel(item.ageMinutes)}</td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminSection>
      <AdminSection title="Failed review requests" description="Failed workflow records are shown without customer identity, destination, token, or raw error content.">
        {truncated.reviewRequests && <AdminNotice tone="warning">Failed request results are truncated. Additional matching records exist.</AdminNotice>}
        {reviewRequests.length === 0 ? <AdminEmpty>No failed review requests.</AdminEmpty> : (
          <AdminTable caption="Failed review request exceptions" headings={['Request', 'Location', 'Channel', 'Age']}>
            {reviewRequests.map((item) => (
              <tr key={item.id}>
                <th scope="row"><span className={ui.id}>{item.id}</span></th>
                <td><span className={ui.id}>{item.locationId}</span></td>
                <td>{item.channel}</td>
                <td className={ui.number}>{ageLabel(item.ageMinutes)}</td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminSection>
    </>
  )
}
