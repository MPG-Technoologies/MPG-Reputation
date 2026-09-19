import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TRIAL_REQUESTS,
  DEFAULT_TRIAL_DURATION_DAYS,
  ALLOW_REMINDERS_AFTER_EXPIRATION,
  deriveTrialLifecycle,
} from '../../src/domain/entitlement'

describe('MR-4 Trial Entitlement Policy Domain', () => {
  it('exposes standard hypothesis constants', () => {
    expect(DEFAULT_TRIAL_REQUESTS).toBe(30)
    expect(DEFAULT_TRIAL_DURATION_DAYS).toBe(30)
    expect(ALLOW_REMINDERS_AFTER_EXPIRATION).toBe(false)
  })

  describe('deriveTrialLifecycle', () => {
    it('returns TRIAL_NOT_PROVISIONED when entitlement is null or NOT_STARTED', () => {
      const fromNull = deriveTrialLifecycle(null)
      expect(fromNull.effectiveStatus).toBe('NOT_STARTED')
      expect(fromNull.remainingRequests).toBe(0)
      expect(fromNull.isEligibleForInitialRequest).toBe(false)
      expect(fromNull.isEligibleForReminder).toBe(false)
      expect(fromNull.reason).toBe('TRIAL_NOT_PROVISIONED')

      const fromNotStarted = deriveTrialLifecycle({
        status: 'NOT_STARTED',
        allocated_requests: 30,
        consumed_requests: 0,
        expires_at: null,
      })
      expect(fromNotStarted.effectiveStatus).toBe('NOT_STARTED')
      expect(fromNotStarted.isEligibleForInitialRequest).toBe(false)
      expect(fromNotStarted.reason).toBe('TRIAL_NOT_ACTIVE')
    })

    it('returns TRIAL_NOT_ACTIVE when status is SUSPENDED or ENDED', () => {
      const suspended = deriveTrialLifecycle({
        status: 'SUSPENDED',
        allocated_requests: 30,
        consumed_requests: 5,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      })
      expect(suspended.effectiveStatus).toBe('SUSPENDED')
      expect(suspended.remainingRequests).toBe(25)
      expect(suspended.isEligibleForInitialRequest).toBe(false)
      expect(suspended.isEligibleForReminder).toBe(false)
      expect(suspended.reason).toBe('TRIAL_NOT_ACTIVE')

      const ended = deriveTrialLifecycle({
        status: 'ENDED',
        allocated_requests: 30,
        consumed_requests: 30,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      })
      expect(ended.effectiveStatus).toBe('ENDED')
      expect(ended.isEligibleForInitialRequest).toBe(false)
      expect(ended.reason).toBe('TRIAL_NOT_ACTIVE')
    })

    it('identifies time expiration and denies initial request and reminders', () => {
      const past = new Date(Date.now() - 3600000).toISOString()
      const expired = deriveTrialLifecycle({
        status: 'ACTIVE',
        allocated_requests: 30,
        consumed_requests: 10,
        expires_at: past,
      })

      expect(expired.effectiveStatus).toBe('EXPIRED')
      expect(expired.remainingRequests).toBe(20)
      expect(expired.isEligibleForInitialRequest).toBe(false)
      expect(expired.isEligibleForReminder).toBe(ALLOW_REMINDERS_AFTER_EXPIRATION)
      expect(expired.reason).toBe('TRIAL_EXPIRED')
    })

    it('identifies exhausted request allowance when consumed >= allocated', () => {
      const exhausted = deriveTrialLifecycle({
        status: 'ACTIVE',
        allocated_requests: 30,
        consumed_requests: 30,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      })

      expect(exhausted.effectiveStatus).toBe('EXHAUSTED')
      expect(exhausted.remainingRequests).toBe(0)
      expect(exhausted.isEligibleForInitialRequest).toBe(false)
      // Existing review request reminder remains eligible even if allowance is exhausted
      expect(exhausted.isEligibleForReminder).toBe(true)
      expect(exhausted.reason).toBe('REQUEST_LIMIT_REACHED')
    })

    it('allows both initial requests and reminders when trial is active and within limits', () => {
      const future = new Date(Date.now() + 86400000 * 20).toISOString()
      const active = deriveTrialLifecycle({
        status: 'ACTIVE',
        allocated_requests: 30,
        consumed_requests: 12,
        expires_at: future,
      })

      expect(active.effectiveStatus).toBe('ACTIVE')
      expect(active.remainingRequests).toBe(18)
      expect(active.isEligibleForInitialRequest).toBe(true)
      expect(active.isEligibleForReminder).toBe(true)
      expect(active.reason).toBe('ENTITLEMENT_GRANTED')
    })
  })
})
