/**
 * MR-5E2: Correlate already authenticated, durable billing evidence.
 * Not an ingestion endpoint, provider lookup, ledger write or entitlement grant.
 */
import { assessPaymentEvidence, type PaymentEvidenceSnapshot } from './payment-evidence'

export interface DurableBillingEvent {
  readonly providerEventId: string
  readonly organizationId: string
  readonly subscriptionId: string
  readonly invoiceId: string
  readonly environment: 'TEST' | 'LIVE'
  readonly processingStatus: 'PROCESSED' | 'RECEIVED' | 'PROCESSING' | 'FAILED' | 'IGNORED'
  readonly eventType: 'invoice.paid' | 'invoice.payment_failed'
  readonly signatureVerified: boolean
}

export type CorrelationAssessment =
  | { readonly outcome: 'CORRELATED_EVIDENCE_ONLY' }
  | { readonly outcome: 'UNVERIFIED'; readonly reason:
      'INVALID_EVENTS' | 'PROVIDER_EVIDENCE' | 'NO_PROCESSED_INVOICE_EVENT' |
      'CONFLICTING_PAYMENT_EVENT' }

export function correlateInvoiceEvidence(args: {
  readonly evidence: PaymentEvidenceSnapshot | null
  readonly events: readonly DurableBillingEvent[]
  readonly organizationId: string
  readonly environment: 'TEST' | 'LIVE'
  readonly currency: string
  readonly now: string
  readonly maxEvidenceAgeMs: number
}): CorrelationAssessment {
  const unverified = (reason: Extract<CorrelationAssessment, { outcome: 'UNVERIFIED' }>['reason']): CorrelationAssessment =>
    ({ outcome: 'UNVERIFIED', reason })
  const evidence = assessPaymentEvidence(args.evidence, {
    organizationId: args.organizationId, environment: args.environment,
    expectedCurrency: args.currency, now: args.now,
    maxEvidenceAgeMs: args.maxEvidenceAgeMs,
  })
  if (evidence.outcome !== 'VERIFIED_PAYMENT_EVIDENCE' || !args.evidence) {
    return unverified('PROVIDER_EVIDENCE')
  }
  if (!Array.isArray(args.events) || args.events.length === 0 ||
      args.events.length > 100 || args.events.some(e =>
        !e || !/^evt_[A-Za-z0-9]+$/.test(e.providerEventId) ||
        !e.signatureVerified ||
        e.organizationId !== args.organizationId ||
        e.environment !== args.environment ||
        e.subscriptionId !== args.evidence!.subscriptionId ||
        e.invoiceId !== args.evidence!.invoiceId
      )) return unverified('INVALID_EVENTS')

  // Re-delivery of a provider event is harmless only when the records agree.
  const seen = new Map<string, DurableBillingEvent>()
  for (const event of args.events) {
    const previous = seen.get(event.providerEventId)
    if (previous && (previous.eventType !== event.eventType ||
        previous.processingStatus !== event.processingStatus)) {
      return unverified('INVALID_EVENTS')
    }
    seen.set(event.providerEventId, event)
  }
  if ([...seen.values()].some(e =>
    e.eventType === 'invoice.payment_failed' && e.processingStatus === 'PROCESSED')) {
    return unverified('CONFLICTING_PAYMENT_EVENT')
  }
  if (![...seen.values()].some(e =>
    e.eventType === 'invoice.paid' && e.processingStatus === 'PROCESSED')) {
    return unverified('NO_PROCESSED_INVOICE_EVENT')
  }
  // This evidence correlation never decides product access or invoice finality.
  return { outcome: 'CORRELATED_EVIDENCE_ONLY' }
}
