/**
 * Stage 1: closed, read-only analysis of PRIVATE SYNTHETIC billing evidence.
 *
 * The real invoice-to-checkout association is NOT established by these local
 * rows. Even a completely matching graph lacks independent authenticated
 * provider provenance, frozen accepted commercial terms and financial finality.
 * Never consume this function's result as payment, an entitlement or a grant.
 */
import {
  compareSyntheticFrozenInvoiceCandidates,
  type SyntheticFrozenCheckoutQuote,
  type SyntheticInvoiceEvidenceCandidate,
} from './synthetic-frozen-invoice-consistency'

type ExtraQuote = SyntheticFrozenCheckoutQuote & {
  readonly checkout_reservation_id: unknown
  readonly plan_id: unknown
}
type ExtraInvoice = SyntheticInvoiceEvidenceCandidate & {
  readonly subscription_record_id: unknown
  readonly webhook_event_record_id: unknown
  readonly provider_event_id: unknown
  readonly source_payload_hash: unknown
}
interface SharedIdentity {
  readonly id: unknown
  readonly organization_id: unknown
  readonly billing_account_id: unknown
  readonly provider: unknown
  readonly environment: unknown
}
export interface SyntheticCheckoutReservation extends SharedIdentity {
  readonly provider_customer_id: unknown
  readonly provider_price_id: unknown
  readonly plan_id: unknown
  readonly status: unknown
  readonly stripe_session_id: unknown
}
export interface SyntheticBillingAccount {
  readonly id: unknown
  readonly organization_id: unknown
  readonly provider: unknown
  readonly environment: unknown
  readonly provider_customer_id: unknown
}
export interface SyntheticSubscriptionRecord extends SharedIdentity {
  readonly provider_price_id: unknown
  readonly provider_subscription_id: unknown
  readonly normalized_status: unknown
}
export interface SyntheticSignedReceipt {
  readonly id: unknown
  readonly provider: unknown
  readonly environment: unknown
  readonly provider_event_id: unknown
  readonly event_type: unknown
  readonly provider_invoice_id: unknown
  readonly payload_hash: unknown
  readonly processing_status: unknown
  readonly organization_id: unknown
  readonly processed_at: unknown
}

export type SyntheticEvidenceChainReview =
  | { readonly outcome: 'REVIEW_REQUIRED'; readonly reason:
      'MISSING_SOURCE' | 'CANDIDATE_MISMATCH' | 'IDENTITY_INVALID' |
      'CHECKOUT_NOT_READY' | 'RESERVATION_MISMATCH' | 'ACCOUNT_MISMATCH' |
      'RECEIPT_MISMATCH' | 'SUBSCRIPTION_MISMATCH' }
  | { readonly outcome: 'SYNTHETIC_CHAIN_ONLY';
      readonly unresolved: 'INVOICE_TO_CHECKOUT_PROVIDER_PROVENANCE_NOT_ESTABLISHED';
      readonly paymentAuthorized: false; readonly financialFinality: false;
      readonly accessAuthorized: false }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/
const EVENT = /^evt_[A-Za-z0-9]+$/
const SUB = /^sub_[A-Za-z0-9]+$/
const CUSTOMER = /^cus_[A-Za-z0-9]+$/
const SESSION = /^cs_test_[A-Za-z0-9]+$/
const blocked = (reason: Extract<SyntheticEvidenceChainReview,
  { outcome:'REVIEW_REQUIRED' }>['reason']): SyntheticEvidenceChainReview =>
  ({outcome:'REVIEW_REQUIRED',reason})
const uuid = (id: unknown): id is string =>
  typeof id === 'string' && UUID.test(id)

export function inspectSyntheticInvoiceEvidenceChain(input: {
  readonly quote: ExtraQuote | null | undefined
  readonly invoice: ExtraInvoice | null | undefined
  readonly reservation: SyntheticCheckoutReservation | null | undefined
  readonly account: SyntheticBillingAccount | null | undefined
  readonly subscription: SyntheticSubscriptionRecord | null | undefined
  readonly receipt: SyntheticSignedReceipt | null | undefined
}): SyntheticEvidenceChainReview {
  const { quote, invoice, reservation, account, subscription, receipt } = input
  if (!quote || !invoice || !reservation || !account || !subscription || !receipt) {
    return blocked('MISSING_SOURCE')
  }
  if (compareSyntheticFrozenInvoiceCandidates({quote,invoice}).outcome !==
      'CONSISTENT_SYNTHETIC_ONLY') return blocked('CANDIDATE_MISMATCH')
  if (![quote.checkout_reservation_id, invoice.subscription_record_id,
        invoice.webhook_event_record_id, reservation.id, account.id,
        subscription.id, receipt.id].every(uuid) ||
      typeof receipt.payload_hash !== 'string' || !HASH.test(receipt.payload_hash) ||
      typeof invoice.source_payload_hash !== 'string' ||
      !HASH.test(invoice.source_payload_hash) ||
      typeof invoice.provider_event_id !== 'string' || !EVENT.test(invoice.provider_event_id) ||
      typeof receipt.provider_event_id !== 'string' || !EVENT.test(receipt.provider_event_id) ||
      typeof reservation.provider_customer_id !== 'string' ||
      !CUSTOMER.test(reservation.provider_customer_id) ||
      typeof account.provider_customer_id !== 'string' ||
      !CUSTOMER.test(account.provider_customer_id) ||
      typeof reservation.stripe_session_id !== 'string' ||
      !SESSION.test(reservation.stripe_session_id) ||
      typeof subscription.provider_subscription_id !== 'string' ||
      !SUB.test(subscription.provider_subscription_id)) return blocked('IDENTITY_INVALID')

  if (reservation.status !== 'READY') return blocked('CHECKOUT_NOT_READY')
  if (reservation.id !== quote.checkout_reservation_id ||
      reservation.organization_id !== quote.organization_id ||
      reservation.billing_account_id !== quote.billing_account_id ||
      reservation.provider !== quote.provider ||
      reservation.environment !== quote.environment ||
      reservation.provider_price_id !== quote.provider_price_id ||
      reservation.plan_id !== quote.plan_id ||
      (quote.plan_id !== 'monthly' && quote.plan_id !== 'annual') ||
      (quote.plan_id === 'monthly' && quote.candidate_interval !== 'month') ||
      (quote.plan_id === 'annual' && quote.candidate_interval !== 'year')) {
    return blocked('RESERVATION_MISMATCH')
  }
  if (account.id !== quote.billing_account_id ||
      account.organization_id !== quote.organization_id ||
      account.provider !== 'stripe' || account.environment !== 'TEST' ||
      account.provider_customer_id !== reservation.provider_customer_id) {
    return blocked('ACCOUNT_MISMATCH')
  }
  if (receipt.id !== invoice.webhook_event_record_id ||
      receipt.provider !== invoice.provider ||
      receipt.environment !== invoice.environment ||
      receipt.event_type !== 'invoice.paid' ||
      receipt.provider_invoice_id !== invoice.provider_invoice_id ||
      receipt.provider_event_id !== invoice.provider_event_id ||
      receipt.payload_hash !== invoice.source_payload_hash ||
      !['RECEIVED','PROCESSING'].includes(String(receipt.processing_status)) ||
      receipt.processed_at !== null ||
      (receipt.organization_id !== null &&
       receipt.organization_id !== invoice.organization_id)) {
    return blocked('RECEIPT_MISMATCH')
  }
  if (subscription.id !== invoice.subscription_record_id ||
      subscription.organization_id !== invoice.organization_id ||
      subscription.billing_account_id !== invoice.billing_account_id ||
      subscription.provider !== 'stripe' ||
      subscription.environment !== 'TEST' ||
      subscription.provider_price_id !== invoice.candidate_price_id ||
      subscription.normalized_status !== 'ACTIVE') {
    return blocked('SUBSCRIPTION_MISMATCH')
  }
  // A signed invoice receipt does NOT prove which checkout produced it.
  // Subscription ACTIVE is a status projection, not financial truth.
  return {
    outcome:'SYNTHETIC_CHAIN_ONLY',
    unresolved:'INVOICE_TO_CHECKOUT_PROVIDER_PROVENANCE_NOT_ESTABLISHED',
    paymentAuthorized:false,
    financialFinality:false,
    accessAuthorized:false,
  }
}
