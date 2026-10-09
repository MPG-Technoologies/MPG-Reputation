import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import { checkCustomerErasureEligibility } from './erasure-guard'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME = '[Deleted Customer]' as const

/**
 * MR-7C.3C External Identifier Erasure Policy (RESOLVED BY OWNER DECISION):
 *
 * The owner has explicitly resolved the external identifier erasure policy:
 * - `source_customer_id` MUST be erased to NULL during customer erasure.
 * - `source_transaction_id` MUST be erased to NULL during customer erasure.
 * - `source_event_id` MUST be retained as the event/idempotency/deduplication key.
 *
 * Rationale:
 * `source_customer_id` and `source_transaction_id` maintain external person/transaction linkability
 * and have no approved post-erasure purpose; hashing is not an approved substitute.
 * `source_event_id` is retained to prevent duplicate ingestion of completed events.
 */
export const C3C_EXTERNAL_IDENTIFIER_POLICY = {
  status: 'RESOLVED',
  sourceCustomerId: 'NULL',
  sourceTransactionId: 'NULL',
  sourceEventId: 'RETAIN',
  rationale:
    'source_customer_id and source_transaction_id maintain external person/transaction linkability and have no approved post-erasure purpose; hashing is not an approved substitute. source_event_id is retained as the event/idempotency/deduplication key.',
} as const

// Backwards-compatible alias referencing the resolved policy
export const C3C_EXTERNAL_IDENTIFIER_GATE = C3C_EXTERNAL_IDENTIFIER_POLICY

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
 * 5. Redacts direct contact PII on customer completion events to '{}' and erases external identifiers (source_customer_id, source_transaction_id) to NULL, while retaining source_event_id.
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
