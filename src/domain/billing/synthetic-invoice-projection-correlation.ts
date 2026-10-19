/**
 * MR-5I4B — local synthetic, READ-ONLY invoice/projection correlation.
 *
 * Every snapshot is caller-supplied. Even a successful comparison DOES NOT
 * authenticate a Stripe event, confirm settlement or authorize paid access.
 * A later trusted worker must source each snapshot from a narrowly scoped,
 * independently verified durable/provider read and enforce atomic finality.
 *
 * No database client, SDK, credentials, HTTP endpoint or entitlement import.
 */
import {
  inspectProviderInvoiceEvidence,
  type BillingEvidenceReadPort,
  type ExpectedInvoiceBinding,
} from './provider-evidence-port'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT = /^evt_[A-Za-z0-9]+$/
const HASH = /^[0-9a-f]{64}$/
const INVOICE = /^in_[A-Za-z0-9]+$/
const CUSTOMER = /^cus_[A-Za-z0-9]+$/
const SUBSCRIPTION = /^sub_[A-Za-z0-9]+$/
const PRICE = /^price_[A-Za-z0-9]+$/

export interface SyntheticDurableInvoiceReceipt {
  readonly provider: string
  readonly environment: 'TEST' | 'LIVE'
  readonly providerEventId: string
  readonly eventType: string
  readonly providerInvoiceId: string | null
  readonly payloadHash: string
  readonly processingStatus: string
  readonly organizationId: string | null
  readonly processedAt: string | null
}

export interface SyntheticTenantBillingAccount {
  readonly id: string
  readonly organizationId: string
  readonly provider: string
  readonly environment: 'TEST' | 'LIVE'
  readonly providerCustomerId: string
}

export interface SyntheticSubscriptionProjection {
  readonly organizationId: string
  readonly billingAccountId: string
  readonly provider: string
  readonly environment: 'TEST' | 'LIVE'
  readonly providerSubscriptionId: string
  readonly providerPriceId: string | null
  readonly normalizedStatus: string
  readonly currentPeriodEnd: string | null
}

export type SyntheticInvoiceProjectionCorrelation =
  | { readonly outcome: 'DISABLED' | 'NOT_CONFIGURED' | 'SYNTHETIC_MATCH_ONLY' }
  | { readonly outcome: 'BLOCKED'; readonly reason:
      'LIVE_GATED' | 'INVALID_INPUT' | 'INVOICE_NOT_PAID_EVENT' |
      'RECEIPT_NOT_READY' | 'TENANT_OR_BINDING_MISMATCH' |
      'PROJECTION_NOT_ACTIVE' | 'PROJECTION_EXPIRED' |
      'PROVIDER_EVIDENCE_REJECTED' }

function localSyntheticOnly(): boolean {
  return process.env.ENABLE_STRIPE_TEST_INVOICE_CORRELATION === 'true' &&
    process.env.MPG_STRIPE_TEST_INVOICE_CORRELATION_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    ['http://127.0.0.1:54331', 'http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

function validDate(value: unknown): number | null {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    return null
  }
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function validInput(args: {
  binding: ExpectedInvoiceBinding
  receipt: SyntheticDurableInvoiceReceipt
  account: SyntheticTenantBillingAccount
  projection: SyntheticSubscriptionProjection
}): boolean {
  const { binding: b, receipt: r, account: a, projection: p } = args
  return b?.provider === 'stripe' && b.environment === 'TEST' &&
    UUID.test(b.organizationId) &&
    INVOICE.test(b.invoiceId) &&
    CUSTOMER.test(b.customerId) &&
    SUBSCRIPTION.test(b.subscriptionId) &&
    PRICE.test(b.priceId) &&
    b.currency === 'PHP' && Number.isSafeInteger(b.amountMinor) &&
    b.amountMinor > 0 && (b.interval === 'month' || b.interval === 'year') &&
    validDate(b.now) !== null &&
    r?.provider === 'stripe' && r.environment === 'TEST' &&
    EVENT.test(r.providerEventId) && HASH.test(r.payloadHash) &&
    (r.providerInvoiceId === null || INVOICE.test(r.providerInvoiceId)) &&
    a?.provider === 'stripe' && a.environment === 'TEST' &&
    UUID.test(a.id) && UUID.test(a.organizationId) &&
    CUSTOMER.test(a.providerCustomerId) &&
    p?.provider === 'stripe' && p.environment === 'TEST' &&
    UUID.test(p.organizationId) && UUID.test(p.billingAccountId) &&
    SUBSCRIPTION.test(p.providerSubscriptionId) &&
    (p.providerPriceId === null || PRICE.test(p.providerPriceId))
}

/**
 * Only a bounded diagnostic comparison of supplied synthetic snapshots.
 * `SYNTHETIC_MATCH_ONLY` is explicitly NOT payment authorization.
 *
 * Without a provider adapter the only post-validation outcome is
 * NOT_CONFIGURED. LIVE and hosted/production operation are always denied.
 * Invoice events still RECEIVED must NOT be marked PROCESSED by this function.
 */
export async function inspectSyntheticInvoiceProjectionCorrelation(args: {
  readonly binding: ExpectedInvoiceBinding
  readonly receipt: SyntheticDurableInvoiceReceipt
  readonly account: SyntheticTenantBillingAccount
  readonly projection: SyntheticSubscriptionProjection
  readonly port?: BillingEvidenceReadPort | null
}): Promise<SyntheticInvoiceProjectionCorrelation> {
  const blocked = (reason: Extract<SyntheticInvoiceProjectionCorrelation, {outcome:'BLOCKED'}>['reason']):
    SyntheticInvoiceProjectionCorrelation => ({ outcome: 'BLOCKED', reason })
  if (!localSyntheticOnly()) return { outcome: 'DISABLED' }
  if (args.binding?.environment === 'LIVE' || args.receipt?.environment === 'LIVE' ||
      args.account?.environment === 'LIVE' || args.projection?.environment === 'LIVE') {
    return blocked('LIVE_GATED')
  }
  if (!validInput(args)) return blocked('INVALID_INPUT')
  const { binding, receipt, account, projection } = args
  if (receipt.eventType !== 'invoice.paid') return blocked('INVOICE_NOT_PAID_EVENT')
  if (receipt.processingStatus !== 'RECEIVED' ||
      receipt.organizationId !== null || receipt.processedAt !== null) {
    return blocked('RECEIPT_NOT_READY')
  }
  if (receipt.providerInvoiceId !== binding.invoiceId ||
      account.organizationId !== binding.organizationId ||
      account.providerCustomerId !== binding.customerId ||
      projection.organizationId !== binding.organizationId ||
      projection.billingAccountId !== account.id ||
      projection.providerSubscriptionId !== binding.subscriptionId ||
      projection.providerPriceId !== binding.priceId) {
    return blocked('TENANT_OR_BINDING_MISMATCH')
  }
  if (projection.normalizedStatus !== 'ACTIVE') return blocked('PROJECTION_NOT_ACTIVE')
  const expiry = validDate(projection.currentPeriodEnd)
  if (expiry === null || expiry <= validDate(binding.now)!) {
    return blocked('PROJECTION_EXPIRED')
  }
  if (!args.port) return { outcome: 'NOT_CONFIGURED' }
  const provider = await inspectProviderInvoiceEvidence({ binding, port: args.port })
  if (provider.outcome !== 'EVIDENCE_ONLY') return blocked('PROVIDER_EVIDENCE_REJECTED')
  // Never reveal provider identifiers, source objects or a paid-access flag.
  // Caller-supplied records and fake adapters are not financial proof.
  return { outcome: 'SYNTHETIC_MATCH_ONLY' }
}
