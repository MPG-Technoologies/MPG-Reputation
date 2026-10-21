import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  isReputationBillingPlanId,
  validateReputationProviderPrice,
  type ReputationBillingPlanId,
  type ProviderRecurringPriceSnapshot,
} from '@/domain/billing/catalog'
import { getConfiguredReputationBillingCatalog } from './pricing'
import { resolveStripePriceBinding } from './stripe-plan-bindings'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/

/**
 * Only an authenticated OWNER or ADMIN using their own RLS-scoped client may
 * prepare a prospective Stripe TEST checkout. Client-provided customer, price,
 * role, amount and interval are deliberately NOT accepted.
 */
export type StripeTestCheckoutPreparation =
  | {
      readonly outcome: 'READY'
      readonly intent: {
        readonly organizationId: string
        readonly billingAccountId: string
        readonly stripeCustomerId: string
        readonly stripePriceId: string
        readonly planId: ReputationBillingPlanId
        readonly amountMinor: number
        readonly currency: 'PHP'
        readonly interval: 'month' | 'year'
      }
    }
  | {
      readonly outcome: 'BLOCKED'
      readonly reason:
        | 'NOT_AUTHENTICATED'
        | 'INVALID_ORGANIZATION'
        | 'NOT_AUTHORIZED'
        | 'INVALID_PLAN'
        | 'ACCOUNT_SETUP_REQUIRED'
        | 'SUBSCRIPTION_EXISTS'
        | 'PRICE_NOT_CONFIGURED'
        | 'PRICE_MISMATCH'
        | 'PROVIDER_UNAVAILABLE'
    }

export async function prepareStripeTestCheckout(args: {
  supabase: SupabaseClient<Database>
  organizationId: unknown
  planId: unknown
  retrievePrice: (priceId: string) => Promise<ProviderRecurringPriceSnapshot>
}): Promise<StripeTestCheckoutPreparation> {
  const { supabase, organizationId, planId, retrievePrice } = args

  // The authenticated Supabase session is the only user identity source.
  // A privileged/service-role client MUST NEVER be supplied to this function.
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user || auth.user.is_anonymous === true) {
    return { outcome: 'BLOCKED', reason: 'NOT_AUTHENTICATED' }
  }
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
    return { outcome: 'BLOCKED', reason: 'INVALID_ORGANIZATION' }
  }
  if (!isReputationBillingPlanId(planId)) {
    return { outcome: 'BLOCKED', reason: 'INVALID_PLAN' }
  }

  // Supabase RPC evaluates auth.uid() within the caller's JWT. Do not infer
  // permission from a posted userId, organization metadata or support role.
  const { data: permitted, error: roleError } = await supabase.rpc(
    'user_has_role',
    { org_id: organizationId, allowed_roles: ['OWNER', 'ADMIN'] }
  )
  if (roleError || permitted !== true) {
    return { outcome: 'BLOCKED', reason: 'NOT_AUTHORIZED' }
  }

  // RLS permits scoped reads only. Provider Customer ownership is confirmed
  // here instead of taking a customer ID from a user-supplied body.
  const { data: account, error: accountError } = await supabase
    .from('organization_billing_accounts')
    .select('id, provider_customer_id')
    .eq('organization_id', organizationId)
    .eq('provider', 'stripe')
    .eq('environment', 'TEST')
    .maybeSingle()
  if (accountError) throw new Error('BILLING_CHECKOUT_ACCOUNT_LOOKUP_FAILED')
  if (!account || !CUSTOMER_ID.test(account.provider_customer_id)) {
    return { outcome: 'BLOCKED', reason: 'ACCOUNT_SETUP_REQUIRED' }
  }

  // Do not create a second subscription for an organization while its
  // existing TEST subscription still needs an upgrade/cancel/portal policy.
  const { data: current, error: currentError } = await supabase
    .from('organization_subscriptions')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('provider', 'stripe')
    .eq('environment', 'TEST')
    .neq('normalized_status', 'ENDED')
    .limit(1)
    .maybeSingle()
  if (currentError) throw new Error('BILLING_CHECKOUT_SUBSCRIPTION_LOOKUP_FAILED')
  if (current) return { outcome: 'BLOCKED', reason: 'SUBSCRIPTION_EXISTS' }

  // Accepted provider Price must match the *server's* configured PHP quote
  // exactly; no browser price, discount, quantity or LIVE price is admissible.
  const catalog = getConfiguredReputationBillingCatalog()
  const binding = resolveStripePriceBinding({
    planId,
    environment: 'TEST',
    config: process.env,
  })
  if (binding.outcome !== 'READY') {
    return { outcome: 'BLOCKED', reason: 'PRICE_NOT_CONFIGURED' }
  }

  let providerPrice: ProviderRecurringPriceSnapshot
  try {
    providerPrice = await retrievePrice(binding.priceId)
  } catch {
    return { outcome: 'BLOCKED', reason: 'PROVIDER_UNAVAILABLE' }
  }
  const match = validateReputationProviderPrice({
    planId,
    configuredPriceId: binding.priceId,
    expectedEnvironment: 'TEST',
    providerPrice,
    plans: catalog,
  })
  if (!match.ok) return { outcome: 'BLOCKED', reason: 'PRICE_MISMATCH' }

  const selected = catalog[planId]
  return {
    outcome: 'READY',
    intent: {
      organizationId,
      billingAccountId: account.id,
      stripeCustomerId: account.provider_customer_id,
      stripePriceId: binding.priceId,
      planId,
      amountMinor: selected.amountMinor,
      currency: selected.currency,
      interval: selected.interval,
    },
  }
}
