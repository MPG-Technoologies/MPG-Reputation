import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export interface CustomerErasureEligibilityResult {
  eligible: boolean
  decision: 'ELIGIBLE' | 'BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS' | 'CUSTOMER_NOT_FOUND'
  unresolvedLegacyRequestsCount: number
}

/**
 * Precondition check for customer erasure (MR-7C.3B).
 *
 * CRITICAL PRIVACY PRECONDITION:
 * C3B must fail closed and refuse customer erasure if there are any historical
 * review requests that lack provable recipient evidence in `review_request_recipient_evidence`.
 *
 * OWNER-APPROVED CONSERVATIVE RULE:
 * A pre-C3A request in SENDING, FAILED, SENT, DELIVERED, CLICKED may also have crossed the
 * external provider boundary before local state was persisted. C3B must not assume
 * those states prove non-delivery.
 *
 * For legacy requests with missing immutable recipient evidence, treat provider-ambiguous
 * states conservatively:
 * - SENDING
 * - FAILED
 * - SENT
 * - DELIVERED
 * - CLICKED
 * Also account for sent_at / message-event evidence where it provides stronger proof.
 *
 * SCHEDULED rows that provably never crossed provider invocation may be handled
 * separately by future C3B cancellation logic.
 */
export async function checkCustomerErasureEligibility({
  supabase,
  organizationId,
  customerId,
}: {
  supabase: SupabaseClient<Database>
  organizationId: string
  customerId: string
}): Promise<CustomerErasureEligibilityResult> {
  // 1. Verify customer exists in organization
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('id', customerId)
    .maybeSingle()

  if (!customer) {
    return {
      eligible: false,
      decision: 'CUSTOMER_NOT_FOUND',
      unresolvedLegacyRequestsCount: 0,
    }
  }

  // 2. Query all review requests for this customer
  const { data: requests, error: reqErr } = await supabase
    .from('review_requests')
    .select('id, status, sent_at')
    .eq('organization_id', organizationId)
    .eq('customer_id', customerId)

  if (reqErr) {
    throw new Error(`Failed to check erasure eligibility: ${reqErr.message}`)
  }

  if (!requests || requests.length === 0) {
    return {
      eligible: true,
      decision: 'ELIGIBLE',
      unresolvedLegacyRequestsCount: 0,
    }
  }

  const requestIds = requests.map((r) => r.id)

  // 3. Query system-owned recipient evidence
  const { data: evidenceRows, error: evErr } = await supabase
    .from('review_request_recipient_evidence')
    .select('review_request_id, suppression_contact_hash')
    .eq('organization_id', organizationId)
    .in('review_request_id', requestIds)

  if (evErr) {
    throw new Error(`Failed to check recipient evidence: ${evErr.message}`)
  }

  const provenRequestIds = new Set(
    (evidenceRows || [])
      .filter((e) => e.suppression_contact_hash !== null)
      .map((e) => e.review_request_id)
  )

  // 4. Query message_events for any provider invocation proof
  const { data: msgEvents, error: msgErr } = await supabase
    .from('message_events')
    .select('review_request_id')
    .eq('organization_id', organizationId)
    .in('review_request_id', requestIds)

  if (msgErr) {
    throw new Error(`Failed to check message events: ${msgErr.message}`)
  }

  const requestsWithMsgEvents = new Set(
    (msgEvents || []).map((m) => m.review_request_id)
  )

  // 5. Identify unresolved legacy requests
  // Provider-ambiguous or delivered states: SENDING, FAILED, SENT, DELIVERED, CLICKED
  // Or requests with sent_at != null or message_events proof
  const PROVIDER_AMBIGUOUS_STATUSES = new Set([
    'SENDING',
    'FAILED',
    'SENT',
    'DELIVERED',
    'CLICKED',
  ])

  let unresolvedCount = 0
  for (const req of requests) {
    if (provenRequestIds.has(req.id)) {
      // Provably decoupled with immutable recipient evidence
      continue
    }

    const isProviderAmbiguousOrDelivered =
      PROVIDER_AMBIGUOUS_STATUSES.has(req.status) ||
      req.sent_at !== null ||
      requestsWithMsgEvents.has(req.id)

    if (isProviderAmbiguousOrDelivered) {
      unresolvedCount++
    }
  }

  if (unresolvedCount > 0) {
    return {
      eligible: false,
      decision: 'BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS',
      unresolvedLegacyRequestsCount: unresolvedCount,
    }
  }

  return {
    eligible: true,
    decision: 'ELIGIBLE',
    unresolvedLegacyRequestsCount: 0,
  }
}
