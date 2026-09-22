import { headers } from 'next/headers'
import {
  getSupportHealthSnapshot,
  type SupportMessageWindow,
} from '@/lib/support/health-snapshot'

export const dynamic = 'force-dynamic'

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No'
}

function ageLabel(
  ageMinutes: number | null
): string {
  if (ageMinutes === null) {
    return 'No pending work'
  }

  if (ageMinutes < 60) {
    return `${ageMinutes} min`
  }

  const hours =
    Math.floor(ageMinutes / 60)

  const minutes =
    ageMinutes % 60

  return minutes > 0
    ? `${hours}h ${minutes}m`
    : `${hours}h`
}

function MessagingWindow({
  title,
  window,
}: {
  title: string
  window: SupportMessageWindow
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">
        {title}
      </h2>

      <p className="mt-2 text-sm text-slate-400">
        Stored messaging records for this organization.
        Counts are factual observations, not a deliverability
        score.
      </p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            {title} messaging telemetry
          </caption>

          <thead className="bg-slate-900 text-slate-300">
            <tr>
              <th scope="col" className="p-4">
                Signal
              </th>
              <th scope="col" className="p-4">
                Count
              </th>
            </tr>
          </thead>

          <tbody>
            <tr className="border-t border-slate-800">
              <th scope="row" className="p-4 font-medium">
                Send records — all providers
              </th>
              <td className="p-4">
                {window.sendRecords.allProviders}
              </td>
            </tr>

            <tr className="border-t border-slate-800">
              <th scope="row" className="p-4 font-medium">
                Send records — Resend
              </th>
              <td className="p-4">
                {window.sendRecords.resend}
              </td>
            </tr>

            <tr className="border-t border-slate-800">
              <th scope="row" className="p-4 font-medium">
                Delivered
              </th>
              <td className="p-4">
                {window.providerEvents.delivered}
              </td>
            </tr>

            <tr className="border-t border-slate-800">
              <th scope="row" className="p-4 font-medium">
                Delivery delayed
              </th>
              <td className="p-4">
                {window.providerEvents.deliveryDelayed}
              </td>
            </tr>

            <tr className="border-t border-slate-800">
              <th scope="row" className="p-4 font-medium">
                Bounced
              </th>
              <td className="p-4">
                {window.providerEvents.bounced}
              </td>
            </tr>

            <tr className="border-t border-slate-800">
              <th scope="row" className="p-4 font-medium">
                Complained
              </th>
              <td className="p-4">
                {window.providerEvents.complained}
              </td>
            </tr>

            <tr className="border-t border-slate-800">
              <th scope="row" className="p-4 font-medium">
                Failed
              </th>
              <td className="p-4">
                {window.providerEvents.failed}
              </td>
            </tr>

            <tr className="border-t border-slate-800">
              <th scope="row" className="p-4 font-medium">
                Provider suppressed
              </th>
              <td className="p-4">
                {window.providerEvents.suppressed}
              </td>
            </tr>

            <tr className="border-t border-slate-800">
              <th scope="row" className="p-4 font-medium">
                Incomplete persisted webhooks
              </th>
              <td className="p-4">
                {window.incompletePersistedWebhooks}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default async function SupportHealthPage({
  params,
}: {
  params: Promise<{
    organizationId: string
  }>
}) {
  const requestHeaders =
    await headers()

  if (
    requestHeaders.has(
      'next-router-prefetch'
    ) ||
    requestHeaders.has(
      'next-router-segment-prefetch'
    ) ||
    /prefetch/i.test(
      requestHeaders.get('purpose') ?? ''
    ) ||
    /prefetch/i.test(
      requestHeaders.get(
        'sec-purpose'
      ) ?? ''
    )
  ) {
    return (
      <p>
        Open this page directly to inspect
        operational health.
      </p>
    )
  }

  const { organizationId } =
    await params

  const result =
    await getSupportHealthSnapshot(
      organizationId
    )

  if (result.status === 'DENIED') {
    return (
      <p role="alert">
        This health snapshot is not
        available to you.
      </p>
    )
  }

  if (
    result.status === 'UNAVAILABLE'
  ) {
    return (
      <p role="alert">
        Operational health data is
        temporarily unavailable. No
        snapshot is displayed.
      </p>
    )
  }

  const {
    messaging,
    last24Hours,
    last7Days,
    outbox,
    deliverabilityRatios,
    snapshotAt,
  } = result.snapshot

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-400">
            Organization
          </p>

          <p className="mt-1 break-all font-mono text-xs text-slate-300">
            {organizationId}
          </p>

          <h1 className="mt-4 text-2xl font-semibold">
            Operational health
          </h1>

          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Read-only internal telemetry.
            Missing telemetry is not treated
            as proof of health.
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
            href={`/admin/organizations/${organizationId}/exceptions`}
            className="text-slate-300 underline underline-offset-4 hover:text-white"
          >
            Operational exceptions
          </a>
        </nav>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Snapshot UTC:{' '}
        <time dateTime={snapshotAt}>
          {snapshotAt}
        </time>
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          Messaging configuration
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          Configuration presence only.
          Secrets and sender values are not
          exposed.
        </p>

        <dl className="mt-4 grid gap-4 rounded-lg border border-slate-800 p-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-slate-400">
              Mode
            </dt>
            <dd className="mt-1">
              {messaging.mode}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-slate-400">
              Provider intent
            </dt>
            <dd className="mt-1">
              {messaging.providerIntent}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-slate-400">
              Live email enabled
            </dt>
            <dd className="mt-1">
              {yesNo(
                messaging.liveEmailEnabled
              )}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-slate-400">
              API key configured
            </dt>
            <dd className="mt-1">
              {yesNo(
                messaging.apiKeyConfigured
              )}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-slate-400">
              From address configured
            </dt>
            <dd className="mt-1">
              {yesNo(
                messaging.fromAddressConfigured
              )}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-slate-400">
              Webhook verification configured
            </dt>
            <dd className="mt-1">
              {yesNo(
                messaging.webhookVerificationConfigured
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          Outbox
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          Current stored outbox states.
          Payloads and raw errors are not
          displayed.
        </p>

        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-800 p-4">
            <dt className="text-sm text-slate-400">
              Pending untouched
            </dt>
            <dd className="mt-1 text-2xl font-semibold">
              {outbox.pendingUntouched}
            </dd>
          </div>

          <div className="rounded-lg border border-slate-800 p-4">
            <dt className="text-sm text-slate-400">
              Retrying
            </dt>
            <dd className="mt-1 text-2xl font-semibold">
              {outbox.retrying}
            </dd>
          </div>

          <div className="rounded-lg border border-slate-800 p-4">
            <dt className="text-sm text-slate-400">
              Stale untouched
            </dt>
            <dd className="mt-1 text-2xl font-semibold">
              {outbox.staleUntouched}
            </dd>
          </div>

          <div className="rounded-lg border border-slate-800 p-4">
            <dt className="text-sm text-slate-400">
              Dispatched
            </dt>
            <dd className="mt-1 text-2xl font-semibold">
              {outbox.dispatched}
            </dd>
          </div>

          <div className="rounded-lg border border-slate-800 p-4">
            <dt className="text-sm text-slate-400">
              Failed
            </dt>
            <dd className="mt-1 text-2xl font-semibold">
              {outbox.failed}
            </dd>
          </div>

          <div className="rounded-lg border border-slate-800 p-4">
            <dt className="text-sm text-slate-400">
              Oldest pending age
            </dt>
            <dd className="mt-1 text-2xl font-semibold">
              {ageLabel(
                outbox.oldestPendingAgeMinutes
              )}
            </dd>
          </div>
        </dl>
      </section>

      <MessagingWindow
        title="Last 24 hours"
        window={last24Hours}
      />

      <MessagingWindow
        title="Last 7 days"
        window={last7Days}
      />

      <section className="mt-8 rounded-lg border border-slate-800 p-5">
        <h2 className="font-semibold">
          Deliverability ratio
        </h2>

        <p className="mt-2 text-sm text-slate-300">
          {deliverabilityRatios.status}
        </p>

        <p className="mt-2 text-sm text-slate-400">
          A cohort-safe denominator is not
          yet calculated. Multiple lifecycle
          events can exist for one provider
          message, so MR-6C does not present
          a potentially misleading percentage.
        </p>
      </section>
    </>
  )
}
