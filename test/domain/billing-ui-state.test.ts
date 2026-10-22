import { describe, expect, it } from 'vitest'
import {
  getBillingWorkspaceSummary,
  getCheckoutReturnMessage,
} from '../../src/domain/billing/ui-state'

const testSub = {
  normalized_status: 'ACTIVE' as const,
  environment: 'TEST' as const,
  current_period_end: '2026-11-20T00:00:00Z',
  cancel_at_period_end: false,
}

describe('MR-5D3A TEST-only billing workspace model', () => {
  it('shows missing billing account as setup required, not a failed payment', () => {
    expect(getBillingWorkspaceSummary({ subscription: null, hasTestAccount: false }))
      .toMatchObject({
        status: 'NOT_CONFIGURED',
        supportRequired: true,
        headline: 'Payment account not set up',
      })
  })
  it('distinguishes linked Stripe TEST account without a subscription', () => {
    const result = getBillingWorkspaceSummary({
      subscription: null, hasTestAccount: true,
    })
    expect(result.status).toBe('NOT_CONFIGURED')
    expect(result.description).toContain('Checkout is not yet available')
  })
  it('records ACTIVE as provider TEST state without granting paid entitlement', () => {
    const status = getBillingWorkspaceSummary({
      subscription: testSub, hasTestAccount: true,
    })
    expect(status.status).toBe('ACTIVE')
    expect(status.headline).toContain('TEST')
    expect(status.description).toContain('does not confirm payment settlement')
    expect(status.periodEnd).toBe(testSub.current_period_end)
  })
  it('never reports an orphan subscription as active billing', () => {
    expect(getBillingWorkspaceSummary({
      subscription: testSub, hasTestAccount: false,
    })).toMatchObject({ status: 'UNAVAILABLE', supportRequired: true, periodEnd: null })
  })
  it('handles pending provider verification without invented payment confirmation', () => {
    const status = getBillingWorkspaceSummary({
      subscription: { ...testSub, normalized_status: 'PENDING' },
      hasTestAccount: true,
    })
    expect(status.headline).toContain('pending')
    expect(status.description).toContain('still required')
  })
  it('flags SUSPENDED and GRACE for intervention without asserting access', () => {
    for (const value of ['SUSPENDED', 'GRACE'] as const) {
      const status = getBillingWorkspaceSummary({
        subscription: { ...testSub, normalized_status: value }, hasTestAccount: true,
      })
      expect(status.status).toBe(value)
      expect(status.supportRequired).toBe(true)
    }
  })
  it('correctly represents ENDED status', () => {
    const status = getBillingWorkspaceSummary({
      subscription: { ...testSub, normalized_status: 'ENDED' },
      hasTestAccount: true,
    })
    expect(status.status).toBe('ENDED')
    expect(status.headline).toContain('ended')
  })
  it('never claims LIVE provider state is supported by TEST-only workspace', () => {
    expect(getBillingWorkspaceSummary({
      subscription: { ...testSub, environment: 'LIVE' },
      hasTestAccount: true,
    })).toMatchObject({ status: 'UNAVAILABLE', supportRequired: true })
  })
  it('error-state data load failure does not pretend no subscription exists', () => {
    expect(getBillingWorkspaceSummary({
      subscription: null, hasTestAccount: false, dataUnavailable: true,
    })).toMatchObject({ status: 'UNAVAILABLE', supportRequired: true })
  })
  it('does not drop recorded cancel-at-period-end information', () => {
    expect(getBillingWorkspaceSummary({
      subscription: { ...testSub, cancel_at_period_end: true },
      hasTestAccount: true,
    }).description).toContain('cancellation at period end')
  })
  it('treats unrecognized provider statuses as unverified rather than crashing or displaying paid', () => {
    for (const raw of ['PAID', 'CANCELED', 'ACTIVE ', '', null, undefined, 1]) {
      const status = getBillingWorkspaceSummary({
        subscription: { ...testSub, normalized_status: raw } as never,
        hasTestAccount: true,
      })
      expect(status).toMatchObject({
        status: 'UNAVAILABLE', headline: 'Billing status unavailable',
        supportRequired: true, periodEnd: null,
      })
      expect(status.description).toContain('No payment, plan change or paid access is confirmed')
    }
  })

  it('refuses malformed and unsafe recorded period dates without inventing status', () => {
    for (const raw of [
      'not-a-date', '', '2026-11-20', '2026-11-20T00:00:00',
      '99999-01-01T00:00:00Z', '2026-11-20T00:00:00+99:99',
      undefined, 1730000000000, {},
    ]) {
      const status = getBillingWorkspaceSummary({
        subscription: { ...testSub, current_period_end: raw } as never,
        hasTestAccount: true,
      })
      expect(status).toMatchObject({ status: 'UNAVAILABLE', periodEnd: null, supportRequired: true })
    }
  })

  it('accepts valid PostgREST timezone-aware dates and optional null dates', () => {
    for (const valid of [
      '2026-11-20T00:00:00Z', '2026-11-20T08:00:00+08:00',
      '2026-11-20T00:00:00.123456+00:00', null,
    ]) {
      const result = getBillingWorkspaceSummary({
        subscription: { ...testSub, current_period_end: valid },
        hasTestAccount: true,
      })
      expect(result.status).toBe('ACTIVE')
      expect(result.periodEnd).toBe(valid)
    }
  })

  it('refuses invalid cancellation flags on provider projections', () => {
    for (const raw of ['true', 1, null, undefined]) {
      expect(getBillingWorkspaceSummary({
        subscription: { ...testSub, cancel_at_period_end: raw } as never,
        hasTestAccount: true,
      })).toMatchObject({ status: 'UNAVAILABLE', periodEnd: null, supportRequired: true })
    }
  })

  it('success return never confirms payment or grants access', () => {
    const message = getCheckoutReturnMessage('success')
    expect(message.title.toLowerCase()).toContain('pending')
    expect(message.description).toContain('does not confirm payment')
    expect(message.description).toContain('verified provider')
  })
  it('cancel return neither claims charge nor creates new checkout intent', () => {
    const message = getCheckoutReturnMessage('cancel')
    expect(message.title).toContain('not completed')
    expect(message.description).toContain('No subscription or paid access is confirmed')
  })
})
