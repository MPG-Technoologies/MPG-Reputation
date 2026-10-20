import 'server-only'

import Stripe from 'stripe'
import { isDisposableStripeTestProviderRuntime } from './local-stripe-test-provider-gate'
import type {
  StripeTestCustomerCreation,
  StripeTestCustomerRecord,
} from './stripe-test-customer-provisioning'

/**
 * TEST-only provider transport. Caller retains frozen name and stable
 * reservation idempotency key. Never sends end-customer PII.
 */
export function createStripeTestCustomerCreator():
  (input: StripeTestCustomerCreation) => Promise<StripeTestCustomerRecord> {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (process.env.ENABLE_STRIPE_TEST_CUSTOMER_PROVISIONING !== 'true' ||
      process.env.MPG_STRIPE_TEST_PROVISIONING_TARGET !== 'LOCAL_SYNTHETIC' ||
      !isDisposableStripeTestProviderRuntime() ||
      !key || !/^sk_test_[A-Za-z0-9]+$/.test(key)) {
    throw new Error('BILLING_CUSTOMER_TEST_PROVIDER_DISABLED')
  }
  const stripe = new Stripe(key)

  return async ({ name, idempotencyKey }) => {
    if (name.length < 1 || name.length > 150 ||
        !/^mpg-reputation-test-customer-[0-9a-f-]{36}$/i.test(idempotencyKey)) {
      throw new Error('BILLING_CUSTOMER_PROVIDER_INPUT_INVALID')
    }
    const created = await stripe.customers.create(
      { name },
      { idempotencyKey, maxNetworkRetries: 1 }
    )
    return { id: created.id, livemode: created.livemode, name: created.name ?? null }
  }
}
