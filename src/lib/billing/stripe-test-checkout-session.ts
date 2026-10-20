import 'server-only'

import Stripe from 'stripe'
import { isDisposableStripeTestProviderRuntime } from './local-stripe-test-provider-gate'
import type {
  StripeTestCheckoutCreateOptions,
  StripeTestCheckoutSession,
} from './stripe-test-checkout-start'

/** TEST-only provider adapter. Not used by a route/scheduler until explicitly approved. */
export function createStripeTestCheckoutSessionCreator():
  (options: StripeTestCheckoutCreateOptions) => Promise<StripeTestCheckoutSession> {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (process.env.ENABLE_STRIPE_TEST_CHECKOUT_CREATE !== 'true' ||
      !isDisposableStripeTestProviderRuntime() ||
      !key || !/^sk_test_[A-Za-z0-9]+$/.test(key)) {
    throw new Error('BILLING_CHECKOUT_TEST_PROVIDER_DISABLED')
  }
  const stripe = new Stripe(key)

  return async (options) => {
    // Caller must supply validated DB-owned IDs and approved return URLs.
    // Stripe's request idempotency key is immutable for each reservation.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'hosted',
      customer: options.customerId,
      client_reference_id: options.reservationId,
      line_items: [{ price: options.priceId, quantity: 1 }],
      success_url: options.successUrl,
      cancel_url: options.cancelUrl,
      expires_at: options.expiresAt,
      allow_promotion_codes: false,
    }, {
      idempotencyKey: options.idempotencyKey,
      maxNetworkRetries: 1,
    })
    return {
      id: session.id,
      url: session.url,
      livemode: session.livemode,
      mode: session.mode,
      customerId: typeof session.customer === 'string'
        ? session.customer : session.customer?.id ?? null,
      expiresAt: session.expires_at,
      status: session.status,
    }
  }
}
