import 'server-only'

import {
  configureReputationBillingCatalog,
  type ReputationBillingCatalog,
} from '@/domain/billing'

/**
 * Authoritative server-side price proposal, never browser-supplied.
 *
 * This only resolves quote amounts. It cannot create Stripe objects,
 * authorize charges, or grant paid entitlements.
 */
export function getConfiguredReputationBillingCatalog(): ReputationBillingCatalog {
  const result = configureReputationBillingCatalog({
    MPG_BILLING_MONTHLY_PRICE_PHP: process.env.MPG_BILLING_MONTHLY_PRICE_PHP,
    MPG_BILLING_ANNUAL_PRICE_PHP: process.env.MPG_BILLING_ANNUAL_PRICE_PHP,
  })

  if (result.outcome !== 'READY') {
    throw new Error('BILLING_PRICING_CONFIGURATION_INVALID')
  }

  return result.plans
}
