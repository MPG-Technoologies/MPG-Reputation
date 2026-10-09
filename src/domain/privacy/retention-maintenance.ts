import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  redactAgedCompletionContacts,
  purgeDispatchedDomainOutbox,
  assertProtectedClassImmunity,
} from '@/domain/privacy/retention-controls'

/**
 * MR-7C.4B2 Bounded Retention Maintenance Defaults:
 * - Conservative bounded limits prevent unbounded memory or database load.
 * - Default scheduling is daily at 03:00 UTC (cadence is implementation default, not retention policy).
 * - Production scheduling is DISABLED BY DEFAULT via ENABLE_RETENTION_MAINTENANCE=false.
 */
export const DEFAULT_ORGANIZATION_BATCH_SIZE = 50
export const DEFAULT_PER_ORG_CONTACT_BATCH_SIZE = 100
export const DEFAULT_PER_ORG_OUTBOX_BATCH_SIZE = 100
export const DEFAULT_MAINTENANCE_CRON_CADENCE = '0 3 * * *'
export const RETENTION_MAINTENANCE_FLAG = 'ENABLE_RETENTION_MAINTENANCE'

/**
 * Organizations eligible for retention maintenance:
 * - Inactive and suspended organizations remain subject to retention policy cutoffs (Decision 11).
 * - Organizations are NEVER hard-deleted; soft-deactivation is strictly preserved.
 */
export const ELIGIBLE_ORGANIZATION_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
] as const

export type EligibleOrganizationStatus =
  (typeof ELIGIBLE_ORGANIZATION_STATUSES)[number]

export interface MultiTenantRetentionMaintenanceOptions {
  enabledOverride?: boolean
  organizationBatchSize?: number
  perOrgContactBatchSize?: number
  perOrgOutboxBatchSize?: number
  asOf?: Date
  maxOrganizations?: number
  actorType?: string
  actorId?: string | null
}

/**
 * Fixed safe failure categories for retention maintenance operations.
 * Free-form error messages, stack traces, database details, payloads, and PII are strictly excluded.
 */
export const MAINTENANCE_FAILURE_CODES = [
  'ORGANIZATION_QUERY_FAILED',
  'CONTACT_REDACTION_FAILED',
  'OUTBOX_PURGE_FAILED',
  'TENANT_MAINTENANCE_FAILED',
] as const

export type MaintenanceFailureCode =
  (typeof MAINTENANCE_FAILURE_CODES)[number]

export interface TenantMaintenanceFailure {
  organizationId: string
  code: MaintenanceFailureCode
}

export interface MultiTenantRetentionMaintenanceResult {
  status: 'COMPLETED' | 'SKIPPED_DISABLED' | 'PARTIALLY_FAILED' | 'FAILED'
  enabled: boolean
  organizationsEvaluated: number
  organizationsSucceeded: number
  organizationsFailed: number
  totalContactsRedacted: number
  totalOutboxRowsPurged: number
  batchesProcessed: number
  durationMs: number
  errors: TenantMaintenanceFailure[]
}

/**
 * Checks whether retention maintenance is enabled via the environment flag.
 * Default is FALSE unless explicitly configured with 'true'.
 */
export function isRetentionMaintenanceEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return env[RETENTION_MAINTENANCE_FLAG] === 'true'
}

/**
 * Server-side coordinator for bounded multi-tenant retention maintenance.
 *
 * Requirements (MR-7C.4B2):
 * 1. Obtains organizations through trusted server/system boundary.
 * 2. Processes organizations in bounded cursor-based batches.
 * 3. Invokes accepted C4B1 operations per organization (preserving tenant isolation).
 * 4. Isolates failures: single tenant failure never rolls back other tenants.
 * 5. Idempotent: repeated runs are safe with zero state corruption.
 * 6. Emits aggregate operational counters only (strictly zero customer PII or raw error strings).
 * 7. Hard-guards against targeting permanent retention classes.
 */
export async function executeMultiTenantRetentionMaintenance(
  supabase: SupabaseClient<Database>,
  options: MultiTenantRetentionMaintenanceOptions = {}
): Promise<MultiTenantRetentionMaintenanceResult> {
  const startTime = Date.now()
  const isEnabled = options.enabledOverride ?? isRetentionMaintenanceEnabled()

  // 1. Production Scheduling / Activation Guard: Default fail-safe
  if (!isEnabled) {
    return {
      status: 'SKIPPED_DISABLED',
      enabled: false,
      organizationsEvaluated: 0,
      organizationsSucceeded: 0,
      organizationsFailed: 0,
      totalContactsRedacted: 0,
      totalOutboxRowsPurged: 0,
      batchesProcessed: 0,
      durationMs: Date.now() - startTime,
      errors: [],
    }
  }

  // 2. Hard code-level immunity verification: Ensure coordinator only targets non-protected operations
  assertProtectedClassImmunity('customer_completion_events.contact')
  assertProtectedClassImmunity('domain_outbox')

  const orgBatchSize = Math.min(
    Math.max(options.organizationBatchSize ?? DEFAULT_ORGANIZATION_BATCH_SIZE, 1),
    200
  )
  const perOrgContactBatchSize = Math.min(
    Math.max(
      options.perOrgContactBatchSize ?? DEFAULT_PER_ORG_CONTACT_BATCH_SIZE,
      1
    ),
    500
  )
  const perOrgOutboxBatchSize = Math.min(
    Math.max(
      options.perOrgOutboxBatchSize ?? DEFAULT_PER_ORG_OUTBOX_BATCH_SIZE,
      1
    ),
    500
  )
  const maxOrgs = options.maxOrganizations ?? 1000
  const asOf = options.asOf ?? new Date()

  let organizationsEvaluated = 0
  let organizationsSucceeded = 0
  let organizationsFailed = 0
  let totalContactsRedacted = 0
  let totalOutboxRowsPurged = 0
  let batchesProcessed = 0
  const tenantErrors: TenantMaintenanceFailure[] = []

  let lastSeenOrgId: string | null = null
  let hasMore = true

  while (hasMore && organizationsEvaluated < maxOrgs) {
    const currentBatchLimit = Math.min(
      orgBatchSize,
      maxOrgs - organizationsEvaluated
    )

    let query = supabase
      .from('organizations')
      .select('id, status')
      .in('status', ELIGIBLE_ORGANIZATION_STATUSES)

    if (lastSeenOrgId) {
      query = query.gt('id', lastSeenOrgId)
    }

    const { data: orgBatch, error: fetchErr } = await query
      .order('id', { ascending: true })
      .limit(currentBatchLimit)

    if (fetchErr) {
      tenantErrors.push({
        organizationId: 'SYSTEM',
        code: 'ORGANIZATION_QUERY_FAILED',
      })
      break
    }

    if (!orgBatch || orgBatch.length === 0) {
      hasMore = false
      break
    }

    batchesProcessed++

    // Process each organization within its own tenant boundary
    for (const org of orgBatch) {
      lastSeenOrgId = org.id
      organizationsEvaluated++

      let contactRedactedCount = 0
      let contactFailed = false

      try {
        // C4B1 Operation 1: 30-day completion contact payload redaction
        const contactResult = await redactAgedCompletionContacts(supabase, {
          organizationId: org.id,
          batchSize: perOrgContactBatchSize,
          asOf,
          actorType: options.actorType || 'system',
          actorId: options.actorId || null,
        })
        contactRedactedCount = contactResult.redactedCount
      } catch {
        contactFailed = true
        organizationsFailed++
        tenantErrors.push({
          organizationId: org.id,
          code: 'CONTACT_REDACTION_FAILED',
        })
      }

      if (contactFailed) {
        if (organizationsEvaluated >= maxOrgs) {
          hasMore = false
          break
        }
        continue
      }

      let outboxPurgedCount = 0
      let outboxFailed = false

      try {
        // C4B1 Operation 2: 30-day successfully DISPATCHED outbox purge
        const outboxResult = await purgeDispatchedDomainOutbox(supabase, {
          organizationId: org.id,
          batchSize: perOrgOutboxBatchSize,
          asOf,
          actorType: options.actorType || 'system',
          actorId: options.actorId || null,
        })
        outboxPurgedCount = outboxResult.purgedCount
      } catch {
        outboxFailed = true
        organizationsFailed++
        tenantErrors.push({
          organizationId: org.id,
          code: 'OUTBOX_PURGE_FAILED',
        })
      }

      if (!outboxFailed) {
        organizationsSucceeded++
        totalContactsRedacted += contactRedactedCount
        totalOutboxRowsPurged += outboxPurgedCount
      }

      if (organizationsEvaluated >= maxOrgs) {
        hasMore = false
        break
      }
    }

    if (orgBatch.length < currentBatchLimit) {
      hasMore = false
    }
  }

  const durationMs = Date.now() - startTime

  let status: MultiTenantRetentionMaintenanceResult['status'] = 'COMPLETED'
  const hasFailures = organizationsFailed > 0 || tenantErrors.length > 0
  if (hasFailures && organizationsSucceeded > 0) {
    status = 'PARTIALLY_FAILED'
  } else if (hasFailures && organizationsSucceeded === 0) {
    status = 'FAILED'
  }

  return {
    status,
    enabled: true,
    organizationsEvaluated,
    organizationsSucceeded,
    organizationsFailed,
    totalContactsRedacted,
    totalOutboxRowsPurged,
    batchesProcessed,
    durationMs,
    errors: tenantErrors,
  }
}
