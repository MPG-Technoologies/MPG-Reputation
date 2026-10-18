/**
 * MR-5 pricing proposal — engineering-only. Not an approved public offer.
 *
 * One MPG Reputation subscription has two billing intervals. Values are in
 * integer Philippine centavos (PHP minor units), never floating-point pesos.
 * These values MUST NOT be treated as authoritative payment-provider truth.
 *
 * No API route, live billing, customer charging or paid entitlement is enabled
 * by this module. A separately authorized Stripe integration must compare
 * provider Price details before creating checkout sessions.
 */
export type ReputationBillingPlanId = 'monthly' | 'annual'
export type ReputationBillingInterval = 'month' | 'year'

export interface ReputationBillingPlan {
  readonly id: ReputationBillingPlanId
  readonly currency: 'PHP'
  readonly interval: ReputationBillingInterval
  readonly intervalCount: 1
  readonly amountMinor: number
  readonly monthlyEquivalentMinor: number
  readonly approval: 'PROPOSED'
}

export const REPUTATION_BILLING_PLANS: Readonly<Record<
  ReputationBillingPlanId,
  ReputationBillingPlan
>> = Object.freeze({
  monthly: Object.freeze({
    id: 'monthly',
    currency: 'PHP',
    interval: 'month',
    intervalCount: 1,
    amountMinor: 150_000,
    monthlyEquivalentMinor: 150_000,
    approval: 'PROPOSED',
  }),
  annual: Object.freeze({
    id: 'annual',
    currency: 'PHP',
    interval: 'year',
    intervalCount: 1,
    amountMinor: 1_200_000,
    monthlyEquivalentMinor: 100_000,
    approval: 'PROPOSED',
  }),
})

export function isReputationBillingPlanId(
  value: unknown
): value is ReputationBillingPlanId {
  return value === 'monthly' || value === 'annual'
}

export function getReputationBillingPlan(
  value: unknown
): ReputationBillingPlan | null {
  return isReputationBillingPlanId(value)
    ? REPUTATION_BILLING_PLANS[value]
    : null
}

export function getAnnualSavingsMinor(): number {
  return (
    REPUTATION_BILLING_PLANS.monthly.amountMinor * 12 -
    REPUTATION_BILLING_PLANS.annual.amountMinor
  )
}

/**
 * Minimal provider Price snapshot for future Stripe adapter verification.
 * No provider SDK or credential is needed for this deterministic validation.
 */
export interface ProviderRecurringPriceSnapshot {
  readonly id: string
  readonly currency: string
  readonly unitAmountMinor: number | null
  readonly interval: string | null
  readonly intervalCount: number | null
  readonly active: boolean
  readonly liveMode: boolean
}

export type ProviderPriceMatch =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason:
        | 'UNKNOWN_PLAN'
        | 'PRICE_ID_MISMATCH'
        | 'PRICE_INACTIVE'
        | 'ENVIRONMENT_MISMATCH'
        | 'CURRENCY_MISMATCH'
        | 'AMOUNT_MISMATCH'
        | 'INTERVAL_MISMATCH'
    }

/**
 * Check a price fetched server-side from the provider, not user-supplied
 * checkout parameters. This is a prerequisite, never billing authorization.
 */
export function validateReputationProviderPrice(args: {
  planId: unknown
  configuredPriceId: string
  expectedEnvironment: 'TEST' | 'LIVE'
  providerPrice: ProviderRecurringPriceSnapshot
}): ProviderPriceMatch {
  const plan = getReputationBillingPlan(args.planId)
  if (!plan) return { ok: false, reason: 'UNKNOWN_PLAN' }

  if (
    !args.configuredPriceId.startsWith('price_') ||
    args.providerPrice.id !== args.configuredPriceId
  ) {
    return { ok: false, reason: 'PRICE_ID_MISMATCH' }
  }

  if (!args.providerPrice.active) {
    return { ok: false, reason: 'PRICE_INACTIVE' }
  }

  if (args.providerPrice.liveMode !== (args.expectedEnvironment === 'LIVE')) {
    return { ok: false, reason: 'ENVIRONMENT_MISMATCH' }
  }

  if (args.providerPrice.currency.toUpperCase() !== plan.currency) {
    return { ok: false, reason: 'CURRENCY_MISMATCH' }
  }

  if (args.providerPrice.unitAmountMinor !== plan.amountMinor) {
    return { ok: false, reason: 'AMOUNT_MISMATCH' }
  }

  if (
    args.providerPrice.interval !== plan.interval ||
    args.providerPrice.intervalCount !== plan.intervalCount
  ) {
    return { ok: false, reason: 'INTERVAL_MISMATCH' }
  }

  return { ok: true }
}
