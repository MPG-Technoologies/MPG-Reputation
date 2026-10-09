import { describe, it, expect, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import {
  assertProtectedClassImmunity,
  isProtectedClass,
  redactAgedCompletionContacts,
  purgeDispatchedDomainOutbox,
} from '../../src/domain/privacy/retention-controls'
import { generateTrackingToken } from '../../src/domain/tracking'
import { generateUnsubscribeToken } from '../../src/domain/unsubscribe'
import { hashSuppressionContact } from '../../src/domain/suppression'
import { GET as trackingRouteGet } from '../../src/app/r/[token]/route'
import { GET as unsubscribeRouteGet, POST as unsubscribeRoutePost } from '../../src/app/unsubscribe/[token]/route'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const isDbAvailable = !!SERVICE_KEY && SERVICE_KEY !== 'dummy_service_role_key'

describe.skipIf(!isDbAvailable)('MR-7C.4B1 Real PostgreSQL Retention Controls Integration Suite', () => {
  let adminClient: SupabaseClient<Database>
  let orgAId: string
  let orgBId: string
  let locAId: string
  let locBId: string
  let custAId: string
  let custBId: string
  let destAId: string
  const baseNonce = Date.now()

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Create Tenant A
    const { data: orgA, error: orgAErr } = await adminClient
      .from('organizations')
      .insert({
        name: `Org Retention A ${baseNonce}`,
        slug: `org-retention-a-${baseNonce}`,
        status: 'ACTIVE',
      })
      .select('id')
      .single()
    if (orgAErr || !orgA) throw new Error(`Failed to create Org A: ${orgAErr?.message}`)
    orgAId = orgA.id

    // Create Tenant B
    const { data: orgB, error: orgBErr } = await adminClient
      .from('organizations')
      .insert({
        name: `Org Retention B ${baseNonce}`,
        slug: `org-retention-b-${baseNonce}`,
        status: 'ACTIVE',
      })
      .select('id')
      .single()
    if (orgBErr || !orgB) throw new Error(`Failed to create Org B: ${orgBErr?.message}`)
    orgBId = orgB.id

    // Location for Tenant A
    const { data: locA, error: locAErr } = await adminClient
      .from('locations')
      .insert({
        organization_id: orgAId,
        name: `Location A ${baseNonce}`,
        status: 'ACTIVE',
      })
      .select('id')
      .single()
    if (locAErr || !locA) throw new Error(`Failed to create Loc A: ${locAErr?.message}`)
    locAId = locA.id

    // Location for Tenant B
    const { data: locB, error: locBErr } = await adminClient
      .from('locations')
      .insert({
        organization_id: orgBId,
        name: `Location B ${baseNonce}`,
        status: 'ACTIVE',
      })
      .select('id')
      .single()
    if (locBErr || !locB) throw new Error(`Failed to create Loc B: ${locBErr?.message}`)
    locBId = locB.id

    // Customer for Tenant A
    const { data: custA, error: custAErr } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgAId,
        location_id: locAId,
        first_name: 'Jane',
        last_name: 'Doe',
        email: `jane.retention.${baseNonce}@example.test`,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()
    if (custAErr || !custA) throw new Error(`Failed to create Customer A: ${custAErr?.message}`)
    custAId = custA.id

    // Customer for Tenant B
    const { data: custB, error: custBErr } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgBId,
        location_id: locBId,
        first_name: 'Bob',
        last_name: 'Smith',
        email: `bob.retention.${baseNonce}@example.test`,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()
    if (custBErr || !custB) throw new Error(`Failed to create Customer B: ${custBErr?.message}`)
    custBId = custB.id

    // Review Destination for Tenant A
    const { data: destA, error: destAErr } = await adminClient
      .from('review_destinations')
      .insert({
        organization_id: orgAId,
        location_id: locAId,
        provider: 'google',
        url: 'https://g.page/r/test-retention-destination/review',
        canonical_url: 'https://g.page/r/test-retention-destination/review',
        status: 'CONFIRMED',
      })
      .select('id')
      .single()
    if (destAErr || !destA) throw new Error(`Failed to create Destination A: ${destAErr?.message}`)
    destAId = destA.id
  })

  // 1-4. COMPLETION CONTACT REDACTION TESTS
  describe('1. Completion Contact Redaction (30-day policy)', () => {
    it('1. updates only contact for >30-day events, preserving source_event_id and completion row', async () => {
      const sourceEventId = `source-aged-${baseNonce}-1`
      const agedDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString()

      const { data: comp, error: compErr } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: custAId,
          source: 'api',
          source_event_id: sourceEventId,
          contact: { email: 'aged.patient@example.test', firstName: 'Alice' },
          created_at: agedDate,
          completed_at: agedDate,
        })
        .select('id, contact, source_event_id, created_at')
        .single()

      expect(compErr).toBeNull()
      expect(comp?.contact).toEqual({ email: 'aged.patient@example.test', firstName: 'Alice' })

      // Execute redaction
      const result = await redactAgedCompletionContacts(adminClient, { organizationId: orgAId })
      expect(result.redactedCount).toBeGreaterThanOrEqual(1)

      // Query database directly
      const { data: updated, error: updatedErr } = await adminClient
        .from('customer_completion_events')
        .select('id, contact, source_event_id, created_at, customer_id, organization_id')
        .eq('id', comp!.id)
        .single()

      expect(updatedErr).toBeNull()
      expect(updated?.id).toBe(comp!.id)
      expect(updated?.source_event_id).toBe(sourceEventId)
      expect(updated?.contact).toEqual({})
      expect(new Date(updated!.created_at).getTime()).toBe(new Date(agedDate).getTime())
      expect(updated?.customer_id).toBe(custAId)
      expect(updated?.organization_id).toBe(orgAId)
    })

    it('2. leaves completion contact untouched if <30 days old', async () => {
      const sourceEventId = `source-fresh-${baseNonce}-2`
      const freshDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()

      const { data: comp, error: compErr } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: custAId,
          source: 'api',
          source_event_id: sourceEventId,
          contact: { email: 'fresh.patient@example.test', firstName: 'Bob' },
          created_at: freshDate,
          completed_at: freshDate,
        })
        .select('id, contact')
        .single()

      expect(compErr).toBeNull()

      // Execute redaction
      await redactAgedCompletionContacts(adminClient, { organizationId: orgAId })

      // Query database directly
      const { data: check } = await adminClient
        .from('customer_completion_events')
        .select('contact')
        .eq('id', comp!.id)
        .single()

      expect(check?.contact).toEqual({ email: 'fresh.patient@example.test', firstName: 'Bob' })
    })

    it('3. does not mutate another tenant rows', async () => {
      const sourceEventId = `source-orgB-${baseNonce}-3`
      const agedDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()

      const { data: compB, error: compBErr } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgBId,
          location_id: locBId,
          customer_id: custBId,
          source: 'api',
          source_event_id: sourceEventId,
          contact: { email: 'tenantB.patient@example.test' },
          created_at: agedDate,
          completed_at: agedDate,
        })
        .select('id')
        .single()

      expect(compBErr).toBeNull()

      // Run redaction scoped to Org A
      await redactAgedCompletionContacts(adminClient, { organizationId: orgAId })

      // Verify Org B row is completely untouched
      const { data: checkB } = await adminClient
        .from('customer_completion_events')
        .select('contact')
        .eq('id', compB!.id)
        .single()

      expect(checkB?.contact).toEqual({ email: 'tenantB.patient@example.test' })
    })
  })

  // 5-8. DISPATCHED OUTBOX AGING TESTS
  describe('2. Dispatched Domain Outbox Aging (30-day purge)', () => {
    it('5. purges >30-day DISPATCHED outbox rows', async () => {
      const agedDispatchedDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString()

      const { data: row, error: rowErr } = await adminClient
        .from('domain_event_outbox')
        .insert({
          organization_id: orgAId,
          aggregate_type: 'customer',
          aggregate_id: custAId,
          event_type: 'customer.completed',
          payload: { eventId: 'evt-1', organizationId: orgAId, locationId: locAId, customerId: custAId, sourceEventId: 'src-1' },
          status: 'DISPATCHED',
          dispatched_at: agedDispatchedDate,
          created_at: agedDispatchedDate,
        })
        .select('id')
        .single()

      expect(rowErr).toBeNull()

      const result = await purgeDispatchedDomainOutbox(adminClient, { batchSize: 100 })
      expect(result.purgedCount).toBeGreaterThanOrEqual(1)

      const { data: check } = await adminClient
        .from('domain_event_outbox')
        .select('id')
        .eq('id', row!.id)

      expect(check?.length).toBe(0)
    })

    it('6. retains old PENDING rows indefinitely (never purged)', async () => {
      const agedDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()

      const { data: row, error: rowErr } = await adminClient
        .from('domain_event_outbox')
        .insert({
          organization_id: orgAId,
          aggregate_type: 'customer',
          aggregate_id: custAId,
          event_type: 'customer.completed',
          payload: { eventId: 'evt-pending', organizationId: orgAId, locationId: locAId, customerId: custAId, sourceEventId: 'src-pending' },
          status: 'PENDING',
          created_at: agedDate,
        })
        .select('id')
        .single()

      expect(rowErr).toBeNull()

      await purgeDispatchedDomainOutbox(adminClient, { batchSize: 100 })

      const { data: check } = await adminClient
        .from('domain_event_outbox')
        .select('id, status')
        .eq('id', row!.id)
        .single()

      expect(check?.id).toBe(row!.id)
      expect(check?.status).toBe('PENDING')
    })

    it('7. retains failed/unresolved rows indefinitely', async () => {
      const agedDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()

      const { data: row, error: rowErr } = await adminClient
        .from('domain_event_outbox')
        .insert({
          organization_id: orgAId,
          aggregate_type: 'customer',
          aggregate_id: custAId,
          event_type: 'customer.completed',
          payload: { eventId: 'evt-failed', organizationId: orgAId, locationId: locAId, customerId: custAId, sourceEventId: 'src-failed' },
          status: 'FAILED',
          created_at: agedDate,
        })
        .select('id')
        .single()

      expect(rowErr).toBeNull()

      await purgeDispatchedDomainOutbox(adminClient, { batchSize: 100 })

      const { data: check } = await adminClient
        .from('domain_event_outbox')
        .select('id, status')
        .eq('id', row!.id)
        .single()

      expect(check?.id).toBe(row!.id)
      expect(check?.status).toBe('FAILED')
    })

    it('8. audit metadata contains no raw contact data or outbox payloads', async () => {
      const { data: auditLogs, error: auditErr } = await adminClient
        .from('audit_events')
        .select('event_type, metadata')
        .in('event_type', ['retention.completion_contacts_redacted', 'retention.dispatched_outbox_purged'])
        .order('created_at', { ascending: false })
        .limit(10)

      expect(auditErr).toBeNull()
      expect(auditLogs?.length).toBeGreaterThan(0)
      for (const log of auditLogs || []) {
        const metaStr = JSON.stringify(log.metadata)
        expect(metaStr).not.toContain('aged.patient@example.test')
        expect(metaStr).not.toContain('evt-1')
        expect(metaStr).not.toContain('Alice')
      }
    })
  })

  // 9-14. PERMANENT-RETENTION IMMUNITY PROOFS
  describe('3. Permanent-Retention Protections', () => {
    it('9. suppressions are permanently retained and cannot be targeted', async () => {
      const contactHash = hashSuppressionContact('email', `unsub.${baseNonce}@example.test`)
      const { data: supp, error: suppErr } = await adminClient
        .from('suppressions')
        .insert({
          organization_id: orgAId,
          channel: 'email',
          contact_hash: contactHash,
          reason: 'MANUAL_UNSUBSCRIBE',
        })
        .select('id')
        .single()

      expect(suppErr).toBeNull()
      expect(isProtectedClass('suppressions')).toBe(true)
      expect(() => assertProtectedClassImmunity('suppressions')).toThrow()

      const { data: check } = await adminClient
        .from('suppressions')
        .select('id')
        .eq('id', supp!.id)
        .single()

      expect(check?.id).toBe(supp!.id)
    })

    it('10. recipient evidence is permanently retained and immune from purge', async () => {
      expect(isProtectedClass('review_request_recipient_evidence')).toBe(true)
      expect(() => assertProtectedClassImmunity('review_request_recipient_evidence')).toThrow()
    })

    it('11. messaging authority evidence is permanently retained and immune from purge', async () => {
      expect(isProtectedClass('messaging_authority_evidence')).toBe(true)
      expect(() => assertProtectedClassImmunity('messaging_authority_evidence')).toThrow()
    })

    it('12. erasure certificates are permanently retained and immune from purge', async () => {
      expect(isProtectedClass('customer_erasure_records')).toBe(true)
      expect(() => assertProtectedClassImmunity('customer_erasure_records')).toThrow()
    })

    it('13. audit history is retained indefinitely and immune from purge', async () => {
      expect(isProtectedClass('audit_events')).toBe(true)
      expect(() => assertProtectedClassImmunity('audit_events')).toThrow()
    })

    it('14. usage and cost ledgers are retained indefinitely and immune from purge', async () => {
      expect(isProtectedClass('organization_usage')).toBe(true)
      expect(isProtectedClass('usage_ledger')).toBe(true)
      expect(isProtectedClass('cost_ledger')).toBe(true)
      expect(() => assertProtectedClassImmunity('organization_usage')).toThrow()
      expect(() => assertProtectedClassImmunity('usage_ledger')).toThrow()
      expect(() => assertProtectedClassImmunity('cost_ledger')).toThrow()
    })
  })

  // 15-20. REVIEW-LINK / UNSUBSCRIBE REGRESSION
  describe('4. Review Link Expiration (90-day) and Unsubscribe Persistence', () => {
    it('15. review link before 90 days routes normally (HTTP 302 redirect)', async () => {
      // Create completion event for this review request
      const { data: comp } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: custAId,
          source: 'quick_complete',
          source_event_id: `source-review-link-recent-${baseNonce}`,
          contact: { email: `recent.${baseNonce}@example.test` },
        })
        .select('id')
        .single()

      const { token, tokenHash } = generateTrackingToken()
      const { tokenHash: unsubTokenHash } = generateUnsubscribeToken()
      const recentSentAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days ago

      const { data: reqRow, error: reqErr } = await adminClient
        .from('review_requests')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: custAId,
          completion_event_id: comp!.id,
          destination_id: destAId,
          token,
          token_hash: tokenHash,
          unsubscribe_token_hash: unsubTokenHash,
          status: 'SENT',
          sent_at: recentSentAt,
          channel: 'email',
        })
        .select('id, token')
        .single()

      expect(reqErr).toBeNull()

      // Customer accesses valid link
      const req = new NextRequest(`http://localhost:3000/r/${token}`)
      const res = await trackingRouteGet(req, {
        params: Promise.resolve({ token }),
      })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('https://g.page/r/test-retention-destination/review')

      // Verify transitioned to CLICKED
      const { data: clicked } = await adminClient
        .from('review_requests')
        .select('status, clicked_at')
        .eq('id', reqRow!.id)
        .single()

      expect(clicked?.status).toBe('CLICKED')
      expect(clicked?.clicked_at).not.toBeNull()
    })

    it('16. review link at or after 90 days fails closed with HTTP 410 Gone HTML and no redirect', async () => {
      // Create completion event for this review request
      const { data: comp } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: custAId,
          source: 'quick_complete',
          source_event_id: `source-review-link-expired-${baseNonce}`,
          contact: { email: `expired.${baseNonce}@example.test` },
        })
        .select('id')
        .single()

      const { token, tokenHash } = generateTrackingToken()
      const { token: unsubToken, tokenHash: unsubTokenHash } = generateUnsubscribeToken()
      const expiredSentAt = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString() // 95 days ago

      const { data: reqRow, error: reqErr } = await adminClient
        .from('review_requests')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: custAId,
          completion_event_id: comp!.id,
          destination_id: destAId,
          token,
          token_hash: tokenHash,
          unsubscribe_token: unsubToken,
          unsubscribe_token_hash: unsubTokenHash,
          status: 'SENT',
          sent_at: expiredSentAt,
          created_at: expiredSentAt,
          channel: 'email',
        })
        .select('id')
        .single()

      expect(reqErr).toBeNull()

      // Bind recipient evidence as required by MR-7C.3A
      const recipientHash = hashSuppressionContact('email', `expired.${baseNonce}@example.test`)
      const { error: evidErr } = await adminClient.from('review_request_recipient_evidence').insert({
        organization_id: orgAId,
        review_request_id: reqRow!.id,
        channel: 'email',
        suppression_contact_hash: recipientHash,
      })
      expect(evidErr).toBeNull()

      // Customer accesses expired link
      const req = new NextRequest(`http://localhost:3000/r/${token}`)
      const res = await trackingRouteGet(req, {
        params: Promise.resolve({ token }),
      })

      expect(res.status).toBe(410)
      expect(res.headers.get('location')).toBeNull()
      const html = await res.text()
      expect(html).toContain('Review Link Expired')

      // 17. Expired link creates no click event and status remains SENT
      const { data: unclicked } = await adminClient
        .from('review_requests')
        .select('status, clicked_at')
        .eq('id', reqRow!.id)
        .single()

      expect(unclicked?.status).toBe('SENT')
      expect(unclicked?.clicked_at).toBeNull()

      const { data: clickEvents } = await adminClient
        .from('message_events')
        .select('id')
        .eq('review_request_id', reqRow!.id)
        .eq('event_type', 'clicked')

      expect(clickEvents?.length).toBe(0)

      // 18. Expired link increments no usage metrics
      // 19. Expired link reveals no internal identifiers
      expect(html).not.toContain(orgAId)
      expect(html).not.toContain(custAId)
      expect(html).not.toContain(reqRow!.id)
      expect(html).not.toContain(tokenHash)

      // 20. Unsubscribe for the same old request remains fully operational
      const unsubReq = new NextRequest(`http://localhost:3000/unsubscribe/${unsubToken}`)
      const unsubRes = await unsubscribeRouteGet(unsubReq, {
        params: Promise.resolve({ token: unsubToken }),
      })
      expect(unsubRes.status).toBe(200)

      const unsubPostReq = new NextRequest(`http://localhost:3000/unsubscribe/${unsubToken}`, {
        method: 'POST',
      })
      const unsubPostRes = await unsubscribeRoutePost(unsubPostReq, {
        params: Promise.resolve({ token: unsubToken }),
      })
      expect(unsubPostRes.status).toBe(200)
    })
  })
})
