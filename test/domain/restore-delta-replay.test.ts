import { describe, it, expect, vi } from 'vitest'
import {
  replayPrivacyRestoreDelta,
} from '@/domain/privacy/restore-replay'
import {
  isExactEmptyJsonObject,
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
    id?: string
    organization_id: string
    customer_id: string
    erased_at: string
    actor_type?: string
    actor_id?: string | null
    created_at?: string
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
  audit_events?: Array<{
    id?: string
    organization_id: string
    actor_type?: string
    actor_id?: string | null
    event_type: string
    entity_type: string
    entity_id: string
    metadata: Record<string, unknown>
  }>
  organizations?: Array<{
    id: string
    name: string
  }>
}

function createMockSupabase(
  tables: TableData,
  options?: {
    shouldErrorRpc?: string
    shouldThrowRpc?: boolean
    failOnCustomerRpcId?: string
    shouldErrorTable?: string
    shouldThrowTable?: boolean
  }
) {
  // Deep clone data to allow in-memory mutation
  const db: TableData = {
    customer_erasure_records: (tables.customer_erasure_records || []).map((r) => ({ ...r })),
    suppressions: (tables.suppressions || []).map((r) => ({ ...r })),
    customers: (tables.customers || []).map((r) => ({ ...r })),
    customer_completion_events: (tables.customer_completion_events || []).map((r) => ({
      ...r,
      contact: typeof r.contact === 'object' && r.contact !== null ? { ...r.contact } : r.contact,
    })),
    review_requests: (tables.review_requests || []).map((r) => ({ ...r })),
    message_events: (tables.message_events || []).map((r) => ({ ...r })),
    audit_events: (tables.audit_events || []).map((r) => ({ ...r })),
    organizations: (tables.organizations || []).map((r) => ({ ...r })),
  }

  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

  const client = {
    _db: db,
    _rpcCalls: rpcCalls,
    rpc: vi.fn(async (fnName: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn: fnName, args })

      if (options?.shouldThrowRpc) {
        throw new Error('RPC_EXECUTION_EXCEPTION')
      }
      if (options?.shouldErrorRpc === fnName) {
        return { data: null, error: new Error('DATABASE_RPC_ERROR') }
      }

      if (fnName === 'replay_customer_erasure_maintenance') {
        const { p_org_id, p_customer_id, p_erased_at } = args as {
          p_org_id: string
          p_customer_id: string
          p_erased_at: string
        }

        if (options?.failOnCustomerRpcId === p_customer_id) {
          return { data: null, error: new Error('INJECTED_CUSTOMER_RPC_FAILURE') }
        }

        // Verify customer exists in customers for p_org_id
        const customer = (db.customers || []).find(
          (c) => c.id === p_customer_id && c.organization_id === p_org_id
        )
        if (!customer) {
          return { data: null, error: new Error('CUSTOMER_NOT_FOUND') }
        }

        // Check if certificate already exists
        const certIndex = (db.customer_erasure_records || []).findIndex(
          (cer) => cer.organization_id === p_org_id && cer.customer_id === p_customer_id
        )
        const alreadyErased = certIndex >= 0

        // Insert certificate if not present
        if (!alreadyErased) {
          db.customer_erasure_records = db.customer_erasure_records || []
          db.customer_erasure_records.push({
            id: `cer-${p_customer_id}`,
            organization_id: p_org_id,
            customer_id: p_customer_id,
            erased_at: p_erased_at,
            actor_type: 'maintenance',
            actor_id: null,
          })

          // Record audit event on initial replay
          db.audit_events = db.audit_events || []
          db.audit_events.push({
            organization_id: p_org_id,
            actor_type: 'maintenance',
            actor_id: null,
            event_type: 'privacy.restore_replay_erasure',
            entity_type: 'customer',
            entity_id: p_customer_id,
            metadata: {
              schema_version: '1.0',
              decision: 'REPLAYED',
              erased_at: p_erased_at,
            },
          })
        }

        // Tombstone customer row
        customer.first_name = CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME
        customer.last_name = null
        customer.email = null
        customer.phone = null

        // Redact completions while retaining source_event_id
        let completionsRedacted = 0
        for (const comp of db.customer_completion_events || []) {
          if (comp.customer_id === p_customer_id && comp.organization_id === p_org_id) {
            comp.contact = {}
            comp.source_customer_id = null
            comp.source_transaction_id = null
            completionsRedacted++
          }
        }

        // Scrub review requests error_message
        let reviewErrorsScrubbed = 0
        const reqIds: string[] = []
        for (const rr of db.review_requests || []) {
          if (rr.customer_id === p_customer_id && rr.organization_id === p_org_id) {
            reqIds.push(rr.id)
            if (rr.error_message !== null) {
              rr.error_message = null
              reviewErrorsScrubbed++
            }
          }
        }

        // Scrub message events sanitized_error
        let messageErrorsScrubbed = 0
        for (const me of db.message_events || []) {
          if (me.organization_id === p_org_id && reqIds.includes(me.review_request_id)) {
            if (me.sanitized_error !== null) {
              me.sanitized_error = null
              messageErrorsScrubbed++
            }
          }
        }

        return {
          data: {
            replayed: true,
            already_erased: alreadyErased,
            customer_id: p_customer_id,
            organization_id: p_org_id,
            erased_at: p_erased_at,
            completion_events_redacted_count: completionsRedacted,
            review_request_errors_scrubbed_count: reviewErrorsScrubbed,
            message_event_errors_scrubbed_count: messageErrorsScrubbed,
          },
          error: null,
        }
      }

      if (fnName === 'replay_suppression_maintenance') {
        const { p_org_id, p_channel, p_contact_hash, p_reason, p_created_at } = args as {
          p_org_id: string
          p_channel: string
          p_contact_hash: string
          p_reason: string
          p_created_at: string
        }

        // Validation
        if (p_channel !== 'email' && p_channel !== 'sms') {
          return { data: null, error: new Error('DENIED: Invalid channel') }
        }
        if (!/^[a-f0-9]{64}$/.test(p_contact_hash)) {
          return { data: null, error: new Error('DENIED: Invalid contact hash') }
        }

        const existing = (db.suppressions || []).find(
          (s) =>
            s.organization_id === p_org_id &&
            s.channel === p_channel &&
            s.contact_hash === p_contact_hash
        )

        let inserted = false
        if (!existing) {
          db.suppressions = db.suppressions || []
          db.suppressions.push({
            id: `sup-${db.suppressions.length + 1}`,
            organization_id: p_org_id,
            channel: p_channel,
            contact_hash: p_contact_hash,
            reason: p_reason,
            created_at: p_created_at,
          })
          inserted = true
        }

        return {
          data: {
            inserted,
            organization_id: p_org_id,
            channel: p_channel,
          },
          error: null,
        }
      }

      return { data: null, error: new Error(`UNKNOWN_RPC: ${fnName}`) }
    }),

    from: (table: keyof TableData) => {
      if (options?.shouldThrowTable) {
        throw new Error('TABLE_READ_EXCEPTION')
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
          maybeSingle: () => Promise.resolve({ data: null, error: new Error('DATABASE_ERROR') }),
          then: (resolve: (val: unknown) => unknown) =>
            Promise.resolve({ data: null, error: new Error('DATABASE_ERROR') }).then(resolve),
        }
        return errorBuilder as unknown
      }

      let rows = [...((db[table] as unknown[]) || [])]

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
          const page = rows.slice(from, to + 1)
          return Promise.resolve({ data: page, error: null })
        },
        maybeSingle: () => {
          const row = rows[0] || null
          return Promise.resolve({ data: row, error: null })
        },
      }

      return builder as unknown
    },
  }

  return client as unknown as SupabaseClient<Database> & {
    _db: TableData
    _rpcCalls: typeof rpcCalls
  }
}

const ORG_ID_1 = '11111111-1111-4111-8111-111111111111'
const ORG_ID_2 = '22222222-2222-4222-8222-222222222222'
const CUST_ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CUST_ID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const HASH_EMAIL = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const HASH_SMS = 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'

function buildValidDelta(overrides?: Partial<PrivacyRestoreDeltaV1>): PrivacyRestoreDeltaV1 {
  return {
    schemaVersion: '1.0',
    backupCreatedAt: '2026-10-01T00:00:00.000Z',
    exportedAt: '2026-10-02T00:00:00.000Z',
    erasures: [
      {
        organizationId: ORG_ID_1,
        customerId: CUST_ID_1,
        erasedAt: '2026-10-01T12:00:00.000Z',
      },
    ],
    suppressions: [
      {
        organizationId: ORG_ID_1,
        channel: 'email',
        contactHash: HASH_EMAIL,
        reason: 'UNSUBSCRIBE',
        createdAt: '2026-10-01T14:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

describe('MR-7C.5C2: Controlled Restore-Delta Replay Engine (Case A)', () => {
  it('1. valid empty delta passes and invokes verification', async () => {
    const supabase = createMockSupabase({})
    const emptyDelta: PrivacyRestoreDeltaV1 = {
      schemaVersion: '1.0',
      backupCreatedAt: '2026-10-01T00:00:00.000Z',
      exportedAt: '2026-10-02T00:00:00.000Z',
      erasures: [],
      suppressions: [],
    }

    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta: emptyDelta,
    })

    expect(result.ok).toBe(true)
    expect(result.decision).toBe('PASS')
    expect(result.erasuresRequested).toBe(0)
    expect(result.erasuresReplayed).toBe(0)
    expect(result.suppressionsRequested).toBe(0)
    expect(result.suppressionsInserted).toBe(0)
    expect(result.verification.ok).toBe(true)
    expect(result.verification.decision).toBe('PASS')
    expect(supabase._rpcCalls.length).toBe(0)
  })

  it('2. invalid schema produces zero writes and BLOCK', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          phone: '+15551234567',
        },
      ],
    })

    const invalidDelta = {
      schemaVersion: '1.0',
      backupCreatedAt: '2026-10-01T00:00:00.000Z',
      exportedAt: '2026-10-02T00:00:00.000Z',
      erasures: [],
      suppressions: [],
      forbiddenUnknownKey: 'ATTACK_PAYLOAD',
    }

    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta: invalidDelta,
    })

    expect(result.ok).toBe(false)
    expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
    expect(result.reason).toBe('INVALID_DELTA_SCHEMA')
    expect(supabase._rpcCalls.length).toBe(0)
    expect(supabase._db.customers![0].first_name).toBe('Alice')
  })

  it('3. one resurrected customer is correctly tombstoned', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          phone: '+15551234567',
        },
      ],
    })

    const delta = buildValidDelta({ suppressions: [] })
    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.ok).toBe(true)
    expect(result.decision).toBe('PASS')
    const customer = supabase._db.customers![0]
    expect(customer.first_name).toBe(CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME)
    expect(customer.last_name).toBe(null)
    expect(customer.email).toBe(null)
    expect(customer.phone).toBe(null)
  })

  it('4. completion contact becomes exact {}', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_completion_events: [
        {
          id: 'cce-1',
          organization_id: ORG_ID_1,
          customer_id: CUST_ID_1,
          contact: { email: 'alice@example.com', name: 'Alice' },
          source_customer_id: 'src_1',
          source_transaction_id: 'txn_1',
          source_event_id: 'evt_1',
        },
      ],
    })

    const delta = buildValidDelta({ suppressions: [] })
    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.ok).toBe(true)
    const cce = supabase._db.customer_completion_events![0]
    expect(isExactEmptyJsonObject(cce.contact)).toBe(true)
  })

  it('5. source_customer_id becomes NULL', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_completion_events: [
        {
          id: 'cce-1',
          organization_id: ORG_ID_1,
          customer_id: CUST_ID_1,
          contact: {},
          source_customer_id: 'external_cust_999',
          source_transaction_id: 'txn_1',
          source_event_id: 'evt_1',
        },
      ],
    })

    const delta = buildValidDelta({ suppressions: [] })
    await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(supabase._db.customer_completion_events![0].source_customer_id).toBe(null)
  })

  it('6. source_transaction_id becomes NULL', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_completion_events: [
        {
          id: 'cce-1',
          organization_id: ORG_ID_1,
          customer_id: CUST_ID_1,
          contact: {},
          source_customer_id: null,
          source_transaction_id: 'external_txn_888',
          source_event_id: 'evt_1',
        },
      ],
    })

    const delta = buildValidDelta({ suppressions: [] })
    await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(supabase._db.customer_completion_events![0].source_transaction_id).toBe(null)
  })

  it('7. source_event_id is retained exactly', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_completion_events: [
        {
          id: 'cce-1',
          organization_id: ORG_ID_1,
          customer_id: CUST_ID_1,
          contact: {},
          source_customer_id: null,
          source_transaction_id: null,
          source_event_id: 'IMMUTABLE_DEDUP_KEY_777',
        },
      ],
    })

    const delta = buildValidDelta({ suppressions: [] })
    await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(supabase._db.customer_completion_events![0].source_event_id).toBe('IMMUTABLE_DEDUP_KEY_777')
  })

  it('8. review_requests.error_message scrubbed', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      review_requests: [
        {
          id: 'rr-1',
          organization_id: ORG_ID_1,
          customer_id: CUST_ID_1,
          error_message: 'Raw provider failure for alice@example.com',
        },
      ],
    })

    const delta = buildValidDelta({ suppressions: [] })
    await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(supabase._db.review_requests![0].error_message).toBe(null)
  })

  it('9. message_events.sanitized_error scrubbed', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      review_requests: [
        {
          id: 'rr-1',
          organization_id: ORG_ID_1,
          customer_id: CUST_ID_1,
          error_message: null,
        },
      ],
      message_events: [
        {
          id: 'me-1',
          organization_id: ORG_ID_1,
          review_request_id: 'rr-1',
          sanitized_error: 'RATE_LIMIT_EXCEEDED',
        },
      ],
    })

    const delta = buildValidDelta({ suppressions: [] })
    await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(supabase._db.message_events![0].sanitized_error).toBe(null)
  })

  it('10. missing erasure certificate restored with truthful chronology', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_erasure_records: [],
    })

    const delta = buildValidDelta({ suppressions: [] })
    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.ok).toBe(true)
    expect(supabase._db.customer_erasure_records!.length).toBe(1)
    const cert = supabase._db.customer_erasure_records![0]
    expect(cert.organization_id).toBe(ORG_ID_1)
    expect(cert.customer_id).toBe(CUST_ID_1)
    expect(cert.erased_at).toBe('2026-10-01T12:00:00.000Z')
  })

  it('11. existing certificate not duplicated', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: '[Deleted Customer]',
          last_name: null,
          email: null,
          phone: null,
        },
      ],
      customer_erasure_records: [
        {
          id: 'cer-existing',
          organization_id: ORG_ID_1,
          customer_id: CUST_ID_1,
          erased_at: '2026-10-01T12:00:00.000Z',
          actor_type: 'maintenance',
        },
      ],
    })

    const delta = buildValidDelta({ suppressions: [] })
    await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(supabase._db.customer_erasure_records!.length).toBe(1)
  })

  it('12. missing email suppression restored', async () => {
    const supabase = createMockSupabase({
      suppressions: [],
    })

    const delta = buildValidDelta({ erasures: [] })
    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.ok).toBe(true)
    expect(result.suppressionsInserted).toBe(1)
    const sup = supabase._db.suppressions![0]
    expect(sup.organization_id).toBe(ORG_ID_1)
    expect(sup.channel).toBe('email')
    expect(sup.contact_hash).toBe(HASH_EMAIL)
  })

  it('13. missing SMS suppression restored', async () => {
    const supabase = createMockSupabase({
      suppressions: [],
    })

    const delta = buildValidDelta({
      erasures: [],
      suppressions: [
        {
          organizationId: ORG_ID_1,
          channel: 'sms',
          contactHash: HASH_SMS,
          reason: 'STOP',
          createdAt: '2026-10-01T15:00:00.000Z',
        },
      ],
    })

    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.ok).toBe(true)
    expect(result.suppressionsInserted).toBe(1)
    const sup = supabase._db.suppressions![0]
    expect(sup.organization_id).toBe(ORG_ID_1)
    expect(sup.channel).toBe('sms')
    expect(sup.contact_hash).toBe(HASH_SMS)
  })

  it('14. existing suppression not duplicated', async () => {
    const supabase = createMockSupabase({
      suppressions: [
        {
          id: 'sup-existing',
          organization_id: ORG_ID_1,
          channel: 'email',
          contact_hash: HASH_EMAIL,
          reason: 'UNSUBSCRIBE',
          created_at: '2026-10-01T14:00:00.000Z',
        },
      ],
    })

    const delta = buildValidDelta({ erasures: [] })
    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.ok).toBe(true)
    expect(result.suppressionsInserted).toBe(0)
    expect(supabase._db.suppressions!.length).toBe(1)
  })

  it('15. identical delta replayed twice remains idempotent', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          phone: null,
        },
      ],
      customer_completion_events: [
        {
          id: 'cce-1',
          organization_id: ORG_ID_1,
          customer_id: CUST_ID_1,
          contact: { email: 'alice@example.com' },
          source_customer_id: 'cust_1',
          source_transaction_id: 'txn_1',
          source_event_id: 'evt_1',
        },
      ],
      suppressions: [],
    })

    const delta = buildValidDelta()

    // First replay
    const res1 = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })
    expect(res1.ok).toBe(true)
    expect(res1.decision).toBe('PASS')
    expect(res1.erasuresReplayed).toBe(1)
    expect(res1.suppressionsInserted).toBe(1)
    expect(supabase._db.customer_erasure_records!.length).toBe(1)
    expect(supabase._db.suppressions!.length).toBe(1)
    expect(supabase._db.audit_events!.length).toBe(1)

    // Second replay
    const res2 = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })
    expect(res2.ok).toBe(true)
    expect(res2.decision).toBe('PASS')
    expect(res2.erasuresReplayed).toBe(1)
    expect(res2.suppressionsInserted).toBe(0) // Already existed
    expect(supabase._db.customer_erasure_records!.length).toBe(1) // No duplicate cert
    expect(supabase._db.suppressions!.length).toBe(1) // No duplicate suppression
    expect(supabase._db.audit_events!.length).toBe(1) // No duplicate audit evidence
  })

  it('16. organization scoping preserved', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: null,
          email: null,
          phone: null,
        },
        {
          id: CUST_ID_2,
          organization_id: ORG_ID_2,
          first_name: 'Bob',
          last_name: 'Jones',
          email: 'bob@example.com',
          phone: '+15559876543',
        },
      ],
      customer_completion_events: [
        {
          id: 'cce-org2',
          organization_id: ORG_ID_2,
          customer_id: CUST_ID_2,
          contact: { email: 'bob@example.com' },
          source_customer_id: 'org2_cust',
          source_transaction_id: 'org2_txn',
          source_event_id: 'org2_evt',
        },
      ],
    })

    const delta = buildValidDelta({ suppressions: [] })
    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.ok).toBe(true)
    // Org 1 customer tombstoned
    expect(supabase._db.customers![0].first_name).toBe(CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME)
    // Org 2 customer completely untouched
    expect(supabase._db.customers![1].first_name).toBe('Bob')
    expect(supabase._db.customers![1].email).toBe('bob@example.com')
    expect(supabase._db.customer_completion_events![0].source_customer_id).toBe('org2_cust')
  })

  it('17. foreign/nonexistent customer fails closed', async () => {
    const supabase = createMockSupabase({
      customers: [], // Missing customer in restored DB
    })

    const delta = buildValidDelta({ suppressions: [] })
    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.ok).toBe(false)
    expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
    expect(result.reason).toBe('REPLAY_MUTATION_FAILED')
    expect(result.error).toContain('CUSTOMER_NOT_FOUND')
  })

  it('18. database error fails closed', async () => {
    const supabase = createMockSupabase(
      {
        customers: [
          {
            id: CUST_ID_1,
            organization_id: ORG_ID_1,
            first_name: 'Alice',
            last_name: null,
            email: null,
            phone: null,
          },
        ],
      },
      { shouldThrowRpc: true }
    )

    const delta = buildValidDelta()
    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.ok).toBe(false)
    expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
    expect(result.reason).toBe('DATABASE_ERROR')
  })

  it('19. partial replay cannot yield PASS', async () => {
    const supabase = createMockSupabase(
      {
        customers: [
          {
            id: CUST_ID_1,
            organization_id: ORG_ID_1,
            first_name: 'Alice',
            last_name: null,
            email: null,
            phone: null,
          },
          {
            id: CUST_ID_2,
            organization_id: ORG_ID_1,
            first_name: 'Charlie',
            last_name: null,
            email: null,
            phone: null,
          },
        ],
      },
      { failOnCustomerRpcId: CUST_ID_2 }
    )

    const delta = buildValidDelta({
      erasures: [
        {
          organizationId: ORG_ID_1,
          customerId: CUST_ID_1,
          erasedAt: '2026-10-01T12:00:00.000Z',
        },
        {
          organizationId: ORG_ID_1,
          customerId: CUST_ID_2,
          erasedAt: '2026-10-01T13:00:00.000Z',
        },
      ],
      suppressions: [],
    })

    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.ok).toBe(false)
    expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
    expect(result.erasuresRequested).toBe(2)
    expect(result.erasuresReplayed).toBe(1)
  })

  it('20. mandatory C5C1 verification executes after replay', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: null,
          email: null,
          phone: null,
        },
      ],
    })

    const delta = buildValidDelta({ suppressions: [] })
    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.verification).toBeDefined()
    expect(result.verification.schemaVersion).toBe('1.0')
    expect(result.verification.erasureRecordsChecked).toBe(1)
    expect(result.verification.reason).toBe('ALL_VERIFIED')
  })

  it('21. verifier BLOCK is propagated as BLOCK_RESTORE_ACTIVATION', async () => {
    // Simulate verifier detecting an issue by injecting a database error into table reads
    const supabase = createMockSupabase(
      {
        customers: [
          {
            id: CUST_ID_1,
            organization_id: ORG_ID_1,
            first_name: 'Alice',
            last_name: null,
            email: null,
            phone: null,
          },
        ],
      },
      { shouldErrorTable: 'customer_erasure_records' }
    )

    const delta = buildValidDelta({ suppressions: [] })
    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    expect(result.ok).toBe(false)
    expect(result.decision).toBe('BLOCK_RESTORE_ACTIVATION')
    expect(result.reason).toBe('VERIFICATION_FAILED')
    expect(result.verification.decision).toBe('BLOCK_RESTORE_ACTIVATION')
  })

  it('22. no raw PII or hashes returned in operational result/log output', async () => {
    const supabase = createMockSupabase({
      customers: [
        {
          id: CUST_ID_1,
          organization_id: ORG_ID_1,
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          phone: '+15551234567',
        },
      ],
      suppressions: [],
    })

    const delta = buildValidDelta()
    const result = await replayPrivacyRestoreDelta({
      supabase,
      delta,
    })

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('alice@example.com')
    expect(serialized).not.toContain('Alice')
    expect(serialized).not.toContain('Smith')
    expect(serialized).not.toContain('+15551234567')
    expect(serialized).not.toContain(HASH_EMAIL)
    expect(serialized).not.toContain('secret')
  })

  it('23. server-only boundary preserved in source code', () => {
    const filePath = path.resolve(process.cwd(), 'src/domain/privacy/restore-replay.ts')
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content.startsWith("import 'server-only'")).toBe(true)
  })

  it('24. PUBLIC/anon/authenticated cannot execute any new maintenance RPC (migration inspection)', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261011120000_mr7c5c2_restore_delta_replay.sql'
    )
    const sql = fs.readFileSync(migrationPath, 'utf-8')

    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.replay_customer_erasure_maintenance(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;'
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.replay_suppression_maintenance(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;'
    )
  })

  it('25. trusted role can execute only the narrowly defined maintenance function (migration inspection)', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261011120000_mr7c5c2_restore_delta_replay.sql'
    )
    const sql = fs.readFileSync(migrationPath, 'utf-8')

    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.replay_customer_erasure_maintenance(UUID, UUID, TIMESTAMPTZ) TO service_role;'
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.replay_suppression_maintenance(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;'
    )
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toContain('SECURITY DEFINER')
  })
})
