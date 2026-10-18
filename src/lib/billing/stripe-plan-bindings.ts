import type { BillingEnvironment } from '@/domain/billing'
import { isReputationBillingPlanId } from '@/domain/billing'

/**
 * Mapping between stable MPG plan IDs and independently provisioned Stripe
 * Prices. Keys are server-only. Creating Stripe Price objects, checkout
 * sessions or entitlements is deliberately not performed here.
 *
 * Binding resolution is not authorization to charge or activate subscriptions.
 */
const PRICE_ENV_KEYS = {
  TEST: {
    monthly: 'STRIPE_TEST_MONTHLY_PRICE_ID',
    annual: 'STRIPE_TEST_ANNUAL_PRICE_ID',
  },
  LIVE: {
    monthly: 'STRIPE_LIVE_MONTHLY_PRICE_ID',
    annual: 'STRIPE_LIVE_ANNUAL_PRICE_ID',
  },
} as const

export type StripePriceBinding =
  | { readonly outcome: 'READY'; readonly priceId: string }
  | {
      readonly outcome: 'BLOCKED'
      readonly reason:
        | 'UNKNOWN_PLAN'
        | 'LIVE_BILLING_DISABLED'
        | 'PRICE_NOT_CONFIGURED'
        | 'INVALID_PRICE_ID'
        | 'DUPLICATE_PLAN_PRICE_IDS'
    }

export function resolveStripePriceBinding(args: {
  planId: unknown
  environment: BillingEnvironment
  config: Readonly<Record<string, string | undefined>>
}): StripePriceBinding {
  const { environment, config } = args

  if (!isReputationBillingPlanId(args.planId)) {
    return { outcome: 'BLOCKED', reason: 'UNKNOWN_PLAN' }
  }

  if (environment === 'LIVE' && config.ENABLE_LIVE_BILLING !== 'true') {
    return { outcome: 'BLOCKED', reason: 'LIVE_BILLING_DISABLED' }
  }

  const keys = PRICE_ENV_KEYS[environment]
  const priceId = config[keys[args.planId]]?.trim()
  const oppositeId = config[
    args.planId === 'monthly' ? keys.annual : keys.monthly
  ]?.trim()

  if (!priceId) {
    return { outcome: 'BLOCKED', reason: 'PRICE_NOT_CONFIGURED' }
  }

  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) {
    return { outcome: 'BLOCKED', reason: 'INVALID_PRICE_ID' }
  }

  if (priceId === oppositeId) {
    return { outcome: 'BLOCKED', reason: 'DUPLICATE_PLAN_PRICE_IDS' }
  }

  return { outcome: 'READY', priceId }
}
