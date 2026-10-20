import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { ProviderRecurringPriceSnapshot } from '@/domain/billing/catalog'
import {
  prepareStripeTestCheckout,
  type StripeTestCheckoutPreparation,
} from './stripe-test-checkout-preflight'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION_ID = /^cs_test_[A-Za-z0-9]+$/

export interface StripeTestCheckoutSession {
  readonly id: string
  readonly url: string | null
  readonly livemode: boolean
  readonly mode: string
  readonly customerId: string | null
  readonly expiresAt: number
  readonly status: string | null
}

export interface StripeTestCheckoutCreateOptions {
  readonly customerId: string
  readonly priceId: string
  readonly reservationId: string
  readonly expiresAt: number
  readonly successUrl: string
  readonly cancelUrl: string
  readonly idempotencyKey: string
}

export type StripeTestCheckoutStartResult =
  | { readonly outcome: 'DISABLED' }
  | { readonly outcome: 'BLOCKED'; readonly reason: string }
  | { readonly outcome: 'READY'; readonly sessionUrl: string; readonly reused: boolean }
  | { readonly outcome: 'RETRY_REQUIRED' | 'MANUAL_REVIEW_REQUIRED' }

function jsonObject(value: Json | null): Record<string, Json | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BILLING_CHECKOUT_RESERVATION_RESPONSE_INVALID')
  }
  return value
}

function allowedStripeCheckoutUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' &&
      parsed.hostname === 'checkout.stripe.com' &&
      parsed.port === '' &&
      parsed.username === '' && parsed.password === '' &&
      parsed.pathname.startsWith('/c/') &&
      parsed.hash === '' && raw.length <= 2048
  } catch {
    return false
  }
}

/** Origin is a server-controlled allowlist value, NEVER a posted redirect. */
export function getStripeTestCheckoutReturnOrigin(): string {
  const raw = process.env.MPG_BILLING_CHECKOUT_RETURN_ORIGIN
  if (!raw || raw.length > 250) throw new Error('BILLING_CHECKOUT_RETURN_ORIGIN_INVALID')
  let url: URL
  try { url = new URL(raw) }
  catch { throw new Error('BILLING_CHECKOUT_RETURN_ORIGIN_INVALID') }
  if (url.origin !== raw || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash ||
      !(url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('BILLING_CHECKOUT_RETURN_ORIGIN_INVALID')
  }
  return url.origin
}

/**
 * Explicit server-only TEST checkout initiation, with an injected
 * RLS-scoped caller and separate privileged checkout RPC client.
 *
 * No route, cron, client-side access, or Stripe SDK connection is installed
 * here. ENABLE_STRIPE_TEST_CHECKOUT_CREATE must be explicitly 'true'.
 */
export async function startStripeTestCheckout(args: {
  userSupabase: SupabaseClient<Database>
  trustedBillingSupabase: SupabaseClient<Database>
  organizationId: unknown
  planId: unknown
  retrievePrice: (priceId: string) => Promise<ProviderRecurringPriceSnapshot>
  createSession: (input: StripeTestCheckoutCreateOptions) => Promise<StripeTestCheckoutSession>
}): Promise<StripeTestCheckoutStartResult> {
  // Direct helper calls must obey the same LOCAL_SYNTHETIC boundary as the
  // internal HTTP route before any RLS read, privileged reservation or provider.
  if (process.env.ENABLE_STRIPE_TEST_CHECKOUT_CREATE !== 'true' ||
      process.env.ENABLE_LIVE_BILLING === 'true' ||
      process.env.NODE_ENV === 'production' ||
      process.env.VERCEL_ENV !== undefined ||
      !['http://127.0.0.1:54331', 'http://localhost:54331']
        .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) return { outcome: 'DISABLED' }

  const preflight: StripeTestCheckoutPreparation = await prepareStripeTestCheckout({
    supabase: args.userSupabase,
    organizationId: args.organizationId,
    planId: args.planId,
    retrievePrice: args.retrievePrice,
  })
  if (preflight.outcome !== 'READY') return preflight

  // This identity must be from the *user session*, never a caller-supplied ID.
  const { data: auth, error: authError } = await args.userSupabase.auth.getUser()
  if (authError || !auth.user?.id || auth.user.is_anonymous === true || !UUID.test(auth.user.id)) {
    return { outcome: 'BLOCKED', reason: 'NOT_AUTHENTICATED' }
  }
  const origin = getStripeTestCheckoutReturnOrigin()
  const { intent } = preflight
  const { data: reservation, error: claimError } =
    await args.trustedBillingSupabase.rpc('reserve_stripe_test_checkout', {
      p_user_id: auth.user.id,
      p_organization_id: intent.organizationId,
      p_billing_account_id: intent.billingAccountId,
      p_provider_customer_id: intent.stripeCustomerId,
      p_provider_price_id: intent.stripePriceId,
      p_plan_id: intent.planId,
      p_return_origin: origin,
    })
  if (claimError) throw new Error('BILLING_CHECKOUT_RESERVATION_FAILED')
  const claim = jsonObject(reservation)

  if (claim.outcome === 'EXISTING_READY') {
    const existing = claim.session_url
    if (typeof existing !== 'string' || !allowedStripeCheckoutUrl(existing)) {
      throw new Error('BILLING_CHECKOUT_SAVED_SESSION_INVALID')
    }
    return { outcome: 'READY', sessionUrl: existing, reused: true }
  }
  if (claim.outcome === 'BUSY') return { outcome: 'RETRY_REQUIRED' }
  if (claim.outcome === 'MANUAL_REVIEW_REQUIRED') {
    return { outcome: 'MANUAL_REVIEW_REQUIRED' }
  }
  if (claim.outcome !== 'RESERVED') {
    return { outcome: 'BLOCKED', reason: String(claim.outcome ?? 'RESERVATION_BLOCKED') }
  }

  const reservationId = claim.reservation_id
  const leaseToken = claim.lease_token
  const expiration = claim.session_expires_at
  if (typeof reservationId !== 'string' || !UUID.test(reservationId) ||
      typeof leaseToken !== 'string' || !UUID.test(leaseToken) ||
      typeof expiration !== 'string' || !Number.isFinite(Date.parse(expiration))) {
    throw new Error('BILLING_CHECKOUT_RESERVATION_RESPONSE_INVALID')
  }
  const expiryUnix = Math.floor(Date.parse(expiration) / 1000)

  let session: StripeTestCheckoutSession
  try {
    session = await args.createSession({
      customerId: intent.stripeCustomerId,
      priceId: intent.stripePriceId,
      reservationId,
      expiresAt: expiryUnix,
      successUrl: origin + '/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: origin + '/billing/checkout/cancel',
      idempotencyKey: 'mpg-reputation-test-checkout-' + reservationId,
    })
  } catch {
    // Do not reset the reservation or change its idempotency key on unknown
    // provider outcomes. Once the lease expires, a safe retry can use the
    // same deterministic key; after 10 min it needs manual reconciliation.
    return { outcome: 'RETRY_REQUIRED' }
  }

  if (!session || !SESSION_ID.test(session.id) ||
      session.mode !== 'subscription' || session.livemode !== false ||
      session.customerId !== intent.stripeCustomerId ||
      session.expiresAt !== expiryUnix ||
      session.status !== 'open' ||
      typeof session.url !== 'string' || !allowedStripeCheckoutUrl(session.url)) {
    return { outcome: 'MANUAL_REVIEW_REQUIRED' }
  }

  const { data: finalized, error: finalizeError } = await args.trustedBillingSupabase.rpc(
    'finalize_stripe_test_checkout', {
      p_user_id: auth.user.id,
      p_reservation_id: reservationId,
      p_lease_token: leaseToken,
      p_session_id: session.id,
      p_session_url: session.url,
      p_session_expires_at: expiration,
    }
  )
  if (finalizeError) throw new Error('BILLING_CHECKOUT_FINALIZE_FAILED')
  const result = jsonObject(finalized)
  if (result.outcome !== 'FINALIZED') {
    // Stripe may have created a session but the organization may have lost
    // membership or a subscription appeared while in flight. Never redirect
    // until local server-side finalization succeeds.
    return { outcome: 'MANUAL_REVIEW_REQUIRED' }
  }
  return { outcome: 'READY', sessionUrl: session.url, reused: false }
}
