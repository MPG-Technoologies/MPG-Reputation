import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  isPrivacyRestoreDeltaV1,
  verifyRestoredPrivacyState,
  DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE,
  type RestorePrivacyVerificationResult,
  type RestoreDecision,
} from './restore-verification'

export interface PrivacyRestoreReplayResult {
  ok: boolean
  decision: RestoreDecision
  schemaVersion: '1.0'
  erasuresRequested: number
  erasuresReplayed: number
  suppressionsRequested: number
  suppressionsInserted: number
  verification: RestorePrivacyVerificationResult
  reason:
    | 'ALL_REPLAYED_AND_VERIFIED'
    | 'INVALID_DELTA_SCHEMA'
    | 'REPLAY_MUTATION_FAILED'
    | 'VERIFICATION_FAILED'
    | 'DATABASE_ERROR'
  error?: string
}

/**
 * Reapplies post-backup privacy states (customer erasure tombstones and suppressions)
 * to an isolated restored database from an authoritative PrivacyRestoreDeltaV1 (Case A).
 *
 * Invariants:
 * 1. Delta Schema: Validated strictly before ANY mutation. Non-conforming schema fails closed
 *    with BLOCK_RESTORE_ACTIVATION and executes zero writes.
 * 2. Smallest Safe Unit: Each erasure replay unit is executed through the dedicated
 *    atomic maintenance RPC `replay_customer_erasure_maintenance`, ensuring each customer's
 *    tombstone, certificate, completion redactions, and error scrubs succeed or roll back atomically.
 * 3. Idempotency: Repeating replay with an identical delta is fully idempotent. Existing
 *    certificates and suppressions are not duplicated, truthful chronology is preserved, and
 *    no redundant new audit records are created.
 * 4. Resumability & Partial Failure: A failure on any record halts mutation and fails closed.
 *    Subsequent runs safely resume and reconcile the remaining records.
 * 5. Mandatory Verification Gate: Calls accepted C5C1 `verifyRestoredPrivacyState()` immediately
 *    after replay. Replay success alone is never sufficient; only a clean verifier PASS
 *    can yield PASS. Any failure produces BLOCK_RESTORE_ACTIVATION.
 * 6. Non-PII Result Contract: Returns minimized operational counters only. Never includes or logs
 *    raw names, emails, phones, suppression hashes, provider payloads, or credentials.
 * 7. Server-Only & Maintenance-Only: Explicitly privileged DR maintenance code; unreachable from
 *    ordinary public, client, tenant, or automated application routes.
 */
export async function replayPrivacyRestoreDelta({
  supabase,
  delta,
  pageSize = DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE,
}: {
  supabase: SupabaseClient<Database>
  delta: unknown
  pageSize?: number
}): Promise<PrivacyRestoreReplayResult> {
  // 1. Strict schema validation before any mutation
  if (!isPrivacyRestoreDeltaV1(delta)) {
    return {
      ok: false,
      decision: 'BLOCK_RESTORE_ACTIVATION',
      schemaVersion: '1.0',
      erasuresRequested: 0,
      erasuresReplayed: 0,
      suppressionsRequested: 0,
      suppressionsInserted: 0,
      verification: {
        ok: false,
        decision: 'BLOCK_RESTORE_ACTIVATION',
        schemaVersion: '1.0',
        erasureRecordsChecked: 0,
        suppressionRecordsChecked: 0,
        missingErasureProtections: 0,
        missingSuppressions: 0,
        reason: 'INVALID_DELTA_SCHEMA',
      },
      reason: 'INVALID_DELTA_SCHEMA',
    }
  }

  const erasuresRequested = delta.erasures.length
  let erasuresReplayed = 0
  const suppressionsRequested = delta.suppressions.length
  let suppressionsInserted = 0

  let replayFailed = false
  let failureReason: 'REPLAY_MUTATION_FAILED' | 'DATABASE_ERROR' = 'REPLAY_MUTATION_FAILED'
  let replayErrorMsg: string | undefined

  // 2. Replay customer erasures (atomic per-customer maintenance RPC)
  for (const erasure of delta.erasures) {
    try {
      const { error } = await supabase.rpc(
        'replay_customer_erasure_maintenance',
        {
          p_org_id: erasure.organizationId,
          p_customer_id: erasure.customerId,
          p_erased_at: erasure.erasedAt,
        }
      )

      if (error) {
        replayFailed = true
        replayErrorMsg = error.message
        break
      }

      erasuresReplayed++
    } catch (err) {
      replayFailed = true
      replayErrorMsg = err instanceof Error ? err.message : 'UNEXPECTED_ERROR'
      failureReason = 'DATABASE_ERROR'
      break
    }
  }

  // 3. Replay suppressions (only if erasures didn't encounter failure)
  if (!replayFailed) {
    for (const suppression of delta.suppressions) {
      try {
        const { data, error } = await supabase.rpc(
          'replay_suppression_maintenance',
          {
            p_org_id: suppression.organizationId,
            p_channel: suppression.channel,
            p_contact_hash: suppression.contactHash,
            p_reason: suppression.reason,
            p_created_at: suppression.createdAt,
          }
        )

        if (error) {
          replayFailed = true
          replayErrorMsg = error.message
          break
        }

        const res = data as { inserted?: boolean } | null
        if (res?.inserted) {
          suppressionsInserted++
        }
      } catch (err) {
        replayFailed = true
        replayErrorMsg = err instanceof Error ? err.message : 'UNEXPECTED_ERROR'
        failureReason = 'DATABASE_ERROR'
        break
      }
    }
  }

  // 4. Mandatory Post-Replay C5C1 Verification
  let verification: RestorePrivacyVerificationResult
  try {
    verification = await verifyRestoredPrivacyState({
      supabase,
      delta,
      pageSize,
    })
  } catch {
    verification = {
      ok: false,
      decision: 'BLOCK_RESTORE_ACTIVATION',
      schemaVersion: '1.0',
      erasureRecordsChecked: 0,
      suppressionRecordsChecked: 0,
      missingErasureProtections: delta.erasures.length - erasuresReplayed,
      missingSuppressions: delta.suppressions.length,
      reason: 'DATABASE_ERROR',
    }
  }

  // If replay mutations failed, overall gate MUST fail closed to BLOCK_RESTORE_ACTIVATION
  if (replayFailed) {
    return {
      ok: false,
      decision: 'BLOCK_RESTORE_ACTIVATION',
      schemaVersion: '1.0',
      erasuresRequested,
      erasuresReplayed,
      suppressionsRequested,
      suppressionsInserted,
      verification,
      reason: failureReason,
      error: replayErrorMsg,
    }
  }

  // Verify that C5C1 verification passed cleanly
  if (!verification.ok || verification.decision !== 'PASS') {
    return {
      ok: false,
      decision: 'BLOCK_RESTORE_ACTIVATION',
      schemaVersion: '1.0',
      erasuresRequested,
      erasuresReplayed,
      suppressionsRequested,
      suppressionsInserted,
      verification,
      reason: 'VERIFICATION_FAILED',
    }
  }

  return {
    ok: true,
    decision: 'PASS',
    schemaVersion: '1.0',
    erasuresRequested,
    erasuresReplayed,
    suppressionsRequested,
    suppressionsInserted,
    verification,
    reason: 'ALL_REPLAYED_AND_VERIFIED',
  }
}
