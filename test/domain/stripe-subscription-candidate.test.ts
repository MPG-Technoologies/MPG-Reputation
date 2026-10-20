import { describe, expect, it } from 'vitest'
import {
  prepareStripeSubscriptionProjection,
  type StripeSubscriptionProjectionTruth,
} from '../../src/lib/billing/stripe-subscription-candidate'
import type {
  StripeSubscriptionOrganizationResolution,
} from '../../src/lib/billing/stripe-subscription-truth'

type Resolved = Extract<StripeSubscriptionOrganizationResolution, { outcome: 'RESOLVED' }>

const resolved: Resolved = {
  outcome: 'RESOLVED',
  environment: 'TEST',
  providerSubscriptionId: 'sub_Synthetic123',
  providerCustomerId: 'cus_Synthetic123',
  providerStatus: 'active',
  organizationId: '11111111-1111-4111-8111-111111111111',
  billingAccountId: '22222222-2222-4222-8222-222222222222',
}

const start = 1792300000
const end = 1794892000

function subscription(
  overrides: Partial<StripeSubscriptionProjectionTruth> = {}
): StripeSubscriptionProjectionTruth {
  return {
    id: 'sub_Synthetic123',
    customer: 'cus_Synthetic123',
    livemode: false,
    status: 'active',
    cancel_at_period_end: false,
    canceled_at: null,
    items: {
      has_more: false,
      data: [{
        price: { id: 'price_Synthetic123' },
        current_period_start: start,
        current_period_end: end,
      }],
    },
    ...overrides,
  }
}

function decision(
  overrides: Partial<StripeSubscriptionProjectionTruth> = {},
  tenant: Resolved = resolved
) {
  return prepareStripeSubscriptionProjection({
    resolved: tenant,
    subscription: subscription(overrides),
  })
}

describe('MR-5C provider-truth subscription candidate — no DB or Stripe account', () => {
  it('constructs a PII-free, tenant-bound TEST projection candidate', () => {
    expect(decision()).toEqual({
      outcome: 'READY',
      candidate: {
        provider: 'stripe',
        environment: 'TEST',
        organizationId: resolved.organizationId,
        billingAccountId: resolved.billingAccountId,
        providerSubscriptionId: resolved.providerSubscriptionId,
        providerPriceId: 'price_Synthetic123',
        providerStatus: 'active',
        normalizedStatus: 'ACTIVE',
        currentPeriodStart: new Date(start * 1000).toISOString(),
        currentPeriodEnd: new Date(end * 1000).toISOString(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        providerStateUpdatedAt: null,
      },
    })
  })

  it.each([
    ['incomplete', 'PENDING'],
    ['trialing', 'PENDING'],
    ['active', 'ACTIVE'],
    ['past_due', 'SUSPENDED'],
    ['unpaid', 'SUSPENDED'],
    ['paused', 'SUSPENDED'],
    ['canceled', 'ENDED'],
    ['incomplete_expired', 'ENDED'],
  ])('normalizes Stripe %s as billing %s (never a paid entitlement)', (status, normalized) => {
    const result = decision({ status })
    expect(result.outcome).toBe('READY')
    if (result.outcome === 'READY') {
      expect(result.candidate.normalizedStatus).toBe(normalized)
    }
  })

  it('rejects unknown or malicious status values rather than defaulting active', () => {
    expect(decision({ status: 'something_new' })).toEqual({
      outcome: 'BLOCKED',
      reason: 'STATUS_UNSUPPORTED',
    })
    expect(decision({ status: '__proto__' })).toEqual({
      outcome: 'BLOCKED',
      reason: 'STATUS_UNSUPPORTED',
    })
  })

  it('rejects subscription and customer ID mismatches even if metadata could impersonate another tenant', () => {
    expect(decision({ id: 'sub_Other123' })).toEqual({
      outcome: 'BLOCKED', reason: 'SUBSCRIPTION_MISMATCH',
    })
    expect(decision({ customer: 'cus_Other123' })).toEqual({
      outcome: 'BLOCKED', reason: 'CUSTOMER_MISMATCH',
    })
  })

  it('accepts expanded customer ID only when it matches resolved provider truth', () => {
    expect(decision({ customer: { id: resolved.providerCustomerId } }).outcome).toBe('READY')
    expect(decision({ customer: { id: 'cus_Foreign123' } })).toEqual({
      outcome: 'BLOCKED', reason: 'CUSTOMER_MISMATCH',
    })
  })

  it('blocks LIVE/provider environment mismatches', () => {
    expect(decision({ livemode: true })).toEqual({
      outcome: 'BLOCKED', reason: 'ENVIRONMENT_MISMATCH',
    })
  })

  it('does not trust forged resolved tenant identities', () => {
    expect(decision({}, { ...resolved, organizationId: 'not-an-organization' })).toEqual({
      outcome: 'BLOCKED', reason: 'IDENTITY_INVALID',
    })
    expect(decision({}, { ...resolved, billingAccountId: '' })).toEqual({
      outcome: 'BLOCKED', reason: 'IDENTITY_INVALID',
    })
  })

  it('rejects more than one price item; no invented aggregation or wrong-plan billing', () => {
    const two = subscription().items.data
    expect(decision({ items: { has_more: false, data: [...two, ...two] } })).toEqual({
      outcome: 'BLOCKED', reason: 'ITEMS_AMBIGUOUS',
    })
    expect(decision({ items: { has_more: false, data: [] } })).toEqual({
      outcome: 'BLOCKED', reason: 'ITEMS_AMBIGUOUS',
    })
    expect(decision({ items: { has_more: true, data: two } })).toEqual({
      outcome: 'BLOCKED', reason: 'ITEMS_AMBIGUOUS',
    })
  })

  it('blocks missing and malformed price identifiers', () => {
    expect(decision({
      items: { has_more: false, data: [{
        price: { id: 'https://example.com' },
        current_period_start: start, current_period_end: end,
      }] },
    })).toEqual({ outcome: 'BLOCKED', reason: 'PRICE_INVALID' })
  })

  it('never guesses active billing periods from incomplete snapshots', () => {
    expect(decision({
      items: { has_more: false, data: [{
        price: { id: 'price_Synthetic123' },
      }] },
    })).toEqual({ outcome: 'BLOCKED', reason: 'PERIOD_INVALID' })
  })

  it('accepts legacy parent period fields when the item lacks them', () => {
    expect(decision({
      current_period_start: start,
      current_period_end: end,
      items: { has_more: false, data: [{ price: { id: 'price_Synthetic123' } }] },
    }).outcome).toBe('READY')
  })

  it('rejects inverted, equal, out-of-range, and partial billing periods', () => {
    for (const [periodStart, periodEnd] of [
      [end, start],
      [start, start],
      [-1, end],
      [start, 999999999999999],
      [null, end],
    ] as const) {
      expect(decision({
        items: { has_more: false, data: [{
          price: { id: 'price_Synthetic123' },
          current_period_start: periodStart,
          current_period_end: periodEnd,
        }] },
      })).toEqual({ outcome: 'BLOCKED', reason: 'PERIOD_INVALID' })
    }
  })

  it('accepts null period only for inactive/unpaid terminal states, not active', () => {
    const item = {
      price: { id: 'price_Synthetic123' },
      current_period_start: null,
      current_period_end: null,
    }
    expect(decision({
      items: { has_more: false, data: [item] },
    })).toEqual({ outcome: 'BLOCKED', reason: 'PERIOD_INVALID' })
    expect(decision({
      status: 'canceled',
      items: { has_more: false, data: [item] },
    }).outcome).toBe('READY')
  })

  it('preserves pending cancellation without ending the subscription early', () => {
    const result = decision({ cancel_at_period_end: true, canceled_at: start })
    expect(result.outcome).toBe('READY')
    if (result.outcome === 'READY') {
      expect(result.candidate.normalizedStatus).toBe('ACTIVE')
      expect(result.candidate.cancelAtPeriodEnd).toBe(true)
      expect(result.candidate.canceledAt).toBe(new Date(start * 1000).toISOString())
    }
  })

  it('blocks missing cancellation flags and invalid cancellation timestamps', () => {
    expect(decision({ cancel_at_period_end: undefined as unknown as boolean })).toEqual({
      outcome: 'BLOCKED', reason: 'CANCELLATION_INVALID',
    })
    expect(decision({ canceled_at: Number.NaN })).toEqual({
      outcome: 'BLOCKED', reason: 'CANCELLATION_INVALID',
    })
  })

  it('drops provider metadata, contact emails, and event-created timestamps rather than persisting sensitive payload', () => {
    const result = decision({
      ...{ metadata: { organizationId: 'forged', privateEmail: 'secret@example.test' }, created: 1 },
    } as Partial<StripeSubscriptionProjectionTruth>)
    expect(result.outcome).toBe('READY')
    if (result.outcome === 'READY') {
      const serialized = JSON.stringify(result.candidate)
      expect(serialized).not.toContain('secret@example.test')
      expect(serialized).not.toContain('metadata')
      expect(serialized).not.toContain('forged')
      expect(result.candidate.providerStateUpdatedAt).toBeNull()
    }
  })
})
