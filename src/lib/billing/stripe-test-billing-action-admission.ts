import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { getStripeTestCheckoutReturnOrigin } from './stripe-test-checkout-start'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const JSON_TYPE = /^application\/json(?:;\s*charset=utf-8)?$/i
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1):[0-9]{2,5}$/

export type StripeTestBillingAction = 'CUSTOMER_SETUP' | 'CHECKOUT' | 'PORTAL'

export interface StripeTestBillingRequestEvidence {
  readonly method: string
  readonly origin: string | null
  readonly fetchSite: string | null
  readonly fetchMode: string | null
  readonly contentType: string | null
  readonly actionHeader: string | null
}

export type StripeTestBillingActionAdmission =
  | { readonly outcome: 'DISABLED' }
  | { readonly outcome: 'DENIED'; readonly reason:
    'INVALID_REQUEST' | 'NOT_AUTHENTICATED' | 'NOT_AUTHORIZED' |
    'INVALID_ORGANIZATION' | 'RATE_LIMITED' }
  | { readonly outcome: 'ALLOWED'; readonly remaining: number }

function parseReply(value: Json | null): Record<string, Json | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BILLING_ACTION_ADMISSION_RESPONSE_INVALID')
  }
  return value
}

function enabledOnlyLocally(): boolean {
  return process.env.ENABLE_STRIPE_TEST_BILLING_ACTIONS === 'true' &&
    process.env.MPG_STRIPE_TEST_BILLING_ACTION_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    process.env.VERCEL_ENV === undefined &&
    process.env.NODE_ENV !== 'production' &&
    ['http://127.0.0.1:54331', 'http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

/**
 * Admission contract for a *future* protected POST route. Does not itself
 * call Stripe, return Customer IDs or construct service-role credentials.
 * The future route must not run provider side effects on denied admissions.
 */
export async function admitStripeTestBillingAction(args: {
  userSupabase: SupabaseClient<Database>
  trustedBillingSupabase: SupabaseClient<Database>
  organizationId: unknown
  action: unknown
  request: StripeTestBillingRequestEvidence
}): Promise<StripeTestBillingActionAdmission> {
  if (!enabledOnlyLocally()) return { outcome: 'DISABLED' }

  // Origin/Fetch Metadata and a non-simple custom JSON header all required.
  // A cross-site HTML form cannot satisfy them; no CORS grants are installed.
  const evidence = args.request
  let expectedOrigin: string
  try { expectedOrigin = getStripeTestCheckoutReturnOrigin() }
  catch { return { outcome: 'DISABLED' } }
  if (!LOCAL_ORIGIN.test(expectedOrigin)) return { outcome: 'DISABLED' }
  if (!evidence || evidence.method !== 'POST' ||
      evidence.origin !== expectedOrigin ||
      evidence.fetchSite !== 'same-origin' ||
      evidence.fetchMode !== 'cors' ||
      !evidence.contentType || !JSON_TYPE.test(evidence.contentType) ||
      evidence.actionHeader !== '1') {
    return { outcome: 'DENIED', reason: 'INVALID_REQUEST' }
  }

  if (typeof args.organizationId !== 'string' || !UUID.test(args.organizationId)) {
    return { outcome: 'DENIED', reason: 'INVALID_ORGANIZATION' }
  }
  if (args.action !== 'CUSTOMER_SETUP' && args.action !== 'CHECKOUT' &&
      args.action !== 'PORTAL') {
    return { outcome: 'DENIED', reason: 'INVALID_REQUEST' }
  }

  const { data: auth, error: authError } = await args.userSupabase.auth.getUser()
  if (authError || !auth.user?.id || auth.user.is_anonymous === true || !UUID.test(auth.user.id)) {
    return { outcome: 'DENIED', reason: 'NOT_AUTHENTICATED' }
  }
  const { data: permitted, error: roleError } = await args.userSupabase.rpc(
    'user_has_role',
    { org_id: args.organizationId, allowed_roles: ['OWNER', 'ADMIN'] }
  )
  if (roleError || permitted !== true) {
    return { outcome: 'DENIED', reason: 'NOT_AUTHORIZED' }
  }

  const { data, error } = await args.trustedBillingSupabase.rpc(
    'claim_stripe_test_billing_action',
    {
      p_user_id: auth.user.id,
      p_organization_id: args.organizationId,
      p_action: args.action,
    }
  )
  if (error) throw new Error('BILLING_ACTION_RATE_CLAIM_FAILED')
  const result = parseReply(data)
  if (result.outcome === 'RATE_LIMITED') {
    return { outcome: 'DENIED', reason: 'RATE_LIMITED' }
  }
  if (result.outcome !== 'ALLOWED') {
    return { outcome: 'DENIED', reason: 'NOT_AUTHORIZED' }
  }
  if (typeof result.remaining !== 'number' ||
      !Number.isInteger(result.remaining) ||
      result.remaining < 0 || result.remaining > 4) {
    throw new Error('BILLING_ACTION_ADMISSION_RESPONSE_INVALID')
  }
  return { outcome: 'ALLOWED', remaining: result.remaining }
}
