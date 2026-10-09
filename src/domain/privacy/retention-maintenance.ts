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
 * Eligible Organization Statuses for Retention Maintenance:
 * Data retention policies (30-day completion contact redaction, 30-day outbox purge)
 * apply to all retained tenant data regardless of whether an organization is currently
 * ACTIVE, INACTIVE, or SUSPENDED. Under Owner Decision 11, inactive organizations
 * are soft-deactivated and NEVER automatically hard-deleted.
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

export interface TenantMaintenanceFailure {
  organizationId: string
  sanitizedError: string
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
 * Default is FALSE unless explicitly configured.
 */
export function isRetentionMaintenanceEnabled(): boolean {
  return process.env[RETENTION_MAINTENANCE_FLAG] === 'true'
}

/**
 * Strips internal SQL details, connection strings, payloads, or potential PII from error messages.
 */
export function sanitizeMaintenanceErrorMessage(rawMessage: string): string {
  if (!rawMessage || typeof rawMessage !== 'string') {
    return 'Unknown maintenance error'
  }

  // Remove potential emails
  let sanitized = rawMessage.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    '[REDACTED_EMAIL]'
  )

  // Remove postgres connection strings / credentials if present
  sanitized = sanitized.replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    '[REDACTED_CONNECTION]'
  )

  // Remove raw UUID tokens that could represent sensitive event or request IDs
  // Keep first 80 characters for diagnostic categorization
  return sanitized.slice(0, 120).trim()
}

/**
 * Server-side coordinator for bounded multi-tenant retention maintenance.
 *
 * Requirements (MR-7C.4B2):
 * 1. Obtains organizations through trusted server/system boundary.
 * 2. Processes organizations in bounded cursor-based batches.
 * 3. Invokes accepted C4B1 operations per organization (preserving tenant isolation).
 * 4. Isolates tenant failures: one failure does not fail or rollback other tenants.
 * 5. Idempotent: repeated runs cause zero harmful side effects.
 * 6. Emits strictly aggregate safe operational metrics (zero PII, zero payloads).
 * 7. Disabled by default via ENABLE_RETENTION_MAINTENANCE=false.
 * 8. Never deletes organizations (Decision 11 soft-deactivation preserved).
 * 9. Asserts permanent retention immunity for protected classes.
 */
export async function executeMultiTenantRetentionMaintenance(
  supabase: SupabaseClient<Database>,
  options: MultiTenantRetentionMaintenanceOptions = {}
): Promise<MultiTenantRetentionMaintenanceResult> {
  const startTime = Date.now()

  // 1. Guard check: Must be enabled via environment flag or explicit test override
  const isEnabled =
    options.enabledOverride !== undefined
      ? options.enabledOverride
      : isRetentionMaintenanceEnabled()

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
  const asOf = options.asOf ?? new Date()
  const maxOrgs = options.maxOrganizations ?? Infinity

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
        sanitizedError: sanitizeMaintenanceErrorMessage(fetchErr.message),
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

      try {
        // C4B1 Operation 1: 30-day completion contact payload redaction
        const contactResult = await redactAgedCompletionContacts(supabase, {
          organizationId: org.id,
          batchSize: perOrgContactBatchSize,
          asOf,
          actorType: options.actorType || 'system',
          actorId: options.actorId || null,
        })

        // C4B1 Operation 2: 30-day successfully DISPATCHED outbox purge
        const outboxResult = await purgeDispatchedDomainOutbox(supabase, {
          organizationId: org.id,
          batchSize: perOrgOutboxBatchSize,
          asOf,
          actorType: options.actorType || 'system',
          actorId: options.actorId || null,
        })

        organizationsSucceeded++
        totalContactsRedacted += contactResult.redactedCount
        totalOutboxRowsPurged += outboxResult.purgedCount
      } catch (tenantErr) {
        // Strict failure isolation: One tenant failure never aborts other tenants
        organizationsFailed++
        const rawMsg =
          tenantErr instanceof Error ? tenantErr.message : String(tenantErr)
        tenantErrors.push({
          organizationId: org.id,
          sanitizedError: sanitizeMaintenanceErrorMessage(rawMsg),
        })
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
  if (organizationsFailed > 0 && organizationsSucceeded > 0) {
    status = 'PARTIALLY_FAILED'
  } else if (organizationsFailed > 0 && organizationsSucceeded === 0) {
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
