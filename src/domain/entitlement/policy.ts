/**
 * Trial and Usage Entitlement Policy (MR-4)
 *
 * Provides server-authoritative entitlement lifecycle rules,
 * validation hypothesis defaults, and reminder boundary policies.
 */

export const DEFAULT_TRIAL_REQUESTS = 30
export const DEFAULT_TRIAL_DURATION_DAYS = 30

/**
 * Working product policy for reminders after trial expiration.
 * Strictly enforced: if an organization's trial expires while a reminder
 * is pending, the pre-reminder check halts cleanly without dispatching.
 */
export const ALLOW_REMINDERS_AFTER_EXPIRATION = false

export type TrialStatus =
  | 'NOT_STARTED'
  | 'ACTIVE'
  | 'EXHAUSTED'
  | 'EXPIRED'
  | 'ENDED'
  | 'SUSPENDED'

export type EntitlementConsumptionReason =
  | 'ENTITLEMENT_GRANTED'
  | 'ENTITLEMENT_ALREADY_CONSUMED'
  | 'TRIAL_NOT_PROVISIONED'
  | 'TRIAL_NOT_ACTIVE'
  | 'TRIAL_EXPIRED'
  | 'REQUEST_LIMIT_REACHED'

export interface EntitlementConsumptionResult {
  allowed: boolean
  reason: EntitlementConsumptionReason
  already_consumed?: boolean
  consumed?: number
  remaining?: number
}

export interface EntitlementState {
  status: TrialStatus
  allocated_requests: number
  consumed_requests: number
  expires_at: string | null
}

export interface DerivedLifecycle {
  effectiveStatus: TrialStatus
  remainingRequests: number
  isEligibleForInitialRequest: boolean
  isEligibleForReminder: boolean
  reason?: EntitlementConsumptionReason
}

/**
 * Evaluates the authoritative entitlement state against current time.
 */
export function deriveTrialLifecycle(
  entitlement: EntitlementState | null | undefined,
  now: Date = new Date()
): DerivedLifecycle {
  if (!entitlement) {
    return {
      effectiveStatus: 'NOT_STARTED',
      remainingRequests: 0,
      isEligibleForInitialRequest: false,
      isEligibleForReminder: false,
      reason: 'TRIAL_NOT_PROVISIONED',
    }
  }

  if (entitlement.status === 'NOT_STARTED') {
    const remaining = Math.max(0, entitlement.allocated_requests - entitlement.consumed_requests)
    return {
      effectiveStatus: 'NOT_STARTED',
      remainingRequests: remaining,
      isEligibleForInitialRequest: false,
      isEligibleForReminder: false,
      reason: 'TRIAL_NOT_ACTIVE',
    }
  }

  const remaining = Math.max(0, entitlement.allocated_requests - entitlement.consumed_requests)

  if (entitlement.status === 'SUSPENDED' || entitlement.status === 'ENDED') {
    return {
      effectiveStatus: entitlement.status,
      remainingRequests: remaining,
      isEligibleForInitialRequest: false,
      isEligibleForReminder: false,
      reason: 'TRIAL_NOT_ACTIVE',
    }
  }

  // Check expiration by time
  if (entitlement.expires_at && new Date(entitlement.expires_at) <= now) {
    return {
      effectiveStatus: 'EXPIRED',
      remainingRequests: remaining,
      isEligibleForInitialRequest: false,
      isEligibleForReminder: ALLOW_REMINDERS_AFTER_EXPIRATION,
      reason: 'TRIAL_EXPIRED',
    }
  }

  // Check limit exhaustion
  if (entitlement.consumed_requests >= entitlement.allocated_requests) {
    return {
      effectiveStatus: 'EXHAUSTED',
      remainingRequests: 0,
      isEligibleForInitialRequest: false,
      // Reminders are for review requests that already claimed entitlement
      isEligibleForReminder: true,
      reason: 'REQUEST_LIMIT_REACHED',
    }
  }

  return {
    effectiveStatus: 'ACTIVE',
    remainingRequests: remaining,
    isEligibleForInitialRequest: true,
    isEligibleForReminder: true,
    reason: 'ENTITLEMENT_GRANTED',
  }
}
