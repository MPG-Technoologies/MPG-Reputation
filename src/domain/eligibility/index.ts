import type { EligibilityInput, EligibilityResult } from './types'

/**
 * Pure domain function evaluating customer review solicitation eligibility.
 * 
 * STRICT INTEGRITY RULE: Never accepts, receives, or evaluates customer sentiment,
 * star ratings, satisfaction scores, complaint status, or reviews.
 */
export function evaluateReviewEligibility(input: EligibilityInput): EligibilityResult {
  if (input.organization.status !== 'ACTIVE') {
    return {
      decision: 'ORGANIZATION_INACTIVE',
      eligible: false,
      reason: `Organization status is ${input.organization.status}`,
    }
  }

  if (input.location.status !== 'ACTIVE') {
    return {
      decision: 'LOCATION_INACTIVE',
      eligible: false,
      reason: `Location status is ${input.location.status}`,
    }
  }

  if (input.isDuplicateEvent) {
    return {
      decision: 'DUPLICATE_EVENT',
      eligible: false,
      reason: 'Completion event has already been processed for this completion event ID',
    }
  }

  const email = input.customer.email?.trim()
  if (!email || !email.includes('@')) {
    return {
      decision: 'NO_CONTACT',
      eligible: false,
      reason: 'No valid email contact address provided for email channel',
    }
  }

  if (input.customer.permission_email === 'denied') {
    return {
      decision: 'EMAIL_PERMISSION_DENIED',
      eligible: false,
      reason: 'Customer explicitly denied email permission',
    }
  }

  if (input.customer.permission_email === 'unknown') {
    return {
      decision: 'EMAIL_PERMISSION_UNKNOWN',
      eligible: false,
      reason: 'Customer email permission is unconfirmed/unknown',
    }
  }

  if (input.isSuppressed) {
    return {
      decision: 'SUPPRESSED',
      eligible: false,
      reason: 'Customer contact address is on the organization suppression list',
    }
  }

  if (input.hasRecentRequestWithinWindow) {
    return {
      decision: 'RECENT_REQUEST',
      eligible: false,
      reason: 'Customer has received a review request within the cooldown window',
    }
  }

  if (!input.destination || input.destination.status !== 'CONFIRMED' || !input.destination.canonical_url) {
    return {
      decision: 'NO_REVIEW_DESTINATION',
      eligible: false,
      reason: 'No confirmed Google review destination URL configured for this location',
    }
  }

  if (input.isTrialLimitReached) {
    return {
      decision: 'TRIAL_LIMIT_REACHED',
      eligible: false,
      reason: 'Organization monthly/trial usage limit has been reached',
    }
  }

  return {
    decision: 'ELIGIBLE',
    eligible: true,
    reason: 'Customer is eligible for neutral review request',
  }
}

export * from './types'
