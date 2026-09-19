import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createHmac, randomUUID } from 'crypto'
import { POST } from '../../src/app/api/webhooks/resend/route'
import * as adminModule from '../../src/lib/supabase/admin'
const { createAdminClient } = adminModule
import { hashSuppressionContact } from '../../src/domain/suppression'
import type { ReviewRequestStatus } from '../../src/domain/review-request/transitions'

// Deterministic test Svix secret: whsec_ + base64(32 bytes)
const TEST_RAW_KEY = Buffer.from('test_svix_secret_key_32_bytes!!', 'utf-8')
const TEST_WEBHOOK_SECRET = `whsec_${TEST_RAW_KEY.toString('base64')}`

function signSvixPayload(secret: string, payload: string, eventId = `evt_${randomUUID()}`) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const secretKey = Buffer.from(secret.replace('whsec_', ''), 'base64')
  const signature = createHmac('sha256', secretKey)
    .update(`${eventId}.${timestamp}.${payload}`)
    .digest('base64')

  return {
    headers: {
      'svix-id': eventId,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
      'content-type': 'application/json',
    },
    eventId,
  }
}

describe('Resend Inbound Webhook Endpoint & Event Deduplication (MR-1A, MR-1A.1, MR-1A.2)', () => {
  const originalEnv = process.env
  const supabase = createAdminClient()

  let testOrgId: string
  let testLocationId: string
  let testCustomerId: string
  let testCompletionEventId: string
  let testReviewRequestId: string
  let testEmailId: string
  let testRecipientEmail: string

  // Helper to create synthetic isolated review requests for specific scenario testing
  async function createTestHierarchy(nonce: number, email: string, initialStatus: ReviewRequestStatus = 'SENT') {
    const { data: bEvent, error: bEventErr } = await supabase
      .from('customer_completion_events')
      .insert({
        organization_id: testOrgId,
        location_id: testLocationId,
        customer_id: testCustomerId,
        source: 'quick_complete',
        source_event_id: `src_test_${nonce}`,
        contact: { email },
        permission: { emailConsent: true },
      })
      .select('id')
      .single()
    if (bEventErr || !bEvent) throw new Error(`Setup cce failed: ${bEventErr?.message}`)

    const token = `token_${nonce}`
    const { data: testReq, error: reqErr } = await supabase
      .from('review_requests')
      .insert({
        organization_id: testOrgId,
        location_id: testLocationId,
        customer_id: testCustomerId,
        completion_event_id: bEvent.id,
        channel: 'email',
        status: initialStatus,
        token,
        token_hash: token,
        ...(initialStatus === 'CLICKED' ? { clicked_at: new Date().toISOString() } : {}),
      })
      .select('id')
      .single()
    if (reqErr || !testReq) throw new Error(`Setup req failed: ${reqErr?.message}`)

    const emailId = `re_msg_${nonce}`
    await supabase.from('message_events').insert({
      organization_id: testOrgId,
      review_request_id: testReq.id,
      provider: 'resend',
      provider_message_id: emailId,
      event_type: 'sent',
      status: initialStatus,
      metadata: { messageKind: 'initial_review_request' },
    })

    return { reviewRequestId: testReq.id, emailId }
  }

  beforeAll(async () => {
    // Check if local Supabase is accessible
    const { error: pingErr } = await supabase.from('organizations').select('id').limit(1)
    if (pingErr) {
      console.warn('Local Supabase not available, skipping webhook DB tests:', pingErr.message)
      return
    }

    const nonce = Date.now()
    testRecipientEmail = `patient_${nonce}@example.test`

    // Create synthetic test hierarchy
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({
        name: `Webhook Test Org ${nonce}`,
        slug: `webhook-test-org-${nonce}`,
      })
      .select('id')
      .single()
    if (orgErr || !org) throw new Error(`Setup org failed: ${orgErr?.message}`)
    testOrgId = org.id

    const { data: loc, error: locErr } = await supabase
      .from('locations')
      .insert({
        organization_id: testOrgId,
        name: 'Main Clinic',
      })
      .select('id')
      .single()
    if (locErr || !loc) throw new Error(`Setup loc failed: ${locErr?.message}`)
    testLocationId = loc.id

    const { data: cust, error: custErr } = await supabase
      .from('customers')
      .insert({
        organization_id: testOrgId,
        location_id: testLocationId,
        first_name: 'Webhook',
        last_name: 'Patient',
        email: testRecipientEmail,
      })
      .select('id')
      .single()
    if (custErr || !cust) throw new Error(`Setup cust failed: ${custErr?.message}`)
    testCustomerId = cust.id

    const { data: cEvent, error: cEventErr } = await supabase
      .from('customer_completion_events')
      .insert({
        organization_id: testOrgId,
        location_id: testLocationId,
        customer_id: testCustomerId,
        source: 'quick_complete',
        source_event_id: `src_${nonce}`,
        contact: { email: testRecipientEmail },
        permission: { emailConsent: true },
      })
      .select('id')
      .single()
    if (cEventErr || !cEvent) throw new Error(`Setup cce failed: ${cEventErr?.message}`)
    testCompletionEventId = cEvent.id

    const token = `token_webhook_${nonce}`
    const { data: reqRecord, error: reqErr } = await supabase
      .from('review_requests')
      .insert({
        organization_id: testOrgId,
        location_id: testLocationId,
        customer_id: testCustomerId,
        completion_event_id: testCompletionEventId,
        channel: 'email',
        status: 'SENT',
        token,
        token_hash: token,
      })
      .select('id')
      .single()
    if (reqErr || !reqRecord) throw new Error(`Setup req failed: ${reqErr?.message}`)
    testReviewRequestId = reqRecord.id

    // Seed initial message_event establishing provider_message_id correlation
    testEmailId = `re_msg_${nonce}`
    const { error: meErr } = await supabase.from('message_events').insert({
      organization_id: testOrgId,
      review_request_id: testReviewRequestId,
      provider: 'resend',
      provider_message_id: testEmailId,
      event_type: 'sent',
      status: 'SENT',
      metadata: { messageKind: 'initial_review_request' },
    })
    if (meErr) throw new Error(`Setup me failed: ${meErr?.message}`)
  })

  afterAll(async () => {
    if (testOrgId) {
      await supabase.from('organizations').delete().eq('id', testOrgId)
    }
  })

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      RESEND_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      RESEND_API_KEY: 're_dummy_key_for_test',
    }
  })

  describe('Cryptographic Signature Verification & Fail-Closed Behavior', () => {
    it('fails closed with HTTP 500 if RESEND_WEBHOOK_SECRET is missing', async () => {
      delete process.env.RESEND_WEBHOOK_SECRET

      const req = new Request('http://localhost:3000/api/webhooks/resend', {
        method: 'POST',
        headers: {
          'svix-id': 'msg_1',
          'svix-timestamp': '12345',
          'svix-signature': 'v1,sig',
        },
        body: JSON.stringify({ type: 'email.delivered' }),
      })

      const res = await POST(req)
      expect(res.status).toBe(500)
    })

    it('rejects request with HTTP 400 if svix headers are missing', async () => {
      const req = new Request('http://localhost:3000/api/webhooks/resend', {
        method: 'POST',
        headers: {},
        body: JSON.stringify({ type: 'email.delivered' }),
      })

      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('rejects request with HTTP 400 if signature is invalid or tampered', async () => {
      const payload = JSON.stringify({ type: 'email.delivered' })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload)

      const tamperedReq = new Request('http://localhost:3000/api/webhooks/resend', {
        method: 'POST',
        headers: {
          ...headers,
          'svix-signature': 'v1,tamperedSignatureBase64==',
        },
        body: payload,
      })

      const res = await POST(tamperedReq)
      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toContain('Invalid webhook signature')
    })
  })

  describe('Delivery Event & Idempotent Deduplication', () => {
    it('processes verified email.delivered event, transitions status, and populates delivered_at and processed_at', async () => {
      const payload = JSON.stringify({
        type: 'email.delivered',
        created_at: new Date().toISOString(),
        data: {
          email_id: testEmailId,
          to: [testRecipientEmail],
        },
      })
      const { headers, eventId } = signSvixPayload(TEST_WEBHOOK_SECRET, payload)

      const req = new Request('http://localhost:3000/api/webhooks/resend', {
        method: 'POST',
        headers,
        body: payload,
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.received).toBe(true)

      // Verify review request status transitioned to DELIVERED
      const { data: updatedReq } = await supabase
        .from('review_requests')
        .select('status, delivered_at')
        .eq('id', testReviewRequestId)
        .single()
      expect(updatedReq?.status).toBe('DELIVERED')
      expect(updatedReq?.delivered_at).not.toBeNull()

      // Verify message_event was recorded with provider_event_id and processed_at stamped
      const { data: events } = await supabase
        .from('message_events')
        .select('*')
        .eq('provider_event_id', eventId)
      expect(events?.length).toBe(1)
      const eventRecord = events![0]
      expect(eventRecord.event_type).toBe('email.delivered')
      expect(eventRecord.status).toBe('DELIVERED')
      expect(eventRecord.processed_at).not.toBeNull()

      // Verify metadata privacy hardening: NO email, customer name, or URLs in metadata
      const metaString = JSON.stringify(eventRecord.metadata)
      expect(metaString).not.toContain(testRecipientEmail)
      expect(metaString).not.toContain('http')
      expect(metaString).not.toContain('token')
    })

    it('deduplicates replayed webhook event with same svix-id without duplicate side-effects', async () => {
      const fixedEventId = `replayed_evt_${randomUUID()}`
      const payload = JSON.stringify({
        type: 'email.delivered',
        created_at: new Date().toISOString(),
        data: {
          email_id: testEmailId,
          to: [testRecipientEmail],
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload, fixedEventId)

      // First delivery
      const req1 = new Request('http://localhost:3000/api/webhooks/resend', {
        method: 'POST',
        headers,
        body: payload,
      })
      const res1 = await POST(req1)
      expect(res1.status).toBe(200)

      // Count message_events before replay
      const { count: countBefore } = await supabase
        .from('message_events')
        .select('*', { count: 'exact', head: true })
        .eq('provider_event_id', fixedEventId)
      expect(countBefore).toBe(1)

      // Replay identical event
      const req2 = new Request('http://localhost:3000/api/webhooks/resend', {
        method: 'POST',
        headers,
        body: payload,
      })
      const res2 = await POST(req2)
      expect(res2.status).toBe(200)
      const json2 = await res2.json()
      expect(json2.received).toBe(true)
      expect(json2.duplicate).toBe(true)

      // Verify no duplicate message_event was created
      const { count: countAfter } = await supabase
        .from('message_events')
        .select('*', { count: 'exact', head: true })
        .eq('provider_event_id', fixedEventId)
      expect(countAfter).toBe(1)
    })
  })

  describe('Concurrent Webhook Deduplication (MR-1A.1 Section 3 & 8)', () => {
    it('concurrent identical webhook delivery is idempotent and returns safe success', async () => {
      const concurrentNonce = Date.now() + 10
      const { emailId: cEmailId } = await createTestHierarchy(
        concurrentNonce,
        `concurrent.${concurrentNonce}@example.test`,
        'SENT'
      )

      const concurrentEventId = `concurrent_evt_${randomUUID()}`
      const payload = JSON.stringify({
        type: 'email.delivered',
        created_at: new Date().toISOString(),
        data: {
          email_id: cEmailId,
          to: [`concurrent.${concurrentNonce}@example.test`],
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload, concurrentEventId)

      // Dispatch two identical requests simultaneously
      const [res1, res2] = await Promise.all([
        POST(
          new Request('http://localhost:3000/api/webhooks/resend', {
            method: 'POST',
            headers: { ...headers },
            body: payload,
          })
        ),
        POST(
          new Request('http://localhost:3000/api/webhooks/resend', {
            method: 'POST',
            headers: { ...headers },
            body: payload,
          })
        ),
      ])

      // Both requests must succeed with HTTP 200 (neither should fail with 500)
      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)

      const json1 = await res1.json()
      const json2 = await res2.json()
      expect(json1.received).toBe(true)
      expect(json2.received).toBe(true)

      // Exactly one should process normally, and one should be handled as duplicate
      const duplicateCount = [json1.duplicate, json2.duplicate].filter(Boolean).length
      expect(duplicateCount).toBe(1)

      // Verify database uniqueness guarantee: exactly 1 message_event row exists
      const { count: eventRowCount } = await supabase
        .from('message_events')
        .select('*', { count: 'exact', head: true })
        .eq('provider_event_id', concurrentEventId)
      expect(eventRowCount).toBe(1)
    })
  })

  describe('Provider-Suppressed Integration (MR-1A.1 Section 4)', () => {
    it('email.suppressed creates internal suppression, marks request SUPPRESSED, and is idempotent on replay', async () => {
      const suppNonce = Date.now() + 20
      const suppEmail = `suppressed.${suppNonce}@example.test`
      const { reviewRequestId: sReqId, emailId: sEmailId } = await createTestHierarchy(
        suppNonce,
        suppEmail,
        'SENT'
      )

      const suppEventId = `evt_supp_${randomUUID()}`
      const payload = JSON.stringify({
        type: 'email.suppressed',
        created_at: new Date().toISOString(),
        data: {
          email_id: sEmailId,
          to: [suppEmail],
          suppression: {
            reason: 'Recipient previously bounced',
          },
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload, suppEventId)

      // First delivery
      const res1 = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers,
          body: payload,
        })
      )
      expect(res1.status).toBe(200)

      // Verify review request became SUPPRESSED
      const { data: updatedReq } = await supabase
        .from('review_requests')
        .select('status')
        .eq('id', sReqId)
        .single()
      expect(updatedReq?.status).toBe('SUPPRESSED')

      // Verify contact suppression was created with PROVIDER_SUPPRESSED reason
      const expectedHash = hashSuppressionContact('email', suppEmail)
      const { data: suppressions } = await supabase
        .from('suppressions')
        .select('*')
        .eq('organization_id', testOrgId)
        .eq('contact_hash', expectedHash)
      expect(suppressions?.length).toBe(1)
      expect(suppressions![0].reason).toBe('PROVIDER_SUPPRESSED')

      // Verify message_events metadata does not contain raw recipient email
      const { data: events } = await supabase
        .from('message_events')
        .select('*')
        .eq('provider_event_id', suppEventId)
      expect(events?.length).toBe(1)
      expect(JSON.stringify(events![0].metadata)).not.toContain(suppEmail)
      expect(events![0].processed_at).not.toBeNull()

      // Replay identical event: must not duplicate suppression
      const res2 = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers,
          body: payload,
        })
      )
      expect(res2.status).toBe(200)
      const json2 = await res2.json()
      expect(json2.duplicate).toBe(true)

      const { count: finalSuppCount } = await supabase
        .from('suppressions')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', testOrgId)
        .eq('contact_hash', expectedHash)
      expect(finalSuppCount).toBe(1)
    })
  })

  describe('Complaint Handling & Duplicate Protection (MR-1A.1 Section 5)', () => {
    it('spam complaint creates contact suppression and repeated complaint does not duplicate suppression', async () => {
      const complaintNonce = Date.now() + 30
      const complaintEmail = `complaint.${complaintNonce}@example.test`
      const { emailId: cEmailId } = await createTestHierarchy(
        complaintNonce,
        complaintEmail,
        'SENT'
      )

      const complaintEventId1 = `evt_complaint_${randomUUID()}`
      const payload1 = JSON.stringify({
        type: 'email.complained',
        created_at: new Date().toISOString(),
        data: {
          email_id: cEmailId,
          to: [complaintEmail],
        },
      })
      const { headers: headers1 } = signSvixPayload(TEST_WEBHOOK_SECRET, payload1, complaintEventId1)

      const res1 = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers: headers1,
          body: payload1,
        })
      )
      expect(res1.status).toBe(200)

      const expectedHash = hashSuppressionContact('email', complaintEmail)
      const { data: suppression } = await supabase
        .from('suppressions')
        .select('*')
        .eq('organization_id', testOrgId)
        .eq('contact_hash', expectedHash)
        .single()
      expect(suppression).not.toBeNull()
      expect(suppression!.reason).toBe('PROVIDER_COMPLAINT')

      // Second distinct event for same complaint: verify DB uniqueness protects suppression table
      const complaintEventId2 = `evt_complaint2_${randomUUID()}`
      const payload2 = JSON.stringify({
        type: 'email.complained',
        created_at: new Date().toISOString(),
        data: {
          email_id: cEmailId,
          to: [complaintEmail],
        },
      })
      const { headers: headers2 } = signSvixPayload(TEST_WEBHOOK_SECRET, payload2, complaintEventId2)

      const res2 = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers: headers2,
          body: payload2,
        })
      )
      expect(res2.status).toBe(200)

      const { count: finalSuppCount } = await supabase
        .from('suppressions')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', testOrgId)
        .eq('contact_hash', expectedHash)
      expect(finalSuppCount).toBe(1)
    })
  })

  describe('Failed & Delayed Route Coverage (MR-1A.1 Section 6)', () => {
    it('email.delivery_delayed records event without falsely marking request FAILED or suppressing contact', async () => {
      const delayNonce = Date.now() + 40
      const delayEmail = `delayed.${delayNonce}@example.test`
      const { reviewRequestId: dReqId, emailId: dEmailId } = await createTestHierarchy(
        delayNonce,
        delayEmail,
        'SENT'
      )

      const delayEventId = `evt_delay_${randomUUID()}`
      const payload = JSON.stringify({
        type: 'email.delivery_delayed',
        created_at: new Date().toISOString(),
        data: {
          email_id: dEmailId,
          to: [delayEmail],
          delay: {
            message: 'Greylisted 451, will retry',
          },
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload, delayEventId)

      const res = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers,
          body: payload,
        })
      )
      expect(res.status).toBe(200)

      // Request status must NOT be FAILED
      const { data: reqAfter } = await supabase
        .from('review_requests')
        .select('status, failed_at')
        .eq('id', dReqId)
        .single()
      expect(reqAfter?.status).toBe('SENT')
      expect(reqAfter?.failed_at).toBeNull()

      // Event was recorded with processed_at stamped
      const { data: eventRecord } = await supabase
        .from('message_events')
        .select('*')
        .eq('provider_event_id', delayEventId)
        .single()
      expect(eventRecord).not.toBeNull()
      expect(eventRecord!.event_type).toBe('email.delivery_delayed')
      expect(eventRecord!.processed_at).not.toBeNull()

      // No suppression created
      const delayHash = hashSuppressionContact('email', delayEmail)
      const { data: supp } = await supabase
        .from('suppressions')
        .select('*')
        .eq('organization_id', testOrgId)
        .eq('contact_hash', delayHash)
        .maybeSingle()
      expect(supp).toBeNull()
    })

    it('email.failed transitions request to FAILED without creating permanent contact suppression', async () => {
      const failNonce = Date.now() + 50
      const failEmail = `failed.${failNonce}@example.test`
      const { reviewRequestId: fReqId, emailId: fEmailId } = await createTestHierarchy(
        failNonce,
        failEmail,
        'SENT'
      )

      const failEventId = `evt_fail_${randomUUID()}`
      const payload = JSON.stringify({
        type: 'email.failed',
        created_at: new Date().toISOString(),
        data: {
          email_id: fEmailId,
          to: [failEmail],
          error: 'Connection timeout after 3 retries',
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload, failEventId)

      const res = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers,
          body: payload,
        })
      )
      expect(res.status).toBe(200)

      // Request transitioned to FAILED
      const { data: reqAfter } = await supabase
        .from('review_requests')
        .select('status, failed_at, error_message')
        .eq('id', fReqId)
        .single()
      expect(reqAfter?.status).toBe('FAILED')
      expect(reqAfter?.failed_at).not.toBeNull()
      expect(reqAfter?.error_message).toContain('Connection timeout')

      // No permanent contact suppression created solely from email.failed
      const failHash = hashSuppressionContact('email', failEmail)
      const { data: supp } = await supabase
        .from('suppressions')
        .select('*')
        .eq('organization_id', testOrgId)
        .eq('contact_hash', failHash)
        .maybeSingle()
      expect(supp).toBeNull()
    })

    it('CLICKED status never regresses when late email.delivered, email.failed, or email.suppressed arrives', async () => {
      const clickedNonce = Date.now() + 60
      const clickedEmail = `clicked.${clickedNonce}@example.test`
      const { reviewRequestId: cReqId, emailId: cEmailId } = await createTestHierarchy(
        clickedNonce,
        clickedEmail,
        'CLICKED'
      )

      const { data: originalReq } = await supabase
        .from('review_requests')
        .select('status, clicked_at')
        .eq('id', cReqId)
        .single()
      expect(originalReq?.status).toBe('CLICKED')
      const originalClickedAt = originalReq?.clicked_at

      // 1. Late email.delivered arrives
      const payloadDelivered = JSON.stringify({
        type: 'email.delivered',
        created_at: new Date().toISOString(),
        data: { email_id: cEmailId, to: [clickedEmail] },
      })
      await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers: signSvixPayload(TEST_WEBHOOK_SECRET, payloadDelivered).headers,
          body: payloadDelivered,
        })
      )

      // 2. Late email.failed arrives
      const payloadFailed = JSON.stringify({
        type: 'email.failed',
        created_at: new Date().toISOString(),
        data: { email_id: cEmailId, to: [clickedEmail], error: 'Late network error' },
      })
      await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers: signSvixPayload(TEST_WEBHOOK_SECRET, payloadFailed).headers,
          body: payloadFailed,
        })
      )

      // 3. Late email.suppressed arrives
      const payloadSuppressed = JSON.stringify({
        type: 'email.suppressed',
        created_at: new Date().toISOString(),
        data: { email_id: cEmailId, to: [clickedEmail] },
      })
      await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers: signSvixPayload(TEST_WEBHOOK_SECRET, payloadSuppressed).headers,
          body: payloadSuppressed,
        })
      )

      // Review request status and clicked_at must remain completely unregressed
      const { data: finalReq } = await supabase
        .from('review_requests')
        .select('status, clicked_at, delivered_at')
        .eq('id', cReqId)
        .single()
      expect(finalReq?.status).toBe('CLICKED')
      expect(finalReq?.clicked_at).toBe(originalClickedAt)
      expect(finalReq?.delivered_at).not.toBeNull()
    })
  })

  describe('Bounce Handling & Contact Suppression (Section 13)', () => {
    it('permanent hard bounce transitions request to FAILED and creates contact suppression', async () => {
      const bounceNonce = Date.now() + 70
      const bounceEmail = `bounce.perm.${bounceNonce}@example.test`
      const { reviewRequestId: bReqId, emailId: bEmailId } = await createTestHierarchy(
        bounceNonce,
        bounceEmail,
        'SENT'
      )

      const payload = JSON.stringify({
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: {
          email_id: bEmailId,
          to: [bounceEmail],
          bounce: {
            type: 'Permanent',
            message: 'Mailbox does not exist 550',
          },
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload)

      const res = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers,
          body: payload,
        })
      )
      expect(res.status).toBe(200)

      // Verify review request status is FAILED
      const { data: updatedReq } = await supabase
        .from('review_requests')
        .select('status, error_message')
        .eq('id', bReqId)
        .single()
      expect(updatedReq?.status).toBe('FAILED')
      expect(updatedReq?.error_message).toContain('Mailbox does not exist')

      // Verify contact suppression exists with reason PROVIDER_HARD_BOUNCE
      const expectedHash = hashSuppressionContact('email', bounceEmail)
      const { data: suppression } = await supabase
        .from('suppressions')
        .select('*')
        .eq('organization_id', testOrgId)
        .eq('contact_hash', expectedHash)
        .maybeSingle()
      expect(suppression).not.toBeNull()
      expect(suppression?.reason).toBe('PROVIDER_HARD_BOUNCE')
    })

    it('transient bounce transitions request to FAILED but does NOT suppress contact', async () => {
      const transNonce = Date.now() + 80
      const transientEmail = `transient.${transNonce}@example.test`
      const { reviewRequestId: tReqId, emailId: tEmailId } = await createTestHierarchy(
        transNonce,
        transientEmail,
        'SENT'
      )

      const payload = JSON.stringify({
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: {
          email_id: tEmailId,
          to: [transientEmail],
          bounce: {
            type: 'Transient',
            message: 'Mailbox full 452',
          },
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload)

      const res = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers,
          body: payload,
        })
      )
      expect(res.status).toBe(200)

      // Request is FAILED
      const { data: updatedReq } = await supabase
        .from('review_requests')
        .select('status')
        .eq('id', tReqId)
        .single()
      expect(updatedReq?.status).toBe('FAILED')

      // But contact is NOT permanently suppressed
      const expectedHash = hashSuppressionContact('email', transientEmail)
      const { data: suppression } = await supabase
        .from('suppressions')
        .select('*')
        .eq('organization_id', testOrgId)
        .eq('contact_hash', expectedHash)
        .maybeSingle()
      expect(suppression).toBeNull()
    })
  })

  describe('Provider Opens & Clicks Isolation (Section 9)', () => {
    it('provider email.opened does NOT count as review activity or change status', async () => {
      const { data: beforeReq } = await supabase
        .from('review_requests')
        .select('status, clicked_at')
        .eq('id', testReviewRequestId)
        .single()

      const payload = JSON.stringify({
        type: 'email.opened',
        created_at: new Date().toISOString(),
        data: {
          email_id: testEmailId,
          to: [testRecipientEmail],
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload)

      const res = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers,
          body: payload,
        })
      )
      expect(res.status).toBe(200)

      const { data: afterReq } = await supabase
        .from('review_requests')
        .select('status, clicked_at')
        .eq('id', testReviewRequestId)
        .single()
      expect(afterReq?.status).toBe(beforeReq?.status)
      expect(afterReq?.clicked_at).toBeNull()
    })

    it('provider email.clicked is NOT interpreted as MPG review link click', async () => {
      const payload = JSON.stringify({
        type: 'email.clicked',
        created_at: new Date().toISOString(),
        data: {
          email_id: testEmailId,
          to: [testRecipientEmail],
          click: {
            link: 'https://updates.techwithmpg.com/track/click',
          },
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload)

      const res = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers,
          body: payload,
        })
      )
      expect(res.status).toBe(200)

      const { data: afterReq } = await supabase
        .from('review_requests')
        .select('status, clicked_at')
        .eq('id', testReviewRequestId)
        .single()
      // Status must NOT have become CLICKED
      expect(afterReq?.status).not.toBe('CLICKED')
      expect(afterReq?.clicked_at).toBeNull()
    })
  })

  describe('Provider Error Sanitization (MR-1A.1 Section 7 & 9)', () => {
    it('sanitizes provider error strings in review_requests and message_events, redacting recipient email and URLs', async () => {
      const sanitizeNonce = Date.now() + 90
      const rawTargetEmail = `secret.patient.${sanitizeNonce}@clinic.example.test`
      const { reviewRequestId: sReqId, emailId: sEmailId } = await createTestHierarchy(
        sanitizeNonce,
        rawTargetEmail,
        'SENT'
      )

      const rawProviderError = `550 5.1.1 User ${rawTargetEmail} unknown at host.\r\nSee diagnostic reference: https://resend.com/errors/550?token=supersecret123`

      const payload = JSON.stringify({
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: {
          email_id: sEmailId,
          to: [rawTargetEmail],
          bounce: {
            type: 'Permanent',
            message: rawProviderError,
          },
        },
      })
      const { headers, eventId } = signSvixPayload(TEST_WEBHOOK_SECRET, payload)

      const res = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers,
          body: payload,
        })
      )
      expect(res.status).toBe(200)

      // Verify review_requests.error_message was sanitized
      const { data: reqRecord } = await supabase
        .from('review_requests')
        .select('error_message')
        .eq('id', sReqId)
        .single()
      expect(reqRecord?.error_message).not.toBeNull()
      expect(reqRecord?.error_message).not.toContain(rawTargetEmail)
      expect(reqRecord?.error_message).not.toContain('https://')
      expect(reqRecord?.error_message).not.toContain('supersecret123')
      expect(reqRecord?.error_message).not.toContain('\r\n')
      expect(reqRecord?.error_message).toContain('[REDACTED_EMAIL]')
      expect(reqRecord?.error_message).toContain('[REDACTED_URL]')
      expect(reqRecord?.error_message).toContain('550 5.1.1 User')

      // Verify message_events.sanitized_error was sanitized
      const { data: eventRecord } = await supabase
        .from('message_events')
        .select('sanitized_error, metadata')
        .eq('provider_event_id', eventId)
        .single()
      expect(eventRecord?.sanitized_error).toBe(reqRecord?.error_message)

      // Verify metadata does not contain raw recipient email or secret URL
      const metaString = JSON.stringify(eventRecord?.metadata || {})
      expect(metaString).not.toContain(rawTargetEmail)
      expect(metaString).not.toContain('https://')
      expect(metaString).not.toContain('supersecret123')
    })
  })

  describe('Resumable Processing & Failure Recovery (MR-1A.2 Sections 11, 12, 13, 14)', () => {
    it('resumes incomplete event processing on retry when review_request update fails initially (MR-1A.2 Section 11)', async () => {
      const failNonce = Date.now() + 100
      const failEmail = `fail-recovery.${failNonce}@example.test`
      const { reviewRequestId: fReqId, emailId: failMsgId } = await createTestHierarchy(
        failNonce,
        failEmail,
        'SENT'
      )
      const failEventId = `evt_fail_res_${randomUUID()}`

      const payload = JSON.stringify({
        type: 'email.delivered',
        created_at: new Date().toISOString(),
        data: {
          email_id: failMsgId,
          to: [failEmail],
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload, failEventId)

      // Mock createAdminClient so the first review_requests update fails
      let failUpdate = true
      const realCreateAdminClient = adminModule.createAdminClient
      const clientSpy = vi.spyOn(adminModule, 'createAdminClient').mockImplementation(() => {
        const client = realCreateAdminClient()
        const origFrom = client.from.bind(client)
        client.from = ((table: string) => {
          const qb = origFrom(table as 'review_requests')
          if (table === 'review_requests') {
            const origUpdate = qb.update.bind(qb)
            qb.update = ((...args: Parameters<typeof origUpdate>) => {
              if (failUpdate) {
                failUpdate = false
                const fakeQuery = {
                  eq: () => fakeQuery,
                  select: () => fakeQuery,
                  then: (resolve: (v: unknown) => unknown) =>
                    Promise.resolve({
                      data: null,
                      error: { message: 'Simulated connection error on review_requests' },
                    }).then(resolve),
                }
                return fakeQuery as unknown as ReturnType<typeof origUpdate>
              }
              return origUpdate(...args)
            }) as typeof origUpdate
          }
          return qb
        }) as unknown as typeof origFrom
        return client
      })

      try {
        // First delivery attempt -> should fail with HTTP 500
        const res1 = await POST(
          new Request('http://localhost:3000/api/webhooks/resend', {
            method: 'POST',
            headers,
            body: payload,
          })
        )
        expect(res1.status).toBe(500)

        // Verify message_events record was claimed, but processed_at remains NULL
        const { data: eventAfterFail } = await supabase
          .from('message_events')
          .select('id, processed_at')
          .eq('provider_event_id', failEventId)
          .single()
        expect(eventAfterFail).not.toBeNull()
        expect(eventAfterFail?.processed_at).toBeNull()

        // Review request is still SENT
        const { data: reqAfterFail } = await supabase
          .from('review_requests')
          .select('status, delivered_at')
          .eq('id', fReqId)
          .single()
        expect(reqAfterFail?.status).toBe('SENT')
        expect(reqAfterFail?.delivered_at).toBeNull()

        // Second delivery attempt (retry with same svix-id) -> must resume and succeed
        const res2 = await POST(
          new Request('http://localhost:3000/api/webhooks/resend', {
            method: 'POST',
            headers,
            body: payload,
          })
        )
        expect(res2.status).toBe(200)

        // Verify review_request now updated to DELIVERED
        const { data: reqAfterRetry } = await supabase
          .from('review_requests')
          .select('status, delivered_at')
          .eq('id', fReqId)
          .single()
        expect(reqAfterRetry?.status).toBe('DELIVERED')
        expect(reqAfterRetry?.delivered_at).not.toBeNull()

        // Verify processed_at is now stamped
        const { data: eventAfterRetry } = await supabase
          .from('message_events')
          .select('id, processed_at')
          .eq('provider_event_id', failEventId)
          .single()
        expect(eventAfterRetry?.processed_at).not.toBeNull()

        // Verify only ONE message_events row exists for this provider_event_id
        const { data: allEvents } = await supabase
          .from('message_events')
          .select('id')
          .eq('provider_event_id', failEventId)
        expect(allEvents?.length).toBe(1)
      } finally {
        clientSpy.mockRestore()
      }
    })

    it('resumes incomplete event processing and persists suppression when suppression write fails initially (MR-1A.2 Section 12)', async () => {
      const suppFailNonce = Date.now() + 110
      const suppFailEmail = `supp-fail.${suppFailNonce}@example.test`
      const { emailId: suppFailMsgId } = await createTestHierarchy(
        suppFailNonce,
        suppFailEmail,
        'SENT'
      )
      const suppFailEventId = `evt_supp_fail_${randomUUID()}`

      const payload = JSON.stringify({
        type: 'email.complained',
        created_at: new Date().toISOString(),
        data: {
          email_id: suppFailMsgId,
          to: [suppFailEmail],
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload, suppFailEventId)

      // Mock createAdminClient so first suppressions.upsert fails
      let failSuppression = true
      const realCreateAdminClient = adminModule.createAdminClient
      const clientSpy = vi.spyOn(adminModule, 'createAdminClient').mockImplementation(() => {
        const client = realCreateAdminClient()
        const origFrom = client.from.bind(client)
        client.from = ((table: string) => {
          const qb = origFrom(table as 'suppressions')
          if (table === 'suppressions') {
            const origUpsert = qb.upsert.bind(qb)
            qb.upsert = ((...args: Parameters<typeof origUpsert>) => {
              if (failSuppression) {
                failSuppression = false
                const fakeQuery = {
                  then: (resolve: (v: unknown) => unknown) =>
                    Promise.resolve({
                      data: null,
                      error: { message: 'Simulated DB error on suppressions write' },
                    }).then(resolve),
                }
                return fakeQuery as unknown as ReturnType<typeof origUpsert>
              }
              return origUpsert(...args)
            }) as typeof origUpsert
          }
          return qb
        }) as unknown as typeof origFrom
        return client
      })

      try {
        // First attempt -> suppression fails -> returns HTTP 500
        const res1 = await POST(
          new Request('http://localhost:3000/api/webhooks/resend', {
            method: 'POST',
            headers,
            body: payload,
          })
        )
        expect(res1.status).toBe(500)

        // Verify message_events claimed, but processed_at remains NULL
        const { data: eventAfterFail } = await supabase
          .from('message_events')
          .select('id, processed_at')
          .eq('provider_event_id', suppFailEventId)
          .single()
        expect(eventAfterFail).not.toBeNull()
        expect(eventAfterFail?.processed_at).toBeNull()

        // Verify suppression was not created yet
        const expectedHash = hashSuppressionContact('email', suppFailEmail)
        const { data: suppBefore } = await supabase
          .from('suppressions')
          .select('id')
          .eq('organization_id', testOrgId)
          .eq('contact_hash', expectedHash)
        expect(suppBefore?.length).toBe(0)

        // Second attempt (retry same svix-id) -> succeeds
        const res2 = await POST(
          new Request('http://localhost:3000/api/webhooks/resend', {
            method: 'POST',
            headers,
            body: payload,
          })
        )
        expect(res2.status).toBe(200)

        // Verify suppression created exactly once
        const { data: suppAfter } = await supabase
          .from('suppressions')
          .select('id, reason')
          .eq('organization_id', testOrgId)
          .eq('contact_hash', expectedHash)
        expect(suppAfter?.length).toBe(1)
        expect(suppAfter?.[0]?.reason).toBe('PROVIDER_COMPLAINT')

        // Verify processed_at is now set
        const { data: eventAfterRetry } = await supabase
          .from('message_events')
          .select('id, processed_at')
          .eq('provider_event_id', suppFailEventId)
          .single()
        expect(eventAfterRetry?.processed_at).not.toBeNull()
      } finally {
        clientSpy.mockRestore()
      }
    })

    it('detects CAS race when request becomes CLICKED before delivery update and preserves CLICKED (MR-1A.2 Section 13)', async () => {
      const raceNonce = Date.now() + 120
      const raceEmail = `race-clicked.${raceNonce}@example.test`
      const { reviewRequestId: rReqId, emailId: rEmailId } = await createTestHierarchy(
        raceNonce,
        raceEmail,
        'SENT'
      )
      const rEventId = `evt_race_${randomUUID()}`

      // Simulate concurrent race: before the first review_requests update executes,
      // mutate review_requests in the database to CLICKED!
      let raceTriggered = false
      const realCreateAdminClient = adminModule.createAdminClient
      const clientSpy = vi.spyOn(adminModule, 'createAdminClient').mockImplementation(() => {
        const client = realCreateAdminClient()
        const origFrom = client.from.bind(client)
        client.from = ((table: string) => {
          const qb = origFrom(table as 'review_requests')
          if (table === 'review_requests') {
            const origUpdate = qb.update.bind(qb)
            qb.update = ((...args: Parameters<typeof origUpdate>) => {
              const builder = origUpdate(...args)
              if (!raceTriggered) {
                raceTriggered = true
                const origThen = builder.then.bind(builder)
                builder.then = ((resolve: (v: unknown) => unknown, reject: (reason: unknown) => unknown) => {
                  // Directly update the DB row to CLICKED right before this first CAS update executes
                  supabase
                    .from('review_requests')
                    .update({ status: 'CLICKED', clicked_at: new Date().toISOString() })
                    .eq('id', rReqId)
                    .then(() => origThen(resolve as never, reject as never))
                }) as typeof builder.then
              }
              return builder
            }) as typeof origUpdate
          }
          return qb
        }) as unknown as typeof origFrom
        return client
      })

      try {
        const payload = JSON.stringify({
          type: 'email.delivered',
          created_at: new Date().toISOString(),
          data: {
            email_id: rEmailId,
            to: [raceEmail],
          },
        })
        const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload, rEventId)

        const res = await POST(
          new Request('http://localhost:3000/api/webhooks/resend', {
            method: 'POST',
            headers,
            body: payload,
          })
        )
        expect(res.status).toBe(200)

        // Verify request remains CLICKED and never regressed to DELIVERED
        const { data: finalReq } = await supabase
          .from('review_requests')
          .select('status, clicked_at, delivered_at')
          .eq('id', rReqId)
          .single()
        expect(finalReq?.status).toBe('CLICKED')
        expect(finalReq?.clicked_at).not.toBeNull()
        // delivered_at is truthfully populated without regressing status
        expect(finalReq?.delivered_at).not.toBeNull()
      } finally {
        clientSpy.mockRestore()
      }
    })

    it('late email.sent cannot regress DELIVERED or CLICKED status (MR-1A.2 Section 14)', async () => {
      const lateNonce = Date.now() + 130
      const lateEmail = `late-sent.${lateNonce}@example.test`
      const deliveredTimestamp = new Date(Date.now() - 3600000).toISOString()
      const { reviewRequestId: lReqId, emailId: lateMsgId } = await createTestHierarchy(
        lateNonce,
        lateEmail,
        'DELIVERED'
      )

      await supabase.from('review_requests').update({ delivered_at: deliveredTimestamp }).eq('id', lReqId)

      // Late email.sent arrives
      const payload = JSON.stringify({
        type: 'email.sent',
        created_at: new Date(Date.now() - 7000000).toISOString(),
        data: {
          email_id: lateMsgId,
          to: [lateEmail],
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload)

      const res = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers,
          body: payload,
        })
      )
      expect(res.status).toBe(200)

      // Status must still be DELIVERED, not regressed to SENT
      const { data: reqAfterLateSent } = await supabase
        .from('review_requests')
        .select('status, delivered_at')
        .eq('id', lReqId)
        .single()
      expect(reqAfterLateSent?.status).toBe('DELIVERED')
      const finalDeliveredAt = reqAfterLateSent?.delivered_at
      expect(finalDeliveredAt ? new Date(finalDeliveredAt).toISOString() : null).toBe(
        new Date(deliveredTimestamp).toISOString()
      )
    })
  })

  describe('Uncorrelated Events Handling (Section 10)', () => {
    it('returns HTTP 200 without error when event cannot be correlated', async () => {
      const payload = JSON.stringify({
        type: 'email.delivered',
        created_at: new Date().toISOString(),
        data: {
          email_id: 're_completely_unknown_msg_99999',
          to: ['unknown@example.test'],
        },
      })
      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload)

      const res = await POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers,
          body: payload,
        })
      )
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.received).toBe(true)
      expect(json.correlated).toBe(false)
    })
  })
})
