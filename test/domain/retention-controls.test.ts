import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  COMPLETION_CONTACT_RETENTION_DAYS,
  REVIEW_LINK_EXPIRATION_DAYS,
  DISPATCHED_OUTBOX_RETENTION_DAYS,
  REVIEW_LINK_EXPIRATION_MS,
  PERMANENT_RETENTION_CLASSES,
  ProtectedClassImmunityError,
  isProtectedClass,
  assertProtectedClassImmunity,
  isReviewRequestLinkExpired,
  redactAgedCompletionContacts,
  purgeDispatchedDomainOutbox,
} from '@/domain/privacy/retention-controls'
import { generateTrackingToken } from '@/domain/tracking'
import { generateUnsubscribeToken } from '@/domain/unsubscribe'

// Mock server-only
vi.mock('server-only', () => ({}))

// Top-level dynamic mock for supabase admin
let mockAdminClientInstance: unknown = null
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockAdminClientInstance,
}))

// Import route handlers after mock setup
import { GET as trackingRouteGet } from '@/app/r/[token]/route'
import { GET as unsubscribeRouteGet } from '@/app/unsubscribe/[token]/route'

class MockQueryBuilder<T extends Record<string, unknown>> {
  private items: T[]

  constructor(items: T[]) {
    this.items = [...items]
  }

  select() {
    return this
  }

  lt(col: string, val: string) {
    this.items = this.items.filter((item) => new Date(item[col] as string).getTime() < new Date(val).getTime())
    return this
  }

  eq(col: string, val: unknown) {
    this.items = this.items.filter((item) => item[col] === val)
    return this
  }

  not(col: string, op: string) {
    if (op === 'is') {
      this.items = this.items.filter((item) => item[col] !== null)
    }
    return this
  }

  order(col: string, opts?: { ascending?: boolean }) {
    const asc = opts?.ascending !== false
    this.items.sort((a, b) => {
      const ta = new Date(a[col] as string).getTime()
      const tb = new Date(b[col] as string).getTime()
      return asc ? ta - tb : tb - ta
    })
    return this
  }

  limit(count: number) {
    const sliced = this.items.slice(0, count)
    return Promise.resolve({ data: sliced, error: null })
  }
}

describe('MR-7C.4B1 Initial Retention Controls Foundation', () => {
  const org1Id = '00000000-0000-0000-0000-000000000001'
  const org2Id = '00000000-0000-0000-0000-000000000002'
  const fixedNow = new Date('2026-10-10T12:00:00Z')

  describe('Part 1: Completion Contact Redaction (Tests 1-7)', () => {
    let mockCompletions: Array<{
      id: string
      organization_id: string
      created_at: string
      contact: Record<string, unknown> | null
      source_event_id: string
    }> = []

    let mockAuditEvents: Array<Record<string, unknown>> = []

    function createMockSupabase(): SupabaseClient<Database> {
      return {
        from: (table: string) => {
          if (table === 'customer_completion_events') {
            return {
              select: () => new MockQueryBuilder(mockCompletions),
              update: (updatePayload: { contact: Record<string, unknown> }) => ({
                in: (_col: string, ids: string[]) => ({
                  eq: (_orgCol: string, orgIdVal: string) => {
                    for (const id of ids) {
                      const row = mockCompletions.find(
                        (c) => c.id === id && c.organization_id === orgIdVal
                      )
                      if (row) {
                        row.contact = updatePayload.contact
                      }
                    }
                    return Promise.resolve({ error: null })
                  },
                }),
              }),
            }
          }
          if (table === 'audit_events') {
            return {
              insert: (auditRecord: Record<string, unknown>) => {
                const inserted = { id: `audit_${mockAuditEvents.length + 1}`, ...auditRecord }
                mockAuditEvents.push(inserted)
                return {
                  select: () => ({
                    maybeSingle: () => Promise.resolve({ data: inserted, error: null }),
                  }),
                }
              },
            }
          }
          throw new Error(`Unexpected table queried in mock: ${table}`)
        },
      } as unknown as SupabaseClient<Database>
    }

    beforeEach(() => {
      mockCompletions = [
        {
          id: 'c1_fresh',
          organization_id: org1Id,
          created_at: '2026-09-25T00:00:00Z', // 15 days old (<30d)
          contact: { email: 'fresh@example.com', firstName: 'Fresh' },
          source_event_id: 'src_evt_101',
        },
        {
          id: 'c2_aged',
          organization_id: org1Id,
          created_at: '2026-08-01T00:00:00Z', // 70 days old (>30d)
          contact: { email: 'aged@example.com', firstName: 'Aged' },
          source_event_id: 'src_evt_102',
        },
        {
          id: 'c3_already_redacted',
          organization_id: org1Id,
          created_at: '2026-07-01T00:00:00Z', // 100 days old (>30d) but already {}
          contact: {},
          source_event_id: 'src_evt_103',
        },
        {
          id: 'c4_foreign_aged',
          organization_id: org2Id,
          created_at: '2026-08-01T00:00:00Z', // 70 days old (>30d) but Org 2
          contact: { email: 'foreign@example.com', firstName: 'Foreign' },
          source_event_id: 'src_evt_104',
        },
      ]
      mockAuditEvents = []
    })

    it('1. Contact <30 days old is untouched', async () => {
      const supabase = createMockSupabase()
      await redactAgedCompletionContacts(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      const freshRow = mockCompletions.find((c) => c.id === 'c1_fresh')!
      expect(freshRow.contact).toEqual({
        email: 'fresh@example.com',
        firstName: 'Fresh',
      })
    })

    it('2. Contact >30 days old is redacted', async () => {
      const supabase = createMockSupabase()
      const result = await redactAgedCompletionContacts(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      expect(result.redactedCount).toBe(1)
      const agedRow = mockCompletions.find((c) => c.id === 'c2_aged')!
      expect(agedRow.contact).toEqual({})
    })

    it('3. source_event_id remains unchanged', async () => {
      const supabase = createMockSupabase()
      await redactAgedCompletionContacts(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      const agedRow = mockCompletions.find((c) => c.id === 'c2_aged')!
      expect(agedRow.source_event_id).toBe('src_evt_102')
    })

    it('4. Completion row remains (not deleted)', async () => {
      const supabase = createMockSupabase()
      const initialCount = mockCompletions.length
      await redactAgedCompletionContacts(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      expect(mockCompletions.length).toBe(initialCount)
      const agedRow = mockCompletions.find((c) => c.id === 'c2_aged')
      expect(agedRow).toBeDefined()
    })

    it('5. Already-redacted row is idempotent', async () => {
      const supabase = createMockSupabase()
      // Run once
      await redactAgedCompletionContacts(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })
      const auditCountAfterFirst = mockAuditEvents.length

      // Run second time
      const secondResult = await redactAgedCompletionContacts(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      expect(secondResult.redactedCount).toBe(0)
      expect(secondResult.affectedOrganizationIds).toHaveLength(0)
      // No duplicate audit event emitted on no-op
      expect(mockAuditEvents.length).toBe(auditCountAfterFirst)
    })

    it('6. Foreign-tenant rows cannot be affected improperly', async () => {
      const supabase = createMockSupabase()
      // Redact scoped strictly to Org 1
      await redactAgedCompletionContacts(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      const foreignRow = mockCompletions.find((c) => c.id === 'c4_foreign_aged')!
      expect(foreignRow.contact).toEqual({
        email: 'foreign@example.com',
        firstName: 'Foreign',
      })
    })

    it('7. Redaction audit contains no raw PII', async () => {
      const supabase = createMockSupabase()
      await redactAgedCompletionContacts(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      expect(mockAuditEvents).toHaveLength(1)
      const audit = mockAuditEvents[0]
      expect(audit.event_type).toBe('retention.completion_contacts_redacted')
      expect(audit.entity_type).toBe('customer_completion_events')

      const rawJson = JSON.stringify(audit)
      expect(rawJson).not.toContain('aged@example.com')
      expect(rawJson).not.toContain('Aged')
      expect(rawJson).not.toContain('fresh@example.com')
      expect(rawJson).not.toContain('foreign@example.com')

      expect(audit.metadata).toEqual({
        redacted_count: 1,
        retention_period_days: 30,
        cutoff_timestamp: '2026-09-10T12:00:00.000Z',
      })
    })
  })

  describe('Part 2: Review-Link Expiration (Tests 8-12)', () => {
    const fixedNowMs = new Date('2026-10-10T12:00:00Z').getTime()
    const eightyNineDaysAgoIso = new Date(
      fixedNowMs - 89 * 24 * 60 * 60 * 1000
    ).toISOString()
    const ninetyDaysAgoIso = new Date(
      fixedNowMs - 90 * 24 * 60 * 60 * 1000
    ).toISOString()
    const ninetyOneDaysAgoIso = new Date(
      fixedNowMs - 91 * 24 * 60 * 60 * 1000
    ).toISOString()

    it('8. Review link <90 days remains valid', () => {
      const valid = isReviewRequestLinkExpired(
        { sent_at: eightyNineDaysAgoIso, created_at: eightyNineDaysAgoIso },
        fixedNowMs
      )
      expect(valid).toBe(false)
    })

    it('9. Review link exactly at/after expiration fails closed according to defined boundary semantics', () => {
      // Exactly at 90 days boundary: fails closed (is expired)
      const exactBoundary = isReviewRequestLinkExpired(
        { sent_at: ninetyDaysAgoIso, created_at: ninetyDaysAgoIso },
        fixedNowMs
      )
      expect(exactBoundary).toBe(true)

      // 1 millisecond before boundary: valid
      const oneMsBeforeBoundary = isReviewRequestLinkExpired(
        { sent_at: ninetyDaysAgoIso, created_at: ninetyDaysAgoIso },
        fixedNowMs - 1
      )
      expect(oneMsBeforeBoundary).toBe(false)

      // 91 days old: expired
      const older = isReviewRequestLinkExpired(
        { sent_at: ninetyOneDaysAgoIso, created_at: ninetyOneDaysAgoIso },
        fixedNowMs
      )
      expect(older).toBe(true)

      // Fallback to created_at when sent_at is null:
      const fallbackExpired = isReviewRequestLinkExpired(
        { sent_at: null, created_at: ninetyDaysAgoIso },
        fixedNowMs
      )
      expect(fallbackExpired).toBe(true)

      // Malformed timestamp fails closed
      expect(isReviewRequestLinkExpired({ created_at: 'invalid-date' }, fixedNowMs)).toBe(true)
    })

    it('10 & 11. Expired link on /r/[token] does not redirect and reveals no internal identifiers', async () => {
      const { token: trackingToken, tokenHash } = generateTrackingToken()

      const mockDbReviewRequest = {
        id: 'rr-secret-id-123',
        organization_id: 'org-secret-id-456',
        location_id: 'loc-secret-id-789',
        destination_id: 'dest-secret-id-012',
        status: 'SENT',
        sent_at: ninetyOneDaysAgoIso,
        created_at: ninetyOneDaysAgoIso,
      }

      mockAdminClientInstance = {
        from: (table: string) => {
          if (table === 'review_requests') {
            return {
              select: () => ({
                eq: (_col: string, val: string) => ({
                  maybeSingle: async () => {
                    if (val === tokenHash) {
                      return { data: mockDbReviewRequest, error: null }
                    }
                    return { data: null, error: null }
                  },
                }),
              }),
            }
          }
          throw new Error(`Unexpected table queried for expired request: ${table}`)
        },
      }

      const request = new NextRequest(`https://reputation.example.com/r/${trackingToken}`)
      const response = await trackingRouteGet(request, {
        params: Promise.resolve({ token: trackingToken }),
      })

      // 10. Does not redirect (HTTP 410 Gone instead of 302/301)
      expect(response.status).toBe(410)
      const body = await response.text()

      // 11. Reveals no internal identifiers in the user-friendly expired view
      expect(body).toContain('Review Link Expired')
      expect(body).toContain('Review request links expire after 90 days.')
      expect(body).not.toContain('rr-secret-id-123')
      expect(body).not.toContain('org-secret-id-456')
      expect(body).not.toContain('loc-secret-id-789')
      expect(body).not.toContain('dest-secret-id-012')
      expect(body).not.toContain(tokenHash)
    })

    it('12. Unsubscribe for the same historical request still works after review-link expiration', async () => {
      const { token: unsubToken, tokenHash: unsubHash } = generateUnsubscribeToken()

      // Historical request sent 150 days ago (>90 days expired for routing link)
      const historicalSentAt = new Date(
        Date.now() - 150 * 24 * 60 * 60 * 1000
      ).toISOString()

      const historicalRequest = {
        id: 'rr-historical-150d',
        organization_id: org1Id,
        customer_id: 'cust-123',
        channel: 'email' as const,
        sent_at: historicalSentAt,
        created_at: historicalSentAt,
        unsubscribe_token_hash: unsubHash,
      }

      // 1. Verify routing link is indeed expired
      expect(
        isReviewRequestLinkExpired({
          sent_at: historicalRequest.sent_at,
          created_at: historicalRequest.created_at,
        })
      ).toBe(true)

      // 2. Verify unsubscribe GET route continues to render valid unsubscribe confirmation page
      mockAdminClientInstance = {
        from: (table: string) => {
          if (table === 'review_requests') {
            return {
              select: () => ({
                eq: (_col: string, val: string) => ({
                  maybeSingle: async () => {
                    if (val === unsubHash) {
                      return { data: historicalRequest, error: null }
                    }
                    return { data: null, error: null }
                  },
                }),
              }),
            }
          }
          if (table === 'organizations') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { name: 'Acme Health' },
                    error: null,
                  }),
                  maybeSingle: async () => ({
                    data: { name: 'Acme Health' },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'review_request_recipient_evidence') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({
                        data: { suppression_contact_hash: 'hash_test_recipient_123' },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'suppressions') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      }

      const unsubReq = new NextRequest(
        `https://reputation.example.com/unsubscribe/${unsubToken}`
      )
      const unsubResponse = await unsubscribeRouteGet(unsubReq, {
        params: Promise.resolve({ token: unsubToken }),
      })

      // Unsubscribe must remain fully operational (200 OK)
      expect(unsubResponse.status).toBe(200)
      const unsubBody = await unsubResponse.text()
      expect(unsubBody).toContain('Stop review-request emails')
      expect(unsubBody).toContain('Acme Health')
    })
  })

  describe('Part 3: Dispatched Outbox Purge (Tests 13-19)', () => {
    let mockOutbox: Array<{
      id: string
      organization_id: string
      status: 'PENDING' | 'DISPATCHED' | 'FAILED'
      created_at: string
      dispatched_at: string | null
      payload: Record<string, unknown>
    }> = []

    let mockAuditEvents: Array<Record<string, unknown>> = []

    function createMockSupabaseForOutbox(): SupabaseClient<Database> {
      return {
        from: (table: string) => {
          if (table === 'domain_event_outbox') {
            return {
              select: () => new MockQueryBuilder(mockOutbox),
              delete: () => ({
                in: (_col: string, ids: string[]) => ({
                  eq: (_orgCol: string, orgIdVal: string) => ({
                    eq: (_statusCol: string, statusVal: string) => {
                      mockOutbox = mockOutbox.filter(
                        (o) =>
                          !(
                            ids.includes(o.id) &&
                            o.organization_id === orgIdVal &&
                            o.status === statusVal
                          )
                      )
                      return Promise.resolve({ error: null })
                    },
                  }),
                }),
              }),
            }
          }
          if (table === 'audit_events') {
            return {
              insert: (auditRecord: Record<string, unknown>) => {
                const inserted = { id: `audit_outbox_${mockAuditEvents.length + 1}`, ...auditRecord }
                mockAuditEvents.push(inserted)
                return {
                  select: () => ({
                    maybeSingle: () => Promise.resolve({ data: inserted, error: null }),
                  }),
                }
              },
            }
          }
          throw new Error(`Unexpected table queried: ${table}`)
        },
      } as unknown as SupabaseClient<Database>
    }

    beforeEach(() => {
      mockOutbox = [
        {
          id: 'outbox_1_dispatched_fresh',
          organization_id: org1Id,
          status: 'DISPATCHED',
          created_at: '2026-09-25T00:00:00Z',
          dispatched_at: '2026-09-25T00:01:00Z', // 15 days old (<30d)
          payload: { customer: 'Customer 1', sensitive: 'secret_fresh' },
        },
        {
          id: 'outbox_2_dispatched_aged',
          organization_id: org1Id,
          status: 'DISPATCHED',
          created_at: '2026-08-01T00:00:00Z',
          dispatched_at: '2026-08-01T00:01:00Z', // 70 days old (>30d)
          payload: { customer: 'Customer 2', sensitive: 'secret_aged' },
        },
        {
          id: 'outbox_3_pending_aged',
          organization_id: org1Id,
          status: 'PENDING',
          created_at: '2026-07-01T00:00:00Z', // 100 days old, NEVER DISPATCHED
          dispatched_at: null,
          payload: { customer: 'Customer 3', sensitive: 'never_purge_pending' },
        },
        {
          id: 'outbox_4_failed_aged',
          organization_id: org1Id,
          status: 'FAILED',
          created_at: '2026-07-01T00:00:00Z', // 100 days old, FAILED
          dispatched_at: null,
          payload: { customer: 'Customer 4', sensitive: 'never_purge_failed' },
        },
      ]
      mockAuditEvents = []
    })

    it('13. DISPATCHED <30 days remains', async () => {
      const supabase = createMockSupabaseForOutbox()
      await purgeDispatchedDomainOutbox(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      const fresh = mockOutbox.find((o) => o.id === 'outbox_1_dispatched_fresh')
      expect(fresh).toBeDefined()
    })

    it('14. DISPATCHED >30 days is eligible/purged', async () => {
      const supabase = createMockSupabaseForOutbox()
      const result = await purgeDispatchedDomainOutbox(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      expect(result.purgedCount).toBe(1)
      const aged = mockOutbox.find((o) => o.id === 'outbox_2_dispatched_aged')
      expect(aged).toBeUndefined()
    })

    it('15. PENDING >30 days is NEVER purged', async () => {
      const supabase = createMockSupabaseForOutbox()
      await purgeDispatchedDomainOutbox(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      const pending = mockOutbox.find((o) => o.id === 'outbox_3_pending_aged')
      expect(pending).toBeDefined()
      expect(pending?.status).toBe('PENDING')
    })

    it('16. Failed/unresolved records are not silently purged', async () => {
      const supabase = createMockSupabaseForOutbox()
      await purgeDispatchedDomainOutbox(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      const failed = mockOutbox.find((o) => o.id === 'outbox_4_failed_aged')
      expect(failed).toBeDefined()
      expect(failed?.status).toBe('FAILED')
    })

    it('17. Purge is idempotent', async () => {
      const supabase = createMockSupabaseForOutbox()
      // First run
      const res1 = await purgeDispatchedDomainOutbox(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })
      expect(res1.purgedCount).toBe(1)

      // Second run
      const res2 = await purgeDispatchedDomainOutbox(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })
      expect(res2.purgedCount).toBe(0)
      expect(res2.affectedOrganizationIds).toHaveLength(0)
    })

    it('18. Bounded batching is enforced', async () => {
      const supabase = createMockSupabaseForOutbox()
      // Add 10 aged dispatched rows
      for (let i = 10; i < 20; i++) {
        mockOutbox.push({
          id: `outbox_${i}_dispatched`,
          organization_id: org1Id,
          status: 'DISPATCHED',
          created_at: '2026-07-01T00:00:00Z',
          dispatched_at: '2026-07-01T00:01:00Z',
          payload: { customer: `Customer ${i}` },
        })
      }

      // Purge with batch size 3
      const result = await purgeDispatchedDomainOutbox(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
        batchSize: 3,
      })

      expect(result.purgedCount).toBe(3)
    })

    it('19. No payload values appear in audit output', async () => {
      const supabase = createMockSupabaseForOutbox()
      await purgeDispatchedDomainOutbox(supabase, {
        asOf: fixedNow,
        organizationId: org1Id,
      })

      expect(mockAuditEvents).toHaveLength(1)
      const audit = mockAuditEvents[0]
      expect(audit.event_type).toBe('retention.outbox_dispatched_purged')
      expect(audit.entity_type).toBe('domain_event_outbox')

      const rawJson = JSON.stringify(audit)
      expect(rawJson).not.toContain('secret_aged')
      expect(rawJson).not.toContain('Customer 2')
      expect(rawJson).not.toContain('never_purge_pending')

      expect(audit.metadata).toEqual({
        purged_count: 1,
        retention_period_days: 30,
        cutoff_timestamp: '2026-09-10T12:00:00.000Z',
      })
    })
  })

  describe('Part 4: Permanent-Retention Guards (Tests 20-25)', () => {
    it('20. suppressions untouched and protected', () => {
      expect(isProtectedClass('suppressions')).toBe(true)
      expect(() => assertProtectedClassImmunity('suppressions')).toThrow(
        ProtectedClassImmunityError
      )
    })

    it('21. review_request_recipient_evidence untouched and protected', () => {
      expect(isProtectedClass('review_request_recipient_evidence')).toBe(true)
      expect(() =>
        assertProtectedClassImmunity('review_request_recipient_evidence')
      ).toThrow(ProtectedClassImmunityError)
    })

    it('22. messaging_authority_evidence untouched and protected', () => {
      expect(isProtectedClass('messaging_authority_evidence')).toBe(true)
      expect(() =>
        assertProtectedClassImmunity('messaging_authority_evidence')
      ).toThrow(ProtectedClassImmunityError)
    })

    it('23. customer_erasure_records untouched and protected', () => {
      expect(isProtectedClass('customer_erasure_records')).toBe(true)
      expect(() =>
        assertProtectedClassImmunity('customer_erasure_records')
      ).toThrow(ProtectedClassImmunityError)
    })

    it('24. audit_events untouched and protected', () => {
      expect(isProtectedClass('audit_events')).toBe(true)
      expect(() => assertProtectedClassImmunity('audit_events')).toThrow(
        ProtectedClassImmunityError
      )
    })

    it('25. financial / usage ledgers and source_event_id untouched and protected', () => {
      const ledgers = [
        'usage_ledger',
        'cost_ledger',
        'organization_usage',
        'customer_completion_events.source_event_id',
      ]

      for (const cls of ledgers) {
        expect(isProtectedClass(cls)).toBe(true)
        expect(() => assertProtectedClassImmunity(cls)).toThrow(
          ProtectedClassImmunityError
        )
      }
    })

    it('Verifies complete set of all 9 frozen permanent-retention classes and launch durations', () => {
      expect(PERMANENT_RETENTION_CLASSES).toEqual([
        'suppressions',
        'review_request_recipient_evidence',
        'messaging_authority_evidence',
        'customer_erasure_records',
        'audit_events',
        'usage_ledger',
        'cost_ledger',
        'organization_usage',
        'customer_completion_events.source_event_id',
      ])

      expect(COMPLETION_CONTACT_RETENTION_DAYS).toBe(30)
      expect(REVIEW_LINK_EXPIRATION_DAYS).toBe(90)
      expect(DISPATCHED_OUTBOX_RETENTION_DAYS).toBe(30)
      expect(REVIEW_LINK_EXPIRATION_MS).toBe(90 * 24 * 60 * 60 * 1000)
    })
  })
})
