import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createHmac, randomUUID } from 'crypto'
import { POST } from '../../src/app/api/webhooks/resend/route'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { hashSuppressionContact } from '../../src/domain/suppression'

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

describe('Resend Inbound Webhook Endpoint & Event Deduplication (MR-1A)', () => {
  const originalEnv = process.env
  const supabase = createAdminClient()

  let testOrgId: string
  let testLocationId: string
  let testCustomerId: string
  let testCompletionEventId: string
  let testReviewRequestId: string
  let testEmailId: string
  let testRecipientEmail: string

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
    it('processes verified email.delivered event, transitions status, and populates delivered_at', async () => {
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

      // Verify message_event was recorded with provider_event_id and without PII
      const { data: events } = await supabase
        .from('message_events')
        .select('*')
        .eq('provider_event_id', eventId)
      expect(events?.length).toBe(1)
      const eventRecord = events![0]
      expect(eventRecord.event_type).toBe('email.delivered')
      expect(eventRecord.status).toBe('DELIVERED')

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

  describe('Bounce Handling & Contact Suppression (Section 13)', () => {
    it('permanent hard bounce transitions request to FAILED and creates contact suppression', async () => {
      const bounceNonce = Date.now()
      const bounceEmail = `bounce.perm.${bounceNonce}@example.test`

      const { data: bEvent, error: bEventErr } = await supabase
        .from('customer_completion_events')
        .insert({
          organization_id: testOrgId,
          location_id: testLocationId,
          customer_id: testCustomerId,
          source: 'quick_complete',
          source_event_id: `src_bounce_perm_${bounceNonce}`,
          contact: { email: bounceEmail },
          permission: { emailConsent: true },
        })
        .select('id')
        .single()
      if (bEventErr || !bEvent) throw new Error(`Setup bounce cce failed: ${bEventErr?.message}`)

      const token = `token_bounce_${bounceNonce}`
      const { data: bounceReq, error: bReqErr } = await supabase
        .from('review_requests')
        .insert({
          organization_id: testOrgId,
          location_id: testLocationId,
          customer_id: testCustomerId,
          completion_event_id: bEvent.id,
          channel: 'email',
          status: 'SENT',
          token,
          token_hash: token,
        })
        .select('id')
        .single()
      if (bReqErr || !bounceReq) throw new Error(`Setup bounce req failed: ${bReqErr?.message}`)

      const bounceEmailId = `re_bounce_msg_${bounceNonce}`
      await supabase.from('message_events').insert({
        organization_id: testOrgId,
        review_request_id: bounceReq.id,
        provider: 'resend',
        provider_message_id: bounceEmailId,
        event_type: 'sent',
        status: 'SENT',
        metadata: { messageKind: 'initial_review_request' },
      })

      const payload = JSON.stringify({
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: {
          email_id: bounceEmailId,
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
        .eq('id', bounceReq.id)
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
      const transNonce = Date.now() + 1
      const transientEmail = `transient.${transNonce}@example.test`

      const { data: tEvent, error: tEventErr } = await supabase
        .from('customer_completion_events')
        .insert({
          organization_id: testOrgId,
          location_id: testLocationId,
          customer_id: testCustomerId,
          source: 'quick_complete',
          source_event_id: `src_bounce_trans_${transNonce}`,
          contact: { email: transientEmail },
          permission: { emailConsent: true },
        })
        .select('id')
        .single()
      if (tEventErr || !tEvent) throw new Error(`Setup trans cce failed: ${tEventErr?.message}`)

      const token = `token_trans_${transNonce}`
      const { data: transReq, error: tReqErr } = await supabase
        .from('review_requests')
        .insert({
          organization_id: testOrgId,
          location_id: testLocationId,
          customer_id: testCustomerId,
          completion_event_id: tEvent.id,
          channel: 'email',
          status: 'SENT',
          token,
          token_hash: token,
        })
        .select('id')
        .single()
      if (tReqErr || !transReq) throw new Error(`Setup trans req failed: ${tReqErr?.message}`)

      const transEmailId = `re_trans_msg_${transNonce}`
      await supabase.from('message_events').insert({
        organization_id: testOrgId,
        review_request_id: transReq.id,
        provider: 'resend',
        provider_message_id: transEmailId,
        event_type: 'sent',
        status: 'SENT',
        metadata: { messageKind: 'initial_review_request' },
      })

      const payload = JSON.stringify({
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: {
          email_id: transEmailId,
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
        .eq('id', transReq.id)
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

  describe('Complaint Handling (Section 14)', () => {
    it('spam complaint creates contact suppression with PROVIDER_COMPLAINT reason', async () => {
      const complaintEmail = `complaint.${Date.now()}@example.test`
      const payload = JSON.stringify({
        type: 'email.complained',
        created_at: new Date().toISOString(),
        data: {
          email_id: testEmailId,
          to: [complaintEmail],
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

      const expectedHash = hashSuppressionContact('email', complaintEmail)
      const { data: suppression } = await supabase
        .from('suppressions')
        .select('*')
        .eq('organization_id', testOrgId)
        .eq('contact_hash', expectedHash)
        .maybeSingle()
      expect(suppression).not.toBeNull()
      expect(suppression?.reason).toBe('PROVIDER_COMPLAINT')
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
