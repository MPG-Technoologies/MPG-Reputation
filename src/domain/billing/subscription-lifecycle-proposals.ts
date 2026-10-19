/**
 * MR-5E3A — credential-free subscription lifecycle PROPOSALS.
 *
 * This is an isolated policy simulator. It is NOT a product entitlement,
 * invoice-settlement decision, webhook worker, database transaction, or grant.
 * The caller-supplied evidence and PROCESSED markers are NOT authentication.
 * Never authorize requests or alter trial balances from this return value.
 */
import type { ProviderEvidenceInspection } from './provider-evidence-port'

export type SubscriptionLifecycleStatus =
  | 'ACTIVE' | 'PAST_DUE' | 'CANCEL_AT_PERIOD_END' | 'ENDED' | 'REVIEW_REQUIRED'

export interface SubscriptionLifecycleSnapshot {
  readonly organizationId: string
  readonly subscriptionId: string
  readonly environment: 'TEST' | 'LIVE'
  readonly status: SubscriptionLifecycleStatus
  readonly periodEnd: string
  readonly lastEventId: string
  readonly lastEventFingerprint: string
  readonly lastEventAt: string
}

export type SubscriptionLifecycleEventKind =
  | 'INVOICE_SETTLED'
  | 'INVOICE_FAILED'
  | 'CANCEL_SCHEDULED'
  | 'CANCEL_EFFECTIVE'
  | 'PERIOD_EXPIRED'
  | 'REFUND_OR_DISPUTE'

export interface SubscriptionLifecycleEvent {
  readonly eventId: string
  readonly fingerprint: string
  readonly kind: SubscriptionLifecycleEventKind
  readonly organizationId: string
  readonly subscriptionId: string
  readonly environment: 'TEST' | 'LIVE'
  readonly occurredAt: string
  readonly periodEnd: string
}

/** External authority is NOT established by a string passed to this method.
 * The future worker must independently prove all of the following facts. */
export interface SubscriptionLifecycleProof {
  readonly durableEventStatus: 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'IGNORED'
  readonly providerInvoiceAssessment: ProviderEvidenceInspection | null
  readonly statusChangeVerified: boolean
}

export type SubscriptionLifecycleProposal =
  | { readonly outcome: 'NO_CHANGE'; readonly reason: 'DUPLICATE_EVENT' }
  | {
      readonly outcome: 'BLOCKED'
      readonly reason:
        | 'INVALID_INPUT' | 'LIVE_GATED' | 'UNPROCESSED_EVENT'
        | 'TENANT_OR_SUBSCRIPTION_MISMATCH' | 'EVENT_FINGERPRINT_CONFLICT'
        | 'STALE_OR_CONFLICTING_EVENT' | 'PROVIDER_PROOF_REQUIRED'
        | 'NO_PRIOR_SUBSCRIPTION' | 'PERIOD_INVALID'
        | 'TERMINAL_REQUIRES_NEW_SUBSCRIPTION' | 'CANCELLATION_REQUIRES_REVIEW'
    }
  | {
      readonly outcome: 'PROPOSAL_ONLY'
      readonly action:
        | 'INITIAL_ACTIVATION' | 'RENEWAL' | 'PAYMENT_DUE'
        | 'SCHEDULE_CANCELLATION' | 'END_AT_PERIOD'
        | 'ESCALATE_FOR_REVIEW'
      readonly candidate: SubscriptionLifecycleSnapshot
    }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUB_ID = /^sub_[A-Za-z0-9]+$/
const EVENT_ID = /^evt_[A-Za-z0-9]+$/
const FINGERPRINT = /^[a-f0-9]{64}$/
const STATUSES: readonly SubscriptionLifecycleStatus[] = [
  'ACTIVE', 'PAST_DUE', 'CANCEL_AT_PERIOD_END', 'ENDED', 'REVIEW_REQUIRED',
]
const KINDS: readonly SubscriptionLifecycleEventKind[] = [
  'INVOICE_SETTLED', 'INVOICE_FAILED', 'CANCEL_SCHEDULED',
  'CANCEL_EFFECTIVE', 'PERIOD_EXPIRED', 'REFUND_OR_DISPUTE',
]

function epoch(value: unknown): number | null {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

function blocked(
  reason: Extract<SubscriptionLifecycleProposal, { outcome: 'BLOCKED' }>['reason']
): SubscriptionLifecycleProposal {
  return { outcome: 'BLOCKED', reason }
}

function isValidEvent(event: SubscriptionLifecycleEvent, now: number): boolean {
  const occurred = epoch(event?.occurredAt)
  return !!event && EVENT_ID.test(event.eventId) &&
    FINGERPRINT.test(event.fingerprint) &&
    KINDS.includes(event.kind) && UUID.test(event.organizationId) &&
    SUB_ID.test(event.subscriptionId) &&
    (event.environment === 'TEST' || event.environment === 'LIVE') &&
    occurred !== null && occurred <= now && epoch(event.periodEnd) !== null
}

function isValidCurrent(current: SubscriptionLifecycleSnapshot): boolean {
  return UUID.test(current.organizationId) &&
    SUB_ID.test(current.subscriptionId) &&
    (current.environment === 'TEST' || current.environment === 'LIVE') &&
    STATUSES.includes(current.status) &&
    EVENT_ID.test(current.lastEventId) &&
    FINGERPRINT.test(current.lastEventFingerprint) &&
    epoch(current.periodEnd) !== null && epoch(current.lastEventAt) !== null
}

/**
 * Simulate what a future, separately authorized transaction might propose.
 * A proposed ACTIVE lifecycle is not paid product entitlement. No trial,
 * message allowance, billing subscription, or RLS record is mutated.
 */
export function proposeSubscriptionLifecycle(args: {
  readonly current: SubscriptionLifecycleSnapshot | null
  readonly event: SubscriptionLifecycleEvent
  readonly proof: SubscriptionLifecycleProof
  readonly now: string
}): SubscriptionLifecycleProposal {
  const now = epoch(args.now)
  if (now === null || !isValidEvent(args.event, now) ||
      (args.current && !isValidCurrent(args.current))) return blocked('INVALID_INPUT')

  const { current, event, proof } = args
  if (event.environment !== 'TEST' || current?.environment === 'LIVE') {
    return blocked('LIVE_GATED')
  }
  if (current && (current.organizationId !== event.organizationId ||
      current.subscriptionId !== event.subscriptionId ||
      current.environment !== event.environment)) {
    return blocked('TENANT_OR_SUBSCRIPTION_MISMATCH')
  }
  if (!proof || proof.durableEventStatus !== 'PROCESSED') {
    return blocked('UNPROCESSED_EVENT')
  }
  if (current?.lastEventId === event.eventId) {
    return current.lastEventFingerprint === event.fingerprint
      ? { outcome: 'NO_CHANGE', reason: 'DUPLICATE_EVENT' }
      : blocked('EVENT_FINGERPRINT_CONFLICT')
  }
  if (current && epoch(event.occurredAt)! <= epoch(current.lastEventAt)!) {
    return blocked('STALE_OR_CONFLICTING_EVENT')
  }

  const priorEnd = current ? epoch(current.periodEnd)! : null
  const eventEnd = epoch(event.periodEnd)!
  const proposed = (
    status: SubscriptionLifecycleStatus,
    periodEnd: string,
    action: Extract<SubscriptionLifecycleProposal, { outcome: 'PROPOSAL_ONLY' }>['action']
  ): SubscriptionLifecycleProposal => ({
    outcome: 'PROPOSAL_ONLY',
    action,
    candidate: {
      organizationId: event.organizationId,
      subscriptionId: event.subscriptionId,
      environment: 'TEST',
      status,
      periodEnd,
      lastEventId: event.eventId,
      lastEventFingerprint: event.fingerprint,
      lastEventAt: event.occurredAt,
    },
  })

  if (event.kind === 'INVOICE_SETTLED') {
    // The only positive lifecycle proposal must be supported by provider
    // evidence AND a separately PROCESSED signed webhook (both future work).
    if (proof.providerInvoiceAssessment?.outcome !== 'EVIDENCE_ONLY') {
      return blocked('PROVIDER_PROOF_REQUIRED')
    }
    if (eventEnd <= now) return blocked('PERIOD_INVALID')
    if (current?.status === 'ENDED') {
      return blocked('TERMINAL_REQUIRES_NEW_SUBSCRIPTION')
    }
    if (current?.status === 'CANCEL_AT_PERIOD_END') {
      return blocked('CANCELLATION_REQUIRES_REVIEW')
    }
    if (current && eventEnd <= priorEnd!) return blocked('PERIOD_INVALID')
    return proposed('ACTIVE', event.periodEnd, current ? 'RENEWAL' : 'INITIAL_ACTIVATION')
  }

  // No other lifecycle event may use an EVIDENCE_ONLY payment result as proof
  // of a provider status change. The future adapter must verify status too.
  if (proof.statusChangeVerified !== true) {
    return blocked('PROVIDER_PROOF_REQUIRED')
  }
  if (!current) return blocked('NO_PRIOR_SUBSCRIPTION')
  if (current.status === 'ENDED') {
    return blocked('TERMINAL_REQUIRES_NEW_SUBSCRIPTION')
  }

  if (event.kind === 'INVOICE_FAILED') {
    // Failure never extends a paid period or creates a grace entitlement.
    if (eventEnd !== priorEnd) return blocked('PERIOD_INVALID')
    return proposed('PAST_DUE', current.periodEnd, 'PAYMENT_DUE')
  }
  if (event.kind === 'CANCEL_SCHEDULED') {
    if (eventEnd !== priorEnd || priorEnd! <= now) {
      return blocked('PERIOD_INVALID')
    }
    return proposed('CANCEL_AT_PERIOD_END', current.periodEnd, 'SCHEDULE_CANCELLATION')
  }
  if (event.kind === 'CANCEL_EFFECTIVE' || event.kind === 'PERIOD_EXPIRED') {
    if (eventEnd !== priorEnd || priorEnd! > now) {
      return blocked('PERIOD_INVALID')
    }
    return proposed('ENDED', current.periodEnd, 'END_AT_PERIOD')
  }

  // Refund/dispute never turns into a successful paid entitlement.
  if (eventEnd !== priorEnd) return blocked('PERIOD_INVALID')
  return proposed('REVIEW_REQUIRED', current.periodEnd, 'ESCALATE_FOR_REVIEW')
}
