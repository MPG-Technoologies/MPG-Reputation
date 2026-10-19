import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeSupportAccess } from './access'
import { recordSupportBillingRecoveryInspection } from './audit'

const MAX_CASES = 20

export interface SupportBillingRecoveryCase {
  readonly id: string
  readonly kind: 'CUSTOMER_SETUP' | 'CHECKOUT'
  readonly reason:
    | 'AGED_CUSTOMER_ATTEMPT' | 'UNLINKED_CUSTOMER'
    | 'CUSTOMER_MAPPING_CONFLICT' | 'AGED_CHECKOUT_ATTEMPT'
    | 'EXPIRED_CHECKOUT_SESSION' | 'EXPIRED_CHECKOUT_RESERVATION'
  readonly state: 'OPEN'
  readonly requestedAt: string
}

export type SupportBillingRecoveryResult =
  | { readonly status: 'DISABLED' }
  | { readonly status: 'DENIED' }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'AVAILABLE'; readonly cases: SupportBillingRecoveryCase[];
      readonly truncated: boolean; readonly snapshotAt: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const kinds = ['CUSTOMER_SETUP', 'CHECKOUT'] as const
const reasons = [
  'AGED_CUSTOMER_ATTEMPT', 'UNLINKED_CUSTOMER', 'CUSTOMER_MAPPING_CONFLICT',
  'AGED_CHECKOUT_ATTEMPT', 'EXPIRED_CHECKOUT_SESSION', 'EXPIRED_CHECKOUT_RESERVATION',
] as const

export function isLocalBillingRecoverySupportViewEnabled(): boolean {
  return process.env.ENABLE_STRIPE_TEST_RECOVERY_SUPPORT_VIEW === 'true' &&
    process.env.MPG_STRIPE_TEST_RECOVERY_SUPPORT_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    ['http://127.0.0.1:54331', 'http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

function safeCase(row: {
  id: string; organization_id: string; kind: string; reason: string;
  state: string; requested_at: string
}, organizationId: string): SupportBillingRecoveryCase | null {
  if (!UUID.test(row.id) ||
      row.organization_id !== organizationId ||
      !kinds.includes(row.kind as typeof kinds[number]) ||
      !reasons.includes(row.reason as typeof reasons[number]) ||
      row.state !== 'OPEN' || !Number.isFinite(Date.parse(row.requested_at))) {
    return null
  }
  return {
    id: row.id, kind: row.kind as SupportBillingRecoveryCase['kind'],
    reason: row.reason as SupportBillingRecoveryCase['reason'],
    state: 'OPEN', requestedAt: row.requested_at,
  }
}

/**
 * MR-5D3D3B: Existing MR-6 MPG_ADMIN access is scoped to one organization;
 * business OWNER/ADMIN alone never grants internal support authority.
 * Every successful read MUST produce an actor-attributed audit first.
 * No provider IDs, requestor identifiers, edits, recovery commands or payments.
 */
export async function getSupportBillingRecoveryCases(
  organizationId: string
): Promise<SupportBillingRecoveryResult> {
  if (!isLocalBillingRecoverySupportViewEnabled()) return { status: 'DISABLED' }

  const access = await authorizeSupportAccess(organizationId)
  if (!access) return { status: 'DENIED' }

  let cases: SupportBillingRecoveryCase[]
  let truncated = false

  try {
    const { data, error } = await createAdminClient()
      .from('stripe_test_billing_recovery_reviews')
      .select('id,organization_id,kind,reason,state,requested_at')
      .eq('organization_id', access.organizationId)
      .eq('state', 'OPEN')
      .order('requested_at', { ascending: true })
      .limit(MAX_CASES + 1)

    if (error || !data || data.length > MAX_CASES + 1) {
      throw new Error('SUPPORT_BILLING_RECOVERY_READ_UNAVAILABLE')
    }
    const bounded = data.slice(0, MAX_CASES)
    const parsed = bounded.map(row => safeCase(row, access.organizationId))
    if (parsed.some(row => row === null)) {
      throw new Error('SUPPORT_BILLING_RECOVERY_ROW_INVALID')
    }
    cases = parsed as SupportBillingRecoveryCase[]
    truncated = data.length > MAX_CASES
  } catch {
    await recordSupportBillingRecoveryInspection(access, 'UNAVAILABLE')
    return { status: 'UNAVAILABLE' }
  }

  // Never reuse a granted capability indefinitely after the private read.
  const currentAccess = await authorizeSupportAccess(access.organizationId)
  if (!currentAccess || currentAccess.actorId !== access.actorId) {
    return { status: 'DENIED' }
  }
  const audited = await recordSupportBillingRecoveryInspection(
    currentAccess, 'AVAILABLE'
  )
  if (!audited) return { status: 'UNAVAILABLE' }

  return {
    status: 'AVAILABLE', cases, truncated, snapshotAt: new Date().toISOString(),
  }
}
