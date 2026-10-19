/**
 * MR-5E3C3A — read-only exception reconciliation for UNVERIFIED synthetic
 * subscription proposals. No provider credentials, DB access, runtime routes,
 * financial settlement, payment writes or request/entitlement authority.
 *
 * Input history is a synthetic test snapshot, NOT authenticated provider truth
 * or an exhaustive transaction history. The audit descriptor is ephemeral:
 * a future slice must independently verify, persist and protect review cases.
 */
import type {
  SubscriptionLifecycleStatus,
  SubscriptionLifecycleProposal,
} from './subscription-lifecycle-proposals'

type Candidate = Extract<SubscriptionLifecycleProposal, { outcome: 'PROPOSAL_ONLY' }>
export type ReconciliationAction = Candidate['action']

export interface SyntheticProposalFact {
  readonly organizationId: string
  readonly subscriptionRecordId: string
  readonly providerSubscriptionId: string
  readonly environment: 'TEST' | 'LIVE'
  readonly providerEventId: string
  readonly webhookEventRecordId: string
  readonly eventFingerprint: string
  readonly providerCreatedAt: string
  readonly action: ReconciliationAction
  readonly status: SubscriptionLifecycleStatus
  readonly periodEnd: string
  readonly sourceKind: 'SYNTHETIC'
  readonly verificationStatus: 'UNVERIFIED'
  readonly accessAuthorized: false
}

export type ReconciliationReason =
  | 'INVALID_INPUT' | 'LIVE_GATED' | 'TENANT_OR_SUBSCRIPTION_MISMATCH'
  | 'HISTORY_INVALID_OR_AMBIGUOUS' | 'EVENT_FINGERPRINT_CONFLICT'
  | 'OLDER_OR_EQUAL_TIME' | 'EXACT_EVENT_REPLAY'
  | 'INITIAL_SUBSCRIPTION_REQUIRES_REVIEW' | 'UNSUPPORTED_TRANSITION'
  | 'PAID_PERIOD_NOT_ADVANCED' | 'PAID_PERIOD_INVALID'
  | 'FAILED_PAYMENT_PERIOD_MISMATCH' | 'REPEATED_PAYMENT_FAILURE'
  | 'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW'
  | 'DISPUTE_OR_REFUND_HOLD' | 'CANCELLATION_HOLD'
  | 'TERMINAL_SUBSCRIPTION_HOLD' | 'END_BEFORE_PAID_PERIOD'
  | 'REFUND_OR_DISPUTE_REQUIRES_REVIEW'
  | 'SIMULATED_ACTIVATION' | 'SIMULATED_RENEWAL'
  | 'SIMULATED_PAYMENT_DUE' | 'SIMULATED_CANCEL_SCHEDULED'
  | 'SIMULATED_PERIOD_END'

export interface SyntheticReconciliationAudit {
  readonly organizationId: string
  readonly subscriptionRecordId: string
  readonly providerSubscriptionId: string
  readonly incomingEventId: string
  readonly incomingWebhookRecordId: string
  readonly previousEventId: string | null
  readonly assessedAt: string
  readonly reason: ReconciliationReason
  readonly environment: 'TEST'
  readonly sourceKind: 'SYNTHETIC'
  readonly evidenceVerified: false
  readonly accessAuthorized: false
  readonly durableAuditRecorded: false
}

export type SyntheticReconciliationResult =
  | { readonly outcome: 'REVIEW_REQUIRED'; readonly audit: SyntheticReconciliationAudit }
  | { readonly outcome: 'NO_CHANGE'; readonly audit: SyntheticReconciliationAudit }
  | {
      readonly outcome: 'SIMULATED_CANDIDATE_ONLY'
      readonly audit: SyntheticReconciliationAudit
      readonly candidate: {
        readonly status: SubscriptionLifecycleStatus
        readonly periodEnd: string
      }
    }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT_ID = /^evt_[A-Za-z0-9]+$/
const SUB_ID = /^sub_[A-Za-z0-9]+$/
const HASH = /^[0-9a-f]{64}$/
const MAX_HISTORY = 100
const ACTION_TO_STATUS: Record<ReconciliationAction, SubscriptionLifecycleStatus> = {
  INITIAL_ACTIVATION: 'ACTIVE',
  RENEWAL: 'ACTIVE',
  PAYMENT_DUE: 'PAST_DUE',
  SCHEDULE_CANCELLATION: 'CANCEL_AT_PERIOD_END',
  END_AT_PERIOD: 'ENDED',
  ESCALATE_FOR_REVIEW: 'REVIEW_REQUIRED',
}

function toEpoch(input: unknown): number | null {
  if (typeof input !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(input)) {
    return null
  }
  const t = Date.parse(input)
  return Number.isFinite(t) ? t : null
}

function validFact(fact: SyntheticProposalFact): boolean {
  return !!fact && UUID.test(fact.organizationId) &&
    UUID.test(fact.subscriptionRecordId) &&
    SUB_ID.test(fact.providerSubscriptionId) &&
    UUID.test(fact.webhookEventRecordId) &&
    EVENT_ID.test(fact.providerEventId) &&
    HASH.test(fact.eventFingerprint) &&
    fact.sourceKind === 'SYNTHETIC' &&
    fact.verificationStatus === 'UNVERIFIED' &&
    fact.accessAuthorized === false &&
    fact.environment === 'TEST' &&
    Object.prototype.hasOwnProperty.call(ACTION_TO_STATUS, fact.action) &&
    ACTION_TO_STATUS[fact.action] === fact.status &&
    toEpoch(fact.providerCreatedAt) !== null &&
    toEpoch(fact.periodEnd) !== null
}

/**
 * A conservative, deterministic, bounded review simulation. Each input fact
 * must later be assembled from trusted server-side ledger/event joins; a caller
 * supplying arbitrary "verified" flags cannot authorize billing.
 */
export function reconcileSyntheticSubscriptionExceptions(args: {
  readonly organizationId: string
  readonly subscriptionRecordId: string
  readonly providerSubscriptionId: string
  readonly environment: 'TEST' | 'LIVE'
  readonly history: readonly SyntheticProposalFact[]
  readonly incoming: SyntheticProposalFact
  readonly now: string
}): SyntheticReconciliationResult {
  const now = toEpoch(args?.now)
  const incoming = args?.incoming
  const history = args?.history
  const head = Array.isArray(history) && history.length ? history[history.length - 1] : null
  const auditBase: Omit<SyntheticReconciliationAudit, 'reason'> = {
    organizationId: args?.organizationId ?? '',
    subscriptionRecordId: args?.subscriptionRecordId ?? '',
    providerSubscriptionId: args?.providerSubscriptionId ?? '',
    incomingEventId: typeof incoming?.providerEventId === 'string' ? incoming.providerEventId : '',
    incomingWebhookRecordId:
      typeof incoming?.webhookEventRecordId === 'string' ? incoming.webhookEventRecordId : '',
    previousEventId: typeof head?.providerEventId === 'string' ? head.providerEventId : null,
    assessedAt: typeof args?.now === 'string' ? args.now : '',
    environment: 'TEST',
    sourceKind: 'SYNTHETIC',
    evidenceVerified: false,
    accessAuthorized: false,
    durableAuditRecorded: false,
  }
  const review = (reason: ReconciliationReason): SyntheticReconciliationResult => ({
    outcome: 'REVIEW_REQUIRED', audit: { ...auditBase, reason },
  })
  const allowed = (
    reason: ReconciliationReason,
  ): SyntheticReconciliationResult => ({
    outcome: 'SIMULATED_CANDIDATE_ONLY',
    audit: { ...auditBase, reason },
    candidate: { status: incoming.status, periodEnd: incoming.periodEnd },
  })

  if (now === null ||
      !UUID.test(args.organizationId) || !UUID.test(args.subscriptionRecordId) ||
      !SUB_ID.test(args.providerSubscriptionId) ||
      !Array.isArray(history) || history.length > MAX_HISTORY ||
      !validFact(incoming)) {
    return review('INVALID_INPUT')
  }
  if (args.environment !== 'TEST') return review('LIVE_GATED')

  function matches(fact: SyntheticProposalFact): boolean {
    return fact.organizationId === args.organizationId &&
      fact.subscriptionRecordId === args.subscriptionRecordId &&
      fact.providerSubscriptionId === args.providerSubscriptionId
  }
  if (!matches(incoming)) return review('TENANT_OR_SUBSCRIPTION_MISMATCH')
  if (toEpoch(incoming.providerCreatedAt)! > now) return review('INVALID_INPUT')

  let lastTime: number | null = null
  const seenEvents = new Map<string, SyntheticProposalFact>()
  const seenRecords = new Set<string>()
  for (const fact of history) {
    if (!validFact(fact)) return review('HISTORY_INVALID_OR_AMBIGUOUS')
    if (!matches(fact)) return review('TENANT_OR_SUBSCRIPTION_MISMATCH')
    const time = toEpoch(fact.providerCreatedAt)!
    if ((lastTime !== null && time <= lastTime) || time > now ||
        seenEvents.has(fact.providerEventId) ||
        seenRecords.has(fact.webhookEventRecordId)) {
      return review('HISTORY_INVALID_OR_AMBIGUOUS')
    }
    lastTime = time
    seenEvents.set(fact.providerEventId, fact)
    seenRecords.add(fact.webhookEventRecordId)
  }

  const existing = seenEvents.get(incoming.providerEventId)
  if (existing || seenRecords.has(incoming.webhookEventRecordId)) {
    if (existing && existing.webhookEventRecordId === incoming.webhookEventRecordId &&
        existing.eventFingerprint === incoming.eventFingerprint &&
        existing.action === incoming.action && existing.status === incoming.status &&
        toEpoch(existing.periodEnd) === toEpoch(incoming.periodEnd) &&
        toEpoch(existing.providerCreatedAt) === toEpoch(incoming.providerCreatedAt)) {
      return { outcome: 'NO_CHANGE', audit: { ...auditBase, reason: 'EXACT_EVENT_REPLAY' } }
    }
    return review('EVENT_FINGERPRINT_CONFLICT')
  }

  if (lastTime !== null && toEpoch(incoming.providerCreatedAt)! <= lastTime) {
    return review('OLDER_OR_EQUAL_TIME')
  }

  // A dispute, termination or cancellation hold cannot be removed by a new
  // event merely because it has a later provider timestamp. Such resolution
  // needs authenticated provider truth and an audited human/operator policy.
  if (history.some(x => x.status === 'REVIEW_REQUIRED')) {
    return review('DISPUTE_OR_REFUND_HOLD')
  }
  if (history.some(x => x.status === 'ENDED')) {
    return review('TERMINAL_SUBSCRIPTION_HOLD')
  }
  if (history.some(x => x.status === 'CANCEL_AT_PERIOD_END') &&
      incoming.action !== 'END_AT_PERIOD' && incoming.action !== 'ESCALATE_FOR_REVIEW') {
    return review('CANCELLATION_HOLD')
  }

  if (incoming.action === 'ESCALATE_FOR_REVIEW') {
    return review('REFUND_OR_DISPUTE_REQUIRES_REVIEW')
  }

  const incomingEnd = toEpoch(incoming.periodEnd)!
  if (!head) {
    if (incoming.action !== 'INITIAL_ACTIVATION') {
      return review('INITIAL_SUBSCRIPTION_REQUIRES_REVIEW')
    }
    return incomingEnd > now ? allowed('SIMULATED_ACTIVATION') :
      review('PAID_PERIOD_INVALID')
  }

  const headEnd = toEpoch(head.periodEnd)!
  switch (incoming.action) {
    case 'INITIAL_ACTIVATION':
      return review('INITIAL_SUBSCRIPTION_REQUIRES_REVIEW')
    case 'RENEWAL':
      if (head.status === 'PAST_DUE') {
        return review('PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW')
      }
      if (head.status !== 'ACTIVE') return review('UNSUPPORTED_TRANSITION')
      if (incomingEnd <= now) return review('PAID_PERIOD_INVALID')
      return incomingEnd > headEnd ? allowed('SIMULATED_RENEWAL') :
        review('PAID_PERIOD_NOT_ADVANCED')
    case 'PAYMENT_DUE':
      if (head.status === 'PAST_DUE') return review('REPEATED_PAYMENT_FAILURE')
      if (head.status !== 'ACTIVE') return review('UNSUPPORTED_TRANSITION')
      return incomingEnd === headEnd ? allowed('SIMULATED_PAYMENT_DUE') :
        review('FAILED_PAYMENT_PERIOD_MISMATCH')
    case 'SCHEDULE_CANCELLATION':
      if (head.status !== 'ACTIVE' && head.status !== 'PAST_DUE') {
        return review('UNSUPPORTED_TRANSITION')
      }
      return incomingEnd === headEnd && incomingEnd > now ?
        allowed('SIMULATED_CANCEL_SCHEDULED') : review('PAID_PERIOD_INVALID')
    case 'END_AT_PERIOD':
      if (head.status !== 'CANCEL_AT_PERIOD_END' &&
          head.status !== 'PAST_DUE' && head.status !== 'ACTIVE') {
        return review('UNSUPPORTED_TRANSITION')
      }
      return incomingEnd === headEnd && now >= headEnd ?
        allowed('SIMULATED_PERIOD_END') : review('END_BEFORE_PAID_PERIOD')
    default:
      return review('UNSUPPORTED_TRANSITION')
  }
}
