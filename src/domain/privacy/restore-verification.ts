import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME } from './customer-erasure'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PrivacyRestoreErasureEvidence {
  organizationId: string
  customerId: string
  erasedAt: string
}

export interface PrivacyRestoreSuppressionEvidence {
  organizationId: string
  channel: string
  contactHash: string
  reason: string
  createdAt: string
}

export interface PrivacyRestoreDeltaV1 {
  schemaVersion: '1.0'
  backupCreatedAt: string
  exportedAt: string
  erasures: PrivacyRestoreErasureEvidence[]
  suppressions: PrivacyRestoreSuppressionEvidence[]
}

export type RestoreDecision = 'PASS' | 'BLOCK_RESTORE_ACTIVATION'

export interface RestorePrivacyVerificationResult {
  ok: boolean
  decision: RestoreDecision
  schemaVersion: '1.0'
  erasureRecordsChecked: number
  suppressionRecordsChecked: number
  missingErasureProtections: number
  missingSuppressions: number
  reason?: 'ALL_VERIFIED' | 'INVALID_DELTA_SCHEMA' | 'DATABASE_ERROR' | 'UNRECONCILED_PRIVACY_DELTA'
}

export type CollectPrivacyRestoreDeltaResult =
  | {
      ok: true
      status: 'COLLECTED'
      delta: PrivacyRestoreDeltaV1
    }
  | {
      ok: false
      status: 'INVALID_TIMESTAMP' | 'UNAVAILABLE'
      error: string
    }

/**
 * Validates that an object conforms strictly to the PrivacyRestoreDeltaV1 contract.
 * Ensures zero forbidden PII or credential fields exist on the payload.
 */
export function isPrivacyRestoreDeltaV1(delta: unknown): delta is PrivacyRestoreDeltaV1 {
  if (!delta || typeof delta !== 'object') {
    return false
  }

  const d = delta as Record<string, unknown>

  if (d.schemaVersion !== '1.0') {
    return false
  }

  if (typeof d.backupCreatedAt !== 'string' || isNaN(Date.parse(d.backupCreatedAt))) {
    return false
  }

  if (typeof d.exportedAt !== 'string' || isNaN(Date.parse(d.exportedAt))) {
    return false
  }

  if (!Array.isArray(d.erasures) || !Array.isArray(d.suppressions)) {
    return false
  }

  // Ensure forbidden payload / PII keys are absent
  const forbiddenTopLevelKeys = [
    'email',
    'phone',
    'name',
    'first_name',
    'last_name',
    'firstName',
    'lastName',
    'token',
    'secret',
    'key',
    'password',
    'apiKey',
    'credentials',
  ]
  for (const k of forbiddenTopLevelKeys) {
    if (k in d) {
      return false
    }
  }

  for (const e of d.erasures) {
    if (!e || typeof e !== 'object') {
      return false
    }
    const item = e as Record<string, unknown>
    if (typeof item.organizationId !== 'string' || !UUID_REGEX.test(item.organizationId)) {
      return false
    }
    if (typeof item.customerId !== 'string' || !UUID_REGEX.test(item.customerId)) {
      return false
    }
    if (typeof item.erasedAt !== 'string' || isNaN(Date.parse(item.erasedAt))) {
      return false
    }

    // Zero PII on erasure evidence
    if (
      'first_name' in item ||
      'last_name' in item ||
      'email' in item ||
      'phone' in item ||
      'contact' in item
    ) {
      return false
    }
  }

  for (const s of d.suppressions) {
    if (!s || typeof s !== 'object') {
      return false
    }
    const item = s as Record<string, unknown>
    if (typeof item.organizationId !== 'string' || !UUID_REGEX.test(item.organizationId)) {
      return false
    }
    if (typeof item.channel !== 'string' || (item.channel !== 'email' && item.channel !== 'sms')) {
      return false
    }
    if (typeof item.contactHash !== 'string' || item.contactHash.length === 0) {
      return false
    }
    if (typeof item.reason !== 'string' || item.reason.length === 0) {
      return false
    }
    if (typeof item.createdAt !== 'string' || isNaN(Date.parse(item.createdAt))) {
      return false
    }

    // Zero PII on suppression evidence
    if ('email' in item || 'phone' in item || 'name' in item || 'contact' in item) {
      return false
    }
  }

  return true
}

/**
 * Serializes a validated PrivacyRestoreDeltaV1 to formatted JSON.
 */
export function serializePrivacyRestoreDelta(delta: PrivacyRestoreDeltaV1): string {
  if (!isPrivacyRestoreDeltaV1(delta)) {
    throw new Error('Cannot serialize invalid PrivacyRestoreDeltaV1')
  }
  return JSON.stringify(delta, null, 2)
}

/**
 * Deserializes and validates a PrivacyRestoreDeltaV1 JSON string.
 */
export function deserializePrivacyRestoreDelta(raw: string): PrivacyRestoreDeltaV1 | null {
  try {
    const parsed = JSON.parse(raw)
    if (isPrivacyRestoreDeltaV1(parsed)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/**
 * Collects post-backup privacy deltas created strictly AFTER backupCreatedAt.
 * Field allowlists strictly omit raw PII, provider payloads, and arbitrary metadata.
 */
export async function collectPrivacyRestoreDelta({
  supabase,
  backupCreatedAt,
  exportedAt,
}: {
  supabase: SupabaseClient<Database>
  backupCreatedAt: string | Date
  exportedAt?: string | Date
}): Promise<CollectPrivacyRestoreDeltaResult> {
  // Validate backupCreatedAt
  if (
    !backupCreatedAt ||
    (typeof backupCreatedAt !== 'string' && !(backupCreatedAt instanceof Date))
  ) {
    return {
      ok: false,
      status: 'INVALID_TIMESTAMP',
      error: 'Invalid backupCreatedAt parameter: non-empty string or Date required',
    }
  }

  const backupDate = new Date(backupCreatedAt)
  if (isNaN(backupDate.getTime())) {
    return {
      ok: false,
      status: 'INVALID_TIMESTAMP',
      error: 'Invalid backupCreatedAt parameter: cannot parse to valid timestamp',
    }
  }

  const backupCreatedAtIso = backupDate.toISOString()

  let exportedAtIso: string
  if (exportedAt) {
    const expDate = new Date(exportedAt)
    if (isNaN(expDate.getTime())) {
      return {
        ok: false,
        status: 'INVALID_TIMESTAMP',
        error: 'Invalid exportedAt parameter: cannot parse to valid timestamp',
      }
    }
    exportedAtIso = expDate.toISOString()
  } else {
    exportedAtIso = new Date().toISOString()
  }

  // 1. Collect customer_erasure_records created strictly AFTER backupCreatedAt
  const { data: erasures, error: erasuresError } = await supabase
    .from('customer_erasure_records')
    .select('organization_id, customer_id, erased_at')
    .gt('erased_at', backupCreatedAtIso)
    .order('erased_at', { ascending: true })
    .order('organization_id', { ascending: true })
    .order('customer_id', { ascending: true })

  if (erasuresError) {
    return {
      ok: false,
      status: 'UNAVAILABLE',
      error: 'DATABASE_READ_ERROR',
    }
  }

  // 2. Collect suppressions created strictly AFTER backupCreatedAt
  const { data: suppressions, error: suppressionsError } = await supabase
    .from('suppressions')
    .select('organization_id, channel, contact_hash, reason, created_at')
    .gt('created_at', backupCreatedAtIso)
    .order('created_at', { ascending: true })
    .order('organization_id', { ascending: true })
    .order('channel', { ascending: true })
    .order('contact_hash', { ascending: true })

  if (suppressionsError) {
    return {
      ok: false,
      status: 'UNAVAILABLE',
      error: 'DATABASE_READ_ERROR',
    }
  }

  const delta: PrivacyRestoreDeltaV1 = {
    schemaVersion: '1.0',
    backupCreatedAt: backupCreatedAtIso,
    exportedAt: exportedAtIso,
    erasures: (erasures || []).map((r) => ({
      organizationId: r.organization_id,
      customerId: r.customer_id,
      erasedAt: r.erased_at,
    })),
    suppressions: (suppressions || []).map((s) => ({
      organizationId: s.organization_id,
      channel: s.channel,
      contactHash: s.contact_hash,
      reason: s.reason,
      createdAt: s.created_at,
    })),
  }

  return {
    ok: true,
    status: 'COLLECTED',
    delta,
  }
}

/**
 * Explicit decision helper evaluating the safe restore gate.
 * Fails closed unless verification is completely clean.
 */
export function evaluateRestoreDecision(
  result: Pick<RestorePrivacyVerificationResult, 'ok' | 'missingErasureProtections' | 'missingSuppressions'>
): RestoreDecision {
  if (
    result.ok === true &&
    result.missingErasureProtections === 0 &&
    result.missingSuppressions === 0
  ) {
    return 'PASS'
  }
  return 'BLOCK_RESTORE_ACTIVATION'
}

/**
 * Verifies that a restored database satisfies the post-backup privacy invariant.
 * Checks for resurrected customer PII, unscrubbed error text, and missing suppressions.
 * Fails closed on any violation or database read failure.
 */
export async function verifyRestoredPrivacyState({
  supabase,
  delta,
}: {
  supabase: SupabaseClient<Database>
  delta: unknown
}): Promise<RestorePrivacyVerificationResult> {
  // 1. Strict schema validation
  if (!isPrivacyRestoreDeltaV1(delta)) {
    return {
      ok: false,
      decision: 'BLOCK_RESTORE_ACTIVATION',
      schemaVersion: '1.0',
      erasureRecordsChecked: 0,
      suppressionRecordsChecked: 0,
      missingErasureProtections: 0,
      missingSuppressions: 0,
      reason: 'INVALID_DELTA_SCHEMA',
    }
  }

  let missingErasureProtections = 0

  // 2. Verify all erasure records in delta
  for (const erasure of delta.erasures) {
    const { organizationId, customerId } = erasure

    // Check customers row
    let customerRow: {
      id: string
      first_name: string | null
      last_name: string | null
      email: string | null
      phone: string | null
    } | null = null

    try {
      const { data: customer, error: custErr } = await supabase
        .from('customers')
        .select('id, first_name, last_name, email, phone')
        .eq('organization_id', organizationId)
        .eq('id', customerId)
        .maybeSingle()

      if (custErr) {
        return {
          ok: false,
          decision: 'BLOCK_RESTORE_ACTIVATION',
          schemaVersion: '1.0',
          erasureRecordsChecked: delta.erasures.length,
          suppressionRecordsChecked: delta.suppressions.length,
          missingErasureProtections: missingErasureProtections + 1,
          missingSuppressions: 0,
          reason: 'DATABASE_ERROR',
        }
      }
      customerRow = customer
    } catch {
      return {
        ok: false,
        decision: 'BLOCK_RESTORE_ACTIVATION',
        schemaVersion: '1.0',
        erasureRecordsChecked: delta.erasures.length,
        suppressionRecordsChecked: delta.suppressions.length,
        missingErasureProtections: missingErasureProtections + 1,
        missingSuppressions: 0,
        reason: 'DATABASE_ERROR',
      }
    }

    let isProtected = true

    // Erased customer row MUST exist with deterministic tombstone and zero PII
    if (!customerRow) {
      isProtected = false
    } else {
      if (
        customerRow.first_name !== CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME ||
        customerRow.last_name !== null ||
        customerRow.email !== null ||
        customerRow.phone !== null
      ) {
        isProtected = false
      }
    }

    // Check customer_completion_events
    try {
      const { data: completions, error: compErr } = await supabase
        .from('customer_completion_events')
        .select('id, contact, source_customer_id, source_transaction_id, source_event_id')
        .eq('organization_id', organizationId)
        .eq('customer_id', customerId)

      if (compErr) {
        return {
          ok: false,
          decision: 'BLOCK_RESTORE_ACTIVATION',
          schemaVersion: '1.0',
          erasureRecordsChecked: delta.erasures.length,
          suppressionRecordsChecked: delta.suppressions.length,
          missingErasureProtections: missingErasureProtections + 1,
          missingSuppressions: 0,
          reason: 'DATABASE_ERROR',
        }
      }

      if (completions && completions.length > 0) {
        for (const c of completions) {
          // MR-7C.3C Invariant: source_customer_id = NULL, source_transaction_id = NULL
          if (c.source_customer_id !== null || c.source_transaction_id !== null) {
            isProtected = false
            break
          }

          // Contact payload must not retain raw contact PII
          if (c.contact && typeof c.contact === 'object') {
            const contactObj = c.contact as Record<string, unknown>
            if (
              contactObj.email ||
              contactObj.phone ||
              contactObj.first_name ||
              contactObj.last_name ||
              contactObj.name ||
              contactObj.firstName ||
              contactObj.lastName
            ) {
              isProtected = false
              break
            }
          }
          // Note: c.source_event_id is retained as deduplication key — does NOT cause failure
        }
      }
    } catch {
      return {
        ok: false,
        decision: 'BLOCK_RESTORE_ACTIVATION',
        schemaVersion: '1.0',
        erasureRecordsChecked: delta.erasures.length,
        suppressionRecordsChecked: delta.suppressions.length,
        missingErasureProtections: missingErasureProtections + 1,
        missingSuppressions: 0,
        reason: 'DATABASE_ERROR',
      }
    }

    // Check review_requests & message_events error scrubbing
    try {
      const { data: requests, error: reqErr } = await supabase
        .from('review_requests')
        .select('id, error_message')
        .eq('organization_id', organizationId)
        .eq('customer_id', customerId)

      if (reqErr) {
        return {
          ok: false,
          decision: 'BLOCK_RESTORE_ACTIVATION',
          schemaVersion: '1.0',
          erasureRecordsChecked: delta.erasures.length,
          suppressionRecordsChecked: delta.suppressions.length,
          missingErasureProtections: missingErasureProtections + 1,
          missingSuppressions: 0,
          reason: 'DATABASE_ERROR',
        }
      }

      if (requests && requests.length > 0) {
        for (const r of requests) {
          if (r.error_message !== null) {
            isProtected = false
            break
          }
        }

        const requestIds = requests.map((r) => r.id)
        if (requestIds.length > 0 && isProtected) {
          const { data: msgEvents, error: msgErr } = await supabase
            .from('message_events')
            .select('id, sanitized_error')
            .eq('organization_id', organizationId)
            .in('review_request_id', requestIds)

          if (msgErr) {
            return {
              ok: false,
              decision: 'BLOCK_RESTORE_ACTIVATION',
              schemaVersion: '1.0',
              erasureRecordsChecked: delta.erasures.length,
              suppressionRecordsChecked: delta.suppressions.length,
              missingErasureProtections: missingErasureProtections + 1,
              missingSuppressions: 0,
              reason: 'DATABASE_ERROR',
            }
          }

          if (msgEvents && msgEvents.length > 0) {
            for (const me of msgEvents) {
              if (me.sanitized_error !== null) {
                isProtected = false
                break
              }
            }
          }
        }
      }
    } catch {
      return {
        ok: false,
        decision: 'BLOCK_RESTORE_ACTIVATION',
        schemaVersion: '1.0',
        erasureRecordsChecked: delta.erasures.length,
        suppressionRecordsChecked: delta.suppressions.length,
        missingErasureProtections: missingErasureProtections + 1,
        missingSuppressions: 0,
        reason: 'DATABASE_ERROR',
      }
    }

    if (!isProtected) {
      missingErasureProtections++
    }
  }

  // 3. Verify all suppressions in delta
  let missingSuppressions = 0

  for (const suppression of delta.suppressions) {
    try {
      const { data: existing, error: supErr } = await supabase
        .from('suppressions')
        .select('id')
        .eq('organization_id', suppression.organizationId)
        .eq('channel', suppression.channel)
        .eq('contact_hash', suppression.contactHash)
        .maybeSingle()

      if (supErr) {
        return {
          ok: false,
          decision: 'BLOCK_RESTORE_ACTIVATION',
          schemaVersion: '1.0',
          erasureRecordsChecked: delta.erasures.length,
          suppressionRecordsChecked: delta.suppressions.length,
          missingErasureProtections,
          missingSuppressions: missingSuppressions + 1,
          reason: 'DATABASE_ERROR',
        }
      }

      if (!existing) {
        missingSuppressions++
      }
    } catch {
      return {
        ok: false,
        decision: 'BLOCK_RESTORE_ACTIVATION',
        schemaVersion: '1.0',
        erasureRecordsChecked: delta.erasures.length,
        suppressionRecordsChecked: delta.suppressions.length,
        missingErasureProtections,
        missingSuppressions: missingSuppressions + 1,
        reason: 'DATABASE_ERROR',
      }
    }
  }

  const ok = missingErasureProtections === 0 && missingSuppressions === 0
  const decision = evaluateRestoreDecision({
    ok,
    missingErasureProtections,
    missingSuppressions,
  })

  return {
    ok,
    decision,
    schemaVersion: '1.0',
    erasureRecordsChecked: delta.erasures.length,
    suppressionRecordsChecked: delta.suppressions.length,
    missingErasureProtections,
    missingSuppressions,
    reason: ok ? 'ALL_VERIFIED' : 'UNRECONCILED_PRIVACY_DELTA',
  }
}
