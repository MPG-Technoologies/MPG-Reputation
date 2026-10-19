import 'server-only'

import { timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  dispatchStripeTestRecoveryBatch,
  type StripeTestRecoveryDispatchReport,
} from './stripe-test-recovery-dispatcher'
import type {
  StripeRecoveryEventRetriever,
  StripeRecoverySubscriptionRetriever,
} from './stripe-recovery-preflight'

export type StripeRecoveryOperatorStatus = 'HEALTHY' | 'ATTENTION' | 'MANUAL_REVIEW_REQUIRED'

export interface StripeRecoveryOperatorSignal {
  readonly status: StripeRecoveryOperatorStatus
  readonly manualReviewRequired: boolean
  readonly reasons: readonly (
    'EXHAUSTED_EVENTS' | 'AGED_OUT_EVENTS' | 'PROCESSING_ERRORS' |
    'FAILED_EVENTS' | 'RETRY_BACKLOG'
  )[]
}

/** Only aggregate numeric counts; never include provider IDs, contact data or token. */
export function deriveStripeRecoveryOperatorSignal(
  report: StripeTestRecoveryDispatchReport
): StripeRecoveryOperatorSignal {
  const reasons: StripeRecoveryOperatorSignal['reasons'][number][] = []
  const inventory = report.inventory
  if (inventory && inventory.exhausted > 0) reasons.push('EXHAUSTED_EVENTS')
  if (inventory && inventory.aged_out > 0) reasons.push('AGED_OUT_EVENTS')
  if (report.errors > 0) reasons.push('PROCESSING_ERRORS')
  if (report.failed > 0) reasons.push('FAILED_EVENTS')
  if (inventory && (inventory.ready > report.examined || inventory.cooldown > 0)) reasons.push('RETRY_BACKLOG')

  const manualReviewRequired = reasons.some(reason =>
    reason === 'EXHAUSTED_EVENTS' ||
    reason === 'AGED_OUT_EVENTS' ||
    reason === 'PROCESSING_ERRORS'
  )
  return {
    status: manualReviewRequired
      ? 'MANUAL_REVIEW_REQUIRED'
      : reasons.length > 0 ? 'ATTENTION' : 'HEALTHY',
    manualReviewRequired,
    reasons,
  }
}

export type StripeRecoveryOperatorResult =
  | { readonly outcome: 'DISABLED' | 'DENIED' }
  | {
      readonly outcome: 'COMPLETE'
      readonly dispatch: StripeTestRecoveryDispatchReport
      readonly signal: StripeRecoveryOperatorSignal
    }

const SHA256_TOKEN = /^[0-9a-f]{64}$/

/**
 * An intentional, synthetic-local-only operator contract, NOT an HTTP route.
 *
 * This prepares a testable trust boundary without granting operator access
 * to tenant OWNERS, public API callers, or production-hosted databases.
 * No client is constructed, no webhook route or scheduler is modified.
 *
 * Later hosted TEST activation needs separately approved environment/identity
 * and database scope, never just changing LOCAL_SYNTHETIC here.
 */
export async function runAuthorizedLocalStripeRecoveryOperation(args: {
  operatorToken: string
  supabase: SupabaseClient<Database>
  retrieveEvent: StripeRecoveryEventRetriever
  retrieveSubscription: StripeRecoverySubscriptionRetriever
  maxEvents?: number
}): Promise<StripeRecoveryOperatorResult> {
  // Fail closed before provider calls, privileged SQL or even queue inspection.
  if (process.env.ENABLE_STRIPE_TEST_RECOVERY_OPERATOR !== 'true' ||
      process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER !== 'true' ||
      process.env.MPG_STRIPE_RECOVERY_TARGET !== 'LOCAL_SYNTHETIC' ||
      process.env.NODE_ENV === 'production' ||
      process.env.VERCEL_ENV !== undefined ||
      process.env.ENABLE_LIVE_BILLING === 'true') {
    return { outcome: 'DISABLED' }
  }

  const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (databaseUrl !== 'http://127.0.0.1:54331' &&
      databaseUrl !== 'http://localhost:54331') {
    return { outcome: 'DISABLED' }
  }

  const expected = process.env.MPG_STRIPE_RECOVERY_OPERATOR_TOKEN
  // Require 32-byte random value encoded as hex. Same-sized constant-time
  // compare; no token, hash or raw proof ever returned/logged.
  if (!expected || !SHA256_TOKEN.test(expected)) {
    return { outcome: 'DISABLED' }
  }
  if (!SHA256_TOKEN.test(args.operatorToken) ||
      !timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(args.operatorToken, 'hex')
      )) {
    return { outcome: 'DENIED' }
  }

  const dispatch = await dispatchStripeTestRecoveryBatch({
    supabase: args.supabase,
    retrieveEvent: args.retrieveEvent,
    retrieveSubscription: args.retrieveSubscription,
    maxEvents: args.maxEvents,
  })

  if (dispatch.outcome !== 'COMPLETE') {
    // A missing or changed underlying dispatcher gate must fail closed.
    return { outcome: 'DISABLED' }
  }

  return {
    outcome: 'COMPLETE',
    dispatch,
    signal: deriveStripeRecoveryOperatorSignal(dispatch),
  }
}
