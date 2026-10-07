import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  executeReviewRequestHandler,
  checkFinalEmailSenderIdentity,
  type ReviewRequestEventData,
} from '../../src/inngest/functions/review-request'
import * as emailProviderModule from '../../src/providers/email'
import type { Database } from '../../src/types/database'

describe('MR-7B.2 Integration: Sender Identity & Compliance Footer Invariant', () => {
  const supabase = createAdminClient()
  let isDbAvailable = false
  const originalEnv = process.env

  const baseNonce = Date.now()

  const mockStep = {
    run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    sleep: async (): Promise<void> => {},
  }

  async function createFixture(suffix: string, opts?: { locationAddress?: string | null }) {
    const nonce = `${baseNonce}_${suffix}_${Math.random().toString(36).slice(2, 7)}`
    const email = `patient.${nonce}@example.test`

    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({
        name: `Org MR7B2 ${nonce}`,
        slug: `org-mr7b2-${nonce}`,
        status: 'ACTIVE',
      })
      .select('id, name')
      .single()
    if (orgErr || !org) throw new Error(`Org setup failed: ${orgErr?.message}`)

    await supabase.rpc('provision_organization_trial', {
      p_org_id: org.id,
      p_max_requests: 30,
      p_duration_days: 30,
    })
    await supabase.rpc('activate_organization_trial', {
      p_org_id: org.id,
    })

    const { data: loc, error: locErr } = await supabase
      .from('locations')
      .insert({
        organization_id: org.id,
        name: `Location A ${nonce}`,
        address: opts?.locationAddress !== undefined ? opts.locationAddress : '100 Medical Plaza, Suite 200, Denver, CO 80202',
        status: 'ACTIVE',
        review_reply_to_email: 'feedback@clinic.test',
      })
      .select('id')
      .single()
    if (locErr || !loc) throw new Error(`Loc setup failed: ${locErr?.message}`)

    const { data: cust, error: custErr } = await supabase
      .from('customers')
      .insert({
        organization_id: org.id,
        location_id: loc.id,
        first_name: 'Alex',
        last_name: 'Fixture',
        email,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()
    if (custErr || !cust) throw new Error(`Cust setup failed: ${custErr?.message}`)

    const { data: dest, error: destErr } = await supabase
      .from('review_destinations')
      .insert({
        organization_id: org.id,
        location_id: loc.id,
        provider: 'google',
        url: 'https://g.page/r/test/review',
        canonical_url: 'https://search.google.com/local/writereview?placeid=test',
        status: 'CONFIRMED',
      })
      .select('id')
      .single()
    if (destErr || !dest) throw new Error(`Dest setup failed: ${destErr?.message}`)

    const { data: cce, error: cceErr } = await supabase
      .from('customer_completion_events')
      .insert({
        organization_id: org.id,
        location_id: loc.id,
        customer_id: cust.id,
        source: 'quick_complete',
        source_event_id: `evt_mr7b2_${nonce}`,
        country: 'US',
        contact: { email },
        permission: { email: 'allowed', sms: 'unknown' },
      })
      .select('id')
      .single()
    if (cceErr || !cce) throw new Error(`CCE setup failed: ${cceErr?.message}`)

    const eventData: ReviewRequestEventData = {
      eventId: cce.id,
      organizationId: org.id,
      locationId: loc.id,
      customerId: cust.id,
      sourceEventId: `evt_mr7b2_${nonce}`,
    }

    return {
      orgId: org.id,
      orgName: org.name,
      locId: loc.id,
      customerId: cust.id,
      destId: dest.id,
      cceId: cce.id,
      email,
      eventData,
      cleanup: async () => {
        await supabase.from('organizations').delete().eq('id', org.id)
      },
    }
  }

  beforeAll(async () => {
    try {
      const { error: pingErr } = await supabase.from('organizations').select('id').limit(1)
      isDbAvailable = !pingErr
    } catch {
      isDbAvailable = false
    }

    if (isDbAvailable) {
      process.env = {
        ...originalEnv,
        EMAIL_PROVIDER: 'console',
        ENABLE_LIVE_EMAIL: 'false',
        WORKFLOW_INITIAL_DELAY: '1s',
        WORKFLOW_REMINDER_DELAY: '1s',
      }
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  // =========================================================================
  // SUITE 1: checkFinalEmailSenderIdentity isolation & scoping
  // =========================================================================
  describe('1. checkFinalEmailSenderIdentity isolation & scoping', () => {
    it('returns ELIGIBLE with sanitized address when location address is valid', async () => {
      if (!isDbAvailable) return

      const fixture = await createFixture('id_valid')
      try {
        const result = await checkFinalEmailSenderIdentity({
          supabase,
          organizationId: fixture.orgId,
          locationId: fixture.locId,
        })

        expect(result.allowed).toBe(true)
        expect(result.decision).toBe('ELIGIBLE')
        expect(result.businessName).toBe(fixture.orgName)
        expect(result.businessPostalAddress).toBe('100 Medical Plaza, Suite 200, Denver, CO 80202')
        expect(result.reviewReplyToEmail).toBe('feedback@clinic.test')
      } finally {
        await fixture.cleanup()
      }
    })

    it('returns SENDER_IDENTITY_INCOMPLETE when location address is null or empty', async () => {
      if (!isDbAvailable) return

      const fixture = await createFixture('id_empty_addr', { locationAddress: null })
      try {
        const result = await checkFinalEmailSenderIdentity({
          supabase,
          organizationId: fixture.orgId,
          locationId: fixture.locId,
        })

        expect(result.allowed).toBe(false)
        expect(result.decision).toBe('SENDER_IDENTITY_INCOMPLETE')
        expect(result.businessPostalAddress).toBeNull()
      } finally {
        await fixture.cleanup()
      }
    })

    it('cross-tenant location query fails with LOCATION_NOT_FOUND', async () => {
      if (!isDbAvailable) return

      const fixtureA = await createFixture('cross_a')
      const fixtureB = await createFixture('cross_b')
      try {
        // Query Location B with Org A ID
        const result = await checkFinalEmailSenderIdentity({
          supabase,
          organizationId: fixtureA.orgId,
          locationId: fixtureB.locId,
        })

        expect(result.allowed).toBe(false)
        expect(result.decision).toBe('LOCATION_NOT_FOUND')
        expect(result.businessPostalAddress).toBeNull()
      } finally {
        await fixtureA.cleanup()
        await fixtureB.cleanup()
      }
    })

    it('multi-location: Location A address is never used for Location B', async () => {
      if (!isDbAvailable) return

      const fixture = await createFixture('multi_loc')
      try {
        // Create second location in same org with distinct address
        const { data: loc2 } = await supabase
          .from('locations')
          .insert({
            organization_id: fixture.orgId,
            name: 'Location B Secondary',
            address: '500 Branch Way, Boulder, CO 80301',
            status: 'ACTIVE',
          })
          .select('id')
          .single()

        const res1 = await checkFinalEmailSenderIdentity({
          supabase,
          organizationId: fixture.orgId,
          locationId: fixture.locId,
        })

        const res2 = await checkFinalEmailSenderIdentity({
          supabase,
          organizationId: fixture.orgId,
          locationId: loc2!.id,
        })

        expect(res1.businessPostalAddress).toBe('100 Medical Plaza, Suite 200, Denver, CO 80202')
        expect(res2.businessPostalAddress).toBe('500 Branch Way, Boulder, CO 80301')
        expect(res1.businessPostalAddress).not.toBe(res2.businessPostalAddress)
      } finally {
        await fixture.cleanup()
      }
    })
  })

  // =========================================================================
  // SUITE 2: Live send invariant (Resend fail-closed on missing address)
  // =========================================================================
  describe('2. Live send fail-closed invariant (Resend provider)', () => {
    it('real/Resend provider + missing address fails closed: request marked FAILED, provider NOT called, no provider_send_attempt recorded', async () => {
      if (!isDbAvailable) return

      const fixture = await createFixture('live_fail_closed', { locationAddress: null })
      const sendMock = vi.fn().mockResolvedValue({
        success: true,
        provider: 'resend',
        messageId: 'resend_msg_123',
      })

      const mockResendProvider = {
        name: 'resend' as const,
        send: sendMock,
      }

      const getEmailProviderSpy = vi
        .spyOn(emailProviderModule, 'getEmailProvider')
        .mockReturnValue(mockResendProvider as unknown as emailProviderModule.EmailProvider)

      try {
        const handlerResult = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        // Workflow aborted
        expect(handlerResult.processed).toBe(false)
        expect(sendMock).not.toHaveBeenCalled()

        // Review request is marked FAILED (retry-compatible, not CANCELLED)
        const { data: req } = await supabase
          .from('review_requests')
          .select('status, error_message, failed_at, sent_at')
          .eq('organization_id', fixture.orgId)
          .single()

        expect(req?.status).toBe('FAILED')
        expect(req?.failed_at).not.toBeNull()
        expect(req?.sent_at).toBeNull()
        expect(req?.error_message).toContain('Business postal address required before live email dispatch')

        // Audit event recorded: decision = SENDER_IDENTITY_INCOMPLETE, zero customer PII/address
        const { data: audits } = await supabase
          .from('audit_events')
          .select('*')
          .eq('organization_id', fixture.orgId)
          .eq('event_type', 'review_request.dispatch_blocked')

        expect(audits).toHaveLength(1)
        const meta = audits![0].metadata as Record<string, unknown>
        expect(meta.decision).toBe('SENDER_IDENTITY_INCOMPLETE')
        expect(meta.stage).toBe('initial')
        expect(meta).not.toHaveProperty('customerEmail')
        expect(meta).not.toHaveProperty('address')
        expect(meta).not.toHaveProperty('token')

        // Usage ledger: NO provider_send_attempt recorded
        const { data: usageEvents } = await supabase
          .from('usage_ledger')
          .select('event_type')
          .eq('organization_id', fixture.orgId)
          .eq('event_type', 'provider_send_attempt')

        expect(usageEvents).toHaveLength(0)
      } finally {
        getEmailProviderSpy.mockRestore()
        await fixture.cleanup()
      }
    })

    it('real/Resend provider + valid address dispatches successfully and includes postal address in composed email', async () => {
      if (!isDbAvailable) return

      const fixture = await createFixture('live_success')
      let capturedPayload: emailProviderModule.SendEmailInput | null = null

      const sendMock = vi.fn().mockImplementation(async (input: emailProviderModule.SendEmailInput) => {
        capturedPayload = input
        return {
          success: true,
          provider: 'resend',
          messageId: 'resend_msg_success_456',
        }
      })

      const mockResendProvider = {
        name: 'resend' as const,
        send: sendMock,
      }

      const getEmailProviderSpy = vi
        .spyOn(emailProviderModule, 'getEmailProvider')
        .mockReturnValue(mockResendProvider as unknown as emailProviderModule.EmailProvider)

      try {
        await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        // Both initial and reminder dispatches succeed when address is valid
        expect(sendMock).toHaveBeenCalledTimes(2)
        const initialPayload = sendMock.mock.calls[0][0] as emailProviderModule.SendEmailInput
        const reminderPayload = sendMock.mock.calls[1][0] as emailProviderModule.SendEmailInput

        expect(initialPayload.html).toContain('Business address: 100 Medical Plaza, Suite 200, Denver, CO 80202')
        expect(initialPayload.text).toContain('100 Medical Plaza, Suite 200, Denver, CO 80202')

        expect(reminderPayload.html).toContain('Business address: 100 Medical Plaza, Suite 200, Denver, CO 80202')
        expect(reminderPayload.text).toContain('100 Medical Plaza, Suite 200, Denver, CO 80202')

        const { data: req } = await supabase
          .from('review_requests')
          .select('status, sent_at, reminded_at')
          .eq('organization_id', fixture.orgId)
          .single()

        expect(req?.status).toBe('SENT')
        expect(req?.sent_at).not.toBeNull()
        expect(req?.reminded_at).not.toBeNull()
      } finally {
        getEmailProviderSpy.mockRestore()
        await fixture.cleanup()
      }
    })
  })

  // =========================================================================
  // SUITE 3: Retry after address configured
  // =========================================================================
  describe('3. Retry after address configured', () => {
    it('request FAILED due to missing address can be retried once address is configured, and uses updated address', async () => {
      if (!isDbAvailable) return

      const fixture = await createFixture('retry_flow', { locationAddress: null })
      const sendMock = vi.fn().mockResolvedValue({
        success: true,
        provider: 'resend',
        messageId: 'resend_retry_success_789',
      })

      const mockResendProvider = {
        name: 'resend' as const,
        send: sendMock,
      }

      const getEmailProviderSpy = vi
        .spyOn(emailProviderModule, 'getEmailProvider')
        .mockReturnValue(mockResendProvider as unknown as emailProviderModule.EmailProvider)

      try {
        // Attempt 1: Initial dispatch with missing address -> fails closed
        await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        const { data: reqBefore } = await supabase
          .from('review_requests')
          .select('id, status')
          .eq('organization_id', fixture.orgId)
          .single()

        expect(reqBefore?.status).toBe('FAILED')
        expect(sendMock).not.toHaveBeenCalled()

        // Owner configures address on location
        await supabase
          .from('locations')
          .update({ address: '999 Newly Configured Ave, Denver, CO 80202' })
          .eq('id', fixture.locId)

        // Attempt 2: Retry execution
        let retryPayload: emailProviderModule.SendEmailInput | null = null
        sendMock.mockImplementation(async (input: emailProviderModule.SendEmailInput) => {
          retryPayload = input
          return {
            success: true,
            provider: 'resend',
            messageId: 'resend_retry_success_789',
          }
        })

        await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(sendMock).toHaveBeenCalled()
        const retryCall = sendMock.mock.calls[0][0] as emailProviderModule.SendEmailInput
        expect(retryCall.html).toContain('Business address: 999 Newly Configured Ave, Denver, CO 80202')
        expect(retryCall.text).toContain('999 Newly Configured Ave, Denver, CO 80202')

        const { data: reqAfter } = await supabase
          .from('review_requests')
          .select('status, sent_at')
          .eq('organization_id', fixture.orgId)
          .single()

        expect(reqAfter?.status).toBe('SENT')
        expect(reqAfter?.sent_at).not.toBeNull()
      } finally {
        getEmailProviderSpy.mockRestore()
        await fixture.cleanup()
      }
    })
  })

  // =========================================================================
  // SUITE 4: Reminder fail-closed invariant
  // =========================================================================
  describe('4. Reminder fail-closed invariant', () => {
    it('address removed before reminder blocks reminder, preserves SENT status, and keeps reminded_at null', async () => {
      if (!isDbAvailable) return

      const fixture = await createFixture('reminder_fail_closed', {
        locationAddress: 'Initial Address, Denver, CO 80202',
      })

      let sendCallCount = 0
      const sendMock = vi.fn().mockImplementation(async () => {
        sendCallCount++
        return {
          success: true,
          provider: 'resend',
          messageId: `resend_msg_${sendCallCount}`,
        }
      })

      const mockResendProvider = {
        name: 'resend' as const,
        send: sendMock,
      }

      const getEmailProviderSpy = vi
        .spyOn(emailProviderModule, 'getEmailProvider')
        .mockReturnValue(mockResendProvider as unknown as emailProviderModule.EmailProvider)

      try {
        // Initial send succeeds
        await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: {
            run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
              if (name === 'dispatch-review-reminder') {
                // Remove address right before reminder step executes
                await supabase
                  .from('locations')
                  .update({ address: null })
                  .eq('id', fixture.locId)
              }
              return fn()
            },
            sleep: async (): Promise<void> => {},
          },
        })

        // Provider was called ONLY once (for initial send), NOT for reminder
        expect(sendCallCount).toBe(1)

        // Verify DB: request remains SENT, reminded_at is NULL
        const { data: req } = await supabase
          .from('review_requests')
          .select('status, sent_at, reminded_at')
          .eq('organization_id', fixture.orgId)
          .single()

        expect(req?.status).toBe('SENT')
        expect(req?.sent_at).not.toBeNull()
        expect(req?.reminded_at).toBeNull()

        // Audit event recorded: reminder_blocked with SENDER_IDENTITY_INCOMPLETE
        const { data: audits } = await supabase
          .from('audit_events')
          .select('*')
          .eq('organization_id', fixture.orgId)
          .eq('event_type', 'review_request.reminder_blocked')

        expect(audits).toHaveLength(1)
        const meta = audits![0].metadata as Record<string, unknown>
        expect(meta.decision).toBe('SENDER_IDENTITY_INCOMPLETE')
      } finally {
        getEmailProviderSpy.mockRestore()
        await fixture.cleanup()
      }
    })
  })

  // =========================================================================
  // SUITE 5: Console provider compatibility
  // =========================================================================
  describe('5. Console provider compatibility (synthetic path)', () => {
    it('console provider dispatches without error even if address is missing', async () => {
      if (!isDbAvailable) return

      const fixture = await createFixture('console_missing_addr', { locationAddress: null })
      try {
        const handlerResult = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(handlerResult.processed).toBe(true)

        const { data: req } = await supabase
          .from('review_requests')
          .select('status, sent_at')
          .eq('organization_id', fixture.orgId)
          .single()

        expect(req?.status).toBe('SENT')
        expect(req?.sent_at).not.toBeNull()
      } finally {
        await fixture.cleanup()
      }
    })
  })
})
