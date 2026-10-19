import { describe, expect, it, vi } from 'vitest'
import {
  inspectProviderInvoiceEvidence,
  type BillingEvidenceReadPort,
  type ExpectedInvoiceBinding,
  type ProviderInvoiceFacts,
  type ProviderInvoiceRead,
} from '../../src/domain/billing/provider-evidence-port'

const binding: ExpectedInvoiceBinding = {
  provider: 'stripe',
  environment: 'TEST',
  organizationId: '11111111-1111-4111-8111-111111111111',
  invoiceId: 'in_fixture',
  customerId: 'cus_fixture',
  subscriptionId: 'sub_fixture',
  priceId: 'price_fixture',
  currency: 'PHP',
  amountMinor: 150_000,
  interval: 'month',
  now: '2026-10-19T05:01:00Z',
}
const invoice: ProviderInvoiceFacts = {
  invoiceId: 'in_fixture',
  environment: 'TEST',
  customerId: 'cus_fixture',
  subscriptionId: 'sub_fixture',
  priceId: 'price_fixture',
  currency: 'PHP',
  amountDueMinor: 150_000,
  amountPaidMinor: 150_000,
  amountRemainingMinor: 0,
  invoicePaid: true,
  paymentStatus: 'succeeded',
  subscriptionStatus: 'active',
  interval: 'month',
  currentPeriodEnd: '2026-11-19T00:00:00Z',
  observedAt: '2026-10-19T05:00:00Z',
  refundedMinor: 0,
  disputeStatus: 'none',
}
function adapter(read: ProviderInvoiceRead = { outcome:'FOUND', invoice }) {
  const fn = vi.fn(async () => read)
  return { port: { provider:'stripe' as const, readInvoice:fn }, fn }
}

describe('MR-5E2D3 provider-agnostic read-only evidence port', () => {
  it('is safe to ship without Stripe credentials or an installed connector', async () => {
    expect(await inspectProviderInvoiceEvidence({binding})).toEqual({
      outcome:'NOT_CONFIGURED',
    })
    expect(await inspectProviderInvoiceEvidence({binding, port:null})).toEqual({
      outcome:'NOT_CONFIGURED',
    })
  })
  it('never permits LIVE inspection even when an adapter is injected', async () => {
    const {port,fn}=adapter()
    expect(await inspectProviderInvoiceEvidence({
      binding:{...binding,environment:'LIVE'},port,
    })).toEqual({outcome:'BLOCKED',reason:'LIVE_GATED'})
    expect(fn).not.toHaveBeenCalled()
  })
  it('does not query the connector for invalid server-side reference values', async () => {
    const {port,fn}=adapter()
    for(const b of [
      {...binding,invoiceId:'invalid'},
      {...binding,customerId:'invalid'},
      {...binding,subscriptionId:'invalid'},
      {...binding,priceId:'invalid'},
      {...binding,amountMinor:0},
      {...binding,currency:'USD'},
      {...binding,organizationId:'not-an-org'},
      {...binding,now:'not a date'},
    ]) {
      expect(await inspectProviderInvoiceEvidence({
        binding:b as ExpectedInvoiceBinding,port,
      })).toEqual({outcome:'BLOCKED',reason:'INVALID_BINDING'})
    }
    expect(fn).not.toHaveBeenCalled()
  })
  it('requires a matching connector identity and exact invoice lookup', async () => {
    const {port,fn}=adapter()
    expect(await inspectProviderInvoiceEvidence({binding,port}))
      .toEqual({outcome:'EVIDENCE_ONLY'})
    expect(fn).toHaveBeenCalledExactlyOnceWith({
      invoiceId:'in_fixture',environment:'TEST',
    })
  })
  it('fails closed for missing provider data and provider/network errors', async () => {
    expect(await inspectProviderInvoiceEvidence({
      binding,port:adapter({outcome:'NOT_FOUND'}).port,
    })).toEqual({outcome:'BLOCKED',reason:'PROVIDER_NOT_FOUND'})
    expect(await inspectProviderInvoiceEvidence({
      binding,port:adapter({outcome:'UNAVAILABLE'}).port,
    })).toEqual({outcome:'BLOCKED',reason:'PROVIDER_UNAVAILABLE'})
    expect(await inspectProviderInvoiceEvidence({
      binding,port:{provider:'stripe',readInvoice:async()=>{throw new Error('network')} },
    })).toEqual({outcome:'BLOCKED',reason:'PROVIDER_UNAVAILABLE'})
  })
  it('rejects mismatched invoice, customer, subscription and environment identifiers', async () => {
    for(const patch of [
      {invoiceId:'in_foreign'},
      {customerId:'cus_foreign'},
      {subscriptionId:'sub_foreign'},
      {environment:'LIVE'},
    ] as const) {
      expect(await inspectProviderInvoiceEvidence({
        binding,port:adapter({outcome:'FOUND',invoice:{...invoice,...patch}}).port,
      })).toEqual({outcome:'BLOCKED',reason:'IDENTITY_MISMATCH'})
    }
  })
  it('rejects price, amount, interval and currency mismatches', async () => {
    for(const patch of [
      {priceId:'price_foreign'},
      {currency:'USD'},
      {amountDueMinor:100_000},
      {interval:'year'},
    ] as const) {
      expect(await inspectProviderInvoiceEvidence({
        binding,port:adapter({outcome:'FOUND',invoice:{...invoice,...patch}}).port,
      })).toEqual({outcome:'BLOCKED',reason:'PRICE_MISMATCH'})
    }
  })
  it('does not infer paid from invoice flags, open payment or unpaid balance', async () => {
    for(const patch of [
      {invoicePaid:false},
      {paymentStatus:'pending'},
      {amountPaidMinor:0},
      {amountRemainingMinor:100},
    ] as const) {
      expect(await inspectProviderInvoiceEvidence({
        binding,port:adapter({outcome:'FOUND',invoice:{...invoice,...patch}}).port,
      })).toEqual({outcome:'BLOCKED',reason:'PAYMENT_NOT_SETTLED'})
    }
  })
  it('rejects refunds, disputes, unverified refund state and inactive subscriptions', async () => {
    for(const patch of [
      {refundedMinor:100},
      {disputeStatus:'open'},
      {disputeStatus:'unknown'},
    ] as const) {
      expect(await inspectProviderInvoiceEvidence({
        binding,port:adapter({outcome:'FOUND',invoice:{...invoice,...patch}}).port,
      })).toEqual({outcome:'BLOCKED',reason:'REFUND_OR_DISPUTE'})
    }
    expect(await inspectProviderInvoiceEvidence({
      binding,port:adapter({outcome:'FOUND',invoice:{...invoice,subscriptionStatus:'past_due'}}).port,
    })).toEqual({outcome:'BLOCKED',reason:'SUBSCRIPTION_NOT_ACTIVE'})
  })
  it('rejects stale, future and expired provider observations', async () => {
    for(const patch of [
      {observedAt:'2026-10-19T04:50:00Z'},
      {observedAt:'2026-10-19T05:10:00Z'},
      {currentPeriodEnd:'2026-10-18T00:00:00Z'},
    ] as const) {
      expect(await inspectProviderInvoiceEvidence({
        binding,port:adapter({outcome:'FOUND',invoice:{...invoice,...patch}}).port,
      })).toEqual({outcome:'BLOCKED',reason:'EXPIRED_OR_STALE'})
    }
  })
  it('rejects malformed adapter results without throwing or authorizing access', async () => {
    for(const malformed of [
      {outcome:'FOUND',invoice:{...invoice,currency:null}},
      {outcome:'FOUND',invoice:{...invoice,amountDueMinor:NaN}},
      {outcome:'FOUND',invoice:{...invoice,observedAt:'not a date'}},
      {outcome:'FOUND',invoice:null},
      {outcome:'FORGED'},
      null,
    ]) {
      const port = {
        provider:'stripe' as const,
        readInvoice:async()=>malformed as ProviderInvoiceRead,
      }
      expect((await inspectProviderInvoiceEvidence({binding,port})).outcome).toBe('BLOCKED')
    }
  })
  it('returns no provider secrets, payment IDs, entitlement or raw PII', async () => {
    const {port}=adapter()
    const result=await inspectProviderInvoiceEvidence({binding,port})
    expect(result).toEqual({outcome:'EVIDENCE_ONLY'})
    expect(JSON.stringify(result)).not.toContain('cus_fixture')
    expect(JSON.stringify(result)).not.toContain('in_fixture')
  })
})
