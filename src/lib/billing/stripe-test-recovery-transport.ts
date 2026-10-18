import 'server-only'

import Stripe from 'stripe'
import type {
  StripeRecoveryEventRetriever,
  StripeRecoverySubscriptionRetriever,
} from './stripe-recovery-preflight'

export interface StripeTestRecoveryTransport {
  retrieveEvent: StripeRecoveryEventRetriever
  retrieveSubscription: StripeRecoverySubscriptionRetriever
}

/**
 * TEST Stripe read-only adapter. This is deliberately separate from the
 * existing general Stripe client: a live key is never accepted here,
 * irrespective of ENABLE_LIVE_BILLING. No connection occurs until one of
 * the returned retriever methods is called by an explicitly authorized worker.
 *
 * Not wired into public webhook intake or a scheduler.
 */
export function createStripeTestRecoveryTransport(): StripeTestRecoveryTransport {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key || !/^sk_test_[A-Za-z0-9]+$/.test(key)) {
    throw new Error('BILLING_STRIPE_TEST_RECOVERY_KEY_REQUIRED')
  }
  const stripe = new Stripe(key)

  return {
    async retrieveEvent(eventId) {
      const event = await stripe.events.retrieve(eventId)
      const object = event.data?.object as unknown as {
        id?: unknown
        object?: unknown
      }
      return {
        id: event.id,
        object: event.object,
        livemode: event.livemode,
        type: event.type,
        data: { object },
      }
    },
    async retrieveSubscription(subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId)
      const legacy = sub as unknown as {
        current_period_start?: number | null
        current_period_end?: number | null
      }
      return {
        id: sub.id,
        customer: typeof sub.customer === 'string'
          ? sub.customer
          : { id: sub.customer.id },
        livemode: sub.livemode,
        status: sub.status,
        cancel_at_period_end: sub.cancel_at_period_end,
        canceled_at: sub.canceled_at,
        items: {
          has_more: sub.items.has_more,
          data: sub.items.data.map((item) => ({
            price: { id: item.price.id },
            current_period_start: item.current_period_start,
            current_period_end: item.current_period_end,
          })),
        },
        current_period_start: legacy.current_period_start,
        current_period_end: legacy.current_period_end,
      }
    },
  }
}
