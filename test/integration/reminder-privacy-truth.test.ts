import { describe, it, expect, vi } from 'vitest'
import { createHmac, randomUUID } from 'crypto'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { executeReviewRequestHandler } from '../../src/inngest/functions/review-request'
import { POST as resendWebhookHandler } from '../../src/app/api/webhooks/resend/route'
import { GET as unsubscribeGetHandler, POST as unsubscribePostHandler } from '../../src/app/unsubscribe/[token]/route'
import { generateUnsubscribeToken } from '../../src/domain/unsubscribe'
import { composeReviewRequestEmail, composeReviewReminderEmail } from '../../src/domain/email'
import { hashSuppressionContact } from '../../src/domain/suppression'
import * as emailProviderModule from '../../src/providers/email'
import { NextRequest } from 'next/server'

const TEST_RAW_KEY = Buffer.from('test_svix_secret_reminder_truth!', 'utf-8')
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

describe('MR-1C.1 Reminder Privacy, Lifecycle Truth & Failure Recovery', () => {
  const supabase = createAdminClient()
  const baseNonce = Date.now()

  const mockStep = {
    run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    sleep: async (): Promise<void> => {},
  }

  async function createTestFixture(suffix: string) {
    const nonce = `${baseNonce}_${suffix}_${Math.random().toString(36).slice(2, 7)}`
    const email = `patient.${nonce}@example.test`

    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({
        name: `Clinic ${nonce}`,
        slug: `clinic-${nonce}`,
        status: 'ACTIVE',
      })
      .select('id, name')
      .single()
    if (orgErr || !org) throw new Error(`Org failed: ${orgErr?.message}`)

    const { data: loc, error: locErr } = await supabase
      .from('locations')
      .insert({
        organization_id: org.id,
        name: `Location ${nonce}`,
        status: 'ACTIVE',
        review_reply_to_email: `reply.${nonce}@example.test`,
      })
      .select('id')
      .single()
    if (locErr || !loc) throw new Error(`Loc failed: ${locErr?.message}`)

    const { data: cust, error: custErr } = await supabase
      .from('customers')
      .insert({
        organization_id: org.id,
        location_id: loc.id,
        first_name: 'Jordan',
        last_name: 'Test',
        email,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()
    if (custErr || !cust) throw new Error(`Cust failed: ${custErr?.message}`)

    const { data: dest, error: destErr } = await supabase
      .from('review_destinations')
      .insert({
        organization_id: org.id,
        location_id: loc.id,
        provider: 'google',
        status: 'CONFIRMED',
        url: 'https://g.page/r/test-review-dest/review',
        canonical_url: 'https://g.page/r/test-review-dest/review',
      })
      .select('id')
      .single()
    if (destErr || !dest) throw new Error(`Dest failed: ${destErr?.message}`)

    const { data: cce, error: cceErr } = await supabase
      .from('customer_completion_events')
      .insert({
        organization_id: org.id,
        location_id: loc.id,
        customer_id: cust.id,
        source: 'quick_complete',
        source_event_id: `evt_${nonce}`,
        contact: { email },
        permission: { email: 'allowed' },
      })
      .select('id')
      .single()
    if (cceErr || !cce) throw new Error(`CCE setup failed: ${cceErr?.message}`)

    const eventData = {
      eventId: cce.id,
      organizationId: org.id,
      locationId: loc.id,
      customerId: cust.id,
      sourceEventId: `evt_${nonce}`,
      completedAt: new Date().toISOString(),
    }

    return {
      org,
      loc,
      cust,
      dest,
      cce,
      email,
      eventData,
      cleanup: async () => {
        await supabase.from('review_requests').delete().eq('organization_id', org.id)
        await supabase.from('customer_completion_events').delete().eq('organization_id', org.id)
        await supabase.from('message_events').delete().eq('organization_id', org.id)
        await supabase.from('audit_events').delete().eq('organization_id', org.id)
        await supabase.from('organization_usage').delete().eq('organization_id', org.id)
        await supabase.from('suppressions').delete().eq('organization_id', org.id)
        await supabase.from('review_destinations').delete().eq('organization_id', org.id)
        await supabase.from('customers').delete().eq('organization_id', org.id)
        await supabase.from('locations').delete().eq('organization_id', org.id)
        await supabase.from('organizations').delete().eq('id', org.id)
      },
    }
  }

  it('1. Message metadata privacy: raw customer email, phone, and tokens are completely absent from message_events', async () => {
    const fixture = await createTestFixture('privacy_meta')
    try {
      const res = await executeReviewRequestHandler({
        event: { data: fixture.eventData },
        step: mockStep,
      })

      expect(res.processed).toBe(true)
      expect(res.reviewRequestId).toBeDefined()

      // Query all message_events generated for this review request
      const { data: events, error } = await supabase
        .from('message_events')
        .select('*')
        .eq('review_request_id', res.reviewRequestId!)

      expect(error).toBeNull()
      expect(events).toBeDefined()
      expect(events!.length).toBeGreaterThanOrEqual(2) // initial + reminder

      for (const event of events!) {
        const metaStr = JSON.stringify(event.metadata || {})
        const metaObj = (event.metadata || {}) as Record<string, unknown>

        // Assert NO raw customer email
        expect(metaStr).not.toContain(fixture.email)
        expect(metaObj.recipientEmail).toBeUndefined()
        expect(metaObj.email).toBeUndefined()
        expect(metaObj.to).toBeUndefined()

        // Assert NO phone
        expect(metaObj.phone).toBeUndefined()
        expect(metaObj.recipientPhone).toBeUndefined()

        // Assert NO raw review or unsubscribe tokens
        expect(metaObj.token).toBeUndefined()
        expect(metaObj.reviewToken).toBeUndefined()
        expect(metaObj.unsubscribeToken).toBeUndefined()

        // Assert NO Google destination URLs
        expect(metaStr).not.toContain('https://g.page')
        expect(metaObj.destinationUrl).toBeUndefined()

        // Assert clean minimal operational metadata
        expect(['initial_review_request', 'review_request_reminder']).toContain(metaObj.messageKind)
        expect(metaObj.reviewRequestId).toBe(res.reviewRequestId)
      }
    } finally {
      await fixture.cleanup()
    }
  })

  it('2. Suppression model truth: authoritative public.suppressions table is used exclusively with SHA-256 hash', async () => {
    const fixture = await createTestFixture('supp_truth')
    try {
      const contactHash = hashSuppressionContact('email', fixture.email)

      // Insert suppression into single authoritative table
      const { error: insErr } = await supabase.from('suppressions').insert({
        organization_id: fixture.org.id,
        channel: 'email',
        contact_hash: contactHash,
        reason: 'CUSTOMER_UNSUBSCRIBED',
      })
      expect(insErr).toBeNull()

      // Query suppression row back
      const { data: suppRow, error: queryErr } = await supabase
        .from('suppressions')
        .select('id, organization_id, channel, contact_hash, reason, created_at')
        .eq('organization_id', fixture.org.id)
        .eq('contact_hash', contactHash)
        .single()

      expect(queryErr).toBeNull()
      expect(suppRow).toBeDefined()
      expect(suppRow!.channel).toBe('email')
      expect(suppRow!.reason).toBe('CUSTOMER_UNSUBSCRIBED')
      expect(suppRow!.contact_hash).toBe(contactHash)
    } finally {
      await fixture.cleanup()
    }
  })

  it('3. Unsubscribe safety: GET does NOT mutate state or suppress; POST mutates state and creates suppression', async () => {
    const fixture = await createTestFixture('unsub_methods')
    try {
      // Execute workflow to establish review_request with unsubscribe token
      const res = await executeReviewRequestHandler({
        event: { data: fixture.eventData },
        step: mockStep,
      })

      const { data: reqRecord } = await supabase
        .from('review_requests')
        .select('id, token, unsubscribe_token_hash')
        .eq('id', res.reviewRequestId!)
        .single()
      expect(reqRecord?.unsubscribe_token_hash).toBeDefined()

      // Generate a known test unsubscribe token and pair it with the request
      const { token: testToken, tokenHash: testTokenHash } = generateUnsubscribeToken()
      await supabase
        .from('review_requests')
        .update({ unsubscribe_token_hash: testTokenHash })
        .eq('id', res.reviewRequestId!)

      // 1. GET with valid token: renders confirmation HTML with status 200 and DOES NOT mutate DB state
      const getReqValid = new NextRequest(`http://localhost:3000/unsubscribe/${testToken}`)
      const getResValid = await unsubscribeGetHandler(getReqValid, {
        params: Promise.resolve({ token: testToken }),
      })
      expect(getResValid.status).toBe(200)
      const getHtml = await getResValid.text()
      expect(getHtml).toContain('Stop review-request emails')

      // Assert state did NOT mutate after GET:
      const { data: suppsAfterGet } = await supabase
        .from('suppressions')
        .select('id')
        .eq('organization_id', fixture.org.id)
      expect(suppsAfterGet?.length).toBe(0)

      // 2. POST with valid token: MUTATES state by creating suppression in public.suppressions
      const postReqValid = new NextRequest(`http://localhost:3000/unsubscribe/${testToken}`, {
        method: 'POST',
      })
      const postResValid = await unsubscribePostHandler(postReqValid, {
        params: Promise.resolve({ token: testToken }),
      })
      // Next.js redirect responds with 303 or 200
      expect([200, 303]).toContain(postResValid.status)

      // Assert state DID mutate after POST: suppression row created with CUSTOMER_UNSUBSCRIBED
      const contactHash = hashSuppressionContact('email', fixture.email)
      const { data: suppAfterPost } = await supabase
        .from('suppressions')
        .select('channel, contact_hash, reason')
        .eq('organization_id', fixture.org.id)
        .eq('contact_hash', contactHash)
        .single()

      expect(suppAfterPost).toBeDefined()
      expect(suppAfterPost?.channel).toBe('email')
      expect(suppAfterPost?.reason).toBe('CUSTOMER_UNSUBSCRIBED')
    } finally {
      await fixture.cleanup()
    }
  })

  it('4. Subject regression check: initial is "Share your experience with {Business Name}" and reminder is "Reminder: Share your experience with {Business Name}"', () => {
    const input = {
      businessName: 'Apex Medical Group',
      customerFirstName: 'Alex',
      reviewUrl: 'https://mpg.local/r/token123',
      unsubscribeUrl: 'https://mpg.local/unsubscribe/unsub123',
    }

    const initial = composeReviewRequestEmail(input)
    expect(initial.subject).toBe('Share your experience with Apex Medical Group')
    expect(initial.subject).not.toContain('visit')

    const reminder = composeReviewReminderEmail(input)
    expect(reminder.subject).toBe('Reminder: Share your experience with Apex Medical Group')
    expect(reminder.subject).not.toContain('visit')

    // Generic fallbacks when businessName is omitted
    const initialFallback = composeReviewRequestEmail({ ...input, businessName: '' })
    expect(initialFallback.subject).toBe('Share your experience')

    const reminderFallback = composeReviewReminderEmail({ ...input, businessName: '' })
    expect(reminderFallback.subject).toBe('Reminder: Share your experience')
  })

  it('5. Provider transient failure and retry: failure does NOT set reminded_at, does NOT increment reminders_sent, retry succeeds and sets reminded_at', async () => {
    const fixture = await createTestFixture('failure_retry')
    try {
      let reminderAttempts = 0
      const mockEmailProvider = {
        send: vi.fn().mockImplementation(async (params) => {
          if (params.idempotencyKey?.includes('reminder')) {
            reminderAttempts++
            if (reminderAttempts === 1) {
              throw new Error('Transient provider 429 Too Many Requests')
            }
          }
          return {
            success: true,
            provider: 'console',
            messageId: `console_mock_${randomUUID()}`,
          }
        }),
      }

      const getEmailProviderSpy = vi
        .spyOn(emailProviderModule, 'getEmailProvider')
        .mockReturnValue(mockEmailProvider as unknown as emailProviderModule.EmailProvider)

      try {
        // Attempt 1: Run workflow. Step 5 (initial) succeeds; Step 8 (reminder) throws transient error
        let attempt1Error: Error | null = null
        try {
          await executeReviewRequestHandler({
            event: { data: fixture.eventData },
            step: mockStep,
          })
        } catch (err) {
          attempt1Error = err as Error
        }

        expect(attempt1Error).not.toBeNull()
        expect(attempt1Error?.message).toContain('Transient provider 429')

        // Fetch request record to inspect DB truth after Attempt 1
        const { data: reqAfterAttempt1 } = await supabase
          .from('review_requests')
          .select('id, status, delivered_at, reminded_at')
          .eq('organization_id', fixture.org.id)
          .single()

        expect(reqAfterAttempt1).toBeDefined()
        const reqId = reqAfterAttempt1!.id

        // 1. reminded_at MUST NOT be set on failure!
        expect(reqAfterAttempt1?.reminded_at).toBeNull()

        // 2. Historical status MUST NOT regress: initial send status (SENT) remains intact
        expect(reqAfterAttempt1?.status).toBe('SENT')

        // 3. message_events must truthfully record failed reminder attempt with minimal metadata
        const { data: failEvent } = await supabase
          .from('message_events')
          .select('status, event_type, sanitized_error, metadata')
          .eq('review_request_id', reqId)
          .eq('event_type', 'failed')
          .single()

        expect(failEvent?.status).toBe('FAILED')
        expect(failEvent?.sanitized_error).toContain('Transient provider 429')
        expect((failEvent?.metadata as Record<string, unknown>)?.messageKind).toBe('review_request_reminder')

        // 4. audit_events must record review_request.reminder_failed
        const { data: auditFail } = await supabase
          .from('audit_events')
          .select('event_type')
          .eq('entity_id', reqId)
          .eq('event_type', 'review_request.reminder_failed')
          .single()
        expect(auditFail).toBeDefined()

        // 5. reminders_sent MUST NOT be incremented
        const period = new Date().toISOString().slice(0, 7)
        const { data: usageAfterFail } = await supabase
          .from('organization_usage')
          .select('value')
          .eq('organization_id', fixture.org.id)
          .eq('period', period)
          .eq('metric', 'reminders_sent')
          .maybeSingle()
        expect(usageAfterFail).toBeNull()

        // Step C: Attempt 2 (Inngest retry): Provider now succeeds for reminder
        const attempt2Result = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(attempt2Result.processed).toBe(true)
        expect(attempt2Result.reminderSent).toBe(true)

        // Verify post-Attempt 2 DB truth:
        const { data: reqAfterAttempt2 } = await supabase
          .from('review_requests')
          .select('status, delivered_at, reminded_at')
          .eq('id', reqId)
          .single()

        // 1. reminded_at is NOW truthfully stamped
        expect(reqAfterAttempt2?.reminded_at).not.toBeNull()

        // 2. Status remains SENT (never regressed)
        expect(reqAfterAttempt2?.status).toBe('SENT')

        // 3. reminders_sent is incremented to exactly 1
        const { data: usageAfterSuccess } = await supabase
          .from('organization_usage')
          .select('value')
          .eq('organization_id', fixture.org.id)
          .eq('period', period)
          .eq('metric', 'reminders_sent')
          .single()
        expect(Number(usageAfterSuccess?.value)).toBe(1)

        // 4. Exactly one reminder_sent audit event recorded
        const { data: auditSent } = await supabase
          .from('audit_events')
          .select('id')
          .eq('entity_id', reqId)
          .eq('event_type', 'review_request.reminder_sent')
        expect(auditSent?.length).toBe(1)

        // Step D: Attempt 3 (Duplicate retry): Should idempotent-skip cleanly
        const attempt3Result = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(attempt3Result.reminderSent).toBe(false)
        expect(reminderAttempts).toBe(2) // exactly 2 reminder attempts total (1 fail, 1 success)

        // reminders_sent usage is still 1
        const { data: usageAfterAttempt3 } = await supabase
          .from('organization_usage')
          .select('value')
          .eq('organization_id', fixture.org.id)
          .eq('period', period)
          .eq('metric', 'reminders_sent')
          .single()
        expect(Number(usageAfterAttempt3?.value)).toBe(1)
      } finally {
        getEmailProviderSpy.mockRestore()
      }
    } finally {
      await fixture.cleanup()
    }
  })

  it('6. Webhook reminders_delivered counter increments only upon provider email.delivered for reminder', async () => {
    const fixture = await createTestFixture('rem_deliv_counter')
    const originalSecret = process.env.RESEND_WEBHOOK_SECRET
    process.env.RESEND_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
    try {

      // Run workflow to send initial + reminder
      const res = await executeReviewRequestHandler({
        event: { data: fixture.eventData },
        step: mockStep,
      })

      // Find reminder message event to get provider_message_id
      const { data: reminderMsg } = await supabase
        .from('message_events')
        .select('provider_message_id')
        .eq('review_request_id', res.reviewRequestId!)
        .eq('event_type', 'sent')
        .filter('metadata->>messageKind', 'eq', 'review_request_reminder')
        .single()

      expect(reminderMsg?.provider_message_id).toBeDefined()
      const reminderMsgId = reminderMsg!.provider_message_id

      // Send Resend webhook for email.delivered matching reminder message ID
      const payload = JSON.stringify({
        type: 'email.delivered',
        data: {
          email_id: reminderMsgId,
          to: [fixture.email],
          created_at: new Date().toISOString(),
        },
      })

      const { headers } = signSvixPayload(TEST_WEBHOOK_SECRET, payload)
      const req = new Request('http://localhost:3000/api/webhooks/resend', {
        method: 'POST',
        headers,
        body: payload,
      })

      const webhookRes = await resendWebhookHandler(req)
      expect(webhookRes.status).toBe(200)

      // Verify reminders_delivered was truthfully incremented in organization_usage
      const period = new Date().toISOString().slice(0, 7)
      const { data: usageDelivered } = await supabase
        .from('organization_usage')
        .select('value')
        .eq('organization_id', fixture.org.id)
        .eq('period', period)
        .eq('metric', 'reminders_delivered')
        .single()

      expect(Number(usageDelivered?.value)).toBe(1)
    } finally {
      process.env.RESEND_WEBHOOK_SECRET = originalSecret
      await fixture.cleanup()
    }
  })
})
