import { headers } from 'next/headers'
import { getSupportExceptionQueue } from '@/lib/support/exception-queue'
import { retryOutboxExceptionAction } from './actions'

export const dynamic = 'force-dynamic'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function recoveryNotice(
  status: string | undefined
): {
  className: string
  message: string
} | null {
  switch (status) {
    case 'DISPATCHED':
      return {
        className:
          'border-emerald-800 bg-emerald-950/30 text-emerald-200',
        message:
          'The eligible pending outbox event was dispatched. The refreshed queue reflects the latest stored state.',
      }

    case 'RETRY_FAILED':
      return {
        className:
          'border-amber-800 bg-amber-950/30 text-amber-200',
        message:
          'The retry attempt failed and the event remains pending. Raw provider or transport errors are not displayed here.',
      }

    case 'NO_LONGER_ELIGIBLE':
      return {
        className:
          'border-slate-700 bg-slate-900 text-slate-300',
        message:
          'The record changed before mutation and was no longer eligible for the bounded retry.',
      }

    case 'OUTCOME_UNKNOWN':
      return {
        className:
          'border-amber-800 bg-amber-950/30 text-amber-200',
        message:
          'The recovery outcome could not be confirmed. Do not retry blindly; inspect the refreshed queue and audit action ID.',
      }

    case 'OUTCOME_UNAVAILABLE':
      return {
        className:
          'border-amber-800 bg-amber-950/30 text-amber-200',
        message:
          'The action may have occurred, but the mandatory result audit could not be confirmed. Do not retry blindly.',
      }

    case 'UNAVAILABLE':
      return {
        className:
          'border-red-900 bg-red-950/30 text-red-200',
        message:
          'Recovery could not proceed because a required support dependency was unavailable.',
      }

    case 'NOT_ELIGIBLE':
      return {
        className:
          'border-slate-700 bg-slate-900 text-slate-300',
        message:
          'That record is not eligible for the bounded recovery action.',
      }

    case 'DENIED':
      return {
        className:
          'border-red-900 bg-red-950/30 text-red-200',
        message:
          'Support authorization was not current when the recovery action ran.',
      }

    case 'CONFIRMATION_REQUIRED':
      return {
        className:
          'border-amber-800 bg-amber-950/30 text-amber-200',
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
      <p role="alert">
        This exception queue is not available to you.
      </p>
    )
  }

  if (result.status === 'UNAVAILABLE') {
    return (
      <p role="alert">
        Operational exception data is temporarily unavailable.
        No queue snapshot is displayed.
      </p>
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-400">
            Organization
          </p>

          <p className="mt-1 break-all font-mono text-xs text-slate-300">
            {organizationId}
          </p>

          <h1 className="mt-4 text-2xl font-semibold">
            Operational exceptions
          </h1>

          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Operational signals requiring inspection. MR-6D permits
            only one audited retry of an eligible pending
            customer.completed outbox record. Webhook replay, FAILED
            reset, bulk recovery, review-request resend, and billing
            mutation remain unavailable.
          </p>
        </div>

        <nav
          aria-label="Organization support views"
          className="flex flex-wrap gap-4 text-sm font-medium"
        >
          <a
            href={`/admin/organizations/${organizationId}`}
            className="text-slate-300 underline underline-offset-4 hover:text-white"
          >
            Organization inspection
          </a>

          <a
            href={`/admin/organizations/${organizationId}/health`}
            className="text-slate-300 underline underline-offset-4 hover:text-white"
          >
            Operational health
          </a>
        </nav>
      </div>

      {notice && (
        <div
          role="status"
          className={`mt-6 rounded-lg border p-4 text-sm ${notice.className}`}
        >
          <p>
            {notice.message}
          </p>

          {safeActionId && (
            <p className="mt-2 break-all font-mono text-xs">
              Action ID: {safeActionId}
            </p>
          )}
        </div>
      )}

      <dl className="mt-6 grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800 p-4">
          <dt className="text-sm text-slate-400">
            Total visible
          </dt>
          <dd className="mt-1 text-2xl font-semibold">
            {total}
          </dd>
        </div>

        <div className="rounded-lg border border-slate-800 p-4">
          <dt className="text-sm text-slate-400">
            Outbox
          </dt>
          <dd className="mt-1 text-2xl font-semibold">
            {outbox.length}
          </dd>
        </div>

        <div className="rounded-lg border border-slate-800 p-4">
          <dt className="text-sm text-slate-400">
            Webhooks
          </dt>
          <dd className="mt-1 text-2xl font-semibold">
            {webhooks.length}
          </dd>
        </div>

        <div className="rounded-lg border border-slate-800 p-4">
          <dt className="text-sm text-slate-400">
            Failed requests
          </dt>
          <dd className="mt-1 text-2xl font-semibold">
            {reviewRequests.length}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs text-slate-500">
        Snapshot UTC:{' '}
        <time dateTime={snapshotAt}>
          {snapshotAt}
        </time>
      </p>

      {total === 0 && (
        <div className="mt-8 rounded-lg border border-slate-800 p-5">
          <h2 className="font-semibold">
            No current operational exceptions
          </h2>

          <p className="mt-2 text-sm text-slate-400">
            No exception matched the current bounded MR-6B
            rules at snapshot time. This is not a claim that
            every external dependency is healthy.
          </p>
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          Outbox exceptions
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          Retrying work, stale untouched work, and explicit failed
          records. Raw payloads and error strings are not displayed.
        </p>

        {truncated.outbox && (
          <p
            className="mt-3 text-sm text-amber-300"
            role="status"
          >
            Outbox results are truncated. Additional matching
            records exist.
          </p>
        )}

        {outbox.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            No outbox exceptions.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Operational outbox exceptions
              </caption>

              <thead className="bg-slate-900 text-slate-300">
                <tr>
                  <th scope="col" className="p-4">State</th>
                  <th scope="col" className="p-4">Event</th>
                  <th scope="col" className="p-4">Aggregate</th>
                  <th scope="col" className="p-4">Attempts</th>
                  <th scope="col" className="p-4">Age</th>
                  <th scope="col" className="p-4">Recovery</th>
                </tr>
              </thead>

              <tbody>
                {outbox.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-slate-800"
                  >
                    <td className="p-4 font-medium">
                      {item.kind}
                    </td>

                    <td className="p-4">
                      <div>{item.eventType}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">
                        {item.id}
                      </div>
                    </td>

                    <td className="p-4">
                      <div>{item.aggregateType}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">
                        {item.aggregateId}
                      </div>
                    </td>

                    <td className="p-4">
                      {item.attemptCount}
                    </td>

                    <td className="p-4">
                      {ageLabel(item.ageMinutes)}
                    </td>

                    <td className="p-4">
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
                          className="min-w-48 space-y-2"
                        >
                          <label className="flex items-start gap-2 text-xs text-slate-400">
                            <input
                              type="checkbox"
                              name="confirmation"
                              value="retry"
                              required
                              className="mt-0.5"
                            />

                            <span>
                              Confirm one bounded retry
                            </span>
                          </label>

                          <button
                            type="submit"
                            className="rounded-md border border-slate-600 px-3 py-2 text-xs font-medium text-slate-100 hover:border-slate-400 hover:bg-slate-900"
                          >
                            Retry pending event
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-slate-500">
                          Not available
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          Incomplete provider webhooks
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          Provider events that remain incomplete beyond the
          MR-6B observation window.
        </p>

        {truncated.webhooks && (
          <p
            className="mt-3 text-sm text-amber-300"
            role="status"
          >
            Webhook results are truncated. Additional matching
            records exist.
          </p>
        )}

        {webhooks.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            No incomplete provider webhook exceptions.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Incomplete provider webhook exceptions
              </caption>

              <thead className="bg-slate-900 text-slate-300">
                <tr>
                  <th scope="col" className="p-4">Provider</th>
                  <th scope="col" className="p-4">Event</th>
                  <th scope="col" className="p-4">Stored status</th>
                  <th scope="col" className="p-4">Review request</th>
                  <th scope="col" className="p-4">Age</th>
                </tr>
              </thead>

              <tbody>
                {webhooks.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-slate-800"
                  >
                    <td className="p-4">
                      {item.provider}
                    </td>

                    <td className="p-4">
                      {item.eventType}
                    </td>

                    <td className="p-4">
                      {item.status}
                    </td>

                    <td className="p-4 font-mono text-xs">
                      {item.reviewRequestId}
                    </td>

                    <td className="p-4">
                      {ageLabel(item.ageMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          Failed review requests
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          Failed workflow records are shown without customer
          identity, destination, token, or raw error content.
        </p>

        {truncated.reviewRequests && (
          <p
            className="mt-3 text-sm text-amber-300"
            role="status"
          >
            Failed request results are truncated. Additional
            matching records exist.
          </p>
        )}

        {reviewRequests.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            No failed review requests.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Failed review request exceptions
              </caption>

              <thead className="bg-slate-900 text-slate-300">
                <tr>
                  <th scope="col" className="p-4">Request</th>
                  <th scope="col" className="p-4">Location</th>
                  <th scope="col" className="p-4">Channel</th>
                  <th scope="col" className="p-4">Age</th>
                </tr>
              </thead>

              <tbody>
                {reviewRequests.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-slate-800"
                  >
                    <td className="p-4 font-mono text-xs">
                      {item.id}
                    </td>

                    <td className="p-4 font-mono text-xs">
                      {item.locationId}
                    </td>

                    <td className="p-4">
                      {item.channel}
                    </td>

                    <td className="p-4">
                      {ageLabel(item.ageMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
