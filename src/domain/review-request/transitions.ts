import type { Database } from '@/types/database'

export type ReviewRequestStatus = Database['public']['Tables']['review_requests']['Row']['status']

export type SupportedProviderEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.bounced'
  | 'email.complained'
  | 'email.failed'
  | 'email.suppressed'
  | 'email.opened'
  | 'email.clicked'

export type BounceClassification = 'Permanent' | 'Transient' | 'Undetermined' | string

export interface TransitionInput {
  currentStatus: ReviewRequestStatus
  eventType: SupportedProviderEventType | string
  bounceType?: BounceClassification
}

export interface TransitionResult {
  nextStatus: ReviewRequestStatus
  statusChanged: boolean
  shouldSuppressContact: boolean
  suppressionReason?: 'PROVIDER_HARD_BOUNCE' | 'PROVIDER_COMPLAINT' | 'PROVIDER_SUPPRESSED'
  shouldSetDeliveredAt: boolean
  isIgnoredForReviewActivity: boolean
}

/**
 * Pure, deterministic state transition function for review requests
 * reacting to provider webhook events (Section 12, 13, 14, 15).
 *
 * CRITICAL INVARIANTS:
 * 1. CLICKED is an MPG-authoritative user activity state. Provider email events
 *    must NEVER regress or overwrite CLICKED.
 * 2. DELIVERED represents proven delivery. Late sent or delivery_delayed events
 *    must NEVER regress DELIVERED to SENT or FAILED.
 * 3. Provider email.opened and email.clicked must NOT be interpreted as MPG
 *    review CTA activity or mutate review request state.
 * 4. Permanent bounces and spam complaints trigger contact suppression.
 *    Transient bounces do NOT permanently suppress contacts.
 */
export function determineReviewRequestTransition(input: TransitionInput): TransitionResult {
  const { currentStatus, eventType, bounceType } = input

  // Provider open/click tracking is explicitly ignored for product review state (Section 9)
  if (eventType === 'email.opened' || eventType === 'email.clicked') {
    return {
      nextStatus: currentStatus,
      statusChanged: false,
      shouldSuppressContact: false,
      shouldSetDeliveredAt: false,
      isIgnoredForReviewActivity: true,
    }
  }

  // Determine suppression requirements independently
  let shouldSuppressContact = false
  let suppressionReason: 'PROVIDER_HARD_BOUNCE' | 'PROVIDER_COMPLAINT' | 'PROVIDER_SUPPRESSED' | undefined

  if (eventType === 'email.complained') {
    shouldSuppressContact = true
    suppressionReason = 'PROVIDER_COMPLAINT'
  } else if (eventType === 'email.suppressed') {
    shouldSuppressContact = true
    suppressionReason = 'PROVIDER_SUPPRESSED'
  } else if (eventType === 'email.bounced') {
    const isPermanent = typeof bounceType === 'string' && bounceType.toLowerCase() === 'permanent'
    if (isPermanent) {
      shouldSuppressContact = true
      suppressionReason = 'PROVIDER_HARD_BOUNCE'
    }
  }

  // Invariant 1: CLICKED is authoritative and irreversible by provider email events
  if (currentStatus === 'CLICKED') {
    return {
      nextStatus: 'CLICKED',
      statusChanged: false,
      shouldSuppressContact,
      suppressionReason,
      shouldSetDeliveredAt: eventType === 'email.delivered',
      isIgnoredForReviewActivity: false,
    }
  }

  // Invariant 2: CANCELLED requests do not transition forward based on email events
  if (currentStatus === 'CANCELLED') {
    return {
      nextStatus: 'CANCELLED',
      statusChanged: false,
      shouldSuppressContact,
      suppressionReason,
      shouldSetDeliveredAt: false,
      isIgnoredForReviewActivity: false,
    }
  }

  let nextStatus: ReviewRequestStatus = currentStatus
  let shouldSetDeliveredAt = false

  switch (eventType) {
    case 'email.sent':
      // Progress SCHEDULED or SENDING to SENT. Never regress DELIVERED.
      if (currentStatus === 'SCHEDULED' || currentStatus === 'SENDING') {
        nextStatus = 'SENT'
      }
      break

    case 'email.delivered':
      // Progress SENDING or SENT or SCHEDULED to DELIVERED.
      if (['SCHEDULED', 'SENDING', 'SENT', 'FAILED'].includes(currentStatus)) {
        nextStatus = 'DELIVERED'
        shouldSetDeliveredAt = true
      } else if (currentStatus === 'DELIVERED') {
        // Idempotent delivered
        shouldSetDeliveredAt = false
      }
      break

    case 'email.delivery_delayed':
      // Informational provider event; persist event without failing or regressing state
      nextStatus = currentStatus
      break

    case 'email.failed':
      // If still in SENDING or SENT, mark FAILED. Do not regress DELIVERED.
      if (['SCHEDULED', 'SENDING', 'SENT'].includes(currentStatus)) {
        nextStatus = 'FAILED'
      }
      break

    case 'email.bounced':
      // Bounces mark the request FAILED if not already CLICKED
      nextStatus = 'FAILED'
      break

    case 'email.complained':
      // Complaint does NOT erase delivery truth; request remains at its current state
      nextStatus = currentStatus
      break

    case 'email.suppressed':
      // Provider reported recipient is suppressed; mark current request SUPPRESSED unless DELIVERED
      if (currentStatus !== 'DELIVERED') {
        nextStatus = 'SUPPRESSED'
      }
      break

    default:
      // Unknown or unhandled provider event; maintain current status safely
      nextStatus = currentStatus
      break
  }

  return {
    nextStatus,
    statusChanged: nextStatus !== currentStatus,
    shouldSuppressContact,
    suppressionReason,
    shouldSetDeliveredAt,
    isIgnoredForReviewActivity: false,
  }
}
