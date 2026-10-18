import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/

export interface StripeTestCustomerRecord {
  readonly id: string
  readonly livemode: boolean
  readonly name: string | null
}

export interface StripeTestCustomerCreation {
  readonly name: string
  readonly idempotencyKey: string
}

export type StripeTestCustomerProvisioningResult =
  | { readonly outcome: 'DISABLED' }
  | { readonly outcome: 'BLOCKED'; readonly reason: 'NOT_AUTHENTICATED' |
      'INVALID_ORGANIZATION' | 'NOT_AUTHORIZED' | 'ORG_UNAVAILABLE' }
  | { readonly outcome: 'READY'; readonly alreadyLinked: boolean }
  | { readonly outcome: 'RETRY_REQUIRED' | 'MANUAL_REVIEW_REQUIRED' }

function parseObject(value: Json | null): Record<string, Json | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BILLING_CUSTOMER_RESERVATION_RESPONSE_INVALID')
  }
  return value
}

/**
 * Deliberately LOCAL SYNTHETIC only. No hosted environment, account API route,
 * production credentials, live billing, or portal entry is activated here.
 * A user-scoped client validates the caller; privileged SQL rechecks role.
 */
function provisioningEnabled(): boolean {
  return process.env.ENABLE_STRIPE_TEST_CUSTOMER_PROVISIONING === 'true' &&
    process.env.MPG_STRIPE_TEST_PROVISIONING_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    process.env.VERCEL_ENV === undefined &&
    ['http://127.0.0.1:54331', 'http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

export async function provisionStripeTestCustomer(args: {
  userSupabase: SupabaseClient<Database>
  trustedBillingSupabase: SupabaseClient<Database>
  organizationId: unknown
  createCustomer: (input: StripeTestCustomerCreation) => Promise<StripeTestCustomerRecord>
}): Promise<StripeTestCustomerProvisioningResult> {
  if (!provisioningEnabled()) return { outcome: 'DISABLED' }

  const { data: auth, error: authError } = await args.userSupabase.auth.getUser()
  if (authError || !auth.user || !UUID.test(auth.user.id)) {
    return { outcome: 'BLOCKED', reason: 'NOT_AUTHENTICATED' }
  }
  if (typeof args.organizationId !== 'string' || !UUID.test(args.organizationId)) {
    return { outcome: 'BLOCKED', reason: 'INVALID_ORGANIZATION' }
  }

  // No posted role, customer ID, organization name or email is trusted.
  const { data: allowed, error: roleError } = await args.userSupabase.rpc(
    'user_has_role',
    { org_id: args.organizationId, allowed_roles: ['OWNER', 'ADMIN'] }
  )
  if (roleError || allowed !== true) {
    return { outcome: 'BLOCKED', reason: 'NOT_AUTHORIZED' }
  }

  const { data: reserved, error: reservationError } =
    await args.trustedBillingSupabase.rpc('reserve_stripe_test_customer', {
      p_user_id: auth.user.id,
      p_organization_id: args.organizationId,
    })
  if (reservationError) throw new Error('BILLING_CUSTOMER_RESERVATION_FAILED')
  const claim = parseObject(reserved)

  if (claim.outcome === 'EXISTING') {
    return { outcome: 'READY', alreadyLinked: true }
  }
  if (claim.outcome === 'BUSY') return { outcome: 'RETRY_REQUIRED' }
  if (claim.outcome === 'MANUAL_REVIEW_REQUIRED') {
    return { outcome: 'MANUAL_REVIEW_REQUIRED' }
  }
  if (claim.outcome === 'ORG_UNAVAILABLE') {
    return { outcome: 'BLOCKED', reason: 'ORG_UNAVAILABLE' }
  }
  if (claim.outcome !== 'RESERVED') {
    return { outcome: 'BLOCKED', reason: 'NOT_AUTHORIZED' }
  }

  const reservationId = claim.reservation_id
  const leaseToken = claim.lease_token
  const name = claim.organization_name
  if (typeof reservationId !== 'string' || !UUID.test(reservationId) ||
      typeof leaseToken !== 'string' || !UUID.test(leaseToken) ||
      typeof name !== 'string' || name.trim() !== name ||
      name.length < 1 || name.length > 150) {
    throw new Error('BILLING_CUSTOMER_RESERVATION_RESPONSE_INVALID')
  }

  let provider: StripeTestCustomerRecord
  try {
    provider = await args.createCustomer({
      name,
      idempotencyKey: 'mpg-reputation-test-customer-' + reservationId,
    })
  } catch {
    // Stripe may have succeeded when the network failed. Never allocate a new
    // idempotency key; re-lease the same reservation after its lease expires.
    return { outcome: 'RETRY_REQUIRED' }
  }

  if (!provider || !CUSTOMER_ID.test(provider.id) ||
      provider.livemode !== false || provider.name !== name) {
    return { outcome: 'MANUAL_REVIEW_REQUIRED' }
  }

  const { data: result, error: finalizeError } =
    await args.trustedBillingSupabase.rpc('finalize_stripe_test_customer', {
      p_user_id: auth.user.id,
      p_organization_id: args.organizationId,
      p_reservation_id: reservationId,
      p_lease_token: leaseToken,
      p_provider_customer_id: provider.id,
    })
  if (finalizeError) throw new Error('BILLING_CUSTOMER_FINALIZATION_FAILED')
  const finalized = parseObject(result)
  if (finalized.outcome !== 'LINKED') {
    return { outcome: 'MANUAL_REVIEW_REQUIRED' }
  }
  return { outcome: 'READY', alreadyLinked: false }
}
