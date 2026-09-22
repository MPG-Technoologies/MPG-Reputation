import { headers } from 'next/headers'
import {
  getSupportHealthSnapshot,
  type SupportMessageWindow,
} from '@/lib/support/health-snapshot'

import {
  AdminFacts, AdminFailure, AdminNotice, AdminSection, AdminStatus,
  AdminTable, OrganizationHeader, adminStyles as ui,
} from '@/components/admin/admin-ui'

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

function MessagingWindows({ last24Hours, last7Days }: {
  last24Hours: SupportMessageWindow; last7Days: SupportMessageWindow
}) {
  const rows = [
    ['Send records — all providers', last24Hours.sendRecords.allProviders, last7Days.sendRecords.allProviders],
    ['Send records — Resend', last24Hours.sendRecords.resend, last7Days.sendRecords.resend],
    ['Delivered', last24Hours.providerEvents.delivered, last7Days.providerEvents.delivered],
    ['Delivery delayed', last24Hours.providerEvents.deliveryDelayed, last7Days.providerEvents.deliveryDelayed],
    ['Bounced', last24Hours.providerEvents.bounced, last7Days.providerEvents.bounced],
    ['Complained', last24Hours.providerEvents.complained, last7Days.providerEvents.complained],
    ['Failed', last24Hours.providerEvents.failed, last7Days.providerEvents.failed],
    ['Provider suppressed', last24Hours.providerEvents.suppressed, last7Days.providerEvents.suppressed],
    ['Incomplete persisted webhooks', last24Hours.incompletePersistedWebhooks, last7Days.incompletePersistedWebhooks],
  ] as const
  return (
    <AdminSection title="Messaging windows" description="Stored messaging records for this organization. Counts are factual observations, not a deliverability score.">
      <AdminTable caption="Messaging telemetry for the last 24 hours and last 7 days"
        headings={['Signal', 'Last 24 hours', 'Last 7 days']}>
        {rows.map(([label, day, week]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td className={ui.number}>{day}</td>
            <td className={ui.number}>{week}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminSection>
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
      <AdminFailure>
        This health snapshot is not
        available to you.
      </AdminFailure>
    )
  }

  if (
    result.status === 'UNAVAILABLE'
  ) {
    return (
      <AdminFailure unavailable>
        Operational health data is
        temporarily unavailable. No
        snapshot is displayed.
      </AdminFailure>
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
      <OrganizationHeader organizationId={organizationId} active="health"
        title="Operational health" snapshotAt={snapshotAt}
        description="Read-only internal telemetry. Missing telemetry is not treated as proof of health." />
      <AdminSection title="Outbox" description="Current stored outbox states. Payloads and raw errors are not displayed.">
        <AdminFacts metrics items={[
          { label: 'Pending untouched', value: outbox.pendingUntouched },
          { label: 'Retrying', value: outbox.retrying },
          { label: 'Stale untouched', value: outbox.staleUntouched },
          { label: 'Dispatched', value: outbox.dispatched },
          { label: 'Failed', value: outbox.failed },
          { label: 'Oldest pending age', value: ageLabel(outbox.oldestPendingAgeMinutes) },
        ]} />
      </AdminSection>
      <div className={ui.healthGrid}>
        <MessagingWindows last24Hours={last24Hours} last7Days={last7Days} />
        <div>
          <AdminSection title="Messaging configuration" description="Configuration presence only. Secrets and sender values are not exposed.">
            <AdminFacts items={[
              { label: 'Mode', value: <span className={ui.id}>{messaging.mode}</span> },
              { label: 'Provider intent', value: messaging.providerIntent },
              { label: 'Live email enabled', value: yesNo(messaging.liveEmailEnabled) },
              { label: 'API key configured', value: yesNo(messaging.apiKeyConfigured) },
              { label: 'From address configured', value: yesNo(messaging.fromAddressConfigured) },
              { label: 'Webhook verification configured', value: yesNo(messaging.webhookVerificationConfigured) },
            ]} />
          </AdminSection>
          <AdminSection title="Deliverability ratio">
            <AdminNotice>
              <AdminStatus>{deliverabilityRatios.status}</AdminStatus>
              <p className={ui.description}>
                A cohort-safe denominator is not yet calculated. Multiple lifecycle
                events can exist for one provider message, so MR-6C does not present
                a potentially misleading percentage.
              </p>
            </AdminNotice>
          </AdminSection>
        </div>
      </div>
    </>
  )
}
