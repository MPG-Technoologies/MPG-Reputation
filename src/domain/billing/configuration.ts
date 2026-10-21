import {
  REPUTATION_BILLING_PLANS,
  type ReputationBillingCatalog,
} from './catalog'

/**
 * Operator-configurable INTERNAL pricing proposal, not live billing authority.
 *
 * Values are peso strings: "1500", "1000" or "1500.50".
 * Missing keys use the owner's current draft defaults; present-but-invalid
 * values fail closed rather than silently falling back.
 */
export interface ReputationPriceConfiguration {
  readonly MPG_BILLING_MONTHLY_PRICE_PHP?: string
  readonly MPG_BILLING_ANNUAL_PRICE_PHP?: string
}

export type ConfiguredReputationPrices =
  | { readonly outcome: 'READY'; readonly plans: ReputationBillingCatalog }
  | {
      readonly outcome: 'BLOCKED'
      readonly reason: 'INVALID_MONTHLY_PRICE' | 'INVALID_ANNUAL_PRICE'
    }

/** Parse PHP major units into integer minor units without float arithmetic. */
export function parsePhpAmountToMinor(value: string): number | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,7}(?:\.[0-9]{1,2})?$/.test(value.trim())) {
    return null
  }

  const [whole, fraction = ''] = value.trim().split('.')
  const amountMinor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(amountMinor) && amountMinor > 0
    ? amountMinor
    : null
}

export function configureReputationBillingCatalog(
  configuration: ReputationPriceConfiguration
): ConfiguredReputationPrices {
  const monthly = configuration.MPG_BILLING_MONTHLY_PRICE_PHP === undefined
    ? REPUTATION_BILLING_PLANS.monthly.amountMinor
    : parsePhpAmountToMinor(configuration.MPG_BILLING_MONTHLY_PRICE_PHP)

  if (monthly === null) {
    return { outcome: 'BLOCKED', reason: 'INVALID_MONTHLY_PRICE' }
  }

  const annual = configuration.MPG_BILLING_ANNUAL_PRICE_PHP === undefined
    ? REPUTATION_BILLING_PLANS.annual.amountMinor
    : parsePhpAmountToMinor(configuration.MPG_BILLING_ANNUAL_PRICE_PHP)

  if (annual === null) {
    return { outcome: 'BLOCKED', reason: 'INVALID_ANNUAL_PRICE' }
  }

  return {
    outcome: 'READY',
    plans: Object.freeze({
      monthly: Object.freeze({
        ...REPUTATION_BILLING_PLANS.monthly,
        amountMinor: monthly,
        monthlyEquivalentMinor: monthly,
      }),
      annual: Object.freeze({
        ...REPUTATION_BILLING_PLANS.annual,
        amountMinor: annual,
        // Rounded to nearest centavo: informational ONLY, not a recurring charge.
        monthlyEquivalentMinor: Math.round(annual / 12),
      }),
    }),
  }
}
