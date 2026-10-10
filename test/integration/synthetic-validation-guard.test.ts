import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { executeReviewRequestHandler } from '../../src/inngest/functions/review-request'
import { ResendEmailProvider } from '../../src/providers/email/resend'

describe('MR-1B-H Synthetic Validation Workflow Guard (Integration)', () => {
  const supabase = createAdminClient()
  const baseNonce = Date.now()
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test_synthetic_key_12345'
    process.env.EMAIL_FROM_ADDRESS = 'feedback@updates.example.com'
    process.env.ENABLE_LIVE_EMAIL = 'false'
    process.env.ENABLE_SYNTHETIC_EMAIL_VALIDATION = 'true'
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  async function createTestFixture(recipientEmail: string, suffix: string) {
    const nonce = `${baseNonce}_${suffix}_${Math.random().toString(36).slice(2, 7)}`
    const firstName = `TestUser_${nonce}`

    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({
        name: `Clinic Synth ${nonce}`,
        slug: `clinic-synth-${nonce}`,
        status: 'ACTIVE',
      })
      .select('id, name')
      .single()
    if (orgErr || !org) throw new Error(`Org failed: ${orgErr?.message}`)

    const { data: loc, error: locErr } = await supabase
      .from('locations')
      .insert({
        organization_id: org.id,
        name: `Location Synth ${nonce}`,
        status: 'ACTIVE',
        address: '123 Synthetic Way, Suite 100, Austin, TX 78701',
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
        first_name: firstName,
        last_name: 'Recipient',
        email: recipientEmail,
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

    await supabase.rpc('provision_organization_trial', {
      p_org_id: org.id,
      p_allocated_requests: 30,
      p_duration_days: 30,
    })
    await supabase
      .from('organization_entitlements')
      .update({
        status: 'ACTIVE',
        started_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      })
      .eq('organization_id', org.id)

    const { data: cce, error: cceErr } = await supabase
      .from('customer_completion_events')
      .insert({
        organization_id: org.id,
        location_id: loc.id,
        customer_id: cust.id,
        source: 'quick_complete',
        source_event_id: `evt_synth_${nonce}`,
        contact: { email: recipientEmail },
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
      sourceEventId: `evt_synth_${nonce}`,
      completedAt: new Date().toISOString(),
    }

    return {
      org,
      loc,
      cust,
      dest,
      cce,
      email: recipientEmail,
      firstName,
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

  it('fails closed on real customer recipient before network/API call under synthetic validation mode', async () => {
    const realRecipientEmail = 'real.patient@somewhere-real.example.com'
    const fixture = await createTestFixture(realRecipientEmail, 'real_blocked')

    try {
      const stepOutputs: Record<string, unknown> = {}
      const mockStep = {
        run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
          const res = await fn()
          stepOutputs[name] = res
          return res
        },
        sleep: async (): Promise<void> => {},
      }

      // The step execution throws the classified safe error for Inngest retry
      await expect(
        executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })
      ).rejects.toThrow('SYNTHETIC_RECIPIENT_REQUIRED')

      // Query the database to verify the review_request record state
      const { data: req } = await supabase
        .from('review_requests')
        .select('id, status, error_message, sent_at, failed_at')
        .eq('organization_id', fixture.org.id)
        .single()

      expect(req).toBeDefined()
      expect(req?.status).toBe('FAILED')
      expect(req?.error_message).toBe('SYNTHETIC_RECIPIENT_REQUIRED')
      expect(req?.sent_at).toBeNull()
      expect(req?.failed_at).not.toBeNull()

      // Verify no recipient PII was leaked in error_message
      expect(req?.error_message).not.toContain(realRecipientEmail)
    } finally {
      await fixture.cleanup()
    }
  })

  it('allows approved Resend test address delivered@resend.dev under synthetic validation mode', async () => {
    const syntheticEmail = 'delivered@resend.dev'
    const fixture = await createTestFixture(syntheticEmail, 'synth_allowed')

    // Mock client send to succeed without making real network calls
    const sendMock = vi.spyOn(ResendEmailProvider.prototype, 'send').mockImplementation(async function (this: ResendEmailProvider, input) {
      // Still execute the real guard validation
      if (this.recipientPolicy === 'resend_test_only' && input.to !== 'delivered@resend.dev') {
        throw new Error('SYNTHETIC_RECIPIENT_REQUIRED')
      }
      return {
        success: true,
        provider: 'resend',
        messageId: 're_synth_mock_id_999',
      }
    })

    try {
      const stepOutputs: Record<string, unknown> = {}
      const mockStep = {
        run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
          const res = await fn()
          stepOutputs[name] = res
          return res
        },
        sleep: async (): Promise<void> => {},
      }

      const res = await executeReviewRequestHandler({
        event: { data: fixture.eventData },
        step: mockStep,
      })

      expect(res.processed).toBe(true)

      // Check review_request in database
      const { data: req } = await supabase
        .from('review_requests')
        .select('id, status, error_message, sent_at')
        .eq('organization_id', fixture.org.id)
        .single()

      expect(req).toBeDefined()
      expect(req?.status).toBe('SENT')
      expect(req?.error_message).toBeNull()
      expect(req?.sent_at).not.toBeNull()

      expect(sendMock).toHaveBeenCalled()
    } finally {
      sendMock.mockRestore()
      await fixture.cleanup()
    }
  })
})
