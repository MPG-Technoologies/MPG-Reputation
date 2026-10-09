import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * MR-7C.4 Frozen Launch Retention Constants (AUTHORITATIVE OWNER DECISIONS):
 * - Completion contact payload redaction: 30 days
 * - Review-link expiration: 90 days
 * - Dispatched outbox purge: 30 days
 */
export const COMPLETION_CONTACT_RETENTION_DAYS = 30
export const REVIEW_LINK_EXPIRATION_DAYS = 90
export const DISPATCHED_OUTBOX_RETENTION_DAYS = 30

export const REVIEW_LINK_EXPIRATION_MS =
  REVIEW_LINK_EXPIRATION_DAYS * 24 * 60 * 60 * 1000

/**
 * Frozen Permanent Retention Classes (MR-7C.4 Decisions 1, 3, 5, 6, 7, 8, 9, 10):
 * These data classes are strictly protected and MUST NEVER be targeted by automatic
 * aging, deletion, or generic purge operations.
 */
export const PERMANENT_RETENTION_CLASSES = [
  'suppressions',
  'review_request_recipient_evidence',
  'messaging_authority_evidence',
  'customer_erasure_records',
  'audit_events',
  'usage_ledger',
  'cost_ledger',
  'organization_usage',
  'customer_completion_events.source_event_id',
] as const

export type PermanentRetentionClass =
  (typeof PERMANENT_RETENTION_CLASSES)[number]

export class ProtectedClassImmunityError extends Error {
  constructor(targetClass: string) {
    super(
      `IMMUNITY VIOLATION: "${targetClass}" is a permanently protected class under MPG Reputation frozen retention policy (MR-7C.4 Decisions 3, 5, 6, 7, 8, 9, 10). Automatic aging, deletion, or purging is strictly prohibited.`
    )
    this.name = 'ProtectedClassImmunityError'
  }
}

/**
 * Validates whether a given class or table name is protected by permanent retention.
 */
export function isProtectedClass(className: string): boolean {
  const normalized = className.trim().toLowerCase()
  return PERMANENT_RETENTION_CLASSES.some(
    (cls) => cls.toLowerCase() === normalized
  )
}

/**
 * Hard code-level guard asserting that protected classes cannot enter retention/purge operations.
 * Throws ProtectedClassImmunityError if a protected class is targeted.
 */
export function assertProtectedClassImmunity(className: string): void {
  if (isProtectedClass(className)) {
    throw new ProtectedClassImmunityError(className)
  }
}

// ---------------------------------------------------------------------------
// 1. Review Link Expiration (Decision 4)
// ---------------------------------------------------------------------------

export interface ReviewLinkExpirationCheckInput {
  sent_at?: string | null
  created_at: string
}

/**
 * Determines if a review request routing link has exceeded its 90-day validity window.
 * Authoritative timestamp is `sent_at` if present, falling back to `created_at`.
 *
 * Boundary Semantics:
 * - `< 90 days`: valid (false)
 * - `>= 90 days`: expired (true, fails closed)
 */
export function isReviewRequestLinkExpired(
  request: ReviewLinkExpirationCheckInput,
  nowMs: number = Date.now()
): boolean {
  const authoritativeTimeStr = request.sent_at || request.created_at
  const authoritativeMs = new Date(authoritativeTimeStr).getTime()

  if (isNaN(authoritativeMs)) {
    // Fail closed if timestamp cannot be parsed
    return true
  }

  return nowMs - authoritativeMs >= REVIEW_LINK_EXPIRATION_MS
}

// ---------------------------------------------------------------------------
// 2. Completion Contact Redaction (Decisions 2 & 3)
// ---------------------------------------------------------------------------

export interface RedactCompletionContactsOptions {
  organizationId?: string
  batchSize?: number
  olderThanDays?: number
  asOf?: Date
  actorId?: string | null
  actorType?: string
}

export interface RedactCompletionContactsResult {
  redactedCount: number
  affectedOrganizationIds: string[]
  auditEventIds: string[]
}

/**
 * Identifies and redacts contact payloads on customer_completion_events older than 30 days.
 *
 * Requirements:
 * - Sets `contact = '{}'::jsonb` (identical to accepted C3B/C3C erasure representation).
 * - Preserves completion rows, `source_event_id`, timestamps, and operational relationships.
 * - Idempotent: rows already `{}` are unaffected.
 * - Tenant-safe: supports optional organizationId scoping.
 * - Records aggregate audit evidence with strictly zero raw PII.
 */
export async function redactAgedCompletionContacts(
  supabase: SupabaseClient<Database>,
  options: RedactCompletionContactsOptions = {}
): Promise<RedactCompletionContactsResult> {
  const olderThanDays = options.olderThanDays ?? COMPLETION_CONTACT_RETENTION_DAYS
  const batchSize = Math.min(Math.max(options.batchSize ?? 100, 1), 500)
  const asOf = options.asOf ?? new Date()
  const cutoffMs = asOf.getTime() - olderThanDays * 24 * 60 * 60 * 1000
  const cutoffIso = new Date(cutoffMs).toISOString()

  let query = supabase
    .from('customer_completion_events')
    .select('id, organization_id, created_at, contact, source_event_id')
    .lt('created_at', cutoffIso)

  if (options.organizationId) {
    query = query.eq('organization_id', options.organizationId)
  }

  const { data: candidates, error: selectErr } = await query
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (selectErr || !candidates || candidates.length === 0) {
    return {
      redactedCount: 0,
      affectedOrganizationIds: [],
      auditEventIds: [],
    }
  }

  // Filter in-memory for rows that actually have redactable contact data.
  // Rows where contact is null, empty object {}, or not an object are already redacted / non-PII.
  const redactableRows = candidates.filter((row) => {
    if (!row.contact || typeof row.contact !== 'object' || Array.isArray(row.contact)) {
      return false
    }
    return Object.keys(row.contact as Record<string, unknown>).length > 0
  })

  if (redactableRows.length === 0) {
    return {
      redactedCount: 0,
      affectedOrganizationIds: [],
      auditEventIds: [],
    }
  }

  // Group by organization for tenant isolation and audit evidence
  const orgMap = new Map<string, string[]>()
  for (const row of redactableRows) {
    const ids = orgMap.get(row.organization_id) || []
    ids.push(row.id)
    orgMap.set(row.organization_id, ids)
  }

  let totalRedacted = 0
  const affectedOrgs: string[] = []
  const auditEventIds: string[] = []

  for (const [orgId, ids] of orgMap.entries()) {
    // Atomic update of contact payload to '{}'::jsonb only
    // source_event_id, source, customer_id, completed_at, etc. are untouched
    const { error: updateErr } = await supabase
      .from('customer_completion_events')
      .update({ contact: {} })
      .in('id', ids)
      .eq('organization_id', orgId)

    if (!updateErr) {
      totalRedacted += ids.length
      affectedOrgs.push(orgId)

      // Safe aggregate audit record (STRICTLY zero PII, zero hashes, zero payload)
      const { data: auditData } = await supabase
        .from('audit_events')
        .insert({
          organization_id: orgId,
          actor_type: options.actorType || 'system',
          actor_id: options.actorId || null,
          event_type: 'retention.completion_contacts_redacted',
          entity_type: 'customer_completion_events',
          entity_id: orgId,
          metadata: {
            redacted_count: ids.length,
            retention_period_days: olderThanDays,
            cutoff_timestamp: cutoffIso,
          },
        })
        .select('id')
        .maybeSingle()

      if (auditData?.id) {
        auditEventIds.push(auditData.id)
      }
    }
  }

  return {
    redactedCount: totalRedacted,
    affectedOrganizationIds: affectedOrgs,
    auditEventIds,
  }
}

// ---------------------------------------------------------------------------
// 3. Dispatched Outbox Purge (Decision 12)
// ---------------------------------------------------------------------------

export interface PurgeDispatchedOutboxOptions {
  organizationId?: string
  batchSize?: number
  olderThanDays?: number
  asOf?: Date
  actorId?: string | null
  actorType?: string
}

export interface PurgeDispatchedOutboxResult {
  purgedCount: number
  affectedOrganizationIds: string[]
  auditEventIds: string[]
}

/**
 * Safely purges successfully DISPATCHED domain outbox records older than 30 days.
 *
 * Hard Guards:
 * - PENDING records are NEVER selected or deleted.
 * - FAILED/unresolved records are NEVER purged.
 * - Only records with `status = 'DISPATCHED'` and `dispatched_at` older than 30 days are eligible.
 * - Operates in bounded batches.
 * - Returns aggregate counts only with zero payload leakage.
 * - Records aggregate audit evidence.
 */
export async function purgeDispatchedDomainOutbox(
  supabase: SupabaseClient<Database>,
  options: PurgeDispatchedOutboxOptions = {}
): Promise<PurgeDispatchedOutboxResult> {
  const olderThanDays = options.olderThanDays ?? DISPATCHED_OUTBOX_RETENTION_DAYS
  const batchSize = Math.min(Math.max(options.batchSize ?? 100, 1), 500)
  const asOf = options.asOf ?? new Date()
  const cutoffMs = asOf.getTime() - olderThanDays * 24 * 60 * 60 * 1000
  const cutoffIso = new Date(cutoffMs).toISOString()

  let query = supabase
    .from('domain_event_outbox')
    .select('id, organization_id, status, dispatched_at')
    .eq('status', 'DISPATCHED')
    .not('dispatched_at', 'is', null)
    .lt('dispatched_at', cutoffIso)

  if (options.organizationId) {
    query = query.eq('organization_id', options.organizationId)
  }

  const { data: candidates, error: selectErr } = await query
    .order('dispatched_at', { ascending: true })
    .limit(batchSize)

  if (selectErr || !candidates || candidates.length === 0) {
    return {
      purgedCount: 0,
      affectedOrganizationIds: [],
      auditEventIds: [],
    }
  }

  // Hard In-Memory Defensive Filter:
  // Must be strictly 'DISPATCHED', must have valid dispatched_at, and must be strictly older than cutoff.
  // PENDING, FAILED, or unresolved rows must NEVER pass.
  const eligibleRows = candidates.filter((row) => {
    if (row.status !== 'DISPATCHED') return false
    if (!row.dispatched_at) return false
    const dispatchedTime = new Date(row.dispatched_at).getTime()
    return !isNaN(dispatchedTime) && dispatchedTime < cutoffMs
  })

  if (eligibleRows.length === 0) {
    return {
      purgedCount: 0,
      affectedOrganizationIds: [],
      auditEventIds: [],
    }
  }

  // Group by organization for tenant isolation and audit
  const orgMap = new Map<string, string[]>()
  for (const row of eligibleRows) {
    const ids = orgMap.get(row.organization_id) || []
    ids.push(row.id)
    orgMap.set(row.organization_id, ids)
  }

  let totalPurged = 0
  const affectedOrgs: string[] = []
  const auditEventIds: string[] = []

  for (const [orgId, ids] of orgMap.entries()) {
    // Defense-in-depth: explicit .eq('status', 'DISPATCHED') ensures no race condition can delete PENDING
    const { error: deleteErr } = await supabase
      .from('domain_event_outbox')
      .delete()
      .in('id', ids)
      .eq('organization_id', orgId)
      .eq('status', 'DISPATCHED')

    if (!deleteErr) {
      totalPurged += ids.length
      affectedOrgs.push(orgId)

      // Safe aggregate audit record (STRICTLY zero payload values)
      const { data: auditData } = await supabase
        .from('audit_events')
        .insert({
          organization_id: orgId,
          actor_type: options.actorType || 'system',
          actor_id: options.actorId || null,
          event_type: 'retention.outbox_dispatched_purged',
          entity_type: 'domain_event_outbox',
          entity_id: orgId,
          metadata: {
            purged_count: ids.length,
            retention_period_days: olderThanDays,
            cutoff_timestamp: cutoffIso,
          },
        })
        .select('id')
        .maybeSingle()

      if (auditData?.id) {
        auditEventIds.push(auditData.id)
      }
    }
  }

  return {
    purgedCount: totalPurged,
    affectedOrganizationIds: affectedOrgs,
    auditEventIds,
  }
}
