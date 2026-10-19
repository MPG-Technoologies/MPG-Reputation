import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CUSTOMER = /^cus_[A-Za-z0-9]+$/
const SESSION = /^cs_test_[A-Za-z0-9]+$/
const PRICE = /^price_[A-Za-z0-9]+$/

export interface StripeRecoveryCustomer {
  readonly id: string
  readonly livemode: boolean
  readonly deleted: boolean
  readonly name: string | null
}
export interface StripeRecoveryCheckout {
  readonly id: string
  readonly livemode: boolean
  readonly mode: string
  readonly customerId: string | null
  readonly clientReferenceId: string | null
  readonly status: string | null
  readonly expiresAt: number
  readonly currency: string | null
  readonly successUrl: string | null
  readonly cancelUrl: string | null
}
export interface StripeRecoveryLineItems {
  readonly hasMore: boolean
  readonly items: readonly { readonly priceId: string | null; readonly quantity: number | null }[]
}
export interface StripeRecoveryReadOnlyProvider {
  readonly retrieveCustomer: (id: string) => Promise<StripeRecoveryCustomer>
  readonly retrieveCheckout: (id: string) => Promise<StripeRecoveryCheckout>
  readonly listCheckoutLineItems: (id: string) => Promise<StripeRecoveryLineItems>
}

export type CustomerProviderFinding =
  | 'NO_PROVIDER_ID' | 'VERIFIED_LINKED' | 'VERIFIED_UNLINKED'
  | 'LOCAL_CONFLICT' | 'MISMATCH' | 'PROVIDER_UNAVAILABLE'
export type CheckoutProviderFinding =
  | 'NO_PROVIDER_ID' | 'BLOCKED_CUSTOMER' | 'MATCHED_OPEN'
  | 'MATCHED_EXPIRED' | 'COMPLETED_UNVERIFIED'
  | 'MISMATCH' | 'PROVIDER_UNAVAILABLE'
export type StripeRecoveryVerification =
  | { readonly outcome: 'DISABLED' }
  | { readonly outcome: 'DENIED'; readonly reason:
      'NOT_AUTHENTICATED' | 'INVALID_ORGANIZATION' | 'NOT_AUTHORIZED' }
  | { readonly outcome: 'VERIFIED'; readonly customer: CustomerProviderFinding;
      readonly checkout: CheckoutProviderFinding }

interface Context {
  readonly customerId: string | null
  readonly linked: boolean
  readonly conflict: boolean
  readonly expectedName: string | null
  readonly sessionId: string | null
  readonly reservationId: string | null
  readonly sessionCustomerId: string | null
  readonly priceId: string | null
  readonly sessionStatus: string | null
  readonly sessionExpiresAt: number | null
  readonly origin: string | null
}

function localOnly(): boolean {
  return process.env.ENABLE_STRIPE_TEST_PROVIDER_RECOVERY === 'true' &&
    process.env.MPG_STRIPE_TEST_PROVIDER_RECOVERY_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    ['http://127.0.0.1:54331','http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

/** Private, service-role-only DB response. No raw context is returned to UI. */
function readContext(raw: Json | null): Context | null {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') {
    throw new Error('BILLING_PROVIDER_CONTEXT_INVALID')
  }
  if (raw.outcome === 'NOT_AUTHORIZED' && Object.keys(raw).length === 1) return null
  const keys = ['outcome','customer_id','customer_linked','customer_local_conflict',
    'customer_expected_name','checkout_id','checkout_reservation_id',
    'checkout_customer_id','checkout_price_id','checkout_status',
    'checkout_expires_at','checkout_origin','has_subscription']
  if (raw.outcome !== 'READY' ||
      Object.keys(raw).length !== keys.length ||
      Object.keys(raw).some(k => !keys.includes(k)) ||
      typeof raw.customer_linked !== 'boolean' ||
      typeof raw.customer_local_conflict !== 'boolean' ||
      typeof raw.has_subscription !== 'boolean') {
    throw new Error('BILLING_PROVIDER_CONTEXT_INVALID')
  }
  const optional = ['customer_id','customer_expected_name','checkout_id',
    'checkout_reservation_id','checkout_customer_id','checkout_price_id',
    'checkout_status','checkout_origin'] as const
  if (optional.some(k => raw[k] !== null && typeof raw[k] !== 'string') ||
      (raw.checkout_expires_at !== null &&
        (typeof raw.checkout_expires_at !== 'number' ||
        !Number.isSafeInteger(raw.checkout_expires_at) ||
        raw.checkout_expires_at <= 0))) {
    throw new Error('BILLING_PROVIDER_CONTEXT_INVALID')
  }
  return {
    customerId: raw.customer_id as string | null,
    linked: raw.customer_linked,
    conflict: raw.customer_local_conflict,
    expectedName: raw.customer_expected_name as string | null,
    sessionId: raw.checkout_id as string | null,
    reservationId: raw.checkout_reservation_id as string | null,
    sessionCustomerId: raw.checkout_customer_id as string | null,
    priceId: raw.checkout_price_id as string | null,
    sessionStatus: raw.checkout_status as string | null,
    sessionExpiresAt: raw.checkout_expires_at as number | null,
    origin: raw.checkout_origin as string | null,
  }
}

function expectedCheckoutUrls(origin: string | null): { success: string; cancel: string } | null {
  if (!origin) return null
  try {
    const url = new URL(origin)
    if (url.origin !== origin || url.username || url.password || url.pathname !== '/' ||
        url.search || url.hash ||
        !(url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) {
      return null
    }
    return {
      success: origin + '/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancel: origin + '/billing/checkout/cancel',
    }
  } catch { return null }
}

async function checkCustomer(context: Context, provider: StripeRecoveryReadOnlyProvider):
  Promise<CustomerProviderFinding> {
  if (context.conflict) return 'LOCAL_CONFLICT'
  if (!context.customerId) return 'NO_PROVIDER_ID'
  if (!CUSTOMER.test(context.customerId)) return 'MISMATCH'
  let value: StripeRecoveryCustomer
  try { value = await provider.retrieveCustomer(context.customerId) }
  catch { return 'PROVIDER_UNAVAILABLE' }
  if (!value || value.id !== context.customerId ||
      value.deleted !== false || value.livemode !== false ||
      (context.expectedName !== null && value.name !== context.expectedName)) {
    return 'MISMATCH'
  }
  return context.linked ? 'VERIFIED_LINKED' : 'VERIFIED_UNLINKED'
}

async function checkCheckout(context: Context, provider: StripeRecoveryReadOnlyProvider,
  customer: CustomerProviderFinding): Promise<CheckoutProviderFinding> {
  if (!context.sessionId) {
    // Stripe idempotency keys cannot be reversed into exact Customer/Session
    // lookups. Never conclude a timed-out PREPARING request did not create one.
    return 'NO_PROVIDER_ID'
  }
  if (customer !== 'VERIFIED_LINKED') return 'BLOCKED_CUSTOMER'
  const urls = expectedCheckoutUrls(context.origin)
  if (!SESSION.test(context.sessionId) ||
      !UUID.test(context.reservationId ?? '') ||
      !PRICE.test(context.priceId ?? '') ||
      !CUSTOMER.test(context.sessionCustomerId ?? '') ||
      context.sessionCustomerId !== context.customerId ||
      context.sessionStatus !== 'READY' ||
      !context.sessionExpiresAt || !urls) return 'MISMATCH'

  let session: StripeRecoveryCheckout
  try { session = await provider.retrieveCheckout(context.sessionId) }
  catch { return 'PROVIDER_UNAVAILABLE' }
  if (!session || session.id !== context.sessionId ||
      session.livemode !== false || session.mode !== 'subscription' ||
      session.customerId !== context.customerId ||
      session.clientReferenceId !== context.reservationId ||
      session.expiresAt !== context.sessionExpiresAt ||
      session.currency !== 'php' ||
      session.successUrl !== urls.success ||
      session.cancelUrl !== urls.cancel ||
      !['open','expired','complete'].includes(session.status ?? '')) {
    return 'MISMATCH'
  }

  let lines: StripeRecoveryLineItems
  try { lines = await provider.listCheckoutLineItems(context.sessionId) }
  catch { return 'PROVIDER_UNAVAILABLE' }
  if (!lines || lines.hasMore !== false || !Array.isArray(lines.items) ||
      lines.items.length !== 1 || lines.items[0].priceId !== context.priceId ||
      lines.items[0].quantity !== 1) return 'MISMATCH'

  if (session.status === 'complete') return 'COMPLETED_UNVERIFIED'
  return session.status === 'expired' ? 'MATCHED_EXPIRED' : 'MATCHED_OPEN'
}

/**
 * Strictly read-only reconciliation of SAVED Stripe IDs. A missing provider ID
 * is always unresolved, not evidence that Stripe created nothing.
 * Results are provisional and NEVER authorize resetting a reservation,
 * issuing a charge, linking customers or granting paid entitlements.
 */
export async function verifyStripeTestRecoveryProviderTruth(args: {
  readonly userSupabase: SupabaseClient<Database>
  readonly trustedBillingSupabase: SupabaseClient<Database>
  readonly organizationId: unknown
  readonly provider: StripeRecoveryReadOnlyProvider
}): Promise<StripeRecoveryVerification> {
  if (!localOnly()) return { outcome: 'DISABLED' }
  const { data: auth, error: authError } = await args.userSupabase.auth.getUser()
  if (authError || !auth.user?.id || !UUID.test(auth.user.id)) {
    return { outcome: 'DENIED', reason: 'NOT_AUTHENTICATED' }
  }
  if (typeof args.organizationId !== 'string' || !UUID.test(args.organizationId)) {
    return { outcome: 'DENIED', reason: 'INVALID_ORGANIZATION' }
  }
  const { data: permitted, error: roleError } = await args.userSupabase.rpc(
    'user_has_role', {
      org_id: args.organizationId, allowed_roles: ['OWNER','ADMIN'],
    }
  )
  if (roleError || permitted !== true) {
    return { outcome: 'DENIED', reason: 'NOT_AUTHORIZED' }
  }

  const { data, error } = await args.trustedBillingSupabase.rpc(
    'read_stripe_test_provider_recovery_context', {
      p_user_id: auth.user.id, p_organization_id: args.organizationId,
    }
  )
  if (error) throw new Error('BILLING_PROVIDER_RECOVERY_CONTEXT_FAILED')
  const context = readContext(data)
  if (!context) return { outcome: 'DENIED', reason: 'NOT_AUTHORIZED' }
  const customer = await checkCustomer(context, args.provider)
  const checkout = await checkCheckout(context, args.provider, customer)
  return { outcome: 'VERIFIED', customer, checkout }
}
