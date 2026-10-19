import 'server-only'

/**
 * MR-5I4C — sealed LOCAL_SYNTHETIC-only read assembler.
 *
 * Reads pre-existing private invoice, tenant and projection records. All
 * reads are scoped; none writes, leases or processes an event. A matching
 * result is NOT trusted settlement, authenticated provider provenance,
 * entitlement or permission to charge. Caller must supply a narrowly trusted
 * server-only client; never expose this function via a public route.
 */
import { timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  inspectSyntheticInvoiceProjectionCorrelation,
  type SyntheticDurableInvoiceReceipt,
  type SyntheticTenantBillingAccount,
  type SyntheticSubscriptionProjection,
} from '@/domain/billing/synthetic-invoice-projection-correlation'
import type { BillingEvidenceReadPort, ExpectedInvoiceBinding } from '@/domain/billing/provider-evidence-port'
import { getConfiguredReputationBillingCatalog } from './pricing'
import { resolveStripePriceBinding } from './stripe-plan-bindings'

const EVENT = /^evt_[A-Za-z0-9]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[a-f0-9]{64}$/
const PLANS = ['monthly', 'annual'] as const

export type PrivateInvoiceReadFinding =
  | { readonly outcome: 'DISABLED' | 'DENIED' | 'NOT_CONFIGURED' | 'SYNTHETIC_MATCH_ONLY' }
  | { readonly outcome: 'BLOCKED'; readonly reason:
      'INVALID_INPUT' | 'INVALID_EVENT_ID' | 'INVALID_ORGANIZATION_ID' | 'SOURCE_NOT_READY' | 'TENANT_NOT_ACTIVE' |
      'AMBIGUOUS_SUBSCRIPTION' | 'PRICE_NOT_MATCHED' |
      'CONFIGURATION_INVALID' | 'CHANGED_DURING_READ' |
      'SOURCE_READ_FAILED' | 'CORRELATION_REJECTED' }

function enabled(): boolean {
  return process.env.ENABLE_STRIPE_TEST_INVOICE_READ_ASSEMBLER === 'true' &&
    process.env.MPG_STRIPE_TEST_INVOICE_READ_ASSEMBLER_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.ENABLE_STRIPE_TEST_INVOICE_CORRELATION === 'true' &&
    process.env.MPG_STRIPE_TEST_INVOICE_CORRELATION_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    ['http://127.0.0.1:54331', 'http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

function sealed(token: unknown): 'DENIED' | 'DISABLED' | 'OK' {
  const expected = process.env.MPG_STRIPE_INVOICE_READ_OPERATOR_TOKEN
  if (!expected || !TOKEN.test(expected)) return 'DISABLED'
  if (typeof token !== 'string' || !TOKEN.test(token) ||
      !timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))) {
    return 'DENIED'
  }
  return 'OK'
}

type Snapshot = Awaited<ReturnType<typeof readSnapshot>>

/**
 * Exact-ID, TEST-scoped, bounded reads only. No dynamic columns or foreign
 * customer IDs enter a database filter. At most two ACTIVE subscriptions are
 * fetched so ambiguous accounts fail rather than silently choosing a row.
 */
async function readSnapshot(
  db: SupabaseClient<Database>,
  eventId: string,
  organizationId: string
) {
  const event = await db.from('billing_webhook_events')
    .select('provider, environment, provider_event_id, event_type, provider_invoice_id, payload_hash, processing_status, organization_id, processed_at, processing_lease_token, processing_attempt_count, processing_attempts')
    .eq('provider', 'stripe').eq('environment', 'TEST')
    .eq('provider_event_id', eventId).maybeSingle()
  if (event.error) throw new Error('INVOICE_EVENT_READ_FAILED')
  // Do not query other tenant data for missing, claimed, failed or unsupported
  // receipts. An invoice ID in a signed receipt is only a correlation hint.
  if (!event.data || event.data.event_type !== 'invoice.paid' ||
      !event.data.provider_invoice_id ||
      event.data.processing_status !== 'RECEIVED' ||
      event.data.organization_id !== null ||
      event.data.processed_at !== null ||
      event.data.processing_lease_token !== null ||
      event.data.processing_attempt_count !== 0 ||
      event.data.processing_attempts !== 0) {
    return { event: event.data, organization: null, account: null, subscriptions: null }
  }

  const organization = await db.from('organizations')
    .select('status').eq('id', organizationId).maybeSingle()
  if (organization.error) throw new Error('INVOICE_ORG_READ_FAILED')
  if (organization.data?.status !== 'ACTIVE') {
    return { event: event.data, organization: organization.data, account: null, subscriptions: null }
  }

  const account = await db.from('organization_billing_accounts')
    .select('id, organization_id, provider, environment, provider_customer_id')
    .eq('organization_id', organizationId).eq('provider', 'stripe')
    .eq('environment', 'TEST').maybeSingle()
  if (account.error) throw new Error('INVOICE_ACCOUNT_READ_FAILED')
  if (!account.data) {
    return { event: event.data, organization: organization.data, account: null, subscriptions: null }
  }

  const subscriptions = await db.from('organization_subscriptions')
    .select('organization_id, billing_account_id, provider, environment, provider_subscription_id, provider_price_id, normalized_status, current_period_end')
    .eq('organization_id', organizationId).eq('billing_account_id', account.data.id)
    .eq('provider', 'stripe').eq('environment', 'TEST')
    .eq('normalized_status', 'ACTIVE').limit(2)
  if (subscriptions.error) throw new Error('INVOICE_SUBSCRIPTIONS_READ_FAILED')
  return {
    event: event.data, organization: organization.data,
    account: account.data, subscriptions: subscriptions.data,
  }
}

function identical(a: Snapshot, b: Snapshot): boolean {
  // Whitelisted, strictly scoped selected columns; compare all of them. This
  // is race *detection* only, NOT a transaction, lock or finality guarantee.
  return JSON.stringify(a) === JSON.stringify(b)
}

function blocked(reason: Extract<PrivateInvoiceReadFinding, {outcome:'BLOCKED'}>['reason']): PrivateInvoiceReadFinding {
  return { outcome: 'BLOCKED', reason }
}

/**
 * Local diagnostic for a manually authorized operator. The operator must
 * supply the target org UUID; it is a filter, NOT proof of invoice ownership.
 * Only an independent provider read can correlate the invoice with a Customer
 * and Subscription. A fake injected port remains synthetic/non-authorizing.
 */
export async function inspectPrivateSyntheticInvoiceEvidence(args: {
  readonly trustedBillingSupabase: SupabaseClient<Database>
  readonly providerEventId: unknown
  readonly organizationId: unknown
  readonly operatorToken: unknown
  readonly port?: BillingEvidenceReadPort | null
}): Promise<PrivateInvoiceReadFinding> {
  if (!enabled()) return { outcome: 'DISABLED' }
  const authorization = sealed(args.operatorToken)
  if (authorization !== 'OK') return { outcome: authorization }
  if (typeof args.providerEventId !== 'string' || !EVENT.test(args.providerEventId)) {
    return blocked('INVALID_EVENT_ID')
  }
  if (typeof args.organizationId !== 'string' || !UUID.test(args.organizationId)) {
    return blocked('INVALID_ORGANIZATION_ID')
  }

  let before: Snapshot
  try {
    before = await readSnapshot(args.trustedBillingSupabase, args.providerEventId, args.organizationId)
  } catch {
    return blocked('SOURCE_READ_FAILED')
  }

  if (!before.event || before.event.event_type !== 'invoice.paid' ||
      before.event.processing_status !== 'RECEIVED' ||
      !before.event.provider_invoice_id ||
      before.event.organization_id !== null || before.event.processed_at !== null ||
      before.event.processing_lease_token !== null ||
      before.event.processing_attempt_count !== 0 ||
      before.event.processing_attempts !== 0) {
    return blocked('SOURCE_NOT_READY')
  }
  if (before.organization?.status !== 'ACTIVE') return blocked('TENANT_NOT_ACTIVE')
  if (!before.account) return blocked('SOURCE_NOT_READY')
  if (!before.subscriptions || before.subscriptions.length !== 1) {
    return blocked('AMBIGUOUS_SUBSCRIPTION')
  }

  const record = before.subscriptions[0]
  const priceId = record.provider_price_id
  if (!priceId) return blocked('PRICE_NOT_MATCHED')
  let binding: ExpectedInvoiceBinding | null = null
  try {
    const catalog = getConfiguredReputationBillingCatalog()
    const matches = PLANS.flatMap(planId => {
      const selected = resolveStripePriceBinding({
        planId, environment: 'TEST', config: process.env,
      })
      if (selected.outcome !== 'READY' || selected.priceId !== priceId) return []
      return [{ interval: catalog[planId].interval, amountMinor: catalog[planId].amountMinor }]
    })
    if (matches.length === 1) {
      binding = {
        provider: 'stripe', environment: 'TEST',
        organizationId: args.organizationId,
        invoiceId: before.event.provider_invoice_id,
        customerId: before.account.provider_customer_id,
        subscriptionId: record.provider_subscription_id,
        priceId, currency: 'PHP',
        amountMinor: matches[0].amountMinor,
        interval: matches[0].interval,
        now: new Date().toISOString(),
      }
    } else if (matches.length > 1) {
      return blocked('CONFIGURATION_INVALID')
    }
  } catch {
    return blocked('CONFIGURATION_INVALID')
  }
  // No installed Stripe TEST Price IDs / no adapter is normal today.
  // An otherwise valid but unrecognized persisted Price is not payment proof.
  if (!binding) {
    const priceConfigured = PLANS.some(planId => {
      const selected = resolveStripePriceBinding({
        planId, environment: 'TEST', config: process.env,
      })
      return selected.outcome === 'READY'
    })
    return priceConfigured ? blocked('PRICE_NOT_MATCHED') : { outcome: 'NOT_CONFIGURED' }
  }

  const receipt: SyntheticDurableInvoiceReceipt = {
    provider: before.event.provider,
    environment: before.event.environment,
    providerEventId: before.event.provider_event_id,
    eventType: before.event.event_type,
    providerInvoiceId: before.event.provider_invoice_id,
    payloadHash: before.event.payload_hash,
    processingStatus: before.event.processing_status,
    organizationId: before.event.organization_id,
    processedAt: before.event.processed_at,
  }
  const account: SyntheticTenantBillingAccount = {
    id: before.account.id, organizationId: before.account.organization_id,
    provider: before.account.provider, environment: before.account.environment,
    providerCustomerId: before.account.provider_customer_id,
  }
  const projection: SyntheticSubscriptionProjection = {
    organizationId: record.organization_id, billingAccountId: record.billing_account_id,
    provider: record.provider, environment: record.environment,
    providerSubscriptionId: record.provider_subscription_id,
    providerPriceId: record.provider_price_id, normalizedStatus: record.normalized_status,
    currentPeriodEnd: record.current_period_end,
  }
  // Normal no-API path is NOT_CONFIGURED, even with a coherent local snapshot.
  const assessment = await inspectSyntheticInvoiceProjectionCorrelation({
    binding, receipt, account, projection, port: args.port,
  })

  let after: Snapshot
  try {
    after = await readSnapshot(args.trustedBillingSupabase, args.providerEventId, args.organizationId)
  } catch {
    return blocked('SOURCE_READ_FAILED')
  }
  if (!identical(before, after)) return blocked('CHANGED_DURING_READ')

  if (assessment.outcome === 'NOT_CONFIGURED') return { outcome: 'NOT_CONFIGURED' }
  if (assessment.outcome !== 'SYNTHETIC_MATCH_ONLY') return blocked('CORRELATION_REJECTED')
  // Still not a processed event, verified payment, paid entitlement or grant.
  return { outcome: 'SYNTHETIC_MATCH_ONLY' }
}
