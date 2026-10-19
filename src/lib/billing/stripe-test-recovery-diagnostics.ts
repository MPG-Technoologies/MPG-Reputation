import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CustomerRecoveryState =
  | 'NOT_STARTED' | 'ACCOUNT_LINKED' | 'IN_FLIGHT'
  | 'RETRY_SAME_RESERVATION' | 'RECONCILE_PROVIDER'

export type CheckoutRecoveryState =
  | 'NOT_STARTED' | 'ACTIVE_SESSION' | 'SUBSCRIPTION_RECORDED'
  | 'IN_FLIGHT' | 'RETRY_SAME_RESERVATION' | 'RECONCILE_PROVIDER'

const customerStates: readonly string[] = [
  'NOT_STARTED', 'ACCOUNT_LINKED', 'IN_FLIGHT',
  'RETRY_SAME_RESERVATION', 'RECONCILE_PROVIDER',
]
const checkoutStates: readonly string[] = [
  'NOT_STARTED', 'ACTIVE_SESSION', 'SUBSCRIPTION_RECORDED',
  'IN_FLIGHT', 'RETRY_SAME_RESERVATION', 'RECONCILE_PROVIDER',
]

export type TestRecoveryDiagnosis =
  | { readonly outcome: 'DISABLED' }
  | { readonly outcome: 'DENIED'; readonly reason:
      'NOT_AUTHENTICATED' | 'INVALID_ORGANIZATION' | 'NOT_AUTHORIZED' }
  | { readonly outcome: 'READY'; readonly customer: CustomerRecoveryState;
      readonly checkout: CheckoutRecoveryState }

function diagnosticEnabled(): boolean {
  return process.env.ENABLE_STRIPE_TEST_RECOVERY_DIAGNOSTICS === 'true' &&
    process.env.MPG_STRIPE_TEST_RECOVERY_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    ['http://127.0.0.1:54331','http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

function parseSnapshot(value: Json | null): TestRecoveryDiagnosis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BILLING_RECOVERY_DIAGNOSIS_INVALID')
  }
  if (value.outcome === 'NOT_AUTHORIZED') {
    return { outcome: 'DENIED', reason: 'NOT_AUTHORIZED' }
  }
  if (value.outcome !== 'READY' ||
      typeof value.customer !== 'string' ||
      typeof value.checkout !== 'string' ||
      !customerStates.includes(value.customer) ||
      !checkoutStates.includes(value.checkout) ||
      Object.keys(value).some(key => !['outcome','customer','checkout'].includes(key))) {
    throw new Error('BILLING_RECOVERY_DIAGNOSIS_INVALID')
  }
  return {
    outcome: 'READY',
    customer: value.customer as CustomerRecoveryState,
    checkout: value.checkout as CheckoutRecoveryState,
  }
}

/**
 * Diagnostic-only: no Stripe API and no mutation of reservation/customer rows.
 * Caller must supply an RLS-scoped authenticated client and an isolated
 * privileged client that can invoke ONLY the narrowly scoped RPC.
 */
export async function diagnoseStripeTestBillingRecovery(args: {
  readonly userSupabase: SupabaseClient<Database>
  readonly trustedBillingSupabase: SupabaseClient<Database>
  readonly organizationId: unknown
}): Promise<TestRecoveryDiagnosis> {
  if (!diagnosticEnabled()) return { outcome: 'DISABLED' }

  const { data: auth, error: authError } = await args.userSupabase.auth.getUser()
  if (authError || !auth.user?.id || !UUID.test(auth.user.id)) {
    return { outcome: 'DENIED', reason: 'NOT_AUTHENTICATED' }
  }
  if (typeof args.organizationId !== 'string' ||
      !UUID.test(args.organizationId)) {
    return { outcome: 'DENIED', reason: 'INVALID_ORGANIZATION' }
  }
  const { data: permitted, error: roleError } = await args.userSupabase.rpc(
    'user_has_role', {
      org_id: args.organizationId,
      allowed_roles: ['OWNER', 'ADMIN'],
    }
  )
  if (roleError || permitted !== true) {
    return { outcome: 'DENIED', reason: 'NOT_AUTHORIZED' }
  }
  const { data, error } = await args.trustedBillingSupabase.rpc(
    'inspect_stripe_test_billing_recovery', {
      p_user_id: auth.user.id,
      p_organization_id: args.organizationId,
    }
  )
  if (error) throw new Error('BILLING_RECOVERY_DIAGNOSIS_FAILED')
  return parseSnapshot(data)
}
