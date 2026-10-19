import 'server-only'

import Stripe from 'stripe'
import type {
  StripeRecoveryReadOnlyProvider,
} from './stripe-test-provider-recovery'

/**
 * TEST-only, read-only provider adapter. No Stripe write method is exposed.
 * Construction is disabled outside explicit disposable local engineering.
 */
export function createStripeTestReadOnlyRecoveryProvider(): StripeRecoveryReadOnlyProvider {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (process.env.ENABLE_STRIPE_TEST_PROVIDER_RECOVERY !== 'true' ||
      process.env.MPG_STRIPE_TEST_PROVIDER_RECOVERY_TARGET !== 'LOCAL_SYNTHETIC' ||
      process.env.ENABLE_LIVE_BILLING === 'true' ||
      process.env.NODE_ENV === 'production' ||
      process.env.VERCEL_ENV !== undefined ||
      !['http://127.0.0.1:54331','http://localhost:54331']
        .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') ||
      !key || !/^sk_test_[A-Za-z0-9]+$/.test(key)) {
    throw new Error('BILLING_PROVIDER_RECOVERY_TEST_DISABLED')
  }

  const stripe = new Stripe(key)
  return {
    async retrieveCustomer(id) {
      if (!/^cus_[A-Za-z0-9]+$/.test(id)) {
        throw new Error('BILLING_PROVIDER_RECOVERY_INVALID_CUSTOMER')
      }
      const result = await stripe.customers.retrieve(id)
      if (result.deleted) {
        return { id: result.id, deleted: true, livemode: false, name: null }
      }
      return {
        id: result.id, deleted: false, livemode: result.livemode,
        name: result.name ?? null,
      }
    },
    async retrieveCheckout(id) {
      if (!/^cs_test_[A-Za-z0-9]+$/.test(id)) {
        throw new Error('BILLING_PROVIDER_RECOVERY_INVALID_SESSION')
      }
      const session = await stripe.checkout.sessions.retrieve(id)
      return {
        id: session.id,
        livemode: session.livemode,
        mode: session.mode,
        customerId: typeof session.customer === 'string'
          ? session.customer : session.customer?.id ?? null,
        clientReferenceId: session.client_reference_id,
        status: session.status,
        expiresAt: session.expires_at,
        currency: session.currency,
        successUrl: session.success_url,
        cancelUrl: session.cancel_url,
      }
    },
    async listCheckoutLineItems(id) {
      if (!/^cs_test_[A-Za-z0-9]+$/.test(id)) {
        throw new Error('BILLING_PROVIDER_RECOVERY_INVALID_SESSION')
      }
      const result = await stripe.checkout.sessions.listLineItems(id, {
        limit: 2,
        expand: ['data.price'],
      })
      return {
        hasMore: result.has_more,
        items: result.data.map(item => ({
          priceId: typeof item.price === 'string'
            ? item.price : item.price?.id ?? null,
          quantity: item.quantity ?? null,
        })),
      }
    },
  }
}
