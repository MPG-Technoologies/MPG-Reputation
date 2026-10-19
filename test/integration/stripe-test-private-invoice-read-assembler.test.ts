import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '../../src/lib/supabase/admin'

// Vitest has no Next.js server-only module; preserve the production import.
vi.mock('server-only', () => ({}))
import { inspectPrivateSyntheticInvoiceEvidence } from '../../src/lib/billing/stripe-test-private-invoice-read-assembler'
import type { ProviderInvoiceFacts } from '../../src/domain/billing/provider-evidence-port'

const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const hasDisposableDb = !!key && key !== 'dummy_service_role_key'
const token = 'a'.repeat(64)
const nonce = String(Date.now())
const customer = 'cus_mr5i4c' + nonce
const subscription = 'sub_mr5i4c' + nonce
const invoice = 'in_mr5i4c' + nonce
const price = 'price_mr5i4c' + nonce
const providerEventId = 'evt_mr5i4c' + nonce

describe.skipIf(!hasDisposableDb)('MR-5I4C private synthetic DB-backed read assembler', () => {
  const db = createAdminClient()
  let orgId: string
  let accountId: string

  const configure = () => {
    vi.stubEnv('ENABLE_STRIPE_TEST_INVOICE_READ_ASSEMBLER', 'true')
    vi.stubEnv('MPG_STRIPE_TEST_INVOICE_READ_ASSEMBLER_TARGET', 'LOCAL_SYNTHETIC')
    vi.stubEnv('ENABLE_STRIPE_TEST_INVOICE_CORRELATION', 'true')
    vi.stubEnv('MPG_STRIPE_TEST_INVOICE_CORRELATION_TARGET', 'LOCAL_SYNTHETIC')
    vi.stubEnv('MPG_STRIPE_INVOICE_READ_OPERATOR_TOKEN', token)
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('VERCEL_ENV', undefined)
    vi.stubEnv('ENABLE_LIVE_BILLING', undefined)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54331')
    vi.stubEnv('STRIPE_TEST_MONTHLY_PRICE_ID', price)
    vi.stubEnv('STRIPE_TEST_ANNUAL_PRICE_ID', undefined)
    vi.stubEnv('MPG_BILLING_MONTHLY_PRICE_PHP', undefined)
    vi.stubEnv('MPG_BILLING_ANNUAL_PRICE_PHP', undefined)
  }

  const inspect = (args: {
    organizationId?: unknown
    providerEventId?: unknown
    operatorToken?: unknown
    port?: Parameters<typeof inspectPrivateSyntheticInvoiceEvidence>[0]['port']
  } = {}) => inspectPrivateSyntheticInvoiceEvidence({
    trustedBillingSupabase: db,
    organizationId: args.organizationId ?? orgId,
    providerEventId: args.providerEventId ?? providerEventId,
    operatorToken: args.operatorToken ?? token,
    port: args.port,
  })

  const facts = (): ProviderInvoiceFacts => ({
    invoiceId: invoice, environment: 'TEST', customerId: customer,
    subscriptionId: subscription, priceId: price, currency: 'PHP',
    amountDueMinor: 150_000, amountPaidMinor: 150_000,
    amountRemainingMinor: 0, invoicePaid: true,
    paymentStatus: 'succeeded', subscriptionStatus: 'active',
    interval: 'month',
    currentPeriodEnd: new Date(Date.now() + 25 * 86400000).toISOString(),
    observedAt: new Date(Date.now() - 15_000).toISOString(),
    refundedMinor: 0, disputeStatus: 'none',
  })
  const port = (value: ProviderInvoiceFacts = facts()) => {
    const readInvoice = vi.fn(async () => ({ outcome: 'FOUND' as const, invoice: value }))
    return { provider: 'stripe' as const, readInvoice }
  }

  beforeAll(async () => {
    const { data: org, error: orgError } = await db.from('organizations')
      .insert({name:'MR5I4C isolated synthetic '+nonce,slug:'mr5i4c-'+nonce})
      .select('id').single()
    if (orgError || !org) throw new Error('MR5I4C_ORG_FIXTURE_FAILED')
    orgId = org.id
    const {data:account,error:accountError} = await db.from('organization_billing_accounts')
      .insert({organization_id:orgId,provider:'stripe',environment:'TEST',provider_customer_id:customer})
      .select('id').single()
    if (accountError || !account) throw new Error('MR5I4C_ACCOUNT_FIXTURE_FAILED')
    accountId = account.id
    const {error:subscriptionError}=await db.from('organization_subscriptions').insert({
      organization_id:orgId,billing_account_id:accountId,provider:'stripe',
      environment:'TEST',provider_subscription_id:subscription,
      provider_price_id:price,provider_status:'active',normalized_status:'ACTIVE',
      current_period_end:new Date(Date.now()+25*86400000).toISOString(),
    })
    if (subscriptionError) throw new Error('MR5I4C_SUB_FIXTURE_FAILED')
    const {error:eventError}=await db.from('billing_webhook_events').insert({
      provider:'stripe',environment:'TEST',provider_event_id:providerEventId,
      provider_invoice_id:invoice,event_type:'invoice.paid',
      payload_hash:'b'.repeat(64),processing_status:'RECEIVED',
    })
    if (eventError) throw new Error('MR5I4C_EVENT_FIXTURE_FAILED')
  })

  beforeEach(async () => {
    configure()
    const {error}=await db.from('billing_webhook_events').update({
      processing_status:'RECEIVED',processed_at:null,organization_id:null,
      processing_lease_token:null,processing_attempt_count:0,processing_attempts:0,
    }).eq('provider_event_id',providerEventId)
    if (error) throw new Error('MR5I4C_RESET_FAILED')
  })
  afterEach(() => vi.unstubAllEnvs())

  afterAll(async () => {
    await db.from('billing_webhook_events').delete().eq('provider_event_id',providerEventId)
    if (orgId) await db.from('organizations').delete().eq('id',orgId)
  })

  it('returns NOT_CONFIGURED with coherent private records but no adapter', async () => {
    expect(await inspect()).toEqual({outcome:'NOT_CONFIGURED'})
    const {data:event}=await db.from('billing_webhook_events')
      .select('processing_status,processed_at,organization_id,processing_attempt_count')
      .eq('provider_event_id',providerEventId).single()
    expect(event).toMatchObject({
      processing_status:'RECEIVED',processed_at:null,
      organization_id:null,processing_attempt_count:0,
    })
  })

  it('seals privileged reads behind local gates and constant-time operator proof', async () => {
    vi.stubEnv('ENABLE_STRIPE_TEST_INVOICE_READ_ASSEMBLER', undefined)
    expect(await inspect()).toEqual({outcome:'DISABLED'})
    configure()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://hosted.invalid')
    expect(await inspect()).toEqual({outcome:'DISABLED'})
    configure()
    vi.stubEnv('NODE_ENV','production')
    expect(await inspect()).toEqual({outcome:'DISABLED'})
    configure()
    vi.stubEnv('ENABLE_LIVE_BILLING','true')
    expect(await inspect()).toEqual({outcome:'DISABLED'})
    configure()
    expect(await inspect({operatorToken:'f'.repeat(64)})).toEqual({outcome:'DENIED'})
    expect(await inspect({operatorToken:'invalid'})).toEqual({outcome:'DENIED'})
    expect(await inspect({organizationId:'invalid'}))
      .toEqual({outcome:'BLOCKED',reason:'INVALID_ORGANIZATION_ID'})
    expect(await inspect({providerEventId:'invalid'}))
      .toEqual({outcome:'BLOCKED',reason:'INVALID_EVENT_ID'})
  })

  it('blocks unknown/foreign tenant and unknown invoice receipt', async () => {
    expect(await inspect({organizationId:'33333333-3333-4333-8333-333333333333'}))
      .toEqual({outcome:'BLOCKED',reason:'TENANT_NOT_ACTIVE'})
    expect(await inspect({providerEventId:'evt_doesnotexist'}))
      .toEqual({outcome:'BLOCKED',reason:'SOURCE_NOT_READY'})
  })

  it('rejects failed invoice, in-flight receipt and replayed PROCESSING/PROCESSED', async () => {
    for (const processing_status of ['PROCESSING','PROCESSED','FAILED'] as const) {
      const {error}=await db.from('billing_webhook_events').update({processing_status})
        .eq('provider_event_id',providerEventId)
      if (error) throw new Error('MR5I4C_EVENT_MUTATION_FAILED')
      expect(await inspect()).toEqual({outcome:'BLOCKED',reason:'SOURCE_NOT_READY'})
    }
    const {error}=await db.from('billing_webhook_events').update({
      processing_status:'RECEIVED',processing_attempt_count:1,
    }).eq('provider_event_id',providerEventId)
    if (error) throw new Error('MR5I4C_EVENT_MUTATION_FAILED')
    expect(await inspect()).toEqual({outcome:'BLOCKED',reason:'SOURCE_NOT_READY'})
  })

  it('requires a configured, frozen tenant Price binding and valid plan config', async () => {
    vi.stubEnv('STRIPE_TEST_MONTHLY_PRICE_ID', undefined)
    expect(await inspect()).toEqual({outcome:'NOT_CONFIGURED'})
    vi.stubEnv('STRIPE_TEST_MONTHLY_PRICE_ID','price_unrelated')
    expect(await inspect()).toEqual({outcome:'BLOCKED',reason:'PRICE_NOT_MATCHED'})
    configure()
    vi.stubEnv('MPG_BILLING_MONTHLY_PRICE_PHP','invalid')
    expect(await inspect()).toEqual({outcome:'BLOCKED',reason:'CONFIGURATION_INVALID'})
  })

  it('reads provider only for exact tenant/subscription and reports non-authorizing synthetic match', async () => {
    const adapter = port()
    const result = await inspect({port:adapter})
    expect(result).toEqual({outcome:'SYNTHETIC_MATCH_ONLY'})
    expect(adapter.readInvoice).toHaveBeenCalledTimes(1)
    expect(adapter.readInvoice).toHaveBeenCalledWith({invoiceId:invoice,environment:'TEST'})
    expect(JSON.stringify(result)).not.toContain(invoice)
    expect(JSON.stringify(result)).not.toContain(customer)
  })

  it('rejects unverified, unpaid, disputed, stale or wrong subscription provider evidence', async () => {
    for(const patch of [
      {invoicePaid:false},{amountPaidMinor:0},{paymentStatus:'pending' as const},
      {disputeStatus:'open' as const},{refundedMinor:100},
      {subscriptionId:'sub_foreign'},
      {observedAt:new Date(Date.now()-360000).toISOString()},
    ]) {
      const result=await inspect({port:port({...facts(),...patch})})
      expect(result).toEqual({outcome:'BLOCKED',reason:'CORRELATION_REJECTED'})
    }
  })

  it('detects receipt change during provider lookup without finalizing or leasing it', async () => {
    const adapter = {
      provider:'stripe' as const,
      readInvoice:vi.fn(async () => {
        const {error}=await db.from('billing_webhook_events')
          .update({processing_status:'PROCESSING'})
          .eq('provider_event_id',providerEventId)
        if(error) throw new Error('MR5I4C_RACE_FIXTURE_FAILED')
        return {outcome:'FOUND' as const,invoice:facts()}
      }),
    }
    expect(await inspect({port:adapter}))
      .toEqual({outcome:'BLOCKED',reason:'CHANGED_DURING_READ'})
    expect(adapter.readInvoice).toHaveBeenCalledTimes(1)
  })

  it('rejects multiple active subscriptions rather than choosing one silently', async () => {
    const extra='sub_mr5i4cextra'+nonce
    const {error}=await db.from('organization_subscriptions').insert({
      organization_id:orgId,billing_account_id:accountId,provider:'stripe',
      environment:'TEST',provider_subscription_id:extra,
      provider_price_id:price,provider_status:'active',normalized_status:'ACTIVE',
    })
    if(error) throw new Error('MR5I4C_AMBIGUITY_FIXTURE_FAILED')
    try {
      expect(await inspect()).toEqual({outcome:'BLOCKED',reason:'AMBIGUOUS_SUBSCRIPTION'})
    } finally {
      await db.from('organization_subscriptions').delete().eq('provider_subscription_id',extra)
    }
  })
})
