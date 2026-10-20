import { describe, expect, it } from 'vitest'
import {
  compareSyntheticFrozenInvoiceCandidates,
  type SyntheticFrozenCheckoutQuote, type SyntheticInvoiceEvidenceCandidate,
} from '../../src/domain/billing/synthetic-frozen-invoice-consistency'

const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const account = '33333333-3333-4333-8333-333333333333'
const otherAccount = '44444444-4444-4444-8444-444444444444'
const quote: SyntheticFrozenCheckoutQuote = {
  organization_id: a, billing_account_id: account, provider: 'stripe',
  environment: 'TEST', provider_price_id: 'price_Monthly',
  candidate_currency: 'PHP', candidate_amount_minor: 150000,
  candidate_interval: 'month', source_kind: 'SYNTHETIC',
  approval_status: 'PROPOSED', verification_status: 'UNVERIFIED',
  payment_authorized: false, access_authorized: false,
}
const invoice: SyntheticInvoiceEvidenceCandidate = {
  organization_id: a, billing_account_id: account, provider: 'stripe',
  environment: 'TEST', provider_invoice_id: 'in_Synthetic',
  candidate_price_id: 'price_Monthly', candidate_currency: 'PHP',
  candidate_amount_minor: 150000, candidate_interval: 'month',
  source_kind: 'SYNTHETIC', verification_status: 'UNVERIFIED',
  financial_finality: false, access_authorized: false,
}
const check = (q: SyntheticFrozenCheckoutQuote | null = quote,
  i: SyntheticInvoiceEvidenceCandidate | null = invoice) =>
  compareSyntheticFrozenInvoiceCandidates({ quote: q, invoice: i })
const denied = (reason: string) => ({ outcome: 'BLOCKED', reason })

describe('MR-5 Stage 1 frozen candidate consistency, never payment authority', () => {
  it('allows only a synthetic-only, explicitly false financial/access result', () => {
    const outcome = check()
    expect(outcome).toEqual({ outcome: 'CONSISTENT_SYNTHETIC_ONLY',
      financialFinality: false, accessAuthorized: false })
    for (const secret of [a, b, account, 'in_Synthetic', 'price_Monthly']) {
      expect(JSON.stringify(outcome)).not.toContain(secret)
    }
  })
  it('requires two records, not an arbitrary orphaned proposal', () => {
    expect(check(null)).toEqual(denied('MISSING_RECORD'))
    expect(check(quote,null)).toEqual(denied('MISSING_RECORD'))
  })
  it.each([
    [{ organization_id: b }, {}, 'CROSS_TENANT_OR_ACCOUNT'],
    [{ billing_account_id: otherAccount }, {}, 'CROSS_TENANT_OR_ACCOUNT'],
    [{}, { organization_id: b }, 'CROSS_TENANT_OR_ACCOUNT'],
    [{}, { billing_account_id: otherAccount }, 'CROSS_TENANT_OR_ACCOUNT'],
    [{ provider_price_id: 'price_Other' }, {}, 'PRICE_MISMATCH'],
    [{}, { candidate_price_id: 'price_Other' }, 'PRICE_MISMATCH'],
    [{ candidate_amount_minor: 100000 }, {}, 'FROZEN_TERMS_MISMATCH'],
    [{}, { candidate_amount_minor: 100000 }, 'FROZEN_TERMS_MISMATCH'],
    [{ candidate_interval: 'year' }, {}, 'FROZEN_TERMS_MISMATCH'],
    [{}, { candidate_interval: 'year' }, 'FROZEN_TERMS_MISMATCH'],
    [{ environment: 'LIVE' }, {}, 'NOT_SYNTHETIC_TEST'],
    [{}, { environment: 'LIVE' }, 'NOT_SYNTHETIC_TEST'],
    [{ source_kind: 'PROVIDER' }, {}, 'NOT_SYNTHETIC_TEST'],
    [{}, { source_kind: 'PROVIDER' }, 'NOT_SYNTHETIC_TEST'],
    [{ approval_status: 'APPROVED' }, {}, 'NOT_UNVERIFIED'],
    [{ payment_authorized: true }, {}, 'NOT_UNVERIFIED'],
    [{ access_authorized: true }, {}, 'NOT_UNVERIFIED'],
    [{}, { verification_status: 'VERIFIED' }, 'NOT_UNVERIFIED'],
    [{}, { financial_finality: true }, 'NOT_UNVERIFIED'],
    [{}, { access_authorized: true }, 'NOT_UNVERIFIED'],
    [{ candidate_amount_minor: 0 }, {}, 'INVALID_RECORD'],
    [{}, { candidate_amount_minor: NaN }, 'INVALID_RECORD'],
    [{ provider_price_id: '' }, {}, 'INVALID_RECORD'],
    [{}, { provider_invoice_id: '' }, 'INVALID_RECORD'],
    [{ organization_id: 'invalid' }, {}, 'INVALID_RECORD'],
  ] as const)('blocks cross-record mismatch %#', (q, i, reason) => {
    expect(check({...quote,...q},{...invoice,...i})).toEqual(denied(reason))
  })
  it('does not mutate either input or infer proof from equal candidates', () => {
    const before = JSON.stringify([quote,invoice])
    expect(check().outcome).toBe('CONSISTENT_SYNTHETIC_ONLY')
    expect(JSON.stringify([quote,invoice])).toBe(before)
    // A caller-provided quote/invoice pair is NOT authenticated provenance.
    expect(check({...quote,verification_status:'VERIFIED'}))
      .toEqual(denied('NOT_UNVERIFIED'))
  })
})
