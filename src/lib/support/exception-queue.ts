import 'server-only'

import { authorizeSupportAccess } from './access'
import { recordSupportExceptionQueueInspection } from './audit'

const CATEGORY_LIMIT = 20
const OUTBOX_STALE_MS = 10 * 60 * 1000
const WEBHOOK_STALE_MS = 5 * 60 * 1000

export interface SupportOutboxException {
  id: string
  kind: 'RETRYING' | 'STALE' | 'FAILED'
  eventType: string
  aggregateType: string
  aggregateId: string
  attemptCount: number
  createdAt: string
  ageMinutes: number
}

export interface SupportWebhookException {
  id: string
  kind: 'INCOMPLETE'
  provider: string
  eventType: string
  reviewRequestId: string
  status: string
  createdAt: string
  ageMinutes: number
}

export interface SupportReviewRequestException {
  id: string
  kind: 'FAILED'
  locationId: string
  channel: 'email' | 'sms'
  occurredAt: string
  ageMinutes: number
}

export interface SupportExceptionQueueSnapshot {
  outbox: SupportOutboxException[]
  webhooks: SupportWebhookException[]
  reviewRequests: SupportReviewRequestException[]
  truncated: {
    outbox: boolean
    webhooks: boolean
    reviewRequests: boolean
  }
  snapshotAt: string
}

export type SupportExceptionQueueResult =
  | { status: 'DENIED' }
  | { status: 'UNAVAILABLE' }
  | { status: 'AVAILABLE'; snapshot: SupportExceptionQueueSnapshot }

function ageMinutes(value: string, now: number): number {
  return Math.max(
    0,
    Math.floor((now - Date.parse(value)) / 60000)
  )
}

export async function getSupportExceptionQueue(
  organizationId: string
): Promise<SupportExceptionQueueResult> {
  const access = await authorizeSupportAccess(organizationId)

  if (!access) {
    return { status: 'DENIED' }
  }

  let snapshot: SupportExceptionQueueSnapshot

  try {
    const {
      supabase,
      organizationId: target,
    } = access

    const now = Date.now()
    const outboxCutoff = new Date(
      now - OUTBOX_STALE_MS
    ).toISOString()
    const webhookCutoff = new Date(
      now - WEBHOOK_STALE_MS
    ).toISOString()

    const [
      outboxFailedResult,
      outboxRetryingResult,
      outboxStaleResult,
      webhookResult,
      reviewRequestResult,
    ] = await Promise.all([
      supabase
        .from('domain_event_outbox')
        .select(
          'id,event_type,aggregate_type,aggregate_id,status,attempt_count,created_at'
        )
        .eq('organization_id', target)
        .eq('status', 'FAILED')
        .order('created_at', { ascending: true })
        .limit(CATEGORY_LIMIT + 1),

      supabase
        .from('domain_event_outbox')
        .select(
          'id,event_type,aggregate_type,aggregate_id,status,attempt_count,created_at'
        )
        .eq('organization_id', target)
        .eq('status', 'PENDING')
        .gt('attempt_count', 0)
        .order('created_at', { ascending: true })
        .limit(CATEGORY_LIMIT + 1),

      supabase
        .from('domain_event_outbox')
        .select(
          'id,event_type,aggregate_type,aggregate_id,status,attempt_count,created_at'
        )
        .eq('organization_id', target)
        .eq('status', 'PENDING')
        .eq('attempt_count', 0)
        .lt('created_at', outboxCutoff)
        .order('created_at', { ascending: true })
        .limit(CATEGORY_LIMIT + 1),

      supabase
        .from('message_events')
        .select(
          'id,review_request_id,provider,event_type,status,created_at'
        )
        .eq('organization_id', target)
        .not('provider_event_id', 'is', null)
        .is('processed_at', null)
        .lt('created_at', webhookCutoff)
        .order('created_at', { ascending: true })
        .limit(CATEGORY_LIMIT + 1),

      supabase
        .from('review_requests')
        .select(
          'id,location_id,channel,failed_at,created_at'
        )
        .eq('organization_id', target)
        .eq('status', 'FAILED')
        .order('created_at', { ascending: true })
        .limit(CATEGORY_LIMIT + 1),
    ])

    const results = [
      outboxFailedResult,
      outboxRetryingResult,
      outboxStaleResult,
      webhookResult,
      reviewRequestResult,
    ]

    if (
      results.some(
        (result) =>
          result.error ||
          !result.data
      )
    ) {
      throw new Error('SUPPORT_EXCEPTION_READ_UNAVAILABLE')
    }

    const failedOutbox =
      outboxFailedResult.data!.slice(0, CATEGORY_LIMIT)
    const retryingOutbox =
      outboxRetryingResult.data!.slice(0, CATEGORY_LIMIT)
    const staleOutbox =
      outboxStaleResult.data!.slice(0, CATEGORY_LIMIT)

    const outbox: SupportOutboxException[] = [
      ...failedOutbox.map((row) => ({
        id: row.id,
        kind: 'FAILED' as const,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        attemptCount: row.attempt_count,
        createdAt: row.created_at,
        ageMinutes: ageMinutes(row.created_at, now),
      })),

      ...retryingOutbox.map((row) => ({
        id: row.id,
        kind: 'RETRYING' as const,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        attemptCount: row.attempt_count,
        createdAt: row.created_at,
        ageMinutes: ageMinutes(row.created_at, now),
      })),

      ...staleOutbox.map((row) => ({
        id: row.id,
        kind: 'STALE' as const,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        attemptCount: row.attempt_count,
        createdAt: row.created_at,
        ageMinutes: ageMinutes(row.created_at, now),
      })),
    ].sort(
      (a, b) =>
        Date.parse(a.createdAt) -
        Date.parse(b.createdAt)
    )

    const webhooks: SupportWebhookException[] =
      webhookResult.data!
        .slice(0, CATEGORY_LIMIT)
        .map((row) => ({
          id: row.id,
          kind: 'INCOMPLETE' as const,
          provider: row.provider,
          eventType: row.event_type,
          reviewRequestId: row.review_request_id,
          status: row.status,
          createdAt: row.created_at,
          ageMinutes: ageMinutes(row.created_at, now),
        }))

    const reviewRequests: SupportReviewRequestException[] =
      reviewRequestResult.data!
        .slice(0, CATEGORY_LIMIT)
        .map((row) => {
          const occurredAt =
            row.failed_at ?? row.created_at

          return {
            id: row.id,
            kind: 'FAILED' as const,
            locationId: row.location_id,
            channel: row.channel,
            occurredAt,
            ageMinutes: ageMinutes(occurredAt, now),
          }
        })

    snapshot = {
      outbox,
      webhooks,
      reviewRequests,
      truncated: {
        outbox:
          outboxFailedResult.data!.length > CATEGORY_LIMIT ||
          outboxRetryingResult.data!.length > CATEGORY_LIMIT ||
          outboxStaleResult.data!.length > CATEGORY_LIMIT,
        webhooks:
          webhookResult.data!.length > CATEGORY_LIMIT,
        reviewRequests:
          reviewRequestResult.data!.length > CATEGORY_LIMIT,
      },
      snapshotAt: new Date(now).toISOString(),
    }
  } catch {
    await recordSupportExceptionQueueInspection(
      access,
      'UNAVAILABLE'
    )

    return { status: 'UNAVAILABLE' }
  }

  // Do not retain authorization blindly across a potentially slow read.
  const currentAccess =
    await authorizeSupportAccess(
      access.organizationId
    )

  if (
    !currentAccess ||
    currentAccess.actorId !== access.actorId
  ) {
    return { status: 'DENIED' }
  }

  if (
    !await recordSupportExceptionQueueInspection(
      currentAccess,
      'AVAILABLE'
    )
  ) {
    return { status: 'UNAVAILABLE' }
  }

  return {
    status: 'AVAILABLE',
    snapshot,
  }
}