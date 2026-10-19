/**
 * MR-5I4D — synthetic-only invoice finality REVIEW policy.
 *
 * This is a pure simulation, NOT an invoice worker, provider authenticator,
 * settlement assertion, durable event finisher or entitlement authority.
 * Every input (including lease tokens, processed markers, event history and
 * provider assessments) is caller-supplied and UNTRUSTED in this module.
 *
 * Real successful finality needs a separately approved, atomic, source-
 * authenticated transaction. This function never returns PROCESSED, PAID,
 * an entitlement or permission to modify a database record.
 */
import type { ProviderEvidenceInspection } from './provider-evidence-port'
import type { PrivateInvoiceReadFinding } from '../../lib/billing/stripe-test-private-invoice-read-assembler'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT = /^evt_[A-Za-z0-9]+$/
const INVOICE = /^in_[A-Za-z0-9]+$/
const SUBSCRIPTION = /^sub_[A-Za-z0-9]+$/
const HASH = /^[0-9a-f]{64}$/
const MAX_HISTORY = 100

export interface SyntheticInvoiceLeaseSnapshot {
  readonly provider: 'stripe'
  readonly environment: 'TEST' | 'LIVE'
  readonly organizationId: string | null
  readonly providerEventId: string
  readonly eventType: string
  readonly providerInvoiceId: string | null
  readonly payloadHash: string
  readonly processingStatus: string
  readonly processedAt: string | null
  readonly processingLeaseToken: string | null
  readonly processingLeaseExpiresAt: string | null
  readonly processingAttemptCount: number
  readonly providerCreatedAt: string
}

export interface SyntheticPriorInvoiceEvent {
  readonly providerEventId: string
  readonly payloadHash: string
  readonly organizationId: string
  readonly subscriptionId: string
  readonly invoiceId: string
  readonly environment: 'TEST' | 'LIVE'
  readonly eventType: 'invoice.paid' | 'invoice.payment_failed'
  readonly processingStatus: 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'IGNORED'
  readonly providerCreatedAt: string
}

export type InvoiceFinalityReviewPlan =
  | { readonly outcome: 'BLOCKED'; readonly reason:
      'MODE_GATED' | 'LIVE_GATED' | 'INVALID_INPUT' | 'INVALID_HISTORY' |
      'TENANT_OR_EVENT_MISMATCH' | 'NOT_LEASE_HOLDER' |
      'LEASE_EXPIRED' | 'EVENT_NOT_IN_PROCESSING' |
      'PROVIDER_NOT_CONFIGURED' | 'PROVIDER_EVIDENCE_MISSING' |
      'CORRELATION_NOT_MATCHED' }
  | { readonly outcome: 'REVIEW_REQUIRED'; readonly reason:
      'DUPLICATE_IN_FLIGHT_OR_FAILED' | 'CONFLICTING_REPLAY' |
      'ALREADY_PROCESSED_INVOICE' | 'CONFLICTING_INVOICE_HISTORY' |
      'OUT_OF_ORDER_EVENT' | 'PAYMENT_FAILURE' }
  | { readonly outcome: 'NO_CHANGE'; readonly reason: 'ALREADY_PROCESSED_EVENT' }
  | { readonly outcome: 'PROPOSAL_ONLY'; readonly nextGate:
      'AUTHENTICATED_PROVIDER_AND_ATOMIC_FINALITY_REQUIRED' }

function epoch(value: unknown): number | null {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    return null
  }
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function blocked(reason: Extract<InvoiceFinalityReviewPlan, {outcome:'BLOCKED'}>['reason']): InvoiceFinalityReviewPlan {
  return { outcome: 'BLOCKED', reason }
}

function review(reason: Extract<InvoiceFinalityReviewPlan, {outcome:'REVIEW_REQUIRED'}>['reason']): InvoiceFinalityReviewPlan {
  return { outcome: 'REVIEW_REQUIRED', reason }
}

function validHistoryEvent(value: SyntheticPriorInvoiceEvent): boolean {
  return !!value && EVENT.test(value.providerEventId) &&
    HASH.test(value.payloadHash) && UUID.test(value.organizationId) &&
    SUBSCRIPTION.test(value.subscriptionId) && INVOICE.test(value.invoiceId) &&
    (value.environment === 'TEST' || value.environment === 'LIVE') &&
    (value.eventType === 'invoice.paid' || value.eventType === 'invoice.payment_failed') &&
    ['PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED'].includes(value.processingStatus) &&
    epoch(value.providerCreatedAt) !== null
}

/**
 * Review-only classification of invoice finality prerequisites.
 * `PROPOSAL_ONLY` explicitly means there is NO authorization to finalize.
 *
 * A signed receipt, a token-shaped string, a "PROCESSED" DTO and the
 * injected synthetic provider adapter never prove real provider provenance.
 * Timestamp ordering is a conservative rejection hint, never authority.
 */
export function planSyntheticInvoiceFinality(args: {
  readonly mode: 'LOCAL_SYNTHETIC' | 'HOSTED' | 'LIVE'
  readonly now: string
  readonly organizationId: string
  readonly subscriptionId: string
  readonly invoiceId: string
  readonly providerEventId: string
  readonly leaseToken: string
  readonly receipt: SyntheticInvoiceLeaseSnapshot
  readonly priorEvents: readonly SyntheticPriorInvoiceEvent[]
  readonly sourceRead: PrivateInvoiceReadFinding
  readonly providerInspection: ProviderEvidenceInspection | null
}): InvoiceFinalityReviewPlan {
  if (args?.mode !== 'LOCAL_SYNTHETIC') return blocked('MODE_GATED')
  if (args?.receipt?.environment === 'LIVE' ||
      (Array.isArray(args.priorEvents) && args.priorEvents.some(e => e?.environment === 'LIVE'))) {
    return blocked('LIVE_GATED')
  }

  const r = args.receipt
  const now = epoch(args.now)
  const created = epoch(r?.providerCreatedAt)
  const expires = epoch(r?.processingLeaseExpiresAt)
  if (now === null || created === null || created > now ||
      !UUID.test(args.organizationId) ||
      !SUBSCRIPTION.test(args.subscriptionId) ||
      !INVOICE.test(args.invoiceId) ||
      !EVENT.test(args.providerEventId) ||
      !UUID.test(args.leaseToken) ||
      !r || r.provider !== 'stripe' || r.environment !== 'TEST' ||
      !EVENT.test(r.providerEventId) ||
      !INVOICE.test(r.providerInvoiceId ?? '') ||
      !HASH.test(r.payloadHash) ||
      !['invoice.paid', 'invoice.payment_failed'].includes(r.eventType) ||
      !Number.isSafeInteger(r.processingAttemptCount) ||
      r.processingAttemptCount < 1 || r.processingAttemptCount > 3 ||
      !Array.isArray(args.priorEvents) ||
      args.priorEvents.length > MAX_HISTORY ||
      args.priorEvents.some(e => !validHistoryEvent(e))) {
    return blocked('INVALID_INPUT')
  }

  // The actual invoice lease has to be fenced in PostgreSQL, not this DTO.
  if (r.providerEventId !== args.providerEventId ||
      r.providerInvoiceId !== args.invoiceId ||
      r.organizationId !== null || r.processedAt !== null) {
    return blocked('TENANT_OR_EVENT_MISMATCH')
  }
  if (r.processingStatus !== 'PROCESSING') return blocked('EVENT_NOT_IN_PROCESSING')
  if (r.processingLeaseToken !== args.leaseToken) return blocked('NOT_LEASE_HOLDER')
  if (expires === null || expires <= now) return blocked('LEASE_EXPIRED')

  // Histories are supplied, may be partial or forged. Therefore the best
  // possible result stays PROPOSAL_ONLY and cannot confer financial authority.
  if (args.priorEvents.some(e =>
    e.organizationId !== args.organizationId ||
    e.subscriptionId !== args.subscriptionId ||
    e.providerCreatedAt && epoch(e.providerCreatedAt)! > now)) {
    return blocked('INVALID_HISTORY')
  }
  const sameId = args.priorEvents.filter(e => e.providerEventId === r.providerEventId)
  if (sameId.length > 0) {
    if (sameId.some(e => e.payloadHash !== r.payloadHash ||
        e.invoiceId !== r.providerInvoiceId || e.eventType !== r.eventType)) {
      return review('CONFLICTING_REPLAY')
    }
    if (sameId.length > 1 || sameId[0].processingStatus !== 'PROCESSED') {
      return review('DUPLICATE_IN_FLIGHT_OR_FAILED')
    }
    return { outcome: 'NO_CHANGE', reason: 'ALREADY_PROCESSED_EVENT' }
  }

  // No policy yet authorizes settling again or automatically correcting a
  // processed/failed event for the same invoice. Require human review.
  const sameInvoice = args.priorEvents.filter(e => e.invoiceId === r.providerInvoiceId)
  if (sameInvoice.some(e => e.eventType !== r.eventType ||
      e.processingStatus === 'PROCESSING' ||
      e.processingStatus === 'FAILED')) return review('CONFLICTING_INVOICE_HISTORY')
  if (sameInvoice.length > 0) return review('ALREADY_PROCESSED_INVOICE')

  // Provider event.created timestamps are NOT a unique monotonic version;
  // equal or earlier observations are grounds to reject, not to authorize.
  if (args.priorEvents.some(e => epoch(e.providerCreatedAt)! >= created)) {
    return review('OUT_OF_ORDER_EVENT')
  }
  if (r.eventType === 'invoice.payment_failed') return review('PAYMENT_FAILURE')

  if (args.sourceRead?.outcome === 'NOT_CONFIGURED' ||
      args.providerInspection === null ||
      args.providerInspection?.outcome === 'NOT_CONFIGURED') {
    return blocked('PROVIDER_NOT_CONFIGURED')
  }
  if (args.sourceRead?.outcome !== 'SYNTHETIC_MATCH_ONLY') {
    return blocked('CORRELATION_NOT_MATCHED')
  }
  if (args.providerInspection?.outcome !== 'EVIDENCE_ONLY') {
    return blocked('PROVIDER_EVIDENCE_MISSING')
  }

  // No claim of settled funds, processed event, or paid product access.
  return {
    outcome: 'PROPOSAL_ONLY',
    nextGate: 'AUTHENTICATED_PROVIDER_AND_ATOMIC_FINALITY_REQUIRED',
  }
}
