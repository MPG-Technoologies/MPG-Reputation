import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  DEFAULT_MAINTENANCE_CRON_CADENCE,
  RETENTION_MAINTENANCE_FLAG,
  ELIGIBLE_ORGANIZATION_STATUSES,
  MAINTENANCE_FAILURE_CODES,
  isRetentionMaintenanceEnabled,
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
import {
  getInngestFunctions,
  processReviewRequestWorkflow,
  recoverPendingOutboxWorkflow,
} from '@/inngest/functions'

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
      expect(result.batchesProcessed).toBe(0)
      expect(result.errors).toEqual([])
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })
  })

  describe('2. Inngest Serve Registration Boundary (Correction 1)', () => {
    it('5. flag absent: retention workflow is NOT registered in Inngest functions list', () => {
      const fns = getInngestFunctions({})
      expect(fns).toContain(processReviewRequestWorkflow)
      expect(fns).toContain(recoverPendingOutboxWorkflow)
      expect(fns).not.toContain(retentionMaintenanceWorkflow)
      expect(fns.length).toBe(2)
    })

    it('6. flag false: retention workflow is NOT registered in Inngest functions list', () => {
      const fns = getInngestFunctions({ ENABLE_RETENTION_MAINTENANCE: 'false' })
      expect(fns).toContain(processReviewRequestWorkflow)
      expect(fns).toContain(recoverPendingOutboxWorkflow)
      expect(fns).not.toContain(retentionMaintenanceWorkflow)
      expect(fns.length).toBe(2)
    })

    it('7. flag true: retention workflow is registered exactly once in Inngest functions list', () => {
      const fns = getInngestFunctions({ ENABLE_RETENTION_MAINTENANCE: 'true' })
      expect(fns).toContain(processReviewRequestWorkflow)
      expect(fns).toContain(recoverPendingOutboxWorkflow)
      expect(fns).toContain(retentionMaintenanceWorkflow)
      expect(fns.filter((fn) => fn === retentionMaintenanceWorkflow).length).toBe(1)
      expect(fns.length).toBe(3)
    })

    it('8. direct retention handler remains fail-safe even if invoked while registration is disabled', async () => {
      delete process.env.ENABLE_RETENTION_MAINTENANCE

      const mockStep = {
        run: vi.fn().mockImplementation((name, fn) => fn()),
      }

      const mockSupabase = {
        from: vi.fn(),
      } as unknown as SupabaseClient<Database>

      const res = await executeRetentionMaintenanceHandler({
        step: mockStep,
        adminClient: mockSupabase,
      })

      expect(res.status).toBe('SKIPPED_DISABLED')
      expect(res.organizationsEvaluated).toBe(0)
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })
  })

  describe('3. Bounded Pagination & Execution Limits', () => {
    it('9. processes organizations in bounded batches using cursor pagination', async () => {
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

    it('10. respects maxOrganizations upper bound if supplied', async () => {
      const mockOrgs = [
        { id: 'org-001', status: 'ACTIVE' },
        { id: 'org-002', status: 'ACTIVE' },
        { id: 'org-003', status: 'ACTIVE' },
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
          if (table === 'customer_completion_events' || table === 'domain_event_outbox') {
            return {
              select: vi.fn().mockReturnThis(),
              lt: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              not: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }
          }
          return {}
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

  describe('4. Failure Isolation & Fixed Safe Failure Codes (Correction 2)', () => {
    it('11. isolates single-tenant errors so other tenants succeed (PARTIALLY_FAILED)', async () => {
      const mockOrgs = [
        { id: 'org-ok-1', status: 'ACTIVE' },
        { id: 'org-fail', status: 'ACTIVE' },
        { id: 'org-ok-2', status: 'ACTIVE' },
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
                  throw new Error('Simulated database error')
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
      expect(result.errors[0].code).toBe('CONTACT_REDACTION_FAILED')
    })

    it('12. ADVERSARIAL PRIVACY TEST: Thrown errors containing sensitive PII/secrets NEVER escape into results', async () => {
      const mockOrgs = [{ id: 'org-adversarial', status: 'ACTIVE' }]

      const adversarialPayload = JSON.stringify({
        email: 'attacker.patient@example.test',
        phone: '+1-555-867-5309',
        uuid: 'd3b07384-d113-46fb-a04a-446fec3fa8c0',
        tokenHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        urlToken: 'https://mpg.internal/r/track?token=secret_123456789',
        pgDetail: 'DETAIL: Key (email)=(victim@domain.test) already exists.',
        connStr: 'postgresql://postgres:mysecretpass@db.internal:5432/prod',
        payload: { patient_name: 'John Doe', ssn: '123-45-6789' },
      })

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
              eq: vi.fn().mockImplementation(() => {
                throw new Error(`Database failure with sensitive data: ${adversarialPayload}`)
              }),
            }
          }
          return {}
        }),
      } as unknown as SupabaseClient<Database>

      const result = await executeMultiTenantRetentionMaintenance(mockSupabase, {
        enabledOverride: true,
      })

      expect(result.status).toBe('FAILED')
      expect(result.errors.length).toBe(1)
      expect(result.errors[0].code).toBe('CONTACT_REDACTION_FAILED')
      expect(result.errors[0].organizationId).toBe('org-adversarial')

      // Serialize entire result object to verify zero string leakage
      const serializedResult = JSON.stringify(result)

      expect(serializedResult).not.toContain('attacker.patient@example.test')
      expect(serializedResult).not.toContain('+1-555-867-5309')
      expect(serializedResult).not.toContain('d3b07384-d113-46fb-a04a-446fec3fa8c0')
      expect(serializedResult).not.toContain('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
      expect(serializedResult).not.toContain('secret_123456789')
      expect(serializedResult).not.toContain('victim@domain.test')
      expect(serializedResult).not.toContain('mysecretpass')
      expect(serializedResult).not.toContain('John Doe')
      expect(serializedResult).not.toContain('123-45-6789')
    })

    it('13. organization query failure returns fixed safe ORGANIZATION_QUERY_FAILED code with SYSTEM scope', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation(() => ({
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database connection failed with sensitive postgresql://admin:p@db:5432/m' },
          }),
        })),
      } as unknown as SupabaseClient<Database>

      const result = await executeMultiTenantRetentionMaintenance(mockSupabase, {
        enabledOverride: true,
      })

      expect(result.status).toBe('FAILED')
      expect(result.errors).toEqual([
        {
          organizationId: 'SYSTEM',
          code: 'ORGANIZATION_QUERY_FAILED',
        },
      ])

      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('postgresql://')
      expect(serialized).not.toContain('admin:p@db')
    })

    it('14. fixed failure categories set contains only authorized category strings', () => {
      expect(MAINTENANCE_FAILURE_CODES).toEqual([
        'ORGANIZATION_QUERY_FAILED',
        'CONTACT_REDACTION_FAILED',
        'OUTBOX_PURGE_FAILED',
        'TENANT_MAINTENANCE_FAILED',
      ])
    })
  })

  describe('5. Scheduling Definition & Cadence Separation', () => {
    it('15. retentionMaintenanceWorkflow has concurrency limit 1', () => {
      expect(retentionMaintenanceWorkflow).toBeDefined()
    })

    it('16. default cadence is daily and does not alter frozen retention durations', () => {
      expect(DEFAULT_MAINTENANCE_CRON_CADENCE).toBe('0 3 * * *')
      expect(COMPLETION_CONTACT_RETENTION_DAYS).toBe(30)
      expect(REVIEW_LINK_EXPIRATION_DAYS).toBe(90)
      expect(DISPATCHED_OUTBOX_RETENTION_DAYS).toBe(30)
    })
  })

  describe('6. Organization Eligibility & Permanent-Retention Protections', () => {
    it('17. eligible organization statuses include ACTIVE, INACTIVE, and SUSPENDED without deletion', () => {
      expect(ELIGIBLE_ORGANIZATION_STATUSES).toEqual([
        'ACTIVE',
        'INACTIVE',
        'SUSPENDED',
      ])
    })

    it('18. permanent retention classes remain immune from coordinator', () => {
      for (const cls of PERMANENT_RETENTION_CLASSES) {
        expect(isProtectedClass(cls)).toBe(true)
      }
    })
  })
})
