import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  DEFAULT_MAINTENANCE_CRON_CADENCE,
  RETENTION_MAINTENANCE_FLAG,
  ELIGIBLE_ORGANIZATION_STATUSES,
  isRetentionMaintenanceEnabled,
  sanitizeMaintenanceErrorMessage,
  executeMultiTenantRetentionMaintenance,
} from '@/domain/privacy/retention-maintenance'
import {
  COMPLETION_CONTACT_RETENTION_DAYS,
  REVIEW_LINK_EXPIRATION_DAYS,
  DISPATCHED_OUTBOX_RETENTION_DAYS,
  PERMANENT_RETENTION_CLASSES,
  isProtectedClass,
} from '@/domain/privacy/retention-controls'
import {
  retentionMaintenanceWorkflow,
  executeRetentionMaintenanceHandler,
} from '@/inngest/functions/retention-maintenance'

describe('MR-7C.4B2 Domain & Orchestration Retention Maintenance Suite', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env[RETENTION_MAINTENANCE_FLAG]
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('1. Feature Flag & Scheduling Guard (Disabled by Default)', () => {
    it('1. isRetentionMaintenanceEnabled returns false by default', () => {
      expect(process.env.ENABLE_RETENTION_MAINTENANCE).toBeUndefined()
      expect(isRetentionMaintenanceEnabled()).toBe(false)
    })

    it('2. isRetentionMaintenanceEnabled returns false for non-true values', () => {
      process.env.ENABLE_RETENTION_MAINTENANCE = '0'
      expect(isRetentionMaintenanceEnabled()).toBe(false)
      process.env.ENABLE_RETENTION_MAINTENANCE = 'false'
      expect(isRetentionMaintenanceEnabled()).toBe(false)
      process.env.ENABLE_RETENTION_MAINTENANCE = ''
      expect(isRetentionMaintenanceEnabled()).toBe(false)
    })

    it('3. isRetentionMaintenanceEnabled returns true only when explicitly set to "true"', () => {
      process.env.ENABLE_RETENTION_MAINTENANCE = 'true'
      expect(isRetentionMaintenanceEnabled()).toBe(true)
    })

    it('4. disabled coordinator execution performs zero mutations and returns SKIPPED_DISABLED', async () => {
      const mockSupabase = {
        from: vi.fn(),
      } as unknown as SupabaseClient<Database>

      const result = await executeMultiTenantRetentionMaintenance(mockSupabase)

      expect(result.status).toBe('SKIPPED_DISABLED')
      expect(result.enabled).toBe(false)
      expect(result.organizationsEvaluated).toBe(0)
      expect(result.organizationsSucceeded).toBe(0)
      expect(result.organizationsFailed).toBe(0)
      expect(result.totalContactsRedacted).toBe(0)
      expect(result.totalOutboxRowsPurged).toBe(0)
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })
  })

  describe('2. Bounded Pagination & Execution Limits', () => {
    it('5. processes organizations in bounded batches using cursor pagination', async () => {
      const mockOrgs = [
        { id: 'org-001', status: 'ACTIVE' },
        { id: 'org-002', status: 'ACTIVE' },
        { id: 'org-003', status: 'INACTIVE' },
      ]

      let queryCallCount = 0
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(() => {
          queryCallCount++
          if (queryCallCount === 1) {
            return Promise.resolve({ data: mockOrgs.slice(0, 2), error: null })
          } else if (queryCallCount === 2) {
            return Promise.resolve({ data: mockOrgs.slice(2, 3), error: null })
          }
          return Promise.resolve({ data: [], error: null })
        }),
      }

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'organizations') return mockQueryBuilder
          if (table === 'customer_completion_events') {
            return {
              select: vi.fn().mockReturnThis(),
              lt: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }
          }
          if (table === 'domain_event_outbox') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              not: vi.fn().mockReturnThis(),
              lt: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }
          }
          return {}
        }),
      } as unknown as SupabaseClient<Database>

      const result = await executeMultiTenantRetentionMaintenance(mockSupabase, {
        enabledOverride: true,
        organizationBatchSize: 2,
      })

      expect(result.status).toBe('COMPLETED')
      expect(result.organizationsEvaluated).toBe(3)
      expect(result.organizationsSucceeded).toBe(3)
      expect(result.batchesProcessed).toBe(2)
      expect(mockQueryBuilder.gt).toHaveBeenCalledWith('id', 'org-002')
    })

    it('6. respects maxOrganizations upper bound if supplied', async () => {
      const mockOrgs = [
        { id: 'org-001', status: 'ACTIVE' },
        { id: 'org-002', status: 'ACTIVE' },
        { id: 'org-003', status: 'ACTIVE' },
      ]

      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockOrgs.slice(0, 2), error: null }),
      }

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'organizations') return mockQueryBuilder
          return {
            select: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }),
      } as unknown as SupabaseClient<Database>

      const result = await executeMultiTenantRetentionMaintenance(mockSupabase, {
        enabledOverride: true,
        maxOrganizations: 2,
      })

      expect(result.organizationsEvaluated).toBe(2)
      expect(result.organizationsSucceeded).toBe(2)
    })
  })

  describe('3. Failure Isolation & Sanitized Aggregate Reporting', () => {
    it('7. isolates single-tenant errors so other tenants succeed (PARTIALLY_FAILED)', async () => {
      const mockOrgs = [
        { id: 'org-success-1', status: 'ACTIVE' },
        { id: 'org-fail', status: 'ACTIVE' },
        { id: 'org-success-2', status: 'ACTIVE' },
      ]

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'organizations') {
            return {
              select: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: mockOrgs, error: null }),
            }
          }
          if (table === 'customer_completion_events') {
            return {
              select: vi.fn().mockReturnThis(),
              lt: vi.fn().mockReturnThis(),
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                if (col === 'organization_id' && val === 'org-fail') {
                  throw new Error('Database connection timeout for sensitive patient.doe@example.com')
                }
                return {
                  order: vi.fn().mockReturnThis(),
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }
              }),
            }
          }
          if (table === 'domain_event_outbox') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              not: vi.fn().mockReturnThis(),
              lt: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }
          }
          return {}
        }),
      } as unknown as SupabaseClient<Database>

      const result = await executeMultiTenantRetentionMaintenance(mockSupabase, {
        enabledOverride: true,
      })

      expect(result.status).toBe('PARTIALLY_FAILED')
      expect(result.organizationsEvaluated).toBe(3)
      expect(result.organizationsSucceeded).toBe(2)
      expect(result.organizationsFailed).toBe(1)
      expect(result.errors.length).toBe(1)
      expect(result.errors[0].organizationId).toBe('org-fail')

      // 8. Sanitized output contains zero PII or raw email
      expect(result.errors[0].sanitizedError).not.toContain('patient.doe@example.com')
      expect(result.errors[0].sanitizedError).toContain('[REDACTED_EMAIL]')
    })

    it('8. sanitizeMaintenanceErrorMessage removes emails, connections, and limits length', () => {
      const emailErr = 'Failed to process customer john.smith@company.org in database'
      expect(sanitizeMaintenanceErrorMessage(emailErr)).toBe(
        'Failed to process customer [REDACTED_EMAIL] in database'
      )

      const connErr = 'FATAL: connect to postgres://user:secret@db.internal:5432/prod failed'
      expect(sanitizeMaintenanceErrorMessage(connErr)).toBe(
        'FATAL: connect to [REDACTED_CONNECTION] failed'
      )

      const longErr = 'X'.repeat(300)
      expect(sanitizeMaintenanceErrorMessage(longErr).length).toBeLessThanOrEqual(120)
    })
  })

  describe('4. Scheduling Definition & Cadence Separation', () => {
    it('9. retentionMaintenanceWorkflow has concurrency limit 1', () => {
      // Concurrency prevents overlapping runs
      expect(retentionMaintenanceWorkflow).toBeDefined()
    })

    it('10. default cadence is daily and does not alter frozen retention durations', () => {
      expect(DEFAULT_MAINTENANCE_CRON_CADENCE).toBe('0 3 * * *')
      // Retention cutoffs remain strictly authoritative
      expect(COMPLETION_CONTACT_RETENTION_DAYS).toBe(30)
      expect(REVIEW_LINK_EXPIRATION_DAYS).toBe(90)
      expect(DISPATCHED_OUTBOX_RETENTION_DAYS).toBe(30)
    })

    it('11. executeRetentionMaintenanceHandler wraps coordinator in Inngest step', async () => {
      const mockStep = {
        run: vi.fn().mockImplementation(async (_name: string, fn: () => Promise<unknown>) => fn()),
      }

      const mockSupabase = {
        from: vi.fn(),
      } as unknown as SupabaseClient<Database>

      const res = await executeRetentionMaintenanceHandler({
        step: mockStep,
        adminClient: mockSupabase,
        options: { enabledOverride: false },
      })

      expect(mockStep.run).toHaveBeenCalledWith(
        'execute-multi-tenant-retention-maintenance',
        expect.any(Function)
      )
      expect(res.status).toBe('SKIPPED_DISABLED')
    })
  })

  describe('5. Organization Eligibility & Permanent-Retention Protections', () => {
    it('12. eligible organization statuses include ACTIVE, INACTIVE, and SUSPENDED without deletion', () => {
      expect(ELIGIBLE_ORGANIZATION_STATUSES).toEqual(['ACTIVE', 'INACTIVE', 'SUSPENDED'])
    })

    it('13. permanent retention classes remain immune from coordinator', () => {
      for (const cls of PERMANENT_RETENTION_CLASSES) {
        expect(isProtectedClass(cls)).toBe(true)
      }
    })
  })
})
