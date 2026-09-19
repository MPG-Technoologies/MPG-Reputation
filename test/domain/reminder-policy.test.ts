import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getWorkflowTimingPolicy,
  isRequestEligibleForReminder,
  MAX_REMINDERS,
} from '../../src/domain/reminder'

describe('MR-1C Reminder Policy & Timing Architecture', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.WORKFLOW_INITIAL_DELAY
    delete process.env.WORKFLOW_REMINDER_DELAY
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('enforces maximum reminders bound of strictly 1 for V1', () => {
    expect(MAX_REMINDERS).toBe(1)
    const policy = getWorkflowTimingPolicy()
    expect(policy.maxReminders).toBe(1)
  })

  it('uses default hypothesis timing values when environment variables are unset', () => {
    const policy = getWorkflowTimingPolicy()
    expect(policy.initialDelay).toBe('2s')
    expect(policy.reminderDelay).toBe('3d')
  })

  it('respects environment overrides for initial and reminder delays', () => {
    process.env.WORKFLOW_INITIAL_DELAY = '10m'
    process.env.WORKFLOW_REMINDER_DELAY = '48h'

    const policy = getWorkflowTimingPolicy()
    expect(policy.initialDelay).toBe('10m')
    expect(policy.reminderDelay).toBe('48h')
  })

  describe('isRequestEligibleForReminder', () => {
    it('approves requests in SENT status without reminders or clicks', () => {
      const res = isRequestEligibleForReminder({
        status: 'SENT',
        reminded_at: null,
        clicked_at: null,
      })
      expect(res.eligible).toBe(true)
      expect(res.reason).toBeUndefined()
    })

    it('approves requests in DELIVERED status without reminders or clicks', () => {
      const res = isRequestEligibleForReminder({
        status: 'DELIVERED',
        reminded_at: null,
        clicked_at: null,
      })
      expect(res.eligible).toBe(true)
    })

    it('rejects requests that have already been reminded', () => {
      const res = isRequestEligibleForReminder({
        status: 'SENT',
        reminded_at: '2026-09-19T10:00:00Z',
        clicked_at: null,
      })
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('ALREADY_REMINDED')
    })

    it('rejects requests in CLICKED status', () => {
      const res = isRequestEligibleForReminder({
        status: 'CLICKED',
        reminded_at: null,
        clicked_at: '2026-09-19T10:00:00Z',
      })
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('CLICKED')
    })

    it('rejects requests where clicked_at is set even if status is not CLICKED', () => {
      const res = isRequestEligibleForReminder({
        status: 'DELIVERED',
        reminded_at: null,
        clicked_at: '2026-09-19T10:00:00Z',
      })
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('CLICKED')
    })

    it('rejects requests in CANCELLED status', () => {
      const res = isRequestEligibleForReminder({
        status: 'CANCELLED',
        reminded_at: null,
        clicked_at: null,
      })
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('CANCELLED')
    })

    it('rejects requests in SUPPRESSED status', () => {
      const res = isRequestEligibleForReminder({
        status: 'SUPPRESSED',
        reminded_at: null,
        clicked_at: null,
      })
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('SUPPRESSED')
    })

    it('rejects requests not yet in a delivered/sent state (SCHEDULED, SENDING, FAILED)', () => {
      expect(isRequestEligibleForReminder({ status: 'SCHEDULED', reminded_at: null }).eligible).toBe(false)
      expect(isRequestEligibleForReminder({ status: 'SENDING', reminded_at: null }).eligible).toBe(false)
      expect(isRequestEligibleForReminder({ status: 'FAILED', reminded_at: null }).eligible).toBe(false)
    })
  })
})
