import { describe, expect, it } from 'vitest'
import {
  REPUTATION_BILLING_PLANS,
  getAnnualSavingsMinor,
  getReputationBillingPlan,
  validateReputationProviderPrice,
  type ProviderRecurringPriceSnapshot,
} from '../../src/domain/billing'
import { resolveStripePriceBinding } from '../../src/lib/billing/stripe-plan-bindings'

function providerPrice(
  overrides: Partial<ProviderRecurringPriceSnapshot> = {}
): ProviderRecurringPriceSnapshot {
  return {
    id: 'price_test_monthly123',
    currency: 'php',
    unitAmountMinor: 150_000,
    interval: 'month',
    intervalCount: 1,
    active: true,
    liveMode: false,
    ...overrides,
  }
}

function match(
  planId: unknown,
  overrides: Partial<ProviderRecurringPriceSnapshot> = {}
) {
  return validateReputationProviderPrice({
    planId,
    configuredPriceId: 'price_test_monthly123',
    expectedEnvironment: 'TEST',
    providerPrice: providerPrice(overrides),
  })
}

const testConfiguration = {
  STRIPE_TEST_MONTHLY_PRICE_ID: 'price_test_monthly123',
  STRIPE_TEST_ANNUAL_PRICE_ID: 'price_test_annual123',
}

describe('MR-5 proposed recurring pricing contract (no Stripe account required)', () => {
  it('models ₱1,500 monthly as 150,000 PHP centavos', () => {
    expect(REPUTATION_BILLING_PLANS.monthly).toMatchObject({
      id: 'monthly',
      currency: 'PHP',
      interval: 'month',
      intervalCount: 1,
      amountMinor: 150_000,
      monthlyEquivalentMinor: 150_000,
      approval: 'PROPOSED',
    })
  })

  it('models ₱1,000 per month billed annually as a single ₱12,000 yearly charge', () => {
    expect(REPUTATION_BILLING_PLANS.annual).toMatchObject({
      id: 'annual',
      interval: 'year',
      intervalCount: 1,
      amountMinor: 1_200_000,
      monthlyEquivalentMinor: 100_000,
      approval: 'PROPOSED',
    })
    expect(getAnnualSavingsMinor()).toBe(600_000)
    expect(REPUTATION_BILLING_PLANS.monthly.amountMinor * 12).toBe(1_800_000)
  })

  it('refuses unknown or user-invented plan IDs', () => {
    expect(getReputationBillingPlan('monthly')).toEqual(REPUTATION_BILLING_PLANS.monthly)
    expect(getReputationBillingPlan('annually')).toBeNull()
    expect(getReputationBillingPlan(null)).toBeNull()
    expect(match('enterprise')).toEqual({ ok: false, reason: 'UNKNOWN_PLAN' })
  })

  it('verifies an active TEST monthly Stripe Price matches amount, currency and cadence', () => {
    expect(match('monthly')).toEqual({ ok: true })
  })

  it('verifies a separate annual Stripe Price bills once per year', () => {
    expect(validateReputationProviderPrice({
      planId: 'annual',
      configuredPriceId: 'price_test_annual123',
      expectedEnvironment: 'TEST',
      providerPrice: providerPrice({
        id: 'price_test_annual123',
        unitAmountMinor: 1_200_000,
        interval: 'year',
      }),
    })).toEqual({ ok: true })
  })

  it('rejects an unconfigured or different Stripe Price ID', () => {
    expect(match('monthly', { id: 'price_other' })).toEqual({
      ok: false,
      reason: 'PRICE_ID_MISMATCH',
    })
    expect(validateReputationProviderPrice({
      planId: 'monthly',
      configuredPriceId: '',
      expectedEnvironment: 'TEST',
      providerPrice: providerPrice(),
    })).toEqual({ ok: false, reason: 'PRICE_ID_MISMATCH' })
  })

  it('rejects inactive and wrong-environment Stripe Prices', () => {
    expect(match('monthly', { active: false })).toEqual({
      ok: false, reason: 'PRICE_INACTIVE',
    })
    expect(match('monthly', { liveMode: true })).toEqual({
      ok: false, reason: 'ENVIRONMENT_MISMATCH',
    })
  })

  it('rejects silently substituted provider currency or amount', () => {
    expect(match('monthly', { currency: 'usd' })).toEqual({
      ok: false, reason: 'CURRENCY_MISMATCH',
    })
    expect(match('monthly', { unitAmountMinor: 120_000 })).toEqual({
      ok: false, reason: 'AMOUNT_MISMATCH',
    })
    expect(match('monthly', { unitAmountMinor: null })).toEqual({
      ok: false, reason: 'AMOUNT_MISMATCH',
    })
  })

  it('rejects billing interval and interval count mismatches', () => {
    expect(match('monthly', { interval: 'year' })).toEqual({
      ok: false, reason: 'INTERVAL_MISMATCH',
    })
    expect(match('monthly', { intervalCount: 3 })).toEqual({
      ok: false, reason: 'INTERVAL_MISMATCH',
    })
  })
})

describe('MR-5 Stripe price configuration boundaries', () => {
  it('fails closed when Stripe price IDs are not yet configured', () => {
    expect(resolveStripePriceBinding({
      planId: 'monthly',
      environment: 'TEST',
      config: {},
    })).toEqual({ outcome: 'BLOCKED', reason: 'PRICE_NOT_CONFIGURED' })
  })

  it('binds monthly and annual independently after test IDs are configured', () => {
    expect(resolveStripePriceBinding({
      planId: 'monthly',
      environment: 'TEST',
      config: testConfiguration,
    })).toEqual({ outcome: 'READY', priceId: 'price_test_monthly123' })
    expect(resolveStripePriceBinding({
      planId: 'annual',
      environment: 'TEST',
      config: testConfiguration,
    })).toEqual({ outcome: 'READY', priceId: 'price_test_annual123' })
  })

  it('rejects invalid and duplicate Stripe Price IDs', () => {
    expect(resolveStripePriceBinding({
      planId: 'annual',
      environment: 'TEST',
      config: { STRIPE_TEST_ANNUAL_PRICE_ID: 'https://unsafe.example' },
    })).toEqual({ outcome: 'BLOCKED', reason: 'INVALID_PRICE_ID' })
    expect(resolveStripePriceBinding({
      planId: 'annual',
      environment: 'TEST',
      config: {
        STRIPE_TEST_MONTHLY_PRICE_ID: 'price_same123',
        STRIPE_TEST_ANNUAL_PRICE_ID: 'price_same123',
      },
    })).toEqual({ outcome: 'BLOCKED', reason: 'DUPLICATE_PLAN_PRICE_IDS' })
  })

  it('fails closed for unknown client-controlled plans', () => {
    expect(resolveStripePriceBinding({
      planId: '__proto__',
      environment: 'TEST',
      config: testConfiguration,
    })).toEqual({ outcome: 'BLOCKED', reason: 'UNKNOWN_PLAN' })
  })

  it('blocks LIVE billing even if a LIVE price ID is present without explicit gate', () => {
    expect(resolveStripePriceBinding({
      planId: 'monthly',
      environment: 'LIVE',
      config: {
        STRIPE_LIVE_MONTHLY_PRICE_ID: 'price_live_example',
        ENABLE_LIVE_BILLING: 'false',
      },
    })).toEqual({ outcome: 'BLOCKED', reason: 'LIVE_BILLING_DISABLED' })
  })

  it('keeps TEST and LIVE mappings separate', () => {
    expect(resolveStripePriceBinding({
      planId: 'monthly',
      environment: 'TEST',
      config: { STRIPE_LIVE_MONTHLY_PRICE_ID: 'price_live_example' },
    })).toEqual({ outcome: 'BLOCKED', reason: 'PRICE_NOT_CONFIGURED' })
  })
})
