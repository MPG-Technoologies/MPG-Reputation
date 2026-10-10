import { describe, it, expect, vi } from 'vitest'
import {
  isPrivacyRestoreDeltaV1,
  serializePrivacyRestoreDelta,
  deserializePrivacyRestoreDelta,
  collectPrivacyRestoreDelta,
  verifyRestoredPrivacyState,
  evaluateRestoreDecision,
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
  options?: { shouldErrorTable?: string; shouldThrow?: boolean }
) {
  return {
    from: (table: keyof TableData) => {
      if (options?.shouldThrow) {
        throw new Error('UNEXPECTED_DATABASE_EXCEPTION')
      }
      if (options?.shouldErrorTable === table) {
        return {
          select: () => ({
            gt: () => ({
              order: () => ({
                order: () => ({
                  order: () => Promise.resolve({ data: null, error: new Error('DATABASE_ERROR') }),
                }),
              }),
            }),
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: new Error('DATABASE_ERROR') }),
              }),
            }),
          }),
        } as unknown
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
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r: unknown) => {
            const item = r as Record<string, unknown>
            return item[col] === val
          })
          return builder
        },
        in: (col: string, vals: unknown[]) => {
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

  const tBackup = '2026-10-01T00:00:00.000Z'
  const tBefore = '2026-09-30T12:00:00.000Z'
  const tEqual = '2026-10-01T00:00:00.000Z'
  const tAfter1 = '2026-10-02T10:00:00.000Z'
  const tAfter2 = '2026-10-03T15:00:00.000Z'

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
          contact_hash: 'hash_after_1',
          reason: 'UNSUBSCRIBE',
          created_at: tAfter1,
        },
        {
          organization_id: orgA,
          channel: 'email',
          contact_hash: 'hash_before',
          reason: 'UNSUBSCRIBE',
          created_at: tBefore,
        },
      ],
    })

    const res = await collectPrivacyRestoreDelta({
      supabase: mockDb,
      backupCreatedAt: tBackup,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.delta.suppressions).toHaveLength(1)
      expect(res.delta.suppressions[0].contactHash).toBe('hash_after_1')
    }
  })

  // 7. Collector contains zero direct PII.
  it('7. Collector contains zero direct PII', async () => {
    const mockDb = createMockSupabase({
      customer_erasure_records: [
        { organization_id: orgA, customer_id: cust1, erased_at: tAfter1 },
      ],
      suppressions: [
        {
          organization_id: orgA,
          channel: 'email',
          contact_hash: 'hash123',
          reason: 'UNSUBSCRIBE',
          created_at: tAfter1,
        },
      ],
    })

    const res = await collectPrivacyRestoreDelta({
      supabase: mockDb,
      backupCreatedAt: tBackup,
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
          contact_hash: 'hash_z',
          reason: 'BOUNCE',
          created_at: tAfter2,
        },
        {
          organization_id: orgA,
          channel: 'email',
          contact_hash: 'hash_a',
          reason: 'UNSUBSCRIBE',
          created_at: tAfter1,
        },
      ],
    })

    const res = await collectPrivacyRestoreDelta({
      supabase: mockDb,
      backupCreatedAt: tBackup,
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
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe('UNAVAILABLE')
      expect(res.error).toBe('DATABASE_READ_ERROR')
    }
  })

  // 10. Correctly erased customer passes verification.
  it('10. Correctly erased customer passes verification', async () => {
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
          contactHash: 'unrestored_suppression_hash',
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
          contactHash: 'active_suppression_hash',
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
          contact_hash: 'active_suppression_hash',
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
          contactHash: 'sensitive_contact_hash_445566778899',
          reason: 'BOUNCE',
          createdAt: tAfter1,
        },
      ],
    }

    const mockDb = createMockSupabase({ suppressions: [] })
    const result = await verifyRestoredPrivacyState({ supabase: mockDb, delta })

    const serializedResult = JSON.stringify(result)
    expect(serializedResult).not.toContain('sensitive_contact_hash_445566778899')
    expect(serializedResult).not.toContain('445566778899')
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
          contactHash: 'hash_org_a',
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
      suppressions: [
        {
          organization_id: orgB,
          channel: 'email',
          contact_hash: 'hash_org_a',
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

  // 21. No browser/client import path exposes the verifier.
  it('21. No browser/client import path exposes the verifier', () => {
    const filePath = path.resolve('E:/MPG-Reputation/src/domain/privacy/restore-verification.ts')
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
          contactHash: 'safe_hash',
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
      suppressions: [
        {
          organization_id: orgA,
          channel: 'email',
          contact_hash: 'safe_hash',
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
  })

  // 24. Existing customer erasure tests contract parity.
  it('24. Existing customer erasure constant parity', () => {
    expect(CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME).toBe('[Deleted Customer]')
  })

  // 25. Existing suppression serialization / deserialization integrity.
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
          contactHash: 'hash123',
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
})
