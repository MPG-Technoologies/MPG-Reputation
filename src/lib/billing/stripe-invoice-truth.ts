/**
 * Server-side billing identity resolver. Keep this module under lib/billing;
 * never import it into client components or expose its trusted DB client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { BillingEnvironment } from '@/domain/billing'
import { assertStripeEventEnvironmentAllowed } from './stripe'

const INVOICE_ID = /^in_[A-Za-z0-9]+$/
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]+$/

const SUPPORTED_INVOICE_EVENTS = new Set([
  'invoice.paid',
  'invoice.payment_failed',
])

/**
 * Call only with a cryptographically verified Stripe Event, never a browser
 * body or reconstructed event. The event is an identity hint, not payment proof.
 */
export interface VerifiedStripeInvoiceEvent {
  readonly type: string
  readonly livemode: boolean
  readonly data: {
    readonly object: {
      readonly id?: unknown
      readonly object?: unknown
    }
  }
}

/**
 * A normalized result of an independent Stripe Invoice retrieve operation.
 * This contract deliberately excludes paid/settled status and amounts.
 */
export interface StripeInvoiceIdentityTruth {
  readonly id: string
  readonly livemode: boolean
  readonly customer: string | { readonly id: string } | null
  readonly subscriptionId: string | null
}

export type StripeInvoiceRetriever = (
  invoiceId: string
) => Promise<StripeInvoiceIdentityTruth>

export type StripeInvoiceOrganizationResolution =
  | { readonly outcome: 'UNSUPPORTED_EVENT' }
  | { readonly outcome: 'UNRESOLVED_CUSTOMER' }
  | { readonly outcome: 'UNRESOLVED_SUBSCRIPTION' }
  | { readonly outcome: 'INACTIVE_ORGANIZATION' }
  | {
      readonly outcome: 'RESOLVED_IDENTITY_ONLY'
      readonly organizationId: string
      readonly billingAccountId: string
      readonly subscriptionRecordId: string
      readonly environment: BillingEnvironment
    }

/**
 * Read-only organization resolution for one independently retrieved invoice.
 *
 * It compares the verified Event's invoice ID against current provider truth,
 * then checks the existing authoritative Customer -> Billing Account ->
 * Subscription mapping, including TEST/LIVE and organization isolation.
 *
 * This function does not authenticate the caller, mark a webhook processed,
 * decide invoice payment/settlement, grant entitlements or mutate billing.
 * It must only be invoked within a separately authenticated server worker.
 */
export async function resolveStripeInvoiceOrganization(args: {
  readonly supabase: SupabaseClient<Database>
  readonly event: VerifiedStripeInvoiceEvent
  readonly retrieveInvoice: StripeInvoiceRetriever
}): Promise<StripeInvoiceOrganizationResolution> {
  const { event, supabase, retrieveInvoice } = args
  if (!SUPPORTED_INVOICE_EVENTS.has(event.type)) {
    return { outcome: 'UNSUPPORTED_EVENT' }
  }
  const environment = assertStripeEventEnvironmentAllowed(event)
  const eventObject = event.data?.object
  if (eventObject?.object !== 'invoice' ||
      typeof eventObject.id !== 'string' ||
      !INVOICE_ID.test(eventObject.id)) {
    throw new Error('BILLING_INVOICE_EVENT_ID_INVALID')
  }

  return resolveStripeInvoiceReferenceOrganization({
    supabase, invoiceId: eventObject.id, environment, retrieveInvoice,
  })
}

/**
 * Exact-ID read-only identity resolution shared by verified-event ingress and
 * the private durable inbox preflight. The caller MUST authenticate provenance;
 * invoiceId/environment alone are never authorization or payment evidence.
 */
export async function resolveStripeInvoiceReferenceOrganization(args: {
  readonly supabase: SupabaseClient<Database>
  readonly invoiceId: string
  readonly environment: BillingEnvironment
  readonly retrieveInvoice: StripeInvoiceRetriever
}): Promise<StripeInvoiceOrganizationResolution> {
  const { supabase, invoiceId, environment, retrieveInvoice } = args
  assertStripeEventEnvironmentAllowed({ livemode: environment === 'LIVE' })
  if (!INVOICE_ID.test(invoiceId)) {
    throw new Error('BILLING_INVOICE_REFERENCE_INVALID')
  }

  let invoice: StripeInvoiceIdentityTruth
  try {
    invoice = await retrieveInvoice(invoiceId)
  } catch {
    throw new Error('BILLING_INVOICE_PROVIDER_UNAVAILABLE')
  }
  if (invoice.id !== invoiceId ||
      invoice.livemode !== (environment === 'LIVE')) {
    throw new Error('BILLING_INVOICE_PROVIDER_IDENTITY_MISMATCH')
  }
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer : invoice.customer?.id
  if (typeof customerId !== 'string' || !CUSTOMER_ID.test(customerId)) {
    return { outcome: 'UNRESOLVED_CUSTOMER' }
  }
  if (typeof invoice.subscriptionId !== 'string' ||
      !SUBSCRIPTION_ID.test(invoice.subscriptionId)) {
    return { outcome: 'UNRESOLVED_SUBSCRIPTION' }
  }

  const { data: account, error: accountError } = await supabase
    .from('organization_billing_accounts')
    .select('id, organization_id')
    .eq('provider', 'stripe')
    .eq('environment', environment)
    .eq('provider_customer_id', customerId)
    .maybeSingle()

  if (accountError) throw new Error('BILLING_INVOICE_ACCOUNT_READ_FAILED')
  if (!account) return { outcome: 'UNRESOLVED_CUSTOMER' }

  const { data: subscription, error: subscriptionError } = await supabase
    .from('organization_subscriptions')
    .select('id')
    .eq('provider', 'stripe')
    .eq('environment', environment)
    .eq('organization_id', account.organization_id)
    .eq('billing_account_id', account.id)
    .eq('provider_subscription_id', invoice.subscriptionId)
    .maybeSingle()

  if (subscriptionError) throw new Error('BILLING_INVOICE_SUBSCRIPTION_READ_FAILED')
  if (!subscription) return { outcome: 'UNRESOLVED_SUBSCRIPTION' }

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('status')
    .eq('id', account.organization_id)
    .maybeSingle()
  if (organizationError) throw new Error('BILLING_INVOICE_ORGANIZATION_READ_FAILED')
  if (!organization || organization.status !== 'ACTIVE') {
    return { outcome: 'INACTIVE_ORGANIZATION' }
  }
  return {
    outcome: 'RESOLVED_IDENTITY_ONLY',
    organizationId: account.organization_id,
    billingAccountId: account.id,
    subscriptionRecordId: subscription.id,
    environment,
  }
}
