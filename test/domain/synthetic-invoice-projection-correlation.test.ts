import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  inspectSyntheticInvoiceProjectionCorrelation,
  type SyntheticDurableInvoiceReceipt,
  type SyntheticTenantBillingAccount,
  type SyntheticSubscriptionProjection,
} from '../../src/domain/billing/synthetic-invoice-projection-correlation'
import type {
  ExpectedInvoiceBinding,
  ProviderInvoiceFacts,
  ProviderInvoiceRead,
} from '../../src/domain/billing/provider-evidence-port'

const org = '11111111-1111-4111-8111-111111111111'
const accountId = '22222222-2222-4222-8222-222222222222'
const binding: ExpectedInvoiceBinding = {
  provider: 'stripe', environment: 'TEST', organizationId: org,
  invoiceId: 'in_correlation', customerId: 'cus_correlation',
  subscriptionId: 'sub_correlation', priceId: 'price_correlation',
  currency: 'PHP', amountMinor: 150_000, interval: 'month',
  now: '2026-10-19T05:01:00Z',
}
const receipt: SyntheticDurableInvoiceReceipt = {
  provider: 'stripe', environment: 'TEST', providerEventId: 'evt_correlation',
  eventType: 'invoice.paid', providerInvoiceId: binding.invoiceId,
  payloadHash: 'a'.repeat(64), processingStatus: 'RECEIVED',
  organizationId: null, processedAt: null,
}
const account: SyntheticTenantBillingAccount = {
  id: accountId, organizationId: org, provider: 'stripe',
  environment: 'TEST', providerCustomerId: binding.customerId,
}
const projection: SyntheticSubscriptionProjection = {
  organizationId: org, billingAccountId: accountId, provider: 'stripe',
  environment: 'TEST', providerSubscriptionId: binding.subscriptionId,
  providerPriceId: binding.priceId, normalizedStatus: 'ACTIVE',
  currentPeriodEnd: '2026-11-19T00:00:00Z',
}
const invoice: ProviderInvoiceFacts = {
  invoiceId: binding.invoiceId, environment: 'TEST',
  customerId: binding.customerId, subscriptionId: binding.subscriptionId,
  priceId: binding.priceId, currency: 'PHP',
  amountDueMinor: binding.amountMinor, amountPaidMinor: binding.amountMinor,
  amountRemainingMinor: 0, invoicePaid: true, paymentStatus: 'succeeded',
  subscriptionStatus: 'active', interval: 'month',
  currentPeriodEnd: '2026-11-19T00:00:00Z',
  observedAt: '2026-10-19T05:00:00Z', refundedMinor: 0,
  disputeStatus: 'none',
}
const makePort = (result: ProviderInvoiceRead = { outcome: 'FOUND', invoice }) => {
  const readInvoice = vi.fn(async () => result)
  return { port: { provider: 'stripe' as const, readInvoice }, readInvoice }
}
type Input = Parameters<typeof inspectSyntheticInvoiceProjectionCorrelation>[0]
const inspect = (change: Partial<Input> = {}) =>
  inspectSyntheticInvoiceProjectionCorrelation({
    binding, receipt, account, projection, ...change,
  })

describe('MR-5I4B read-only synthetic invoice → tenant projection comparison', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_STRIPE_TEST_INVOICE_CORRELATION', 'true')
    vi.stubEnv('MPG_STRIPE_TEST_INVOICE_CORRELATION_TARGET', 'LOCAL_SYNTHETIC')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54331')
    vi.stubEnv('ENABLE_LIVE_BILLING', undefined)
    vi.stubEnv('VERCEL_ENV', undefined)
    vi.stubEnv('NODE_ENV', 'test')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('defaults to NOT_CONFIGURED without a payment provider adapter', async () => {
    expect(await inspect()).toEqual({ outcome: 'NOT_CONFIGURED' })
    expect(await inspect({ port: null })).toEqual({ outcome: 'NOT_CONFIGURED' })
  })

  it('is disabled without local flags and on production, hosted or live targets', async () => {
    const { port, readInvoice } = makePort()
    vi.stubEnv('ENABLE_STRIPE_TEST_INVOICE_CORRELATION', undefined)
    expect(await inspect({port})).toEqual({ outcome: 'DISABLED' })
    vi.stubEnv('ENABLE_STRIPE_TEST_INVOICE_CORRELATION', 'true')
    vi.stubEnv('MPG_STRIPE_TEST_INVOICE_CORRELATION_TARGET', 'HOSTED')
    expect(await inspect({port})).toEqual({ outcome: 'DISABLED' })
    vi.stubEnv('MPG_STRIPE_TEST_INVOICE_CORRELATION_TARGET', 'LOCAL_SYNTHETIC')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://hosted.example')
    expect(await inspect({port})).toEqual({ outcome: 'DISABLED' })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54331')
    vi.stubEnv('NODE_ENV', 'production')
    expect(await inspect({port})).toEqual({ outcome: 'DISABLED' })
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(await inspect({port})).toEqual({ outcome: 'DISABLED' })
    vi.stubEnv('VERCEL_ENV', undefined)
    vi.stubEnv('ENABLE_LIVE_BILLING', 'true')
    expect(await inspect({port})).toEqual({ outcome: 'DISABLED' })
    expect(readInvoice).not.toHaveBeenCalled()
  })

  it('rejects LIVE references before any provider lookup', async () => {
    const {port,readInvoice}=makePort()
    for (const change of [
      {binding:{...binding,environment:'LIVE' as const}},
      {receipt:{...receipt,environment:'LIVE' as const}},
      {account:{...account,environment:'LIVE' as const}},
      {projection:{...projection,environment:'LIVE' as const}},
    ]) {
      expect(await inspect({...change,port})).toEqual({
        outcome:'BLOCKED',reason:'LIVE_GATED',
      })
    }
    expect(readInvoice).not.toHaveBeenCalled()
  })

  it('never reads provider for tampered receipts, malformed IDs or invalid binding', async () => {
    const {port,readInvoice}=makePort()
    for (const change of [
      {receipt:{...receipt,providerEventId:'wrong'}},
      {receipt:{...receipt,payloadHash:'invalid'}},
      {receipt:{...receipt,providerInvoiceId:'wrong'}},
      {account:{...account,id:'wrong'}},
      {projection:{...projection,providerPriceId:'wrong'}},
      {binding:{...binding,amountMinor:0}},
      {binding:{...binding,now:'invalid'}},
    ]) {
      expect(await inspect({...change,port})).toEqual({
        outcome:'BLOCKED',reason:'INVALID_INPUT',
      })
    }
    expect(readInvoice).not.toHaveBeenCalled()
  })

  it('blocks failed invoice events and any already-claimed or processed receipt', async () => {
    const {port,readInvoice}=makePort()
    expect(await inspect({receipt:{...receipt,eventType:'invoice.payment_failed'},port}))
      .toEqual({outcome:'BLOCKED',reason:'INVOICE_NOT_PAID_EVENT'})
    for (const change of [
      {processingStatus:'PROCESSING'},
      {processingStatus:'PROCESSED'},
      {processingStatus:'FAILED'},
      {organizationId:org},
      {processedAt:'2026-10-19T05:00:00Z'},
    ]) {
      expect(await inspect({receipt:{...receipt,...change},port}))
        .toEqual({outcome:'BLOCKED',reason:'RECEIPT_NOT_READY'})
    }
    expect(readInvoice).not.toHaveBeenCalled()
  })

  it('blocks foreign tenant, account, customer, invoice, subscription or price', async () => {
    const {port,readInvoice}=makePort()
    const other='33333333-3333-4333-8333-333333333333'
    for (const change of [
      {receipt:{...receipt,providerInvoiceId:'in_foreign'}},
      {account:{...account,organizationId:other}},
      {account:{...account,providerCustomerId:'cus_foreign'}},
      {projection:{...projection,organizationId:other}},
      {projection:{...projection,billingAccountId:other}},
      {projection:{...projection,providerSubscriptionId:'sub_foreign'}},
      {projection:{...projection,providerPriceId:'price_foreign'}},
    ]) {
      expect(await inspect({...change,port})).toEqual({
        outcome:'BLOCKED',reason:'TENANT_OR_BINDING_MISMATCH',
      })
    }
    expect(readInvoice).not.toHaveBeenCalled()
  })

  it('never promotes ACTIVE alone or an expired/stale projection to payment truth', async () => {
    const {port,readInvoice}=makePort()
    expect(await inspect()).toEqual({outcome:'NOT_CONFIGURED'})
    expect(await inspect({projection:{...projection,normalizedStatus:'PENDING'},port}))
      .toEqual({outcome:'BLOCKED',reason:'PROJECTION_NOT_ACTIVE'})
    for (const currentPeriodEnd of ['2026-10-19T05:00:00Z',null,'not a date']) {
      expect(await inspect({projection:{...projection,currentPeriodEnd},port}))
        .toEqual({outcome:'BLOCKED',reason:'PROJECTION_EXPIRED'})
    }
    expect(readInvoice).not.toHaveBeenCalled()
  })

  it('returns only SYNTHETIC_MATCH_ONLY with fully matching injected fake provider data', async () => {
    const {port,readInvoice}=makePort()
    const result=await inspect({port})
    expect(result).toEqual({outcome:'SYNTHETIC_MATCH_ONLY'})
    expect(readInvoice).toHaveBeenCalledExactlyOnceWith({
      invoiceId:binding.invoiceId, environment:'TEST',
    })
    expect(JSON.stringify(result)).not.toContain('cus_correlation')
    expect(JSON.stringify(result)).not.toContain('in_correlation')
    expect(JSON.stringify(result)).not.toContain('paidEntitlement')
    expect(receipt.processingStatus).toBe('RECEIVED')
  })

  it('fails closed for absent, unpaid, mismatched, stale or disputed provider evidence', async () => {
    for (const result of [
      {outcome:'NOT_FOUND'} as const,
      {outcome:'UNAVAILABLE'} as const,
      {outcome:'FOUND',invoice:{...invoice,invoicePaid:false}} as const,
      {outcome:'FOUND',invoice:{...invoice,paymentStatus:'pending'}} as const,
      {outcome:'FOUND',invoice:{...invoice,priceId:'price_foreign'}} as const,
      {outcome:'FOUND',invoice:{...invoice,customerId:'cus_foreign'}} as const,
      {outcome:'FOUND',invoice:{...invoice,observedAt:'2026-10-18T00:00:00Z'}} as const,
      {outcome:'FOUND',invoice:{...invoice,refundedMinor:100}} as const,
      {outcome:'FOUND',invoice:{...invoice,disputeStatus:'unknown'}} as const,
    ]) {
      expect(await inspect({port:makePort(result).port}))
        .toEqual({outcome:'BLOCKED',reason:'PROVIDER_EVIDENCE_REJECTED'})
    }
    expect(await inspect({port:{
      provider:'stripe',readInvoice:async()=>{throw new Error('unavailable')},
    }})).toEqual({outcome:'BLOCKED',reason:'PROVIDER_EVIDENCE_REJECTED'})
  })
})
