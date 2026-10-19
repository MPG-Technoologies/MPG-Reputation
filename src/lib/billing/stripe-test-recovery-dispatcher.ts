import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import {
  processDurableStripeTestEvent,
} from './stripe-test-reconciliation-worker'
import type {
  StripeRecoveryEventRetriever,
  StripeRecoverySubscriptionRetriever,
} from './stripe-recovery-preflight'

type RecoveryQueueCounts = {
  readonly ready: number
  readonly cooldown: number
  readonly in_flight: number
  readonly exhausted: number
  readonly aged_out: number
}

export type StripeTestRecoveryDispatchReport = {
  readonly outcome: 'DISABLED' | 'COMPLETE'
  readonly examined: number
  readonly committed: number
  readonly ignored: number
  readonly failed: number
  readonly deferred: number
  readonly lostLease: number
  readonly errors: number
  readonly inventory: RecoveryQueueCounts | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COUNT_KEYS = ['ready', 'cooldown', 'in_flight', 'exhausted', 'aged_out'] as const

function parseQueue(raw: Json | null): { eventIds: string[]; counts: RecoveryQueueCounts } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      raw.outcome !== 'READY' || !Array.isArray(raw.event_ids) ||
      !raw.summary || typeof raw.summary !== 'object' || Array.isArray(raw.summary)) {
    throw new Error('BILLING_RECOVERY_INVENTORY_INVALID')
  }

  const ids = raw.event_ids
  if (ids.length > 10 || !ids.every(id => typeof id === 'string' && UUID.test(id)) ||
      new Set(ids).size !== ids.length) {
    throw new Error('BILLING_RECOVERY_INVENTORY_INVALID')
  }
  const counts = raw.summary
  if (!COUNT_KEYS.every(key => Number.isSafeInteger(counts[key]) &&
      typeof counts[key] === 'number' && counts[key] >= 0)) {
    throw new Error('BILLING_RECOVERY_INVENTORY_INVALID')
  }
  return {
    eventIds: ids as string[],
    counts: counts as RecoveryQueueCounts,
  }
}

/**
 * Manually callable, TEST-only, service-role-injected recovery batch.
 *
 * The SQL selector NEVER leases or mutates rows, and the prior worker's
 * service-role-only atomic claim/fencing remains the only processing gate.
 * Dispatch is intentionally not scheduled/exposed through HTTP. Every
 * invocation requires an explicit server-only flag; no implicit activation.
 */
export async function dispatchStripeTestRecoveryBatch(args: {
  supabase: SupabaseClient<Database>
  retrieveEvent: StripeRecoveryEventRetriever
  retrieveSubscription: StripeRecoverySubscriptionRetriever
  maxEvents?: number
}): Promise<StripeTestRecoveryDispatchReport> {
  const empty = {
    examined: 0, committed: 0, ignored: 0, failed: 0,
    deferred: 0, lostLease: 0, errors: 0, inventory: null,
  } as const

  if (process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER !== 'true') {
    return { outcome: 'DISABLED', ...empty }
  }

  const limit = args.maxEvents ?? 5
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) {
    throw new Error('BILLING_RECOVERY_BATCH_LIMIT_INVALID')
  }

  const { data, error } = await args.supabase.rpc(
    'inspect_stripe_test_webhook_recovery', { p_limit: limit }
  )
  if (error) throw new Error('BILLING_RECOVERY_INVENTORY_READ_FAILED')
  const { eventIds, counts } = parseQueue(data)

  const progress = {
    examined: 0, committed: 0, ignored: 0,
    failed: 0, deferred: 0, lostLease: 0, errors: 0,
  }
  // Bounded sequential processing avoids turning one TEST worker into a
  // parallel Stripe API storm; the SQL claim protects against overlapping
  // dispatcher instances, and the subscription mutex guards cross-event order.
  for (const eventRecordId of eventIds) {
    progress.examined++
    try {
      const value = await processDurableStripeTestEvent({
        supabase: args.supabase,
        eventRecordId,
        retrieveEvent: args.retrieveEvent,
        retrieveSubscription: args.retrieveSubscription,
      })
      switch (value.outcome) {
        case 'COMMITTED': progress.committed++; break
        case 'IGNORED': progress.ignored++; break
        case 'FAILED': progress.failed++; break
        case 'RETRY_REQUIRED': progress.deferred++; break
        case 'LOST_LEASE':
        case 'NO_WORK': progress.lostLease++; break
      }
    } catch {
      // Worker lease expires naturally on abnormal failure. No raw provider
      // error or customer identifier is logged/returned.
      progress.errors++
    }
  }

  return { outcome: 'COMPLETE', ...progress, inventory: counts }
}
