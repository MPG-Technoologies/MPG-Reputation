import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { BillingEnvironment } from '@/domain/billing'
import { assertStripeEventEnvironmentAllowed } from './stripe'

const SUPPORTED_SUBSCRIPTION_EVENT_TYPES = new Set<string>([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

export interface VerifiedStripeSubscriptionEvent {
  type: string
  livemode: boolean
  data: {
    object: {
      id?: unknown
      object?: unknown
      [key: string]: unknown
    }
  }
}

export interface StripeSubscriptionProviderTruth {
  id: string
  customer: string | { id: string }
  livemode: boolean
  status: string
}

export type StripeSubscriptionRetriever = (
  subscriptionId: string
) => Promise<StripeSubscriptionProviderTruth>

export type StripeSubscriptionOrganizationResolution =
  | {
      outcome: 'UNSUPPORTED_EVENT'
      eventType: string
    }
  | {
      outcome: 'UNRESOLVED_CUSTOMER'
      environment: BillingEnvironment
      providerSubscriptionId: string
      providerCustomerId: string
      providerStatus: string
    }
  | {
      outcome: 'RESOLVED'
      environment: BillingEnvironment
      providerSubscriptionId: string
      providerCustomerId: string
      providerStatus: string
      billingAccountId: string
      organizationId: string
    }

function getSubscriptionIdFromVerifiedEvent(
  event: VerifiedStripeSubscriptionEvent
): string {
  const object = event.data.object

  if (
    object.object !== 'subscription' ||
    typeof object.id !== 'string' ||
    !object.id.trim()
  ) {
    throw new Error('BILLING_STRIPE_SUBSCRIPTION_EVENT_INVALID')
  }

  return object.id.trim()
}

function getCustomerIdFromProviderTruth(
  subscription: StripeSubscriptionProviderTruth
): string {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id

  if (!customerId?.trim()) {
    throw new Error('BILLING_STRIPE_SUBSCRIPTION_CUSTOMER_INVALID')
  }

  return customerId.trim()
}

/**
 * Resolve a verified Stripe subscription event to an MPG organization.
 *
 * Trust boundary:
 * - event must already be cryptographically verified.
 * - current provider truth is retrieved instead of trusting event snapshot state.
 * - retrieved TEST/LIVE state must match verified Event.livemode.
 * - tenant identity comes from MPG's persisted Stripe Customer mapping.
 * - Stripe metadata is never treated as tenant authority.
 * - no subscription projection or entitlement mutation occurs here.
 */
export async function resolveStripeSubscriptionOrganization(args: {
  supabase: SupabaseClient<Database>
  event: VerifiedStripeSubscriptionEvent
  retrieveSubscription: StripeSubscriptionRetriever
}): Promise<StripeSubscriptionOrganizationResolution> {
  const { supabase, event, retrieveSubscription } = args

  if (!SUPPORTED_SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    return {
      outcome: 'UNSUPPORTED_EVENT',
      eventType: event.type,
    }
  }

  const environment =
    assertStripeEventEnvironmentAllowed(event)

  const providerSubscriptionId =
    getSubscriptionIdFromVerifiedEvent(event)

  let subscription: StripeSubscriptionProviderTruth

  try {
    subscription =
      await retrieveSubscription(providerSubscriptionId)
  } catch {
    throw new Error(
      'BILLING_STRIPE_SUBSCRIPTION_RETRIEVE_FAILED'
    )
  }

  if (subscription.id !== providerSubscriptionId) {
    throw new Error(
      'BILLING_STRIPE_SUBSCRIPTION_ID_MISMATCH'
    )
  }

  const providerEnvironment: BillingEnvironment =
    subscription.livemode ? 'LIVE' : 'TEST'

  if (providerEnvironment !== environment) {
    throw new Error(
      'BILLING_STRIPE_SUBSCRIPTION_ENVIRONMENT_MISMATCH'
    )
  }

  const providerCustomerId =
    getCustomerIdFromProviderTruth(subscription)

  const providerStatus = subscription.status?.trim()

  if (!providerStatus) {
    throw new Error(
      'BILLING_STRIPE_SUBSCRIPTION_STATUS_INVALID'
    )
  }

  const { data: billingAccount, error } =
    await supabase
      .from('organization_billing_accounts')
      .select('id, organization_id')
      .eq('provider', 'stripe')
      .eq('environment', environment)
      .eq('provider_customer_id', providerCustomerId)
      .maybeSingle()

  if (error) {
    throw new Error(
      'BILLING_STRIPE_ORGANIZATION_CORRELATION_FAILED'
    )
  }

  if (!billingAccount) {
    return {
      outcome: 'UNRESOLVED_CUSTOMER',
      environment,
      providerSubscriptionId,
      providerCustomerId,
      providerStatus,
    }
  }

  return {
    outcome: 'RESOLVED',
    environment,
    providerSubscriptionId,
    providerCustomerId,
    providerStatus,
    billingAccountId: billingAccount.id,
    organizationId: billingAccount.organization_id,
  }
}