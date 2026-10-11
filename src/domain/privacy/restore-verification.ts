import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME } from './customer-erasure'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/

export const DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE = 1000

export const REVIEW_REQUEST_ID_CHUNK_SIZE = 100

export const ALLOWED_DELTA_KEYS = new Set([
  'schemaVersion',
  'backupCreatedAt',
  'exportedAt',
  'erasures',
  'suppressions',
])

export const ALLOWED_ERASURE_KEYS = new Set([
  'organizationId',
  'customerId',
  'erasedAt',
])

export const ALLOWED_SUPPRESSION_KEYS = new Set([
  'organizationId',
  'channel',
  'contactHash',
  'reason',
  'createdAt',
])

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
 * Normalizes a page size parameter into a safe, positive integer.
 * Treats pageSize strictly as a performance hint rather than a server limit.
 */
export function normalizePageSize(pageSize?: number): number {
  if (typeof pageSize !== 'number' || !Number.isFinite(pageSize) || pageSize < 1) {
    return DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE
  }
  return Math.floor(pageSize)
}

/**
 * Validates whether a value is strictly an empty JSON object ({}).
 * Rejects non-empty objects, arrays, primitives, null, undefined, or strings.
 */
export function isExactEmptyJsonObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  return Object.keys(value as Record<string, unknown>).length === 0
}

/**
 * Executes cap-safe deterministic pagination for Supabase/PostgREST queries.
 *
 * Invariant:
 * 1. Requests range(nextOffset, nextOffset + requestedPageSize - 1)
 * 2. Next offset advances by ACTUAL returned rows (nextOffset += data.length), NOT requested pageSize.
 * 3. Enumeration terminates ONLY when data.length === 0.
 *    A short non-empty page (data.length < requestedPageSize) is NEVER treated as exhaustion,
 *    guaranteeing complete collection when server caps (e.g. PostgREST max_rows = 1000) are lower
 *    than requested pageSize.
 * 4. Fails closed on any query error, exception, or null data.
 */
async function paginateQuery<T>(
  queryFactory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  onRow: (row: T) => void,
  requestedPageSize: number
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const pSize = normalizePageSize(requestedPageSize)
  let nextOffset = 0

  while (true) {
    const from = nextOffset
    const to = from + pSize - 1

    try {
      const { data, error } = await queryFactory(from, to)

      if (error || !data) {
        return { ok: false, error: error ?? new Error('DATABASE_READ_ERROR') }
      }

      if (data.length === 0) {
        // Explicit empty page establishes complete enumeration
        break
      }

      for (const row of data) {
        onRow(row)
      }

      // Advance offset by actual returned rows, not requested pageSize
      nextOffset += data.length
    } catch (err) {
      return { ok: false, error: err }
    }
  }

  return { ok: true }
}

/**
 * Validates that an object conforms strictly to the PrivacyRestoreDeltaV1 contract.
 * Enforces exact property allowlists on top-level keys, erasure evidence, and suppression evidence.
 * Validates that contactHash matches SHA-256 hex format (64 chars).
 * Prohibits any unknown properties or forbidden raw PII.
 */
export function isPrivacyRestoreDeltaV1(delta: unknown): delta is PrivacyRestoreDeltaV1 {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
    return false
  }

  const d = delta as Record<string, unknown>
  const topKeys = Object.keys(d)

  // Enforce strict top-level property allowlist
  if (topKeys.length !== 5) {
    return false
  }
  for (const k of topKeys) {
    if (!ALLOWED_DELTA_KEYS.has(k)) {
      return false
    }
  }

  if (d.schemaVersion !== '1.0') {
    return false
  }

  if (typeof d.backupCreatedAt !== 'string' || Number.isNaN(Date.parse(d.backupCreatedAt))) {
    return false
  }

  if (typeof d.exportedAt !== 'string' || Number.isNaN(Date.parse(d.exportedAt))) {
    return false
  }

  // exportedAt must be strictly greater than backupCreatedAt
  if (Date.parse(d.exportedAt) <= Date.parse(d.backupCreatedAt)) {
    return false
  }

  if (!Array.isArray(d.erasures) || !Array.isArray(d.suppressions)) {
    return false
  }

  for (const e of d.erasures) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      return false
    }
    const item = e as Record<string, unknown>
    const eKeys = Object.keys(item)
    if (eKeys.length !== 3) {
      return false
    }
    for (const k of eKeys) {
      if (!ALLOWED_ERASURE_KEYS.has(k)) {
        return false
      }
    }

    if (typeof item.organizationId !== 'string' || !UUID_REGEX.test(item.organizationId)) {
      return false
    }
    if (typeof item.customerId !== 'string' || !UUID_REGEX.test(item.customerId)) {
      return false
    }
    if (typeof item.erasedAt !== 'string' || Number.isNaN(Date.parse(item.erasedAt))) {
      return false
    }
  }

  for (const s of d.suppressions) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      return false
    }
    const item = s as Record<string, unknown>
    const sKeys = Object.keys(item)
    if (sKeys.length !== 5) {
      return false
    }
    for (const k of sKeys) {
      if (!ALLOWED_SUPPRESSION_KEYS.has(k)) {
        return false
      }
    }

    if (typeof item.organizationId !== 'string' || !UUID_REGEX.test(item.organizationId)) {
      return false
    }
    if (typeof item.channel !== 'string' || (item.channel !== 'email' && item.channel !== 'sms')) {
      return false
    }
    if (typeof item.contactHash !== 'string' || !SHA256_HEX_REGEX.test(item.contactHash)) {
      return false
    }
    if (typeof item.reason !== 'string' || item.reason.trim().length === 0) {
      return false
    }
    if (typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt))) {
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
 * Collects post-backup privacy deltas created strictly in the frozen window:
 * (backupCreatedAt, exportedAt]
 *
 * For erasures: erased_at > backupCreatedAt AND erased_at <= exportedAt
 * For suppressions: created_at > backupCreatedAt AND created_at <= exportedAt
 *
 * Captures exportedAt before the database reads to establish an authoritative upper bound.
 * Uses complete deterministic, cap-safe pagination until table exhaustion.
 */
export async function collectPrivacyRestoreDelta({
  supabase,
  backupCreatedAt,
  exportedAt,
  pageSize = DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE,
}: {
  supabase: SupabaseClient<Database>
  backupCreatedAt: string | Date
  exportedAt?: string | Date
  pageSize?: number
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
  if (Number.isNaN(backupDate.getTime())) {
    return {
      ok: false,
      status: 'INVALID_TIMESTAMP',
      error: 'Invalid backupCreatedAt parameter: cannot parse to valid timestamp',
    }
  }

  const backupCreatedAtIso = backupDate.toISOString()

  // Capture exportedAt before database reads
  let exportedAtIso: string
  if (exportedAt) {
    const expDate = new Date(exportedAt)
    if (Number.isNaN(expDate.getTime())) {
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

  if (Date.parse(exportedAtIso) <= Date.parse(backupCreatedAtIso)) {
    return {
      ok: false,
      status: 'INVALID_TIMESTAMP',
      error: 'Invalid export window: exportedAt must be strictly greater than backupCreatedAt',
    }
  }

  const pSize = normalizePageSize(pageSize)

  // 1. Collect customer_erasure_records in window (backupCreatedAt, exportedAt] with cap-safe pagination
  const collectedErasures: PrivacyRestoreErasureEvidence[] = []
  const erasureRes = await paginateQuery(
    (from, to) =>
      supabase
        .from('customer_erasure_records')
        .select('organization_id, customer_id, erased_at')
        .gt('erased_at', backupCreatedAtIso)
        .lte('erased_at', exportedAtIso)
        .order('erased_at', { ascending: true })
        .order('organization_id', { ascending: true })
        .order('customer_id', { ascending: true })
        .range(from, to),
    (r) => {
      collectedErasures.push({
        organizationId: r.organization_id,
        customerId: r.customer_id,
        erasedAt: r.erased_at,
      })
    },
    pSize
  )

  if (!erasureRes.ok) {
    return {
      ok: false,
      status: 'UNAVAILABLE',
      error: 'DATABASE_READ_ERROR',
    }
  }

  // 2. Collect suppressions in window (backupCreatedAt, exportedAt] with cap-safe pagination
  const collectedSuppressions: PrivacyRestoreSuppressionEvidence[] = []
  const suppressionRes = await paginateQuery(
    (from, to) =>
      supabase
        .from('suppressions')
        .select('organization_id, channel, contact_hash, reason, created_at')
        .gt('created_at', backupCreatedAtIso)
        .lte('created_at', exportedAtIso)
        .order('created_at', { ascending: true })
        .order('organization_id', { ascending: true })
        .order('channel', { ascending: true })
        .order('contact_hash', { ascending: true })
        .range(from, to),
    (s) => {
      collectedSuppressions.push({
        organizationId: s.organization_id,
        channel: s.channel,
        contactHash: s.contact_hash,
        reason: s.reason,
        createdAt: s.created_at,
      })
    },
    pSize
  )

  if (!suppressionRes.ok) {
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
    erasures: collectedErasures,
    suppressions: collectedSuppressions,
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
 * Evaluates:
 * 1. Customer tombstone in customers table (first_name = '[Deleted Customer]', last_name/email/phone = null).
 * 2. Durable erasure certificate in customer_erasure_records for (organization_id, customer_id).
 * 3. Completion events contact payload exact empty object ({}) and source_customer_id / source_transaction_id erased (null).
 * 4. Error scrubbing in review_requests (error_message = null) and message_events (sanitized_error = null).
 * 5. Presence of all post-backup suppressions in the restored database.
 *
 * Implements complete deterministic, cap-safe pagination for all multi-row queries.
 * Reports truthful counters (counting only records fully and successfully evaluated before any failure).
 * Fails closed on any violation or database read failure.
 */
export async function verifyRestoredPrivacyState({
  supabase,
  delta,
  pageSize = DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE,
}: {
  supabase: SupabaseClient<Database>
  delta: unknown
  pageSize?: number
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

  const pSize = normalizePageSize(pageSize)
  let erasureRecordsChecked = 0
  let suppressionRecordsChecked = 0
  let missingErasureProtections = 0
  let missingSuppressions = 0

  // 2. Verify all erasure records in delta
  for (const erasure of delta.erasures) {
    const { organizationId, customerId } = erasure
    let isProtected = true

    // Check customers row
    try {
      const { data: customerRow, error: custErr } = await supabase
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
          erasureRecordsChecked,
          suppressionRecordsChecked,
          missingErasureProtections: missingErasureProtections + 1,
          missingSuppressions,
          reason: 'DATABASE_ERROR',
        }
      }

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
    } catch {
      return {
        ok: false,
        decision: 'BLOCK_RESTORE_ACTIVATION',
        schemaVersion: '1.0',
        erasureRecordsChecked,
        suppressionRecordsChecked,
        missingErasureProtections: missingErasureProtections + 1,
        missingSuppressions,
        reason: 'DATABASE_ERROR',
      }
    }

    // Verify durable erasure certificate exists in customer_erasure_records
    try {
      const { data: certRow, error: certErr } = await supabase
        .from('customer_erasure_records')
        .select('organization_id, customer_id')
        .eq('organization_id', organizationId)
        .eq('customer_id', customerId)
        .maybeSingle()

      if (certErr) {
        return {
          ok: false,
          decision: 'BLOCK_RESTORE_ACTIVATION',
          schemaVersion: '1.0',
          erasureRecordsChecked,
          suppressionRecordsChecked,
          missingErasureProtections: missingErasureProtections + 1,
          missingSuppressions,
          reason: 'DATABASE_ERROR',
        }
      }

      if (
        !certRow ||
        certRow.organization_id !== organizationId ||
        certRow.customer_id !== customerId
      ) {
        isProtected = false
      }
    } catch {
      return {
        ok: false,
        decision: 'BLOCK_RESTORE_ACTIVATION',
        schemaVersion: '1.0',
        erasureRecordsChecked,
        suppressionRecordsChecked,
        missingErasureProtections: missingErasureProtections + 1,
        missingSuppressions,
        reason: 'DATABASE_ERROR',
      }
    }

    // Check customer_completion_events with cap-safe pagination
    const compRes = await paginateQuery(
      (from, to) =>
        supabase
          .from('customer_completion_events')
          .select('id, contact, source_customer_id, source_transaction_id, source_event_id')
          .eq('organization_id', organizationId)
          .eq('customer_id', customerId)
          .order('id', { ascending: true })
          .range(from, to),
      (c) => {
        // MR-7C.3C Invariant: source_customer_id = NULL, source_transaction_id = NULL
        if (c.source_customer_id !== null || c.source_transaction_id !== null) {
          isProtected = false
        }

        // Contact payload must strictly equal the empty JSON object: {}
        if (!isExactEmptyJsonObject(c.contact)) {
          isProtected = false
        }
        // Note: c.source_event_id is retained as deduplication key — does NOT cause failure
      },
      pSize
    )

    if (!compRes.ok) {
      return {
        ok: false,
        decision: 'BLOCK_RESTORE_ACTIVATION',
        schemaVersion: '1.0',
        erasureRecordsChecked,
        suppressionRecordsChecked,
        missingErasureProtections: missingErasureProtections + 1,
        missingSuppressions,
        reason: 'DATABASE_ERROR',
      }
    }

    // Check review_requests with cap-safe pagination
    const collectedRequestIds: string[] = []
    const reqRes = await paginateQuery(
      (from, to) =>
        supabase
          .from('review_requests')
          .select('id, error_message')
          .eq('organization_id', organizationId)
          .eq('customer_id', customerId)
          .order('id', { ascending: true })
          .range(from, to),
      (r) => {
        if (r.error_message !== null) {
          isProtected = false
        }
        collectedRequestIds.push(r.id)
      },
      pSize
    )

    if (!reqRes.ok) {
      return {
        ok: false,
        decision: 'BLOCK_RESTORE_ACTIVATION',
        schemaVersion: '1.0',
        erasureRecordsChecked,
        suppressionRecordsChecked,
        missingErasureProtections: missingErasureProtections + 1,
        missingSuppressions,
        reason: 'DATABASE_ERROR',
      }
    }

    // Check message_events with bounded request ID chunking and cap-safe pagination
    if (collectedRequestIds.length > 0) {
      for (let i = 0; i < collectedRequestIds.length; i += REVIEW_REQUEST_ID_CHUNK_SIZE) {
        const chunk = collectedRequestIds.slice(i, i + REVIEW_REQUEST_ID_CHUNK_SIZE)
        const msgRes = await paginateQuery(
          (from, to) =>
            supabase
              .from('message_events')
              .select('id, sanitized_error')
              .eq('organization_id', organizationId)
              .in('review_request_id', chunk)
              .order('id', { ascending: true })
              .range(from, to),
          (me) => {
            if (me.sanitized_error !== null) {
              isProtected = false
            }
          },
          pSize
        )

        if (!msgRes.ok) {
          return {
            ok: false,
            decision: 'BLOCK_RESTORE_ACTIVATION',
            schemaVersion: '1.0',
            erasureRecordsChecked,
            suppressionRecordsChecked,
            missingErasureProtections: missingErasureProtections + 1,
            missingSuppressions,
            reason: 'DATABASE_ERROR',
          }
        }
      }
    }

    // Completed all checks for this erasure record without a database failure
    erasureRecordsChecked++
    if (!isProtected) {
      missingErasureProtections++
    }
  }

  // 3. Verify all suppressions in delta
  for (const suppression of delta.suppressions) {
    try {
      const { data: existing, error: supErr } = await supabase
        .from('suppressions')
        .select('id, organization_id, channel, contact_hash')
        .eq('organization_id', suppression.organizationId)
        .eq('channel', suppression.channel)
        .eq('contact_hash', suppression.contactHash)
        .maybeSingle()

      if (supErr) {
        return {
          ok: false,
          decision: 'BLOCK_RESTORE_ACTIVATION',
          schemaVersion: '1.0',
          erasureRecordsChecked,
          suppressionRecordsChecked,
          missingErasureProtections,
          missingSuppressions: missingSuppressions + 1,
          reason: 'DATABASE_ERROR',
        }
      }

      suppressionRecordsChecked++
      if (!existing) {
        missingSuppressions++
      }
    } catch {
      return {
        ok: false,
        decision: 'BLOCK_RESTORE_ACTIVATION',
        schemaVersion: '1.0',
        erasureRecordsChecked,
        suppressionRecordsChecked,
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
    erasureRecordsChecked,
    suppressionRecordsChecked,
    missingErasureProtections,
    missingSuppressions,
    reason: ok ? 'ALL_VERIFIED' : 'UNRECONCILED_PRIVACY_DELTA',
  }
}
