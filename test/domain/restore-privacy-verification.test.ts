import { describe, it, expect, vi } from 'vitest'
import {
  isPrivacyRestoreDeltaV1,
  isExactEmptyJsonObject,
  serializePrivacyRestoreDelta,
  deserializePrivacyRestoreDelta,
  collectPrivacyRestoreDelta,
  verifyRestoredPrivacyState,
  evaluateRestoreDecision,
  normalizePageSize,
  DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE,
  REVIEW_REQUEST_ID_CHUNK_SIZE,
  type PrivacyRestoreDeltaV1,
} from '@/domain/privacy/restore-verification'
import { CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME } from '@/domain/privacy/customer-erasure'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

type TableData = {
  customer_erasure_records?: Array<{
    organization_id: string
    customer_id: string
    erased_at: string
  }>
  suppressions?: Array<{
    id?: string
    organization_id: string
    channel: string
    contact_hash: string
    reason: string
    created_at: string
  }>
  customers?: Array<{
    id: string
    organization_id: string
    first_name: string | null
    last_name: string | null
    email: string | null
    phone: string | null
  }>
  customer_completion_events?: Array<{
    id: string
    organization_id: string
    customer_id: string
    contact: unknown
    source_customer_id: string | null
    source_transaction_id: string | null
    source_event_id: string
  }>
  review_requests?: Array<{
    id: string
    organization_id: string
    customer_id: string
    error_message: string | null
  }>
  message_events?: Array<{
    id: string
    organization_id: string
    review_request_id: string
    sanitized_error: string | null
  }>
}

function createMockSupabase(
  tables: TableData,
  options?: {
    shouldErrorTable?: string
    shouldThrow?: boolean
    failOnRangeFrom?: { table: string; from: number }
    serverMaxRows?: number
    onRequestRange?: (table: string, from: number, to: number) => void
    onInFilter?: (table: string, col: string, vals: unknown[]) => void
  }
) {
  return {
    from: (table: keyof TableData) => {
      if (options?.shouldThrow) {
        throw new Error('UNEXPECTED_DATABASE_EXCEPTION')
      }
      if (options?.shouldErrorTable === table) {
        const errorBuilder: Record<string, unknown> = {
          select: () => errorBuilder,
          gt: () => errorBuilder,
          lte: () => errorBuilder,
          eq: () => errorBuilder,
          in: () => errorBuilder,
          order: () => errorBuilder,
          range: () => errorBuilder,
          maybeSingle: () =>
            Promise.resolve({ data: null, error: new Error('DATABASE_ERROR') }),
          then: (resolve: (val: unknown) => unknown) =>
            Promise.resolve({ data: null, error: new Error('DATABASE_ERROR') }).then(resolve),
        }
        return errorBuilder as unknown
      }

      let rows = [...((tables[table] as unknown[]) || [])]

      const builder: Record<string, unknown> = {
        select: () => builder,
        gt: (col: string, val: string) => {
          rows = rows.filter((r: unknown) => {
            const item = r as Record<string, unknown>
            return new Date(item[col] as string).getTime() > new Date(val).getTime()
          })
          return builder
        },
        lte: (col: string, val: string) => {
          rows = rows.filter((r: unknown) => {
            const item = r as Record<string, unknown>
            return new Date(item[col] as string).getTime() <= new Date(val).getTime()
          })
          return builder
        },
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r: unknown) => {
            const item = r as Record<string, unknown>
            return item[col] === val
          })
          return builder
        },
        in: (col: string, vals: unknown[]) => {
          if (options?.onInFilter) {
            options.onInFilter(table, col, vals)
          }
          rows = rows.filter((r: unknown) => {
            const item = r as Record<string, unknown>
            return vals.includes(item[col])
          })
          return builder
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          const asc = opts?.ascending !== false
          rows.sort((a: unknown, b: unknown) => {
            const av = (a as Record<string, unknown>)[col] as string
            const bv = (b as Record<string, unknown>)[col] as string
            if (av < bv) return asc ? -1 : 1
            if (av > bv) return asc ? 1 : -1
            return 0
          })
          return builder
        },
        range: (from: number, to: number) => {
          if (options?.onRequestRange) {
            options.onRequestRange(table, from, to)
          }
          if (
            options?.failOnRangeFrom &&
            options.failOnRangeFrom.table === table &&
            options.failOnRangeFrom.from === from
          ) {
            return {
              then: (resolve: (val: unknown) => unknown) =>
                Promise.resolve({ data: null, error: new Error('PAGE_READ_ERROR') }).then(resolve),
            }
          }
          const requestedSlice = rows.slice(from, to + 1)
          if (options?.serverMaxRows && options.serverMaxRows > 0) {
            rows = requestedSlice.slice(0, options.serverMaxRows)
          } else {
            rows = requestedSlice
          }
          return builder
        },
        maybeSingle: () => {
          return Promise.resolve({
            data: rows.length > 0 ? rows[0] : null,
            error: null,
          })
        },
        then: (resolve: (val: unknown) => unknown) => {
          return Promise.resolve({ data: rows, error: null }).then(resolve)
        },
      }

      return builder
    },
  } as unknown as SupabaseClient<Database>
}

describe('MR-7C.5C1 Post-Restore Privacy Verification Foundation', () => {
  const orgA = '11111111-1111-4111-8111-111111111111'
  const orgB = '22222222-2222-4222-8222-222222222222'
  const cust1 = '33333333-3333-4333-8333-333333333333'
  const cust2 = '44444444-4444-4444-8444-444444444444'

  const validHash1 = 'a'.repeat(64)
  const validHash2 = 'b'.repeat(64)
  const validHash3 = 'c'.repeat(64)
  const validHash4 = 'd'.repeat(64)

  const tBackup = '2026-10-01T00:00:00.000Z'
  const tBefore = '2026-09-30T12:00:00.000Z'
  const tEqual = '2026-10-01T00:00:00.000Z'
  const tAfter1 = '2026-10-02T10:00:00.000Z'
  const tAfter2 = '2026-10-03T15:00:00.000Z'
  const tAfter3 = '2026-10-04T12:00:00.000Z'

  // 1. Valid empty delta passes.
  it('1. Valid empty delta passes', async () => {
    const emptyDelta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [],
      suppressions: [],
    }

    expect(isPrivacyRestoreDeltaV1(emptyDelta)).toBe(true)
    const mockDb = createMockSupabase({})
    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta: emptyDelta })

    expect(result.ok).toBe(true)
    expect(result.decision).toBe('PASS')
    expect(result.erasureRecordsChecked).toBe(0)
    expect(result.suppressionRecordsChecked).toBe(0)
    expect(result.missingErasureProtections).toBe(0)
    expect(result.missingSuppressions).toBe(0)
    expect(result.reason).toBe('ALL_VERIFIED')
  })

  // 2. Invalid schema version fails closed.
  it('2. Invalid schema version fails closed', async () => {
    const invalidDelta = {
      schemaVersion: '2.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [],
      suppressions: [],
    }

    expect(isPrivacyRestoreDeltaV1(invalidDelta)).toBe(false)
    const mockDb = createMockSupabase({})
    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta: invalidDelta })

    expect(result.ok).toBe(false)
    expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
    expect(result.reason).toBe('INVALID_DELTA_SCHEMA')
  })

  // 3. Invalid backup timestamp fails.
  it('3. Invalid backup timestamp fails', async () => {
    const mockDb = createMockSupabase({})

    // In collector
    const collectRes = await collectPrivacyRestoreDelta({
      supabase: mockDb,
      backupCreatedAt: 'invalid-date-string',
    })
    expect(collectRes.ok).toBe(false)
    if (!collectRes.ok) {
      expect(collectRes.status).toBe('INVALID_TIMESTAMP')
    }

    // In verifier
    const deltaWithBadTime = {
      schemaVersion: '1.0',
      backupCreatedAt: 'not-a-timestamp',
      exportedAt: tAfter2,
      erasures: [],
      suppressions: [],
    }
    const verifyRes = await verifyRestoredPrivacyState({ supabase: mockDb, delta: deltaWithBadTime })
    expect(verifyRes.ok).toBe(false)
    expect(verifyRes.decision).toBe('BLOCK_RESTORE_ACTIVATION')
    expect(verifyRes.reason).toBe('INVALID_DELTA_SCHEMA')
  })

  // 4. Collector includes erasures after backup timestamp.
  it('4. Collector includes erasures after backup timestamp', async () => {
    const mockDb = createMockSupabase({
      customer_erasure_records: [
        { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
      ],
      suppressions: [],
    })

    const res = await collectPrivacyRestoreDelta({
      supabase: mockDb,
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.delta.erasures).toHaveLength(1)
      expect(res.delta.erasures[0]).toEqual({
        organizationId: orgA,
        customerId: cust1,
        erasedAt: tAfter1,
      })
    }
  })

  // 5. Collector excludes erasures before/equal backup timestamp according to frozen boundary semantics.
  it('5. Collector excludes erasures before/equal backup timestamp according to frozen boundary semantics', async () => {
    const mockDb = createMockSupabase({
      customer_erasure_records: [
        { organization_id: orgA, customer_id: cust1, erased_at: tBefore },
        { organization_id: orgA, customer_id: cust2, erased_at: tEqual },
      ],
      suppressions: [],
    })

    const res = await collectPrivacyRestoreDelta({
      supabase: mockDb,
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.delta.erasures).toHaveLength(0)
    }
  })

  // 6. Collector includes suppressions after backup timestamp.
  it('6. Collector includes suppressions after backup timestamp', async () => {
    const mockDb = createMockSupabase({
      customer_erasure_records: [],
      suppressions: [
        {
          organization_id: orgA,
          channel: 'email',
          contact_hash: validHash1,
          reason: 'UNSUBSCRIBE',
          created_at: tAfter1,
        },
        {
          organization_id: orgA,
          channel: 'email',
          contact_hash: validHash2,
          reason: 'UNSUBSCRIBE',
          created_at: tBefore,
        },
      ],
    })

    const res = await collectPrivacyRestoreDelta({
      supabase: mockDb,
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.delta.suppressions).toHaveLength(1)
      expect(res.delta.suppressions[0].contactHash).toBe(validHash1)
    }
  })

  // 7. Collector contains zero raw contact PII; pseudonymous suppression hashes retained.
  it('7. Collector contains zero raw contact PII; pseudonymous suppression hashes retained', async () => {
    const mockDb = createMockSupabase({
      customer_erasure_records: [
        { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
      ],
      suppressions: [
        {
          organization_id: orgA,
          channel: 'email',
          contact_hash: validHash1,
          reason: 'UNSUBSCRIBE',
          created_at: tAfter1,
        },
      ],
    })

    const res = await collectPrivacyRestoreDelta({
      supabase: mockDb,
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      const serialized = serializePrivacyRestoreDelta(res.delta)
      expect(serialized).not.toContain('first_name')
      expect(serialized).not.toContain('last_name')
      expect(serialized).not.toContain('email@')
      expect(serialized).not.toContain('phone')
      expect(serialized).not.toContain('password')
      expect(serialized).not.toContain('token')
      expect(serialized).not.toContain('secret')
      expect(serialized).toContain(validHash1) // Retained as pseudonymous suppression continuity evidence
    }
  })

  // 8. Collector uses deterministic ordering.
  it('8. Collector uses deterministic ordering', async () => {
    const mockDb = createMockSupabase({
      customer_erasure_records: [
        { organization_id: orgB, customer_id: cust2, erased_at: tAfter2 },
        { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
      ],
      suppressions: [
        {
          organization_id: orgB,
          channel: 'email',
          contact_hash: validHash2,
          reason: 'BOUNCE',
          created_at: tAfter2,
        },
        {
          organization_id: orgA,
          channel: 'email',
          contact_hash: validHash1,
          reason: 'UNSUBSCRIBE',
          created_at: tAfter1,
        },
      ],
    })

    const res = await collectPrivacyRestoreDelta({
      supabase: mockDb,
      backupCreatedAt: tBackup,
      exportedAt: tAfter3,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      // First is tAfter1, then tAfter2
      expect(res.delta.erasures[0].erasedAt).toBe(tAfter1)
      expect(res.delta.erasures[1].erasedAt).toBe(tAfter2)
      expect(res.delta.suppressions[0].createdAt).toBe(tAfter1)
      expect(res.delta.suppressions[1].createdAt).toBe(tAfter2)
    }
  })

  // 9. Database read failure returns fail-closed/unavailable.
  it('9. Database read failure returns fail-closed/unavailable', async () => {
    const errorDb = createMockSupabase({}, { shouldErrorTable: 'customer_erasure_records' })

    const res = await collectPrivacyRestoreDelta({
      supabase: errorDb,
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe('UNAVAILABLE')
      expect(res.error).toBe('DATABASE_READ_ERROR')
    }
  })

  // 10. Correctly erased customer with certificate and empty contact passes verification.
  it('10. Correctly erased customer with certificate and empty contact passes verification', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
      suppressions: [],
    }

    const mockDb = createMockSupabase({
      customers: [
        {
          id: cust1,
          organization_id: orgA,
          first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_erasure_records: [
        {
          organization_id: orgA,
          customer_id: cust1,
          erased_at: tAfter1,
        },
      ],
      customer_completion_events: [
        {
          id: 'comp1',
          organization_id: orgA,
          customer_id: cust1,
          contact: {},
          source_customer_id: null,
          source_transaction_id: null,
          source_event_id: 'evt_123',
        },
      ],
      review_requests: [
        { id: 'rr1', organization_id: orgA, customer_id: cust1, error_message: null },
      ],
      message_events: [
        { id: 'me1', organization_id: orgA, review_request_id: 'rr1', sanitized_error: null },
      ],
    })

    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
    expect(result.ok).toBe(true)
    expect(result.decision).toBe('PASS')
    expect(result.missingErasureProtections).toBe(0)
    expect(evaluateRestoreDecision(result)).toBe('PASS')
  })

  // 11. Resurrected email causes restore block.
  it('11. Resurrected email causes restore block', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
      suppressions: [],
    }

    const mockDb = createMockSupabase({
      customers: [
        {
          id: cust1,
          organization_id: orgA,
          first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
          last_name: null,
          email: 'resurrected@example.test',
          phone: null,
        },
      ],
      customer_erasure_records: [
        { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
      ],
    })

    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
    expect(result.ok).toBe(false)
    expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
    expect(result.missingErasureProtections).toBe(1)
    expect(evaluateRestoreDecision(result)).toBe('BLOCK_RESTORE_ACTIVATION')
  })

  // 12. Resurrected phone causes restore block.
  it('12. Resurrected phone causes restore block', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
      suppressions: [],
    }

    const mockDb = createMockSupabase({
      customers: [
        {
          id: cust1,
          organization_id: orgA,
          first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
          last_name: null,
          email: null,
          phone: '+15551234567',
        },
      ],
      customer_erasure_records: [
        { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
      ],
    })

    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
    expect(result.ok).toBe(false)
    expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
    expect(result.missingErasureProtections).toBe(1)
  })

  // 13. Restored first/last name PII causes restore block.
  it('13. Restored first/last name PII causes restore block', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
      suppressions: [],
    }

    const mockDbFirstName = createMockSupabase({
      customers: [
        {
          id: cust1,
          organization_id: orgA,
          first_name: 'John',
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_erasure_records: [
        { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
      ],
    })
    const res1 = await verifyRestoredPrivacyState({ supabase: mockDbFirstName, delta })
    expect(res1.ok).toBe(false)
    expect(res1.missingErasureProtections).toBe(1)

    const mockDbLastName = createMockSupabase({
      customers: [
        {
          id: cust1,
          organization_id: orgA,
          first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
          last_name: 'Doe',
          email: null,
          phone: null,
        },
      ],
      customer_erasure_records: [
        { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
      ],
    })
    const res2 = await verifyRestoredPrivacyState({ supabase: mockDbLastName, delta })
    expect(res2.ok).toBe(false)
    expect(res2.missingErasureProtections).toBe(1)
  })

  // 14. Restored source_customer_id causes restore block.
  it('14. Restored source_customer_id causes restore block', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
      suppressions: [],
    }

    const mockDb = createMockSupabase({
      customers: [
        {
          id: cust1,
          organization_id: orgA,
          first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_erasure_records: [
        { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
      ],
      customer_completion_events: [
        {
          id: 'comp1',
          organization_id: orgA,
          customer_id: cust1,
          contact: {},
          source_customer_id: 'crm_cust_999',
          source_transaction_id: null,
          source_event_id: 'evt_123',
        },
      ],
    })

    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
    expect(result.ok).toBe(false)
    expect(result.missingErasureProtections).toBe(1)
  })

  // 15. Restored source_transaction_id causes restore block.
  it('15. Restored source_transaction_id causes restore block', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
      suppressions: [],
    }

    const mockDb = createMockSupabase({
      customers: [
        {
          id: cust1,
          organization_id: orgA,
          first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_erasure_records: [
        { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
      ],
      customer_completion_events: [
        {
          id: 'comp1',
          organization_id: orgA,
          customer_id: cust1,
          contact: {},
          source_customer_id: null,
          source_transaction_id: 'tx_777',
          source_event_id: 'evt_123',
        },
      ],
    })

    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
    expect(result.ok).toBe(false)
    expect(result.missingErasureProtections).toBe(1)
  })

  // 16. Retained source_event_id does NOT cause failure.
  it('16. Retained source_event_id does NOT cause failure', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
      suppressions: [],
    }

    const mockDb = createMockSupabase({
      customers: [
        {
          id: cust1,
          organization_id: orgA,
          first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_erasure_records: [
        { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
      ],
      customer_completion_events: [
        {
          id: 'comp1',
          organization_id: orgA,
          customer_id: cust1,
          contact: {},
          source_customer_id: null,
          source_transaction_id: null,
          source_event_id: 'idempotent_event_key_abc',
        },
      ],
    })

    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
    expect(result.ok).toBe(true)
    expect(result.missingErasureProtections).toBe(0)
  })

  // 17. Missing suppression causes restore block.
  it('17. Missing suppression causes restore block', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [],
      suppressions: [
        {
          organizationId: orgA,
          channel: 'email',
          contactHash: validHash1,
          reason: 'UNSUBSCRIBE',
          createdAt: tAfter1,
        },
      ],
    }

    const mockDb = createMockSupabase({ suppressions: [] })
    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })

    expect(result.ok).toBe(false)
    expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
    expect(result.missingSuppressions).toBe(1)
  })

  // 18. Present suppression passes.
  it('18. Present suppression passes', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [],
      suppressions: [
        {
          organizationId: orgA,
          channel: 'email',
          contactHash: validHash1,
          reason: 'UNSUBSCRIBE',
          createdAt: tAfter1,
        },
      ],
    }

    const mockDb = createMockSupabase({
      suppressions: [
        {
          organization_id: orgA,
          channel: 'email',
          contact_hash: validHash1,
          reason: 'UNSUBSCRIBE',
          created_at: tAfter1,
        },
      ],
    })

    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
    expect(result.ok).toBe(true)
    expect(result.decision).toBe('PASS')
    expect(result.missingSuppressions).toBe(0)
  })

  // 19. Hash values are not returned in result/log output.
  it('19. Hash values are not returned in result/log output', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [],
      suppressions: [
        {
          organizationId: orgA,
          channel: 'email',
          contactHash: validHash1,
          reason: 'BOUNCE',
          createdAt: tAfter1,
        },
      ],
    }

    const mockDb = createMockSupabase({ suppressions: [] })
    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })

    const serializedResult = JSON.stringify(result)
    expect(serializedResult).not.toContain(validHash1)
  })

  // 20. Multiple organizations remain correctly scoped.
  it('20. Multiple organizations remain correctly scoped', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
      suppressions: [
        {
          organizationId: orgA,
          channel: 'email',
          contactHash: validHash1,
          reason: 'UNSUBSCRIBE',
          createdAt: tAfter1,
        },
      ],
    }

    // Customer and suppression exist under orgB, NOT orgA
    const mockDb = createMockSupabase({
      customers: [
        {
          id: cust1,
          organization_id: orgB,
          first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_erasure_records: [
        {
          organization_id: orgB,
          customer_id: cust1,
          erased_at: tAfter1,
        },
      ],
      suppressions: [
        {
          organization_id: orgB,
          channel: 'email',
          contact_hash: validHash1,
          reason: 'UNSUBSCRIBE',
          created_at: tAfter1,
        },
      ],
    })

    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
    // Fails because orgA records are missing
    expect(result.ok).toBe(false)
    expect(result.missingErasureProtections).toBe(1)
    expect(result.missingSuppressions).toBe(1)
  })

  // 21. No browser/client import path exposes the verifier (Portable Path).
  it('21. No browser/client import path exposes the verifier (Portable Path)', () => {
    const filePath = path.resolve(process.cwd(), 'src/domain/privacy/restore-verification.ts')
    const content = fs.readFileSync(filePath, 'utf-8')
    const firstLine = content.split('\n')[0].trim()
    expect(firstLine).toBe("import 'server-only'")
  })

  // 22. Verification result contains aggregate safe fields only.
  it('22. Verification result contains aggregate safe fields only', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
      suppressions: [
        {
          organizationId: orgA,
          channel: 'email',
          contactHash: validHash1,
          reason: 'UNSUBSCRIBE',
          createdAt: tAfter1,
        },
      ],
    }

    const mockDb = createMockSupabase({
      customers: [
        {
          id: cust1,
          organization_id: orgA,
          first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_erasure_records: [
        {
          organization_id: orgA,
          customer_id: cust1,
          erased_at: tAfter1,
        },
      ],
      suppressions: [
        {
          organization_id: orgA,
          channel: 'email',
          contact_hash: validHash1,
          reason: 'UNSUBSCRIBE',
          created_at: tAfter1,
        },
      ],
    })

    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
    const keys = Object.keys(result).sort()
    expect(keys).toEqual([
      'decision',
      'erasureRecordsChecked',
      'missingErasureProtections',
      'missingSuppressions',
      'ok',
      'reason',
      'schemaVersion',
      'suppressionRecordsChecked',
    ])
  })

  // 23. Unexpected DB errors fail closed.
  it('23. Unexpected DB errors fail closed', async () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
      suppressions: [],
    }

    const throwingDb = createMockSupabase({}, { shouldThrow: true })
    const result = await verifyRestoredPrivacyState({ supabase: throwingDb, delta })

    expect(result.ok).toBe(false)
    expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
    expect(result.reason).toBe('DATABASE_ERROR')
    expect(result.erasureRecordsChecked).toBe(0)
  })

  // 24. Existing customer erasure constant parity.
  it('24. Existing customer erasure constant parity', () => {
    expect(CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME).toBe('[Deleted Customer]')
  })

  // 25. Delta serialization / deserialization roundtrip.
  it('25. Delta serialization / deserialization roundtrip', () => {
    const delta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: tBackup,
      exportedAt: tAfter2,
      erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
      suppressions: [
        {
          organizationId: orgA,
          channel: 'email',
          contactHash: validHash1,
          reason: 'UNSUBSCRIBE',
          createdAt: tAfter1,
        },
      ],
    }

    const serialized = serializePrivacyRestoreDelta(delta)
    const deserialized = deserializePrivacyRestoreDelta(serialized)
    expect(deserialized).toEqual(delta)
    expect(deserializePrivacyRestoreDelta('{ invalid: json }')).toBeNull()
  })

  // =========================================================================
  // PAGE SIZE NORMALIZATION TESTS
  // =========================================================================
  describe('Page Size Normalization', () => {
    it('normalizes valid positive integers', () => {
      expect(normalizePageSize(100)).toBe(100)
      expect(normalizePageSize(1)).toBe(1)
      expect(normalizePageSize(5000)).toBe(5000)
    })

    it('normalizes fractional numbers by flooring', () => {
      expect(normalizePageSize(10.8)).toBe(10)
      expect(normalizePageSize(1.1)).toBe(1)
    })

    it('falls back to default on non-numbers, negative, zero, NaN, and Infinity', () => {
      expect(normalizePageSize(undefined)).toBe(DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE)
      expect(normalizePageSize(0)).toBe(DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE)
      expect(normalizePageSize(-10)).toBe(DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE)
      expect(normalizePageSize(NaN)).toBe(DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE)
      expect(normalizePageSize(Infinity)).toBe(DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE)
      expect(normalizePageSize(-Infinity)).toBe(DEFAULT_RESTORE_VERIFICATION_PAGE_SIZE)
    })
  })

  // =========================================================================
  // CAP-SAFE PAGINATION & SERVER ROW-CAP INVARIANTS
  // =========================================================================
  describe('Cap-Safe Pagination and Server Cap Invariants', () => {
    it('1. Collector: requested pageSize = 2000, simulated server max rows = 1000, 1500+ erasure rows -> ALL rows collected', async () => {
      const totalRecords = 1550
      const erasureRows = Array.from({ length: totalRecords }, (_, i) => ({
        organization_id: orgA,
        customer_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        erased_at: new Date(Date.parse(tBackup) + (i + 1) * 1000).toISOString(),
      }))

      const requestedRanges: Array<{ from: number; to: number }> = []
      const mockDb = createMockSupabase(
        {
          customer_erasure_records: erasureRows,
          suppressions: [],
        },
        {
          serverMaxRows: 1000, // Server caps each response to 1000 rows
          onRequestRange: (table, from, to) => {
            if (table === 'customer_erasure_records') {
              requestedRanges.push({ from, to })
            }
          },
        }
      )

      const res = await collectPrivacyRestoreDelta({
        supabase: mockDb,
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        pageSize: 2000, // Client requests 2000 rows
      })

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.delta.erasures).toHaveLength(totalRecords)
        expect(res.delta.erasures[0].customerId).toBe(erasureRows[0].customer_id)
        expect(res.delta.erasures[totalRecords - 1].customerId).toBe(
          erasureRows[totalRecords - 1].customer_id
        )

        // Verify exact offset progression:
        // Request 1: 0..1999 -> server returned 1000 rows
        // Request 2: 1000..2999 -> server returned 550 rows
        // Request 3: 1550..3549 -> server returned 0 rows -> completed
        expect(requestedRanges).toEqual([
          { from: 0, to: 1999 },
          { from: 1000, to: 2999 },
          { from: 1550, to: 3549 },
        ])
      }
    })

    it('2. Collector: requested pageSize = 2000, simulated server max rows = 1000, 1500+ suppressions -> ALL rows collected', async () => {
      const totalRecords = 1550
      const suppressionRows = Array.from({ length: totalRecords }, (_, i) => ({
        organization_id: orgA,
        channel: 'email',
        contact_hash: String(i).padStart(64, '0'),
        reason: 'UNSUBSCRIBE',
        created_at: new Date(Date.parse(tBackup) + (i + 1) * 1000).toISOString(),
      }))

      const mockDb = createMockSupabase(
        {
          customer_erasure_records: [],
          suppressions: suppressionRows,
        },
        {
          serverMaxRows: 1000,
        }
      )

      const res = await collectPrivacyRestoreDelta({
        supabase: mockDb,
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        pageSize: 2000,
      })

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.delta.suppressions).toHaveLength(totalRecords)
      }
    })

    it('3. Verifier: requested pageSize > simulated server cap, unsafe completion row exists after server-capped first response -> BLOCK_RESTORE_ACTIVATION', async () => {
      // Total 1500 completion events; row 1200 has non-empty contact
      const completionRows = Array.from({ length: 1500 }, (_, i) => ({
        id: `comp-${String(i).padStart(5, '0')}`,
        organization_id: orgA,
        customer_id: cust1,
        contact: i === 1200 ? { email: 'leak@example.test' } : {},
        source_customer_id: null,
        source_transaction_id: null,
        source_event_id: `evt-${i}`,
      }))

      const delta: PrivacyRestoreDeltaV1 = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
        suppressions: [],
      }

      const mockDb = createMockSupabase(
        {
          customers: [
            {
              id: cust1,
              organization_id: orgA,
              first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
              last_name: null,
              email: null,
              phone: null,
            },
          ],
          customer_erasure_records: [
            { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
          ],
          customer_completion_events: completionRows,
        },
        {
          serverMaxRows: 1000, // Capped to 1000
        }
      )

      const result = await verifyRestoredPrivacyState({
        supabase: mockDb,
        delta,
        pageSize: 2000, // Requested 2000
      })

      expect(result.ok).toBe(false)
      expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
      expect(result.missingErasureProtections).toBe(1)
    })

    it('4. Verifier: unsafe review_request.error_message exists after first server-capped response -> blocks', async () => {
      const reviewRows = Array.from({ length: 1500 }, (_, i) => ({
        id: `rr-${String(i).padStart(5, '0')}`,
        organization_id: orgA,
        customer_id: cust1,
        error_message: i === 1200 ? 'Unscrubbed provider error leak' : null,
      }))

      const delta: PrivacyRestoreDeltaV1 = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
        suppressions: [],
      }

      const mockDb = createMockSupabase(
        {
          customers: [
            {
              id: cust1,
              organization_id: orgA,
              first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
              last_name: null,
              email: null,
              phone: null,
            },
          ],
          customer_erasure_records: [
            { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
          ],
          review_requests: reviewRows,
        },
        {
          serverMaxRows: 1000,
        }
      )

      const result = await verifyRestoredPrivacyState({
        supabase: mockDb,
        delta,
        pageSize: 2000,
      })

      expect(result.ok).toBe(false)
      expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
      expect(result.missingErasureProtections).toBe(1)
    })

    it('5. Verifier: unsafe message_events.sanitized_error exists after first server-capped response -> blocks', async () => {
      const reviewRows = [
        {
          id: 'rr-00001',
          organization_id: orgA,
          customer_id: cust1,
          error_message: null,
        },
      ]

      // 1500 message events for review request rr-00001; row 1200 has sanitized_error leak
      const messageRows = Array.from({ length: 1500 }, (_, i) => ({
        id: `me-${String(i).padStart(5, '0')}`,
        organization_id: orgA,
        review_request_id: 'rr-00001',
        sanitized_error: i === 1200 ? 'Raw provider error text leak' : null,
      }))

      const delta: PrivacyRestoreDeltaV1 = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
        suppressions: [],
      }

      const mockDb = createMockSupabase(
        {
          customers: [
            {
              id: cust1,
              organization_id: orgA,
              first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
              last_name: null,
              email: null,
              phone: null,
            },
          ],
          customer_erasure_records: [
            { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
          ],
          review_requests: reviewRows,
          message_events: messageRows,
        },
        {
          serverMaxRows: 1000,
        }
      )

      const result = await verifyRestoredPrivacyState({
        supabase: mockDb,
        delta,
        pageSize: 2000,
      })

      expect(result.ok).toBe(false)
      expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
      expect(result.missingErasureProtections).toBe(1)
    })

    it('6. Short non-empty page is NOT treated as exhaustion and advances offset by actual rows', async () => {
      // 15 items in table
      const totalRecords = 15
      const erasureRows = Array.from({ length: totalRecords }, (_, i) => ({
        organization_id: orgA,
        customer_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        erased_at: new Date(Date.parse(tBackup) + (i + 1) * 1000).toISOString(),
      }))

      // Simulated server caps at 6 items per query
      const requestedRanges: Array<{ from: number; to: number }> = []
      const mockDb = createMockSupabase(
        {
          customer_erasure_records: erasureRows,
          suppressions: [],
        },
        {
          serverMaxRows: 6,
          onRequestRange: (table, from, to) => {
            if (table === 'customer_erasure_records') {
              requestedRanges.push({ from, to })
            }
          },
        }
      )

      const res = await collectPrivacyRestoreDelta({
        supabase: mockDb,
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        pageSize: 10, // Client requested 10
      })

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.delta.erasures).toHaveLength(15)

        // Request 1: 0..9 -> server returns 6 items (rows 0..5) -> offset 6
        // Request 2: 6..15 -> server returns 6 items (rows 6..11) -> offset 12
        // Request 3: 12..21 -> server returns 3 items (rows 12..14, a SHORT PAGE) -> offset 15
        // Request 4: 15..24 -> server returns 0 items -> BREAK!
        expect(requestedRanges).toEqual([
          { from: 0, to: 9 },
          { from: 6, to: 15 },
          { from: 12, to: 21 },
          { from: 15, to: 24 },
        ])
      }
    })

    it('7. Only an explicit empty page establishes enumeration completion', async () => {
      // 4 items
      const erasureRows = Array.from({ length: 4 }, (_, i) => ({
        organization_id: orgA,
        customer_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        erased_at: new Date(Date.parse(tBackup) + (i + 1) * 1000).toISOString(),
      }))

      let queriesMade = 0
      const mockDb = createMockSupabase(
        {
          customer_erasure_records: erasureRows,
          suppressions: [],
        },
        {
          serverMaxRows: 4, // Exactly returns 4 items on query 1
          onRequestRange: (table) => {
            if (table === 'customer_erasure_records') {
              queriesMade++
            }
          },
        }
      )

      const res = await collectPrivacyRestoreDelta({
        supabase: mockDb,
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        pageSize: 4,
      })

      expect(res.ok).toBe(true)
      // Must have made 2 queries: first query got 4 items, second query got 0 items (explicit empty page!)
      expect(queriesMade).toBe(2)
    })

    it('8. Page-N query failure fails closed', async () => {
      const erasureRows = Array.from({ length: 20 }, (_, i) => ({
        organization_id: orgA,
        customer_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        erased_at: new Date(Date.parse(tBackup) + (i + 1) * 1000).toISOString(),
      }))

      // Fail on range from = 5 (page 2 when server returns 5 per page)
      const mockDb = createMockSupabase(
        {
          customer_erasure_records: erasureRows,
          suppressions: [],
        },
        {
          serverMaxRows: 5,
          failOnRangeFrom: { table: 'customer_erasure_records', from: 5 },
        }
      )

      const res = await collectPrivacyRestoreDelta({
        supabase: mockDb,
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        pageSize: 10,
      })

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.status).toBe('UNAVAILABLE')
        expect(res.error).toBe('DATABASE_READ_ERROR')
      }
    })

    it('9. No duplicate or skipped rows across capped-page boundaries', async () => {
      const totalRecords = 25
      const suppressionRows = Array.from({ length: totalRecords }, (_, i) => ({
        organization_id: orgA,
        channel: 'email',
        contact_hash: String(i).padStart(64, '0'),
        reason: 'UNSUBSCRIBE',
        created_at: new Date(Date.parse(tBackup) + (i + 1) * 1000).toISOString(),
      }))

      const mockDb = createMockSupabase(
        {
          customer_erasure_records: [],
          suppressions: suppressionRows,
        },
        {
          serverMaxRows: 7, // Weird server cap
        }
      )

      const res = await collectPrivacyRestoreDelta({
        supabase: mockDb,
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        pageSize: 10,
      })

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.delta.suppressions).toHaveLength(totalRecords)
        const hashes = res.delta.suppressions.map((s) => s.contactHash)
        const uniqueHashes = new Set(hashes)
        expect(uniqueHashes.size).toBe(totalRecords) // Zero duplicates, zero omitted!
      }
    })

    it('10. Large review request ID set is chunked into bounded groups for message_events verification', async () => {
      // 250 review requests for cust1
      const totalRequests = 250
      const reviewRows = Array.from({ length: totalRequests }, (_, i) => ({
        id: `rr-${String(i).padStart(5, '0')}`,
        organization_id: orgA,
        customer_id: cust1,
        error_message: null,
      }))

      // Message events for the 250 requests
      const messageRows = Array.from({ length: totalRequests }, (_, i) => ({
        id: `me-${String(i).padStart(5, '0')}`,
        organization_id: orgA,
        review_request_id: `rr-${String(i).padStart(5, '0')}`,
        sanitized_error: null,
      }))

      const delta: PrivacyRestoreDeltaV1 = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
        suppressions: [],
      }

      const inFilterSizes: number[] = []
      const mockDb = createMockSupabase(
        {
          customers: [
            {
              id: cust1,
              organization_id: orgA,
              first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
              last_name: null,
              email: null,
              phone: null,
            },
          ],
          customer_erasure_records: [
            {
              organization_id: orgA,
              customer_id: cust1,
              erased_at: tAfter1,
            },
          ],
          customer_completion_events: [],
          review_requests: reviewRows,
          message_events: messageRows,
          suppressions: [],
        },
        {
          onInFilter: (table, _col, vals) => {
            if (table === 'message_events') {
              inFilterSizes.push(vals.length)
            }
          },
        }
      )

      const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })

      expect(result.ok).toBe(true)
      expect(result.decision).toBe('PASS')
      expect(result.missingErasureProtections).toBe(0)

      // Verified chunk sizes: 250 requests partitioned into [100, 100, 50],
      // with each chunk queried twice (first page of data, second explicit empty page)
      expect(inFilterSizes).toEqual([
        REVIEW_REQUEST_ID_CHUNK_SIZE,
        REVIEW_REQUEST_ID_CHUNK_SIZE,
        REVIEW_REQUEST_ID_CHUNK_SIZE,
        REVIEW_REQUEST_ID_CHUNK_SIZE,
        50,
        50,
      ])
    })
  })

  // =========================================================================
  // CORRECTION 2: DURABLE ERASURE CERTIFICATE VERIFICATION
  // =========================================================================
  describe('Correction 2: Durable Erasure Certificate Invariants', () => {
    it('Certificate present -> passes', async () => {
      const delta: PrivacyRestoreDeltaV1 = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
        suppressions: [],
      }

      const mockDb = createMockSupabase({
        customers: [
          {
            id: cust1,
            organization_id: orgA,
            first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
            last_name: null,
            email: null,
            phone: null,
          },
        ],
        customer_erasure_records: [
          { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
        ],
      })

      const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
      expect(result.ok).toBe(true)
      expect(result.decision).toBe('PASS')
      expect(result.missingErasureProtections).toBe(0)
    })

    it('Missing erasure certificate -> BLOCK_RESTORE_ACTIVATION even if customer row looks erased', async () => {
      const delta: PrivacyRestoreDeltaV1 = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
        suppressions: [],
      }

      // Customer looks erased, but customer_erasure_records is empty!
      const mockDb = createMockSupabase({
        customers: [
          {
            id: cust1,
            organization_id: orgA,
            first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
            last_name: null,
            email: null,
            phone: null,
          },
        ],
        customer_erasure_records: [], // MISSING CERTIFICATE
      })

      const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
      expect(result.ok).toBe(false)
      expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
      expect(result.missingErasureProtections).toBe(1)
    })

    it('Erasure certificate from wrong organization -> blocks restore', async () => {
      const delta: PrivacyRestoreDeltaV1 = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
        suppressions: [],
      }

      const mockDb = createMockSupabase({
        customers: [
          {
            id: cust1,
            organization_id: orgA,
            first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
            last_name: null,
            email: null,
            phone: null,
          },
        ],
        customer_erasure_records: [
          // Certificate belongs to orgB, not orgA
          { organization_id: orgB, customer_id: cust1, erased_at: tAfter1 },
        ],
      })

      const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
      expect(result.ok).toBe(false)
      expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
      expect(result.missingErasureProtections).toBe(1)
    })

    it('Certificate DB read failure -> fails closed with DATABASE_ERROR', async () => {
      const delta: PrivacyRestoreDeltaV1 = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
        suppressions: [],
      }

      const mockDb = createMockSupabase(
        {
          customers: [
            {
              id: cust1,
              organization_id: orgA,
              first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
              last_name: null,
              email: null,
              phone: null,
            },
          ],
        },
        { shouldErrorTable: 'customer_erasure_records' }
      )

      const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
      expect(result.ok).toBe(false)
      expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
      expect(result.reason).toBe('DATABASE_ERROR')
      expect(result.erasureRecordsChecked).toBe(0)
    })
  })

  // =========================================================================
  // CORRECTION 3: EXACT COMPLETION CONTACT REDACTION
  // =========================================================================
  describe('Correction 3: Exact Completion Contact Redaction Invariants', () => {
    it('isExactEmptyJsonObject helper behavior', () => {
      expect(isExactEmptyJsonObject({})).toBe(true)

      // These MUST FAIL:
      expect(isExactEmptyJsonObject({ email: 'x@example.com' })).toBe(false)
      expect(isExactEmptyJsonObject({ customerEmail: 'x@example.com' })).toBe(false)
      expect(isExactEmptyJsonObject({ foo: 'bar' })).toBe(false)
      expect(isExactEmptyJsonObject({ nested: { email: 'x@example.com' } })).toBe(false)
      expect(isExactEmptyJsonObject([])).toBe(false)
      expect(isExactEmptyJsonObject(null)).toBe(false)
      expect(isExactEmptyJsonObject(undefined)).toBe(false)
      expect(isExactEmptyJsonObject('')).toBe(false)
      expect(isExactEmptyJsonObject('{}')).toBe(false)
      expect(isExactEmptyJsonObject(123)).toBe(false)
      expect(isExactEmptyJsonObject(true)).toBe(false)
    })

    it.each([
      ['non-empty with email', { email: 'x@example.com' }],
      ['non-empty with customerEmail', { customerEmail: 'x@example.com' }],
      ['non-empty with arbitrary key foo', { foo: 'bar' }],
      ['nested object', { nested: { email: 'x@example.com' } }],
      ['array', ['email@example.com']],
      ['null', null],
      ['string', 'some-string'],
    ])('Non-empty or non-object contact payload (%s) blocks restore', async (_, badContact) => {
      const delta: PrivacyRestoreDeltaV1 = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [{ organizationId: orgA, customerId: cust1, erasedAt: tAfter1 }],
        suppressions: [],
      }

      const mockDb = createMockSupabase({
        customers: [
          {
            id: cust1,
            organization_id: orgA,
            first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
            last_name: null,
            email: null,
            phone: null,
          },
        ],
        customer_erasure_records: [
          { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
        ],
        customer_completion_events: [
          {
            id: 'comp1',
            organization_id: orgA,
            customer_id: cust1,
            contact: badContact,
            source_customer_id: null,
            source_transaction_id: null,
            source_event_id: 'evt_123',
          },
        ],
      })

      const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })
      expect(result.ok).toBe(false)
      expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
      expect(result.missingErasureProtections).toBe(1)
    })
  })

  // =========================================================================
  // CORRECTION 4: STRICT DELTA SCHEMA & SUPPRESSION HASH VALIDATION
  // =========================================================================
  describe('Correction 4: Strict Delta Schema & Suppression Hash Validation', () => {
    it.each([
      'email',
      'phone',
      'secretEmail',
      'rawContact',
      'metadata',
      'providerPayload',
      'token',
      'apiKey',
      'foo',
    ])('Unknown top-level property %s invalidates the delta artifact', (forbiddenKey) => {
      const invalidDelta = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [],
        suppressions: [],
        [forbiddenKey]: 'forbidden-value',
      }

      expect(isPrivacyRestoreDeltaV1(invalidDelta)).toBe(false)
    })

    it('Unknown property on erasure evidence invalidates the delta artifact', () => {
      const invalidDelta = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [
          {
            organizationId: orgA,
            customerId: cust1,
            erasedAt: tAfter1,
            extraField: 'not-allowed',
          },
        ],
        suppressions: [],
      }

      expect(isPrivacyRestoreDeltaV1(invalidDelta)).toBe(false)
    })

    it('Unknown property on suppression evidence invalidates the delta artifact', () => {
      const invalidDelta = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [],
        suppressions: [
          {
            organizationId: orgA,
            channel: 'email',
            contactHash: validHash1,
            reason: 'UNSUBSCRIBE',
            createdAt: tAfter1,
            metadata: 'not-allowed',
          },
        ],
      }

      expect(isPrivacyRestoreDeltaV1(invalidDelta)).toBe(false)
    })

    it('Valid SHA-256 (64 hex characters) passes validation', () => {
      const validDelta: PrivacyRestoreDeltaV1 = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [],
        suppressions: [
          {
            organizationId: orgA,
            channel: 'email',
            contactHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            reason: 'UNSUBSCRIBE',
            createdAt: tAfter1,
          },
        ],
      }

      expect(isPrivacyRestoreDeltaV1(validDelta)).toBe(true)
    })

    it.each([
      'short_hash',
      'hash123',
      'G'.repeat(64), // uppercase or non-hex
      'a'.repeat(63), // 63 chars
      'a'.repeat(65), // 65 chars
      'arbitrary_string',
      '',
    ])('Malformed contactHash (%s) fails validation', (badHash) => {
      const invalidDelta = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: [],
        suppressions: [
          {
            organizationId: orgA,
            channel: 'email',
            contactHash: badHash,
            reason: 'UNSUBSCRIBE',
            createdAt: tAfter1,
          },
        ],
      }

      expect(isPrivacyRestoreDeltaV1(invalidDelta)).toBe(false)
    })
  })

  // =========================================================================
  // CORRECTION 5: FIXED EXPORT WINDOW (backupCreatedAt, exportedAt]
  // =========================================================================
  describe('Correction 5: Fixed Export Window Invariants', () => {
    it('Window boundaries: timestamp == backupCreatedAt is excluded, timestamp == exportedAt is included', async () => {
      const tWindowStart = '2026-10-01T00:00:00.000Z'
      const tJustAfter = '2026-10-01T00:00:00.001Z'
      const tWindowEnd = '2026-10-02T00:00:00.000Z'
      const tAfterWindow = '2026-10-02T00:00:00.001Z'

      const mockDb = createMockSupabase({
        customer_erasure_records: [
          { organization_id: orgA, customer_id: '00000000-0000-4000-8000-000000000001', erased_at: tWindowStart }, // == backupCreatedAt -> EXCLUDED
          { organization_id: orgA, customer_id: '00000000-0000-4000-8000-000000000002', erased_at: tJustAfter },   // > backupCreatedAt -> INCLUDED
          { organization_id: orgA, customer_id: '00000000-0000-4000-8000-000000000003', erased_at: tWindowEnd },    // == exportedAt -> INCLUDED
          { organization_id: orgA, customer_id: '00000000-0000-4000-8000-000000000004', erased_at: tAfterWindow },  // > exportedAt -> EXCLUDED
        ],
        suppressions: [
          { organization_id: orgA, channel: 'email', contact_hash: validHash1, reason: 'UNSUB', created_at: tWindowStart }, // EXCLUDED
          { organization_id: orgA, channel: 'email', contact_hash: validHash2, reason: 'UNSUB', created_at: tJustAfter },   // INCLUDED
          { organization_id: orgA, channel: 'email', contact_hash: validHash3, reason: 'UNSUB', created_at: tWindowEnd },    // INCLUDED
          { organization_id: orgA, channel: 'email', contact_hash: validHash4, reason: 'UNSUB', created_at: tAfterWindow },  // EXCLUDED
        ],
      })

      const res = await collectPrivacyRestoreDelta({
        supabase: mockDb,
        backupCreatedAt: tWindowStart,
        exportedAt: tWindowEnd,
      })

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.delta.erasures).toHaveLength(2)
        expect(res.delta.erasures.map((e) => e.erasedAt)).toEqual([tJustAfter, tWindowEnd])

        expect(res.delta.suppressions).toHaveLength(2)
        expect(res.delta.suppressions.map((s) => s.createdAt)).toEqual([tJustAfter, tWindowEnd])
      }
    })

    it('exportedAt <= backupCreatedAt fails closed with INVALID_TIMESTAMP', async () => {
      const mockDb = createMockSupabase({})

      const res = await collectPrivacyRestoreDelta({
        supabase: mockDb,
        backupCreatedAt: '2026-10-05T00:00:00.000Z',
        exportedAt: '2026-10-04T00:00:00.000Z', // Before backupCreatedAt
      })

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.status).toBe('INVALID_TIMESTAMP')
      }
    })
  })

  // =========================================================================
  // CORRECTION 7: TRUTHFUL CHECK COUNTERS
  // =========================================================================
  describe('Correction 7: Truthful Check Counters Invariants', () => {
    it('3 erasures verified, 4th DB query fails -> erasureRecordsChecked = 3', async () => {
      const custIds = [
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000004',
      ]

      const delta: PrivacyRestoreDeltaV1 = {
        schemaVersion: '1.0',
        backupCreatedAt: tBackup,
        exportedAt: tAfter2,
        erasures: custIds.map((id) => ({
          organizationId: orgA,
          customerId: id,
          erasedAt: tAfter1,
        })),
        suppressions: [],
      }

      // First 3 customers exist and are protected; 4th customer triggers DB error
      let queryCount = 0
      const mockDb = {
        from: (table: string) => {
          if (table === 'customers') {
            queryCount++
            if (queryCount === 4) {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: () =>
                        Promise.resolve({ data: null, error: new Error('DATABASE_ERROR') }),
                    }),
                  }),
                }),
              }
            }
          }

          // Return valid responses for first 3 customers
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    range: () => Promise.resolve({ data: [], error: null }),
                  }),
                  maybeSingle: () => {
                    if (table === 'customers') {
                      return Promise.resolve({
                        data: {
                          id: custIds[queryCount - 1],
                          organization_id: orgA,
                          first_name: CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
                          last_name: null,
                          email: null,
                          phone: null,
                        },
                        error: null,
                      })
                    }
                    if (table === 'customer_erasure_records') {
                      return Promise.resolve({
                        data: {
                          organization_id: orgA,
                          customer_id: custIds[queryCount - 1],
                        },
                        error: null,
                      })
                    }
                    return Promise.resolve({ data: null, error: null })
                  },
                }),
              }),
            }),
          }
        },
      } as unknown as SupabaseClient<Database>

      const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })

      expect(result.ok).toBe(false)
      expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
      expect(result.reason).toBe('DATABASE_ERROR')
      // Exactly 3 verified before the 4th failed!
      expect(result.erasureRecordsChecked).toBe(3)
      expect(result.suppressionRecordsChecked).toBe(0)
    })
  })
})
