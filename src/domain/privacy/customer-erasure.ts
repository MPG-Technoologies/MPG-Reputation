import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import { checkCustomerErasureEligibility } from './erasure-guard'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME = '[Deleted Customer]' as const

/**
 * MR-7C.3C External Identifier Gate Invariant:
 *
 * `source_customer_id` and `source_transaction_id` remain UNRESOLVED / OWNER-LEGAL DECISION.
 * For B1, these fields remain unchanged on `customer_completion_events` only because no tenant-facing
 * erasure surface exists yet.
 *
 * Invariant: MR-7C.3C MUST NOT expose customer erasure until the external identifier policy
 * for source_customer_id and source_transaction_id is explicitly resolved.
 */
export const C3C_EXTERNAL_IDENTIFIER_GATE = {
  sourceCustomerId: 'UNRESOLVED / OWNER-LEGAL DECISION',
  sourceTransactionId: 'UNRESOLVED / OWNER-LEGAL DECISION',
  invariant:
    'MR-7C.3C MUST NOT expose customer erasure until the external identifier policy for source_customer_id and source_transaction_id is explicitly resolved.',
} as const

export type CustomerErasureAuthority =
  | 'AUTHORIZED'
  | 'DENIED'
  | 'UNAVAILABLE'

export type CustomerErasureResult =
  | {
      status: 'AUTHORIZED'
      success: true
      alreadyErased: boolean
      customerId: string
      organizationId: string
      erasedAt: string
      completionEventsRedactedCount: number
      reviewRequestErrorsScrubbedCount: number
      messageEventErrorsScrubbedCount: number
    }
  | {
      status: 'DENIED'
      success: false
      reason?: string
    }
  | {
      status: 'BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS'
      success: false
      unresolvedLegacyRequestsCount: number
    }
  | {
      status: 'UNAVAILABLE'
      success: false
      error?: string
    }

/**
 * Check customer erasure authority for a user in an organization.
 *
 * OWNER AUTHORITY DECISION (FROZEN):
 * Customer erasure / anonymization authority is OWNER ONLY.
 * - OWNER: allowed to authorize customer erasure
 * - ADMIN: denied
 * - OPERATOR: denied
 * - VIEWER: denied
 * - anonymous / unauthenticated: denied
 */
export async function checkErasureAuthority(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  userId: string
): Promise<CustomerErasureAuthority> {
  const { data: membership, error } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    return 'UNAVAILABLE'
  }

  if (!membership || membership.role !== 'OWNER') {
    return 'DENIED'
  }

  return 'AUTHORIZED'
}

/**
 * Internal atomic execution of customer erasure via the privileged service-role RPC.
 *
 * Preconditions:
 * 1. Checks legacy request recipient evidence eligibility (checkCustomerErasureEligibility).
 *    Fails closed if any legacy request has unresolved recipient evidence in provider-ambiguous states.
 * 2. Invokes the atomic PostgreSQL RPC `execute_customer_erasure` inside a single transaction.
 * 3. Never hard-deletes the customer row.
 * 4. Preserves all compliance and operational records (review requests, message events, recipient evidence, suppressions, audit).
 * 5. Redacts direct contact PII on customer completion events to '{}'.
 * 6. Scrubs historical error text on review_requests and message_events to NULL.
 * 7. Sets customer first_name to deterministic tombstone '[Deleted Customer]', nulls last_name, email, phone.
 * 8. Enforces transactional OWNER role check inside the database transaction (immune to TOCTOU races).
 */
export async function executeCustomerErasureInternal({
  adminClient,
  organizationId,
  customerId,
  actorId,
  actorType = 'user',
}: {
  adminClient: SupabaseClient<Database>
  organizationId: string
  customerId: string
  actorId: string
  actorType?: string
}): Promise<CustomerErasureResult> {
  if (!UUID.test(organizationId) || !UUID.test(customerId) || !actorId || !UUID.test(actorId)) {
    return {
      status: 'DENIED',
      success: false,
    }
  }

  // 1. Enforce mandatory legacy erasure eligibility gate before attempting mutation
  const eligibility = await checkCustomerErasureEligibility({
    supabase: adminClient,
    organizationId,
    customerId,
  })

  if (!eligibility.eligible) {
    if (eligibility.decision === 'CUSTOMER_NOT_FOUND') {
      // Fail closed without existence leakage
      return {
        status: 'DENIED',
        success: false,
      }
    }
    if (eligibility.decision === 'BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS') {
      return {
        status: 'BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS',
        success: false,
        unresolvedLegacyRequestsCount: eligibility.unresolvedLegacyRequestsCount,
      }
    }
  }

  // 2. Invoke atomic transactional erasure RPC
  const { data, error } = await adminClient.rpc('execute_customer_erasure', {
    p_org_id: organizationId,
    p_customer_id: customerId,
    p_actor_id: actorId,
    p_actor_type: actorType,
  })

  if (error) {
    if (error.message.includes('DENIED')) {
      return {
        status: 'DENIED',
        success: false,
        reason: error.message,
      }
    }
    if (error.message.includes('CUSTOMER_NOT_FOUND')) {
      return {
        status: 'DENIED',
        success: false,
      }
    }
    if (error.message.includes('BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS')) {
      return {
        status: 'BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS',
        success: false,
        unresolvedLegacyRequestsCount: eligibility.unresolvedLegacyRequestsCount || 1,
      }
    }
    return {
      status: 'UNAVAILABLE',
      success: false,
      error: error.message,
    }
  }

  const rpcResult = data as {
    erased: boolean
    already_erased: boolean
    customer_id: string
    organization_id: string
    erased_at: string
    completion_events_redacted_count: number
    review_request_errors_scrubbed_count?: number
    message_event_errors_scrubbed_count?: number
  }

  return {
    status: 'AUTHORIZED',
    success: true,
    alreadyErased: rpcResult.already_erased,
    customerId: rpcResult.customer_id,
    organizationId: rpcResult.organization_id,
    erasedAt: rpcResult.erased_at,
    completionEventsRedactedCount: rpcResult.completion_events_redacted_count,
    reviewRequestErrorsScrubbedCount: rpcResult.review_request_errors_scrubbed_count ?? 0,
    messageEventErrorsScrubbedCount: rpcResult.message_event_errors_scrubbed_count ?? 0,
  }
}

/**
 * Authorized customer erasure entry point.
 *
 * Verifies caller authority (OWNER only) and tenant isolation before delegating to atomic execution.
 */
export async function eraseCustomer({
  organizationId,
  customerId,
  actorType,
  actorId,
  tenantClient,
  adminClient,
}: {
  organizationId: string
  customerId: string
  actorType?: string
  actorId?: string | null
  tenantClient?: SupabaseClient<Database>
  adminClient?: SupabaseClient<Database>
}): Promise<CustomerErasureResult> {
  if (!UUID.test(organizationId) || !UUID.test(customerId)) {
    return {
      status: 'DENIED',
      success: false,
    }
  }

  let effectiveActorType = actorType ?? 'user'
  let effectiveActorId = actorId ?? null

  if (tenantClient) {
    const {
      data: { user },
      error: authError,
    } = await tenantClient.auth.getUser()

    if (authError || !user || user.is_anonymous) {
      return {
        status: 'DENIED',
        success: false,
      }
    }

    const authority = await checkErasureAuthority(
      tenantClient,
      organizationId,
      user.id
    )

    if (authority !== 'AUTHORIZED') {
      return {
        status: authority,
        success: false,
      }
    }

    // Fail closed if customer not found in tenant or foreign customer ID
    const { data: customer, error: custError } = await tenantClient
      .from('customers')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', customerId)
      .maybeSingle()

    if (custError) {
      return {
        status: 'UNAVAILABLE',
        success: false,
      }
    }

    if (!customer) {
      return {
        status: 'DENIED',
        success: false,
      }
    }

    effectiveActorType = actorType ?? 'user'
    effectiveActorId = user.id
  }

  if (!effectiveActorId || !UUID.test(effectiveActorId)) {
    return {
      status: 'DENIED',
      success: false,
    }
  }

  const privilegedClient = adminClient ?? createAdminClient()

  return executeCustomerErasureInternal({
    adminClient: privilegedClient,
    organizationId,
    customerId,
    actorId: effectiveActorId,
    actorType: effectiveActorType,
  })
}
