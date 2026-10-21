import 'server-only'

import Stripe from 'stripe'
import { isDisposableStripeTestProviderRuntime } from './local-stripe-test-provider-gate'
import type {
  StripeTestPortalConfiguration,
  StripeTestPortalSession,
} from './stripe-test-customer-portal'

/**
 * TEST-only Stripe Billing Portal adapter. No public route consumes it.
 * It never creates charges, changes plans or publishes a billing offer.
 */
export function createStripeTestPortalProvider() {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (process.env.ENABLE_STRIPE_TEST_PORTAL !== 'true' ||
      process.env.MPG_STRIPE_TEST_PORTAL_TARGET !== 'LOCAL_SYNTHETIC' ||
      !isDisposableStripeTestProviderRuntime() ||
      !key || !/^sk_test_[A-Za-z0-9]+$/.test(key)) {
    throw new Error('BILLING_PORTAL_TEST_PROVIDER_DISABLED')
  }
  const stripe = new Stripe(key)

  return {
    async retrieveConfiguration(id: string): Promise<StripeTestPortalConfiguration> {
      if (!/^bpc_[A-Za-z0-9]+$/.test(id)) {
        throw new Error('BILLING_PORTAL_CONFIGURATION_ID_INVALID')
      }
      const config = await stripe.billingPortal.configurations.retrieve(id)
      return {
        id: config.id,
        livemode: config.livemode,
        active: config.active,
        loginPageEnabled: config.login_page?.enabled ?? false,
        features: {
          invoiceHistoryEnabled: config.features.invoice_history?.enabled === true,
          paymentMethodUpdateEnabled: config.features.payment_method_update?.enabled === true,
          subscriptionUpdateEnabled: config.features.subscription_update?.enabled === true,
          subscriptionCancelEnabled: config.features.subscription_cancel?.enabled === true,
          customerUpdateEnabled: config.features.customer_update?.enabled === true,
        },
      }
    },
    async createSession(input: {
      customerId: string; configurationId: string; returnUrl: string
    }): Promise<StripeTestPortalSession> {
      if (!/^cus_[A-Za-z0-9]+$/.test(input.customerId) ||
          !/^bpc_[A-Za-z0-9]+$/.test(input.configurationId)) {
        throw new Error('BILLING_PORTAL_PROVIDER_INPUT_INVALID')
      }
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        configuration: input.configurationId,
        return_url: input.returnUrl,
      })
      return {
        id: session.id,
        livemode: session.livemode,
        customer: session.customer,
        configuration: typeof session.configuration === 'string'
          ? session.configuration : session.configuration?.id ?? '',
        returnUrl: session.return_url ?? '',
        url: session.url,
      }
    },
  }
}
