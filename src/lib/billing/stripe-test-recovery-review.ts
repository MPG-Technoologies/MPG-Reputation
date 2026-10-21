import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RecoveryReviewKind = 'CUSTOMER_SETUP' | 'CHECKOUT'
export type RecoveryReviewIntakeResult =
  | { readonly outcome: 'DISABLED' }
  | { readonly outcome: 'DENIED'; readonly reason:
      'NOT_AUTHENTICATED' | 'INVALID_ORGANIZATION' | 'NOT_AUTHORIZED' | 'INVALID_KIND' }
  | { readonly outcome: 'NOT_NEEDED' | 'REQUESTED' | 'ALREADY_REQUESTED' }

function localOnly(): boolean {
  return process.env.ENABLE_STRIPE_TEST_RECOVERY_REVIEW === 'true' &&
    process.env.MPG_STRIPE_TEST_RECOVERY_REVIEW_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    ['http://127.0.0.1:54331','http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

function parseResult(value: Json | null): RecoveryReviewIntakeResult {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      typeof value.outcome !== 'string') {
    throw new Error('BILLING_RECOVERY_REVIEW_RESPONSE_INVALID')
  }
  if (value.outcome === 'NOT_AUTHORIZED') {
    return { outcome: 'DENIED', reason: 'NOT_AUTHORIZED' }
  }
  if (value.outcome === 'INVALID_INPUT') {
    return { outcome: 'DENIED', reason: 'INVALID_KIND' }
  }
  if (value.outcome === 'REQUESTED' || value.outcome === 'ALREADY_REQUESTED' ||
      value.outcome === 'NOT_NEEDED') {
    return { outcome: value.outcome }
  }
  throw new Error('BILLING_RECOVERY_REVIEW_RESPONSE_INVALID')
}

/**
 * Creates an immutable tenant review REQUEST, not a support decision.
 * The PostgreSQL RPC derives review reason from authoritative local rows;
 * caller cannot provide reason, evidence, provider identifiers or outcome.
 * There is intentionally NO public route or automatic recovery action.
 */
export async function requestStripeTestRecoveryReview(args: {
  readonly userSupabase: SupabaseClient<Database>
  readonly trustedBillingSupabase: SupabaseClient<Database>
  readonly organizationId: unknown
  readonly kind: unknown
}): Promise<RecoveryReviewIntakeResult> {
  if (!localOnly()) return { outcome: 'DISABLED' }

  const { data: auth, error: authError } = await args.userSupabase.auth.getUser()
  if (authError || !auth.user?.id || auth.user.is_anonymous === true ||
      !UUID.test(auth.user.id)) {
    return { outcome: 'DENIED', reason: 'NOT_AUTHENTICATED' }
  }
  if (typeof args.organizationId !== 'string' || !UUID.test(args.organizationId)) {
    return { outcome: 'DENIED', reason: 'INVALID_ORGANIZATION' }
  }
  if (args.kind !== 'CUSTOMER_SETUP' && args.kind !== 'CHECKOUT') {
    return { outcome: 'DENIED', reason: 'INVALID_KIND' }
  }

  const { data: allowed, error: roleError } = await args.userSupabase.rpc(
    'user_has_role', {
      org_id: args.organizationId,
      allowed_roles: ['OWNER','ADMIN'],
    }
  )
  if (roleError || allowed !== true) {
    return { outcome: 'DENIED', reason: 'NOT_AUTHORIZED' }
  }

  const { data, error } = await args.trustedBillingSupabase.rpc(
    'request_stripe_test_billing_recovery_review', {
      p_user_id: auth.user.id,
      p_organization_id: args.organizationId,
      p_kind: args.kind,
    }
  )
  if (error) throw new Error('BILLING_RECOVERY_REVIEW_INTAKE_FAILED')
  return parseResult(data)
}
