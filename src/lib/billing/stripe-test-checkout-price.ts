import 'server-only'

import Stripe from 'stripe'
import type { ProviderRecurringPriceSnapshot } from '@/domain/billing/catalog'

/**
 * Read-only Stripe TEST Price lookup. Never constructs Checkout Sessions or
 * accepts LIVE credentials, irrespective of ENABLE_LIVE_BILLING.
 */
export function createStripeTestCheckoutPriceRetriever():
  (priceId: string) => Promise<ProviderRecurringPriceSnapshot> {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key || !/^sk_test_[A-Za-z0-9]+$/.test(key)) {
    throw new Error('BILLING_CHECKOUT_TEST_KEY_REQUIRED')
  }
  const stripe = new Stripe(key)

  return async (priceId) => {
    if (!/^price_[A-Za-z0-9]+$/.test(priceId)) {
      throw new Error('BILLING_CHECKOUT_PRICE_ID_INVALID')
    }
    const price = await stripe.prices.retrieve(priceId)
    return {
      id: price.id,
      currency: price.currency,
      unitAmountMinor: price.unit_amount,
      interval: price.recurring?.interval ?? null,
      intervalCount: price.recurring?.interval_count ?? null,
      active: price.active,
      liveMode: price.livemode,
    }
  }
}
