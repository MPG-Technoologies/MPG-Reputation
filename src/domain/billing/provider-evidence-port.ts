/**
 * MR-5E2D3 — credential-free read-only connector contract for future Stripe
 * invoice/payment evidence. This module never uses provider SDKs, webhooks,
 * database clients, environment credentials or paid-entitlement APIs.
 *
 * Passing synthetic data through this interface does NOT authenticate it.
 * A future owner-authorized server adapter must implement provider retrieval
 * and provenance checks before any processing/entitlement integration.
 */
export type BillingProviderId = 'stripe'
export type BillingProviderEnvironment = 'TEST' | 'LIVE'
export type BillingInterval = 'month' | 'year'

/** Expected values MUST be derived server-side from saved tenant binding,
 * verified invoice reference and frozen pricing terms, never a browser body. */
export interface ExpectedInvoiceBinding {
  readonly provider: BillingProviderId
  readonly environment: BillingProviderEnvironment
  readonly organizationId: string
  readonly invoiceId: string
  readonly customerId: string
  readonly subscriptionId: string
  readonly priceId: string
  readonly currency: 'PHP'
  readonly amountMinor: number
  readonly interval: BillingInterval
  readonly now: string
}

/** Minimized provider facts: no PII, URLs, raw payment objects or tokens.
 * All fields require independent provider source verification in the adapter. */
export interface ProviderInvoiceFacts {
  readonly invoiceId: string
  readonly environment: BillingProviderEnvironment
  readonly customerId: string
  readonly subscriptionId: string
  readonly priceId: string
  readonly currency: string
  readonly amountDueMinor: number
  readonly amountPaidMinor: number
  readonly amountRemainingMinor: number
  readonly invoicePaid: boolean
  readonly paymentStatus: 'succeeded' | 'pending' | 'failed' | 'unknown'
  readonly subscriptionStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete'
  readonly interval: BillingInterval
  readonly currentPeriodEnd: string
  readonly observedAt: string
  readonly refundedMinor: number
  readonly disputeStatus: 'none' | 'open' | 'lost' | 'unknown'
}

export type ProviderInvoiceRead =
  | { readonly outcome: 'FOUND'; readonly invoice: ProviderInvoiceFacts }
  | { readonly outcome: 'NOT_FOUND' | 'UNAVAILABLE' }

/** The only point where real Stripe code needs to be connected later.
 * This interface has deliberately NO charge, checkout, refund or write method. */
export interface BillingEvidenceReadPort {
  readonly provider: BillingProviderId
  readInvoice(reference: {
    readonly invoiceId: string
    readonly environment: BillingProviderEnvironment
  }): Promise<ProviderInvoiceRead>
}

export type ProviderEvidenceInspection =
  | { readonly outcome: 'NOT_CONFIGURED' }
  | {
      readonly outcome: 'BLOCKED'
      readonly reason:
        | 'LIVE_GATED' | 'INVALID_BINDING' | 'PROVIDER_MISMATCH' |
          'PROVIDER_UNAVAILABLE' | 'PROVIDER_NOT_FOUND' |
          'INVALID_PROVIDER_RESPONSE' | 'IDENTITY_MISMATCH' |
          'PRICE_MISMATCH' | 'PAYMENT_NOT_SETTLED' |
          'REFUND_OR_DISPUTE' | 'SUBSCRIPTION_NOT_ACTIVE' |
          'EXPIRED_OR_STALE'
    }
  | { readonly outcome: 'EVIDENCE_ONLY' }

const STRIPE_INVOICE = /^in_[A-Za-z0-9]+$/
const STRIPE_CUSTOMER = /^cus_[A-Za-z0-9]+$/
const STRIPE_SUBSCRIPTION = /^sub_[A-Za-z0-9]+$/
const STRIPE_PRICE = /^price_[A-Za-z0-9]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_EVIDENCE_AGE_MS = 120_000

function block(
  reason: Extract<ProviderEvidenceInspection, { outcome: 'BLOCKED' }>['reason']
): ProviderEvidenceInspection {
  return { outcome: 'BLOCKED', reason }
}

function validDate(value: string): number | null {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    return null
  }
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function validBinding(input: ExpectedInvoiceBinding): boolean {
  return input?.provider === 'stripe' &&
    (input.environment === 'TEST' || input.environment === 'LIVE') &&
    UUID.test(input.organizationId) &&
    STRIPE_INVOICE.test(input.invoiceId) &&
    STRIPE_CUSTOMER.test(input.customerId) &&
    STRIPE_SUBSCRIPTION.test(input.subscriptionId) &&
    STRIPE_PRICE.test(input.priceId) &&
    input.currency === 'PHP' &&
    Number.isSafeInteger(input.amountMinor) && input.amountMinor > 0 &&
    (input.interval === 'month' || input.interval === 'year') &&
    validDate(input.now) !== null
}

/**
 * Fail-closed evidence inspection, NOT payment settlement or entitlement.
 * With no adapter installed (the expected pre-API state) this returns
 * NOT_CONFIGURED and performs zero network or database operations.
 * LIVE intentionally stays disabled even when a mock adapter is injected.
 */
export async function inspectProviderInvoiceEvidence(args: {
  readonly binding: ExpectedInvoiceBinding
  readonly port?: BillingEvidenceReadPort | null
}): Promise<ProviderEvidenceInspection> {
  if (!validBinding(args.binding)) return block('INVALID_BINDING')
  if (args.binding.environment === 'LIVE') return block('LIVE_GATED')

  const port = args.port
  if (!port) return { outcome: 'NOT_CONFIGURED' }
  if (port.provider !== args.binding.provider) return block('PROVIDER_MISMATCH')

  let response: ProviderInvoiceRead
  try {
    response = await port.readInvoice({
      invoiceId: args.binding.invoiceId,
      environment: args.binding.environment,
    })
  } catch {
    return block('PROVIDER_UNAVAILABLE')
  }
  if (!response || typeof response !== 'object' ||
      !['FOUND', 'NOT_FOUND', 'UNAVAILABLE'].includes(response.outcome)) {
    return block('INVALID_PROVIDER_RESPONSE')
  }
  if (response.outcome === 'UNAVAILABLE') return block('PROVIDER_UNAVAILABLE')
  if (response.outcome === 'NOT_FOUND') return block('PROVIDER_NOT_FOUND')

  const invoice = response.invoice
  if (!invoice || !Number.isSafeInteger(invoice.amountDueMinor) ||
      !Number.isSafeInteger(invoice.amountPaidMinor) ||
      !Number.isSafeInteger(invoice.amountRemainingMinor) ||
      !Number.isSafeInteger(invoice.refundedMinor) ||
      invoice.amountDueMinor < 0 || invoice.amountPaidMinor < 0 ||
      invoice.amountRemainingMinor < 0 || invoice.refundedMinor < 0 ||
      validDate(invoice.observedAt) === null ||
      validDate(invoice.currentPeriodEnd) === null ||
      !['none', 'open', 'lost', 'unknown'].includes(invoice.disputeStatus) ||
      !['succeeded', 'pending', 'failed', 'unknown'].includes(invoice.paymentStatus) ||
      !['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete'].includes(invoice.subscriptionStatus) ||
      typeof invoice.invoicePaid !== 'boolean') {
    return block('INVALID_PROVIDER_RESPONSE')
  }

  if (invoice.invoiceId !== args.binding.invoiceId ||
      invoice.environment !== args.binding.environment ||
      invoice.customerId !== args.binding.customerId ||
      invoice.subscriptionId !== args.binding.subscriptionId) {
    return block('IDENTITY_MISMATCH')
  }
  if (invoice.priceId !== args.binding.priceId ||
      invoice.currency.toUpperCase() !== args.binding.currency ||
      invoice.interval !== args.binding.interval ||
      invoice.amountDueMinor !== args.binding.amountMinor) {
    return block('PRICE_MISMATCH')
  }
  if (invoice.refundedMinor !== 0 || invoice.disputeStatus !== 'none') {
    return block('REFUND_OR_DISPUTE')
  }
  if (!invoice.invoicePaid || invoice.paymentStatus !== 'succeeded' ||
      invoice.amountRemainingMinor !== 0 ||
      invoice.amountPaidMinor !== invoice.amountDueMinor) {
    return block('PAYMENT_NOT_SETTLED')
  }
  if (invoice.subscriptionStatus !== 'active') {
    return block('SUBSCRIPTION_NOT_ACTIVE')
  }

  const now = validDate(args.binding.now)!
  const age = now - validDate(invoice.observedAt)!
  if (age < 0 || age > MAX_EVIDENCE_AGE_MS ||
      validDate(invoice.currentPeriodEnd)! <= now) {
    return block('EXPIRED_OR_STALE')
  }

  // NOT authorization: separate, audited webhook processing and an owner-
  // accepted entitlement transaction are still required before any access.
  return { outcome: 'EVIDENCE_ONLY' }
}
