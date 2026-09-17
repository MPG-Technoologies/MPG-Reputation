import { describe, it, expect } from 'vitest'
import { evaluateReviewEligibility } from '../../src/domain/eligibility'
import type { EligibilityInput } from '../../src/domain/eligibility/types'

describe('evaluateReviewEligibility pure domain engine', () => {
  const baseInput: EligibilityInput = {
    organization: { id: 'org-1', status: 'ACTIVE' },
    location: { id: 'loc-1', status: 'ACTIVE' },
    customer: {
      id: 'cust-1',
      email: 'customer@example.test',
      permission_email: 'allowed',
    },
    destination: {
      id: 'dest-1',
      status: 'CONFIRMED',
      canonical_url: 'https://g.page/r/example/review',
    },
    isSuppressed: false,
    isDuplicateEvent: false,
    hasRecentRequestWithinWindow: false,
    isTrialLimitReached: false,
  }

  it('returns ELIGIBLE for compliant inputs', () => {
    const result = evaluateReviewEligibility(baseInput)
    expect(result.eligible).toBe(true)
    expect(result.decision).toBe('ELIGIBLE')
  })

  it('returns ORGANIZATION_INACTIVE when organization is not ACTIVE', () => {
    const result = evaluateReviewEligibility({
      ...baseInput,
      organization: { id: 'org-1', status: 'INACTIVE' },
    })
    expect(result.eligible).toBe(false)
    expect(result.decision).toBe('ORGANIZATION_INACTIVE')
  })

  it('returns LOCATION_INACTIVE when location is not ACTIVE', () => {
    const result = evaluateReviewEligibility({
      ...baseInput,
      location: { id: 'loc-1', status: 'INACTIVE' },
    })
    expect(result.eligible).toBe(false)
    expect(result.decision).toBe('LOCATION_INACTIVE')
  })

  it('returns DUPLICATE_EVENT when marked as duplicate', () => {
    const result = evaluateReviewEligibility({
      ...baseInput,
      isDuplicateEvent: true,
    })
    expect(result.eligible).toBe(false)
    expect(result.decision).toBe('DUPLICATE_EVENT')
  })

  it('returns NO_CONTACT when customer has no email', () => {
    const result = evaluateReviewEligibility({
      ...baseInput,
      customer: { ...baseInput.customer, email: null },
    })
    expect(result.eligible).toBe(false)
    expect(result.decision).toBe('NO_CONTACT')
  })

  it('returns NO_CONTACT when customer email is empty or invalid', () => {
    const result = evaluateReviewEligibility({
      ...baseInput,
      customer: { ...baseInput.customer, email: '   ' },
    })
    expect(result.eligible).toBe(false)
    expect(result.decision).toBe('NO_CONTACT')
  })

  it('returns EMAIL_PERMISSION_DENIED when permission is denied', () => {
    const result = evaluateReviewEligibility({
      ...baseInput,
      customer: { ...baseInput.customer, permission_email: 'denied' },
    })
    expect(result.eligible).toBe(false)
    expect(result.decision).toBe('EMAIL_PERMISSION_DENIED')
  })

  it('returns EMAIL_PERMISSION_UNKNOWN when permission is unknown', () => {
    const result = evaluateReviewEligibility({
      ...baseInput,
      customer: { ...baseInput.customer, permission_email: 'unknown' },
    })
    expect(result.eligible).toBe(false)
    expect(result.decision).toBe('EMAIL_PERMISSION_UNKNOWN')
  })

  it('returns SUPPRESSED when contact is suppressed', () => {
    const result = evaluateReviewEligibility({
      ...baseInput,
      isSuppressed: true,
    })
    expect(result.eligible).toBe(false)
    expect(result.decision).toBe('SUPPRESSED')
  })

  it('returns RECENT_REQUEST when cooldown window is active', () => {
    const result = evaluateReviewEligibility({
      ...baseInput,
      hasRecentRequestWithinWindow: true,
    })
    expect(result.eligible).toBe(false)
    expect(result.decision).toBe('RECENT_REQUEST')
  })

  it('returns NO_REVIEW_DESTINATION when destination is missing or unconfirmed', () => {
    const noDestResult = evaluateReviewEligibility({
      ...baseInput,
      destination: null,
    })
    expect(noDestResult.eligible).toBe(false)
    expect(noDestResult.decision).toBe('NO_REVIEW_DESTINATION')

    const unconfirmedResult = evaluateReviewEligibility({
      ...baseInput,
      destination: {
        id: 'dest-1',
        status: 'PENDING_CONFIRMATION',
        canonical_url: 'https://g.page/r/example/review',
      },
    })
    expect(unconfirmedResult.eligible).toBe(false)
    expect(unconfirmedResult.decision).toBe('NO_REVIEW_DESTINATION')
  })

  it('returns TRIAL_LIMIT_REACHED when limit flag is true', () => {
    const result = evaluateReviewEligibility({
      ...baseInput,
      isTrialLimitReached: true,
    })
    expect(result.eligible).toBe(false)
    expect(result.decision).toBe('TRIAL_LIMIT_REACHED')
  })
})
