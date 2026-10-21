import { describe, expect, it } from 'vitest'
import {
  configureReputationBillingCatalog,
  getAnnualSavingsMinor,
  getReputationBillingPlan,
  parsePhpAmountToMinor,
  validateReputationProviderPrice,
} from '../../src/domain/billing'

describe('MR-5 owner-corrected, configurable internal pricing', () => {
  it('uses ₱1,500 for a month and ₱1,000 TOTAL for an entire year', () => {
    const result = configureReputationBillingCatalog({})
    expect(result.outcome).toBe('READY')
    if (result.outcome !== 'READY') return
    expect(result.plans.monthly.amountMinor).toBe(150_000)
    expect(result.plans.annual.amountMinor).toBe(100_000)
    expect(result.plans.annual.interval).toBe('year')
    expect(result.plans.annual.monthlyEquivalentMinor).toBe(8_333)
    expect(getAnnualSavingsMinor(result.plans)).toBe(1_700_000)
  })

  it('permits independent secure operator overrides without code changes', () => {
    const result = configureReputationBillingCatalog({
      MPG_BILLING_MONTHLY_PRICE_PHP: '1750.50',
      MPG_BILLING_ANNUAL_PRICE_PHP: '3000',
    })
    expect(result.outcome).toBe('READY')
    if (result.outcome !== 'READY') return
    expect(getReputationBillingPlan('monthly', result.plans)?.amountMinor).toBe(175_050)
    expect(getReputationBillingPlan('annual', result.plans)?.amountMinor).toBe(300_000)
    expect(result.plans.annual.monthlyEquivalentMinor).toBe(25_000)
    expect(getAnnualSavingsMinor(result.plans)).toBe(1_800_600)
  })

  it('allows overriding only one billing interval', () => {
    const result = configureReputationBillingCatalog({
      MPG_BILLING_ANNUAL_PRICE_PHP: '2000',
    })
    expect(result.outcome).toBe('READY')
    if (result.outcome !== 'READY') return
    expect(result.plans.monthly.amountMinor).toBe(150_000)
    expect(result.plans.annual.amountMinor).toBe(200_000)
  })

  it('parses PHP pesos accurately without float-based centavos', () => {
    expect(parsePhpAmountToMinor('1500')).toBe(150_000)
    expect(parsePhpAmountToMinor('1000.5')).toBe(100_050)
    expect(parsePhpAmountToMinor(' 1000.05 ')).toBe(100_005)
    expect(parsePhpAmountToMinor('0.01')).toBeNull() // integer peso minimum
  })

  it.each(['', '0', '-1500', '1e6', 'Infinity', '1500.999', 'PHP 1500', '1,500', '  ', '9999999999'])(
    'rejects malformed monthly price %s and does not silently restore a default',
    (value) => {
      expect(configureReputationBillingCatalog({
        MPG_BILLING_MONTHLY_PRICE_PHP: value,
      })).toEqual({ outcome: 'BLOCKED', reason: 'INVALID_MONTHLY_PRICE' })
    }
  )

  it('rejects invalid annual price independently', () => {
    expect(configureReputationBillingCatalog({
      MPG_BILLING_MONTHLY_PRICE_PHP: '1500',
      MPG_BILLING_ANNUAL_PRICE_PHP: '-1',
    })).toEqual({ outcome: 'BLOCKED', reason: 'INVALID_ANNUAL_PRICE' })
  })

  it('matches a future provider Price against the CONFIGURED annual amount', () => {
    const result = configureReputationBillingCatalog({
      MPG_BILLING_ANNUAL_PRICE_PHP: '2345',
    })
    if (result.outcome !== 'READY') throw new Error('Invalid synthetic price config')
    const providerPrice = {
      id: 'price_TestAnnual123', currency: 'php',
      unitAmountMinor: 234_500,
      interval: 'year', intervalCount: 1,
      active: true, liveMode: false,
    }
    expect(validateReputationProviderPrice({
      planId: 'annual', configuredPriceId: providerPrice.id,
      expectedEnvironment: 'TEST', providerPrice, plans: result.plans,
    })).toEqual({ ok: true })
    expect(validateReputationProviderPrice({
      planId: 'annual', configuredPriceId: providerPrice.id,
      expectedEnvironment: 'TEST', providerPrice,
    })).toEqual({ ok: false, reason: 'AMOUNT_MISMATCH' })
  })

  it('rejects the OLD ₱12,000/year amount even if the Stripe Price ID matches', () => {
    expect(validateReputationProviderPrice({
      planId: 'annual', configuredPriceId: 'price_TestAnnual123',
      expectedEnvironment: 'TEST',
      providerPrice: {
        id: 'price_TestAnnual123', currency: 'php', unitAmountMinor: 1_200_000,
        interval: 'year', intervalCount: 1, active: true, liveMode: false,
      },
    })).toEqual({ ok: false, reason: 'AMOUNT_MISMATCH' })
  })
})
