/**
 * MR-1C Reminder Policy & Timing Configuration
 * 
 * Timing values are explicit configuration and product hypotheses,
 * not permanent accepted business rules. They can be configured via environment
 * variables without rewriting workflow logic.
 * 
 * V1 Invariant: At most ONE reminder per review request. No multi-step campaign builder.
 */

export interface WorkflowTimingPolicy {
  initialDelay: string
  reminderDelay: string
  maxReminders: number
}

export const MAX_REMINDERS = 1

/**
 * Returns the active workflow timing policy.
 * - initialDelay: Cooldown delay after customer completion event before initial send (default '2s' in dev/tests, hypothesis '2h' in production).
 * - reminderDelay: Cooldown delay after initial send before reminder re-evaluation (default '3d' hypothesis in production, '2s' in tests).
 * - maxReminders: Hard limit of 1 reminder for V1.
 */
export function getWorkflowTimingPolicy(): WorkflowTimingPolicy {
  const initialDelay = process.env.WORKFLOW_INITIAL_DELAY || '2s'
  const reminderDelay = process.env.WORKFLOW_REMINDER_DELAY || '3d'

  return {
    initialDelay,
    reminderDelay,
    maxReminders: MAX_REMINDERS,
  }
}

/**
 * Evaluates whether a review request record is structurally eligible for a reminder.
 * A request is ineligible for a reminder if:
 * 1. It has already received a reminder (reminded_at is not null)
 * 2. It has reached CLICKED status or has clicked_at set
 * 3. It has been CANCELLED or SUPPRESSED
 * 4. It has not yet been sent (status is SCHEDULED, SENDING, or FAILED)
 */
export function isRequestEligibleForReminder(request: {
  status: string
  reminded_at?: string | null
  clicked_at?: string | null
  cancelled_at?: string | null
}): { eligible: boolean; reason?: 'ALREADY_REMINDED' | 'CLICKED' | 'CANCELLED' | 'SUPPRESSED' | 'NOT_DELIVERABLE' } {
  if (request.reminded_at) {
    return { eligible: false, reason: 'ALREADY_REMINDED' }
  }

  if (request.status === 'CLICKED' || request.clicked_at) {
    return { eligible: false, reason: 'CLICKED' }
  }

  if (request.status === 'CANCELLED' || request.cancelled_at) {
    return { eligible: false, reason: 'CANCELLED' }
  }

  if (request.status === 'SUPPRESSED') {
    return { eligible: false, reason: 'SUPPRESSED' }
  }

  // Must be in a delivered/sent state to qualify for a reminder
  if (!['SENT', 'DELIVERED'].includes(request.status)) {
    return { eligible: false, reason: 'NOT_DELIVERABLE' }
  }

  return { eligible: true }
}
