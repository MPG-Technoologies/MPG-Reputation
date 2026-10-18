import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import {
  prepareRecoveredStripeSubscription,
  type StripeRecoveryEventRetriever,
  type StripeRecoverySubscriptionRetriever,
} from './stripe-recovery-preflight'

/**
 * An explicitly invoked TEST-only worker for one previously verified durable
 * Stripe Event. It is deliberately not attached to the HTTP webhook, a user
 * route, cron scheduler, customer action, or production billing.
 *
 * Reconciliation critical section:
 * event lease -> retrieved event -> subscription mutex -> retrieve CURRENT
 * Stripe subscription -> tenant validation -> SQL-fenced atomic commit+finalize.
 * The mutex must be acquired BEFORE the current provider-state fetch.
 */
export type StripeReconciliationWorkerResult =
  | { outcome: 'NO_WORK' | 'LOST_LEASE' | 'RETRY_REQUIRED' }
  | { outcome: 'IGNORED' }
  | { outcome: 'COMMITTED'; projectionOutcome: 'CREATED' | 'UPDATED' | 'UNCHANGED' }
  | { outcome: 'FAILED'; errorCode: 'PROVIDER_UNAVAILABLE' | 'UNRESOLVED_CUSTOMER' |
       'INVALID_PROVIDER_DATA' | 'CORRELATION_FAILED' | 'PROCESSING_FAILED' }

function asObject(value: Json | null): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('BILLING_WORKER_DB_RESPONSE_INVALID')
  }
  return value as Record<string, unknown>
}

async function call(
  fn: () => PromiseLike<{ data: Json | null; error: unknown }>
): Promise<Record<string, unknown>> {
  const { data, error } = await fn()
  if (error) throw new Error('BILLING_WORKER_DB_OPERATION_FAILED')
  return asObject(data)
}

export async function processDurableStripeTestEvent(args: {
  supabase: SupabaseClient<Database>
  eventRecordId: string
  retrieveEvent: StripeRecoveryEventRetriever
  retrieveSubscription: StripeRecoverySubscriptionRetriever
}): Promise<StripeReconciliationWorkerResult> {
  const { supabase, eventRecordId, retrieveEvent, retrieveSubscription } = args

  const lease = await call(() => supabase.rpc('lease_stripe_webhook_processing', {
    p_event_id: eventRecordId,
  }))
  if (lease.outcome === 'NO_WORK') return { outcome: 'NO_WORK' }
  if (lease.outcome !== 'LEASED' || typeof lease.lease_token !== 'string' ||
      lease.environment !== 'TEST' || lease.event_id !== eventRecordId) {
    throw new Error('BILLING_WORKER_LEASE_INVALID')
  }
  const eventToken = lease.lease_token
  const subscriptionLockRef: { current: { id: string; token: string } | null } = { current: null }
  let mutexBusy = false

  async function finish(status: 'FAILED' | 'IGNORED', errorCode?: string) {
    const finalized = await call(() => supabase.rpc('complete_stripe_webhook_processing', {
      p_event_id: eventRecordId,
      p_lease_token: eventToken,
      p_status: status,
      p_organization_id: null,
      p_error_code: errorCode ?? null,
    }))
    return finalized.outcome === 'FINALIZED'
  }

  try {
    let preflight
    try {
      preflight = await prepareRecoveredStripeSubscription({
        supabase, eventRecordId, leaseToken: eventToken, retrieveEvent,
        retrieveSubscription: async (subscriptionId) => {
          // This closure is invoked AFTER Stripe Event identity is validated
          // but BEFORE current provider Subscription state is retrieved.
          const locked = await call(() => supabase.rpc(
            'lease_stripe_subscription_reconciliation', {
              p_event_id: eventRecordId,
              p_event_lease_token: eventToken,
              p_subscription_id: subscriptionId,
            }
          ))
          if (locked.outcome === 'BUSY') {
            mutexBusy = true
            throw new Error('BILLING_RECONCILIATION_BUSY')
          }
          if (locked.outcome !== 'LEASED' ||
              typeof locked.lease_token !== 'string' ||
              locked.subscription_id !== subscriptionId) {
            throw new Error('BILLING_RECONCILIATION_LEASE_FAILED')
          }
          subscriptionLockRef.current = { id: subscriptionId, token: locked.lease_token }
          return retrieveSubscription(subscriptionId)
        },
      })
    } catch {
      // DB errors, interrupted requests and other unexpected failures must not
      // turn into processed events; the existing 5-attempt recovery remains.
      const finalized = await finish('FAILED', 'PROCESSING_FAILED')
      return finalized
        ? { outcome: 'FAILED', errorCode: 'PROCESSING_FAILED' }
        : { outcome: 'LOST_LEASE' }
    }

    if (mutexBusy) {
      // A different, unexpired worker owns this subscription. Do not perform
      // provider reads and never write the snapshot of another worker.
      const finalized = await finish('FAILED', 'PROCESSING_FAILED')
      return finalized
        ? { outcome: 'RETRY_REQUIRED' }
        : { outcome: 'LOST_LEASE' }
    }
    if (preflight.outcome === 'NOT_LEASE_HOLDER') return { outcome: 'LOST_LEASE' }
    if (preflight.outcome === 'FAILED') {
      const finalized = await finish('FAILED', preflight.errorCode)
      return finalized
        ? { outcome: 'FAILED', errorCode: preflight.errorCode }
        : { outcome: 'LOST_LEASE' }
    }
    if (preflight.outcome === 'IGNORED') {
      const finalized = await finish('IGNORED')
      return finalized ? { outcome: 'IGNORED' } : { outcome: 'LOST_LEASE' }
    }

    if (!subscriptionLockRef.current ||
        preflight.candidate.providerSubscriptionId !== subscriptionLockRef.current.id ||
        preflight.candidate.environment !== 'TEST') {
      const finalized = await finish('FAILED', 'INVALID_PROVIDER_DATA')
      return finalized
        ? { outcome: 'FAILED', errorCode: 'INVALID_PROVIDER_DATA' }
        : { outcome: 'LOST_LEASE' }
    }

    const candidate = preflight.candidate
    const committed = await call(() => supabase.rpc(
      'commit_stripe_subscription_reconciliation', {
        p_event_id: eventRecordId,
        p_event_lease_token: eventToken,
        p_subscription_lease_token: subscriptionLockRef.current!.token,
        p_org_id: candidate.organizationId,
        p_billing_account_id: candidate.billingAccountId,
        p_provider_customer_id: preflight.providerCustomerId,
        p_environment: candidate.environment,
        p_provider_subscription_id: candidate.providerSubscriptionId,
        p_provider_price_id: candidate.providerPriceId,
        p_provider_status: candidate.providerStatus,
        p_normalized_status: candidate.normalizedStatus,
        p_current_period_start: candidate.currentPeriodStart,
        p_current_period_end: candidate.currentPeriodEnd,
        p_cancel_at_period_end: candidate.cancelAtPeriodEnd,
        p_canceled_at: candidate.canceledAt,
      }
    ))
    if (committed.outcome === 'COMMITTED' &&
        (committed.projection_outcome === 'CREATED' ||
         committed.projection_outcome === 'UPDATED' ||
         committed.projection_outcome === 'UNCHANGED')) {
      return { outcome: 'COMMITTED', projectionOutcome: committed.projection_outcome }
    }
    if (committed.outcome === 'NOT_LEASE_HOLDER') return { outcome: 'LOST_LEASE' }

    const finalized = await finish('FAILED', 'PROCESSING_FAILED')
    return finalized
      ? { outcome: 'FAILED', errorCode: 'PROCESSING_FAILED' }
      : { outcome: 'LOST_LEASE' }
  } finally {
    if (subscriptionLockRef.current) {
      // SQL success already released the lock. For provider failures, release
      // only if this fencing token still owns it. Never mask primary failures
      // with cleanup errors; an unreleased slot self-expires within 120s.
      try {
        await supabase.rpc('release_stripe_subscription_reconciliation', {
          p_subscription_id: subscriptionLockRef.current.id,
          p_lease_token: subscriptionLockRef.current.token,
        })
      } catch {
        // Token fencing and TTL supply the recovery path.
      }
    }
  }
}
