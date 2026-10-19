import { describe, expect, it } from 'vitest'
import { correlateInvoiceEvidence, type DurableBillingEvent } from '../../src/domain/billing/evidence-correlation'
import type { PaymentEvidenceSnapshot } from '../../src/domain/billing/payment-evidence'

const org = '11111111-1111-4111-8111-111111111111'
const evidence: PaymentEvidenceSnapshot = {
  provider: 'stripe', environment: 'TEST', organizationId: org,
  subscriptionId: 'sub_sample', invoiceId: 'in_sample',
  invoiceSubscriptionId: 'sub_sample', invoicePaid: true,
  invoiceAmountRemainingMinor: 0, invoiceCurrency: 'PHP',
  invoiceEnvironment: 'TEST', invoiceOrganizationId: org,
  paymentStatus: 'succeeded', subscriptionStatus: 'active',
  periodEnd: '2026-12-01T00:00:00Z', verifiedAt: '2026-11-01T00:00:00Z',
}
const paid: DurableBillingEvent = {
  providerEventId: 'evt_sample', organizationId: org,
  subscriptionId: 'sub_sample', invoiceId: 'in_sample',
  environment: 'TEST', signatureVerified: true,
  eventType: 'invoice.paid', processingStatus: 'PROCESSED',
}
const base = { evidence, events: [paid], organizationId: org,
  environment: 'TEST' as const, currency: 'PHP', now: '2026-11-01T00:01:00Z',
  maxEvidenceAgeMs: 120000 }

describe('MR-5E2 non-authorizing correlation', () => {
  it('only correlates the matching paid synthetic event', () => {
    expect(correlateInvoiceEvidence(base)).toEqual({outcome:'CORRELATED_EVIDENCE_ONLY'})
  })
  it('rejects missing durable processed webhook', () => {
    expect(correlateInvoiceEvidence({...base,events:[{...paid,processingStatus:'RECEIVED'}]}))
      .toEqual({outcome:'UNVERIFIED',reason:'NO_PROCESSED_INVOICE_EVENT'})
  })
  it('rejects cross-tenant, unsigned and foreign invoices', () => {
    for (const patch of [{organizationId:'foreign'}, {signatureVerified:false},
      {invoiceId:'in_foreign'}]) {
      expect(correlateInvoiceEvidence({...base,events:[{...paid,...patch}]}))
        .toEqual({outcome:'UNVERIFIED',reason:'INVALID_EVENTS'})
    }
  })
  it('deduplicates identical retries and refuses contradictory duplicates', () => {
    expect(correlateInvoiceEvidence({...base,events:[paid,paid]}))
      .toEqual({outcome:'CORRELATED_EVIDENCE_ONLY'})
    expect(correlateInvoiceEvidence({...base,events:[paid,{...paid,eventType:'invoice.payment_failed'}]}))
      .toEqual({outcome:'UNVERIFIED',reason:'INVALID_EVENTS'})
  })
  it('rejects processed failures even with a processed invoice paid event', () => {
    expect(correlateInvoiceEvidence({...base,events:[paid,{
      ...paid,providerEventId:'evt_failed', eventType:'invoice.payment_failed'}]}))
      .toEqual({outcome:'UNVERIFIED',reason:'CONFLICTING_PAYMENT_EVENT'})
  })
  it('rejects stale provider data independently of webhook status', () => {
    expect(correlateInvoiceEvidence({...base,evidence:{...evidence,
      verifiedAt:'2026-10-01T00:00:00Z'}}))
      .toEqual({outcome:'UNVERIFIED',reason:'PROVIDER_EVIDENCE'})
  })
})
