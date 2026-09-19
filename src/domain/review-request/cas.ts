import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { determineReviewRequestTransition, type ReviewRequestStatus, type TransitionResult } from './transitions'

export interface ApplyTransitionInput {
  supabase: SupabaseClient<Database>
  reviewRequestId: string
  eventType: string
  bounceType?: string
  eventOccurredAt?: string
  sanitizedError?: string | null
  maxRetries?: number
}

export interface ApplyTransitionResult {
  success: boolean
  finalStatus: ReviewRequestStatus
  transition: TransitionResult
  error?: string
}

/**
 * Optimistic compare-and-set status updater for review requests (MR-1A.2 Section 7).
 *
 * Prevents race conditions where a stale read overwrites a newer authoritative state
 * (e.g., webhook reads SENT, customer clicks link setting CLICKED, webhook writes DELIVERED).
 *
 * Pattern:
 * 1. Fetch current status and timestamps
 * 2. Determine transition
 * 3. Attempt UPDATE with WHERE id = reviewRequestId AND status = currentStatus
 * 4. If 1 row updated: success
 * 5. If 0 rows updated: refetch, recompute against new status, retry (max 3 times)
 * 6. Always preserves CLICKED invariant (CLICKED never regresses)
 */
export async function applyProviderReviewRequestTransition(
  input: ApplyTransitionInput
): Promise<ApplyTransitionResult> {
  const {
    supabase,
    reviewRequestId,
    eventType,
    bounceType,
    eventOccurredAt,
    sanitizedError,
    maxRetries = 3,
  } = input

  let lastError: string | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 1. Fetch current review request state
    const { data: currentReq, error: fetchErr } = await supabase
      .from('review_requests')
      .select('id, status, delivered_at, clicked_at')
      .eq('id', reviewRequestId)
      .single()

    if (fetchErr || !currentReq) {
      const detail = fetchErr?.message || 'record not found'
      return {
        success: false,
        finalStatus: 'FAILED',
        transition: null as unknown as TransitionResult,
        error: `Failed to fetch review request: ${detail}`,
      }
    }

    const currentStatus = currentReq.status as ReviewRequestStatus

    // 2. Determine transition
    const transition = determineReviewRequestTransition({
      currentStatus,
      eventType,
      bounceType,
    })

    const needsStatusChange = transition.statusChanged
    const needsDeliveredAt = transition.shouldSetDeliveredAt && !currentReq.delivered_at
    const needsFailedAt = transition.nextStatus === 'FAILED'

    // If no database updates to review_requests are needed (already in target state or ignored)
    if (!needsStatusChange && !needsDeliveredAt) {
      return {
        success: true,
        finalStatus: currentStatus,
        transition,
      }
    }

    // Build update payload
    const updatePayload: Database['public']['Tables']['review_requests']['Update'] = {
      updated_at: new Date().toISOString(),
    }

    // Invariant: If currentStatus is already CLICKED, never regress status
    if (currentStatus === 'CLICKED') {
      updatePayload.status = 'CLICKED'
    } else {
      updatePayload.status = transition.nextStatus
    }

    if (needsDeliveredAt) {
      updatePayload.delivered_at = eventOccurredAt || new Date().toISOString()
    }

    if (needsFailedAt) {
      updatePayload.failed_at = new Date().toISOString()
      if (sanitizedError) {
        updatePayload.error_message = sanitizedError
      }
    }

    // 3. Attempt atomic compare-and-set update matching id and status
    const { data: updatedRows, error: updateErr } = await supabase
      .from('review_requests')
      .update(updatePayload)
      .eq('id', reviewRequestId)
      .eq('status', currentStatus)
      .select('id, status')

    if (updateErr) {
      lastError = updateErr.message
      break
    }

    // 4. Success if exactly one row matched the expected status
    if (updatedRows && updatedRows.length === 1) {
      return {
        success: true,
        finalStatus: updatedRows[0].status as ReviewRequestStatus,
        transition,
      }
    }

    // 5. If 0 rows were updated, a concurrent writer updated the status; retry loop refetches
  }

  return {
    success: false,
    finalStatus: 'FAILED',
    transition: null as unknown as TransitionResult,
    error: lastError || 'Exceeded maximum CAS retry attempts due to concurrent updates',
  }
}
