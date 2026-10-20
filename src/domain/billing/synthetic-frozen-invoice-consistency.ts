/**
 * MR-5 Stage 1 — synthetic frozen-quote / invoice-draft consistency.
 *
 * Both inputs are untrusted candidates from private, TEST-only snapshots.
 * This does NOT link a provider invoice to a checkout reservation, authenticate
 * Stripe, prove accepted commercial terms, settle an invoice, process an event,
 * charge a customer, or authorize access. No database/provider/network calls.
 * A consistent candidate must remain UNVERIFIED and non-authorizing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PRICE = /^price_[A-Za-z0-9]+$/
const INVOICE = /^in_[A-Za-z0-9]+$/
const MAX_MINOR = Number.MAX_SAFE_INTEGER

export interface SyntheticFrozenCheckoutQuote {
  readonly organization_id: unknown
  readonly billing_account_id: unknown
  readonly provider: unknown
  readonly environment: unknown
  readonly provider_price_id: unknown
  readonly candidate_currency: unknown
  readonly candidate_amount_minor: unknown
  readonly candidate_interval: unknown
  readonly source_kind: unknown
  readonly approval_status: unknown
  readonly verification_status: unknown
  readonly payment_authorized: unknown
  readonly access_authorized: unknown
}

export interface SyntheticInvoiceEvidenceCandidate {
  readonly organization_id: unknown
  readonly billing_account_id: unknown
  readonly provider: unknown
  readonly environment: unknown
  readonly provider_invoice_id: unknown
  readonly candidate_price_id: unknown
  readonly candidate_currency: unknown
  readonly candidate_amount_minor: unknown
  readonly candidate_interval: unknown
  readonly source_kind: unknown
  readonly verification_status: unknown
  readonly financial_finality: unknown
  readonly access_authorized: unknown
}

export type SyntheticFrozenInvoiceComparison =
  | { readonly outcome: 'BLOCKED'; readonly reason:
      'MISSING_RECORD' | 'INVALID_RECORD' | 'NOT_SYNTHETIC_TEST' |
      'NOT_UNVERIFIED' | 'CROSS_TENANT_OR_ACCOUNT' |
      'PRICE_MISMATCH' | 'FROZEN_TERMS_MISMATCH' }
  | { readonly outcome: 'CONSISTENT_SYNTHETIC_ONLY';
      readonly financialFinality: false; readonly accessAuthorized: false }

const blocked = (
  reason: Extract<SyntheticFrozenInvoiceComparison, { outcome: 'BLOCKED' }>['reason']
): SyntheticFrozenInvoiceComparison => ({ outcome: 'BLOCKED', reason })

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value)

const validMinor = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) &&
  value > 0 && value <= MAX_MINOR

/**
 * Deliberately never returns APPROVED, PAID, VERIFIED or AUTHORIZED.
 * Equal fields cannot establish invoice-to-checkout provenance: that requires
 * a separate accepted provider-authenticated, durable exact-ID link.
 */
export function compareSyntheticFrozenInvoiceCandidates(args: {
  readonly quote: SyntheticFrozenCheckoutQuote | null | undefined
  readonly invoice: SyntheticInvoiceEvidenceCandidate | null | undefined
}): SyntheticFrozenInvoiceComparison {
  const { quote, invoice } = args
  if (!quote || !invoice) return blocked('MISSING_RECORD')
  if (!isUuid(quote.organization_id) ||
      !isUuid(quote.billing_account_id) ||
      !isUuid(invoice.organization_id) ||
      !isUuid(invoice.billing_account_id) ||
      !PRICE.test(String(quote.provider_price_id)) ||
      !PRICE.test(String(invoice.candidate_price_id)) ||
      !INVOICE.test(String(invoice.provider_invoice_id)) ||
      !validMinor(quote.candidate_amount_minor) ||
      !validMinor(invoice.candidate_amount_minor) ||
      quote.candidate_currency !== 'PHP' ||
      invoice.candidate_currency !== 'PHP' ||
      !['month', 'year'].includes(String(quote.candidate_interval)) ||
      !['month', 'year'].includes(String(invoice.candidate_interval))) {
    return blocked('INVALID_RECORD')
  }
  if (quote.provider !== 'stripe' || invoice.provider !== 'stripe' ||
      quote.environment !== 'TEST' || invoice.environment !== 'TEST' ||
      quote.source_kind !== 'SYNTHETIC' ||
      invoice.source_kind !== 'SYNTHETIC') {
    return blocked('NOT_SYNTHETIC_TEST')
  }
  if (quote.approval_status !== 'PROPOSED' ||
      quote.verification_status !== 'UNVERIFIED' ||
      invoice.verification_status !== 'UNVERIFIED' ||
      quote.payment_authorized !== false ||
      quote.access_authorized !== false ||
      invoice.financial_finality !== false ||
      invoice.access_authorized !== false) {
    return blocked('NOT_UNVERIFIED')
  }
  if (quote.organization_id.toLowerCase() !== invoice.organization_id.toLowerCase() ||
      quote.billing_account_id.toLowerCase() !== invoice.billing_account_id.toLowerCase()) {
    return blocked('CROSS_TENANT_OR_ACCOUNT')
  }
  if (quote.provider_price_id !== invoice.candidate_price_id) {
    return blocked('PRICE_MISMATCH')
  }
  if (quote.candidate_currency !== invoice.candidate_currency ||
      quote.candidate_amount_minor !== invoice.candidate_amount_minor ||
      quote.candidate_interval !== invoice.candidate_interval) {
    return blocked('FROZEN_TERMS_MISMATCH')
  }
  return { outcome: 'CONSISTENT_SYNTHETIC_ONLY',
    financialFinality: false, accessAuthorized: false }
}
