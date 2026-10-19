import { describe, expect, it } from 'vitest'
import { assessPaymentEvidence, type PaymentEvidenceSnapshot } from '../../src/domain/billing/payment-evidence'

const organizationId = '11111111-1111-4111-8111-111111111111'
const paid: PaymentEvidenceSnapshot = {
  provider: 'stripe', environment: 'TEST', organizationId,
  subscriptionId: 'sub_sample', invoiceId: 'in_sample',
  invoiceSubscriptionId: 'sub_sample', invoicePaid: true,
  invoiceAmountRemainingMinor: 0, invoiceCurrency: 'PHP',
  invoiceEnvironment: 'TEST', invoiceOrganizationId: organizationId,
  paymentStatus: 'succeeded', subscriptionStatus: 'active',
  periodEnd: '2026-12-01T00:00:00Z', verifiedAt: '2026-11-01T00:00:00Z',
}
const context = { organizationId, environment: 'TEST' as const,
  now: '2026-11-01T00:01:00Z', maxEvidenceAgeMs: 120000, expectedCurrency: 'PHP' }

describe('MR-5E1 payment evidence prerequisite (not entitlement)', () => {
  it('rejects absent evidence', () => {
    expect(assessPaymentEvidence(null, context)).toEqual({
      outcome: 'INSUFFICIENT_EVIDENCE', reason: 'MISSING_OR_INVALID',
    })
  })
  it('accepts a fully matching fresh synthetic evidence snapshot only as prerequisite', () => {
    expect(assessPaymentEvidence(paid, context)).toEqual({
      outcome: 'VERIFIED_PAYMENT_EVIDENCE',
    })
  })
  it.each([
    [{ organizationId: 'other' }, 'TENANT_MISMATCH'],
    [{ invoiceOrganizationId: 'other' }, 'TENANT_MISMATCH'],
    [{ invoiceEnvironment: 'LIVE' }, 'ENVIRONMENT_MISMATCH'],
    [{ invoiceSubscriptionId: 'sub_other' }, 'SUBSCRIPTION_MISMATCH'],
    [{ invoiceCurrency: 'USD' }, 'CURRENCY_MISMATCH'],
    [{ invoicePaid: false }, 'UNPAID_INVOICE'],
    [{ invoiceAmountRemainingMinor: 10 }, 'UNPAID_INVOICE'],
    [{ paymentStatus: 'pending' }, 'PAYMENT_NOT_SUCCEEDED'],
    [{ subscriptionStatus: 'past_due' }, 'SUBSCRIPTION_NOT_ACTIVE'],
    [{ periodEnd: '2026-10-01T00:00:00Z' }, 'EXPIRED_PERIOD'],
    [{ verifiedAt: '2026-10-31T23:00:00Z' }, 'STALE_EVIDENCE'],
    [{ verifiedAt: '2026-11-02T00:00:00Z' }, 'STALE_EVIDENCE'],
    [{ invoiceId: '' }, 'MISSING_OR_INVALID'],
  ] as const)('fails closed on %#', (changes, reason) => {
    expect(assessPaymentEvidence({ ...paid, ...changes }, context)).toEqual({
      outcome: 'INSUFFICIENT_EVIDENCE', reason,
    })
  })
})
