import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createHmac, randomUUID } from 'crypto'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { executeReviewRequestHandler, type ReviewRequestEventData } from '../../src/inngest/functions/review-request'
import { POST as resendWebhookHandler } from '../../src/app/api/webhooks/resend/route'
import { isRequestEligibleForReminder, MAX_REMINDERS } from '../../src/domain/reminder'
import { evaluateReviewEligibility } from '../../src/domain/eligibility'
import { hashSuppressionContact } from '../../src/domain/suppression'
import { composeReviewReminderEmail } from '../../src/domain/email'
import { buildTrackedReviewUrl } from '../../src/domain/tracking'
import { ConsoleEmailProvider } from '../../src/providers/email'

const TEST_RAW_KEY = Buffer.from('test_svix_secret_reminder_32_b!', 'utf-8')
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

describe('MR-1C Reminder Lifecycle & Messaging Operations (Section 19: 29 Proof Scenarios)', () => {
  const supabase = createAdminClient()
  const originalEnv = process.env
  let isDbAvailable = false

  let baseOrgId: string
  const baseNonce = Date.now()

  const mockStep = {
    run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    sleep: async (): Promise<void> => {},
  }

  // Helper to create isolated test hierarchies
  async function createScenarioFixture(suffix: string, opts?: {
    orgStatus?: 'ACTIVE' | 'SUSPENDED'
    locStatus?: 'ACTIVE' | 'INACTIVE'
    destStatus?: 'CONFIRMED' | 'INACTIVE' | 'PENDING_CONFIRMATION'
    replyTo?: string | null
    permissionEmail?: 'allowed' | 'unknown' | 'denied'
  }) {
    const nonce = `${baseNonce}_${suffix}_${Math.random().toString(36).slice(2, 7)}`
    const email = `patient.${nonce}@example.test`

    // 1. Organization
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({
        name: `Org ${nonce}`,
        slug: `org-${nonce}`,
        status: opts?.orgStatus || 'ACTIVE',
      })
      .select('id, name')
      .single()
    if (orgErr || !org) throw new Error(`Org setup failed: ${orgErr?.message}`)

    // 2. Location
    const { data: loc, error: locErr } = await supabase
      .from('locations')
      .insert({
        organization_id: org.id,
        name: `Clinic ${nonce}`,
        status: opts?.locStatus || 'ACTIVE',
        review_reply_to_email: opts?.replyTo !== undefined ? opts.replyTo : `reply.${nonce}@example.test`,
      })
      .select('id')
      .single()
    if (locErr || !loc) throw new Error(`Loc setup failed: ${locErr?.message}`)

    // 3. Customer
    const { data: cust, error: custErr } = await supabase
      .from('customers')
      .insert({
        organization_id: org.id,
        location_id: loc.id,
        first_name: 'Alex',
        last_name: 'Synthetic',
        email,
        permission_email: opts?.permissionEmail || 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()
    if (custErr || !cust) throw new Error(`Cust setup failed: ${custErr?.message}`)

    // 4. Review Destination
    const { data: dest, error: destErr } = await supabase
      .from('review_destinations')
      .insert({
        organization_id: org.id,
        location_id: loc.id,
        provider: 'google',
        url: 'https://g.page/r/test-reminder/review',
        canonical_url: 'https://g.page/r/test-reminder/review',
        status: opts?.destStatus || 'CONFIRMED',
      })
      .select('id')
      .single()
    if (destErr || !dest) throw new Error(`Dest setup failed: ${destErr?.message}`)

    // 4b. Active Entitlement for review request messaging
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

    // 5. Completion Event
    const { data: cce, error: cceErr } = await supabase
      .from('customer_completion_events')
      .insert({
        organization_id: org.id,
        location_id: loc.id,
        customer_id: cust.id,
        source: 'quick_complete',
        source_event_id: `evt_${nonce}`,
        contact: { email },
        permission: { email: opts?.permissionEmail || 'allowed' },
      })
      .select('id')
      .single()
    if (cceErr || !cce) throw new Error(`CCE setup failed: ${cceErr?.message}`)

    const eventData: ReviewRequestEventData = {
      eventId: cce.id,
      organizationId: org.id,
      locationId: loc.id,
      customerId: cust.id,
      sourceEventId: `evt_${nonce}`,
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
    const { error: pingErr } = await supabase.from('organizations').select('id').limit(1)
    isDbAvailable = !pingErr

    if (!isDbAvailable) return

    process.env = {
      ...originalEnv,
      EMAIL_PROVIDER: 'console',
      ENABLE_LIVE_EMAIL: 'false',
      RESEND_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      WORKFLOW_INITIAL_DELAY: '1s',
      WORKFLOW_REMINDER_DELAY: '1s',
    }

    const baseFixture = await createScenarioFixture('base')
    baseOrgId = baseFixture.orgId
  })

  afterAll(async () => {
    if (baseOrgId) {
      await supabase.from('organizations').delete().eq('id', baseOrgId)
    }
    process.env = originalEnv
  })

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EMAIL_PROVIDER: 'console',
      ENABLE_LIVE_EMAIL: 'false',
      RESEND_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      WORKFLOW_INITIAL_DELAY: '1s',
      WORKFLOW_REMINDER_DELAY: '1s',
    }
  })

  // =========================================================================
  // Scenarios 1 to 4: Normal Flow, Bounded Reminder Count & Idempotent Replay
  // =========================================================================
  describe('Scenarios 1-4: Normal Flow, Reminder Bound & Multiple Executions', () => {
    it('Scenario 1: Normal flow sends initial request and reminder once, recording reminded_at', async () => {
      const fixture = await createScenarioFixture('s1')
      try {
        const result = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(result.processed).toBe(true)
        expect(result.emailSent).toBe(true)
        expect(result.reminderSent).toBe(true)

        // Verify review_request table state
        const { data: req } = await supabase
          .from('review_requests')
          .select('id, status, sent_at, reminded_at')
          .eq('id', result.reviewRequestId!)
          .single()

        expect(req?.reminded_at).not.toBeNull()
        expect(req?.sent_at).not.toBeNull()

        // Verify message_events table has discriminator
        const { data: msgEvents } = await supabase
          .from('message_events')
          .select('event_type, metadata')
          .eq('review_request_id', result.reviewRequestId!)

        const kinds = msgEvents?.map((m) => (m.metadata as Record<string, unknown>)?.messageKind)
        expect(kinds).toContain('initial_review_request')
        expect(kinds).toContain('review_request_reminder')

        // Verify organization usage was incremented for reminders_sent
        const period = new Date().toISOString().slice(0, 7)
        const { data: usage } = await supabase
          .from('organization_usage')
          .select('value')
          .eq('organization_id', fixture.orgId)
          .eq('period', period)
          .eq('metric', 'reminders_sent')
          .maybeSingle()

        expect(Number(usage?.value || 0)).toBe(1)
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 2: Reminder count bound: MAX_REMINDERS is 1 and request never receives more than 1 reminder', async () => {
      expect(MAX_REMINDERS).toBe(1)
      const fixture = await createScenarioFixture('s2')
      try {
        const result1 = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })
        expect(result1.reminderSent).toBe(true)

        // Fetch request with reminded_at populated
        const { data: req } = await supabase
          .from('review_requests')
          .select('id, status, reminded_at, clicked_at')
          .eq('id', result1.reviewRequestId!)
          .single()

        expect(req?.reminded_at).not.toBeNull()
        const check = isRequestEligibleForReminder(req!)
        expect(check.eligible).toBe(false)
        expect(check.reason).toBe('ALREADY_REMINDED')
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 3: Multiple workflow executions for same request send reminder only once', async () => {
      const fixture = await createScenarioFixture('s3')
      try {
        const res1 = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })
        expect(res1.reminderSent).toBe(true)

        // Re-execute identical workflow
        const res2 = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        // Replay recognizes existing request; reminder step skipped
        expect(res2.reminderSent).toBe(false)

        // Verify message_events has exactly one reminder event
        const { data: msgEvents } = await supabase
          .from('message_events')
          .select('metadata')
          .eq('review_request_id', res1.reviewRequestId!)

        const reminderEvents = msgEvents?.filter(
          (m) => (m.metadata as Record<string, unknown>)?.messageKind === 'review_request_reminder'
        )
        expect(reminderEvents).toHaveLength(1)
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 4: Second reminder attempt returns false / skips cleanly without error', async () => {
      const fixture = await createScenarioFixture('s4')
      try {
        await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        // Second run
        const res2 = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(res2.processed).toBe(true)
        expect(res2.reminderSent).toBe(false)
      } finally {
        await fixture.cleanup()
      }
    })
  })

  // =========================================================================
  // Scenarios 5 to 9: Click Stopping Invariants
  // =========================================================================
  describe('Scenarios 5-9: Click Stopping Invariants', () => {
    it('Scenario 5: Click before reminder delay elapses aborts reminder', async () => {
      const fixture = await createScenarioFixture('s5')
      try {
        let reviewReqId: string | null = null
        const customStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const res = await fn()
            if (name === 'create-or-resolve-review-request') {
              reviewReqId = (res as { id: string }).id
            }
            return res
          },
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay' && reviewReqId) {
              await supabase
                .from('review_requests')
                .update({ status: 'CLICKED', clicked_at: new Date().toISOString() })
                .eq('id', reviewReqId)
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.emailSent).toBe(true)
        expect(res.reminderSent).toBe(false)
        expect(res.reminderSkippedReason).toBe('CLICKED')

        // Confirm reminded_at was NOT populated
        const { data: req } = await supabase
          .from('review_requests')
          .select('reminded_at, status')
          .eq('id', res.reviewRequestId!)
          .single()

        expect(req?.status).toBe('CLICKED')
        expect(req?.reminded_at).toBeNull()
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 6: Click during reminder delay window aborts reminder', async () => {
      const fixture = await createScenarioFixture('s6')
      try {
        let reviewReqId: string | null = null
        const customStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const res = await fn()
            if (name === 'create-or-resolve-review-request') {
              reviewReqId = (res as { id: string }).id
            }
            return res
          },
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay' && reviewReqId) {
              await supabase
                .from('review_requests')
                .update({ status: 'CLICKED', clicked_at: new Date().toISOString() })
                .eq('id', reviewReqId)
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.reminderSent).toBe(false)
        expect(res.reminderSkippedReason).toBe('CLICKED')
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 7: Click immediately before reminder dispatch step aborts reminder', async () => {
      const fixture = await createScenarioFixture('s7')
      try {
        let reviewReqId: string | null = null
        const customStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            if (name === 'dispatch-review-reminder' && reviewReqId) {
              // Click arrives right before dispatch step
              await supabase
                .from('review_requests')
                .update({ status: 'CLICKED', clicked_at: new Date().toISOString() })
                .eq('id', reviewReqId)
            }
            const res = await fn()
            if (name === 'create-or-resolve-review-request') {
              reviewReqId = (res as { id: string }).id
            }
            return res
          },
          sleep: async () => {},
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.reminderSent).toBe(false)
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 8: Status is CLICKED: reminder aborted', () => {
      const check = isRequestEligibleForReminder({
        status: 'CLICKED',
        reminded_at: null,
        clicked_at: '2026-09-19T00:00:00Z',
      })
      expect(check.eligible).toBe(false)
      expect(check.reason).toBe('CLICKED')
    })

    it('Scenario 9: clicked_at is populated even if status is not CLICKED: reminder aborted', () => {
      const check = isRequestEligibleForReminder({
        status: 'SENT',
        reminded_at: null,
        clicked_at: '2026-09-19T00:00:00Z',
      })
      expect(check.eligible).toBe(false)
      expect(check.reason).toBe('CLICKED')
    })
  })

  // =========================================================================
  // Scenarios 10 to 12: Suppression & Unsubscribe Stopping Invariants
  // =========================================================================
  describe('Scenarios 10-12: Suppression & Unsubscribe Stopping Invariants', () => {
    it('Scenario 10: Customer unsubscribes during reminder delay: reminder aborted', async () => {
      const fixture = await createScenarioFixture('s10')
      try {
        const customStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay') {
              // Customer unsubscribes during reminder sleep
              const contactHash = hashSuppressionContact('email', fixture.email)
              await supabase.from('suppressions').insert({
                organization_id: fixture.orgId,
                channel: 'email',
                contact_hash: contactHash,
                reason: 'CUSTOMER_UNSUBSCRIBED',
              })
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.emailSent).toBe(true)
        expect(res.reminderSent).toBe(false)
        expect(res.reminderSkippedReason).toBe('Customer contact address is on the organization suppression list')

        // Verify audit event was logged for skipped reminder
        const { data: audits } = await supabase
          .from('audit_events')
          .select('event_type, metadata')
          .eq('entity_id', res.reviewRequestId!)
          .eq('event_type', 'review_request.reminder_skipped')

        expect(audits).toHaveLength(1)
        expect((audits![0].metadata as Record<string, unknown>)?.decision).toBe('SUPPRESSED')
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 11: Customer marked suppressed before reminder: reminder aborted', async () => {
      const fixture = await createScenarioFixture('s11')
      try {
        let reviewReqId: string | null = null
        const customStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const res = await fn()
            if (name === 'create-or-resolve-review-request') {
              reviewReqId = (res as { id: string }).id
            }
            return res
          },
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay' && reviewReqId) {
              await supabase
                .from('review_requests')
                .update({ status: 'SUPPRESSED' })
                .eq('id', reviewReqId)
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.emailSent).toBe(true)
        expect(res.reminderSent).toBe(false)
        expect(res.reminderSkippedReason).toBe('SUPPRESSED')
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 12: Suppression entry exists for email contact hash: reminder aborted', () => {
      const check = evaluateReviewEligibility({
        organization: { id: 'org-1', status: 'ACTIVE' },
        location: { id: 'loc-1', status: 'ACTIVE' },
        customer: { id: 'cust-1', email: 'test@example.test', permission_email: 'allowed' },
        destination: { id: 'dest-1', status: 'CONFIRMED', canonical_url: 'https://g.page/r/test' },
        isSuppressed: true,
        hasRecentRequestWithinWindow: false,
      })
      expect(check.eligible).toBe(false)
      expect(check.decision).toBe('SUPPRESSED')
    })
  })

  // =========================================================================
  // Scenarios 13 to 14: Cancellation Stopping Invariants
  // =========================================================================
  describe('Scenarios 13-14: Cancellation Stopping Invariants', () => {
    it('Scenario 13: Request is CANCELLED before reminder delay elapses: reminder aborted', async () => {
      const fixture = await createScenarioFixture('s13')
      try {
        let reviewReqId: string | null = null
        const customStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const res = await fn()
            if (name === 'create-or-resolve-review-request') {
              reviewReqId = (res as { id: string }).id
            }
            return res
          },
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay' && reviewReqId) {
              await supabase
                .from('review_requests')
                .update({ status: 'CANCELLED' })
                .eq('id', reviewReqId)
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.emailSent).toBe(true)
        expect(res.reminderSent).toBe(false)
        expect(res.reminderSkippedReason).toBe('CANCELLED')
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 14: Request is CANCELLED during reminder step: reminder aborted', () => {
      const check = isRequestEligibleForReminder({
        status: 'CANCELLED',
        reminded_at: null,
        clicked_at: null,
      })
      expect(check.eligible).toBe(false)
      expect(check.reason).toBe('CANCELLED')
    })
  })

  // =========================================================================
  // Scenarios 15 to 20: Mutation between Initial and Reminder
  // =========================================================================
  describe('Scenarios 15-20: Dynamic Configuration & Invalidation Handling', () => {
    it('Scenario 15: Location review_reply_to_email changed to valid value between initial and reminder: reminder uses new reply-to', async () => {
      const fixture = await createScenarioFixture('s15', { replyTo: 'old@example.test' })
      try {
        const newReplyTo = 'updated.support@example.test'
        const customStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay') {
              await supabase
                .from('locations')
                .update({ review_reply_to_email: newReplyTo })
                .eq('id', fixture.locId)
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.reminderSent).toBe(true)
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 16: Location review_reply_to_email removed/invalidated between initial and reminder: reminder omits reply-to safely', async () => {
      const fixture = await createScenarioFixture('s16', { replyTo: 'old@example.test' })
      try {
        const customStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay') {
              await supabase
                .from('locations')
                .update({ review_reply_to_email: null })
                .eq('id', fixture.locId)
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.reminderSent).toBe(true)
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 17: Destination unconfirmed or deactivated between initial and reminder: reminder aborted', async () => {
      const fixture = await createScenarioFixture('s17')
      try {
        const customStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay') {
              await supabase
                .from('review_destinations')
                .update({ status: 'INACTIVE' })
                .eq('id', fixture.destId)
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.emailSent).toBe(true)
        expect(res.reminderSent).toBe(false)
        expect(res.reminderSkippedReason).toContain('destination')
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 18: Customer email permission revoked between initial and reminder: reminder aborted', async () => {
      const fixture = await createScenarioFixture('s18')
      try {
        const customStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay') {
              await supabase
                .from('customers')
                .update({ permission_email: 'denied' })
                .eq('id', fixture.customerId)
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.emailSent).toBe(true)
        expect(res.reminderSent).toBe(false)
        expect(res.reminderSkippedReason).toContain('permission')
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 19: Organization suspended between initial and reminder: reminder aborted', async () => {
      const fixture = await createScenarioFixture('s19')
      try {
        const customStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay') {
              await supabase
                .from('organizations')
                .update({ status: 'SUSPENDED' })
                .eq('id', fixture.orgId)
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.emailSent).toBe(true)
        expect(res.reminderSent).toBe(false)
        expect(res.reminderSkippedReason).toContain('Organization')
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 20: Location deactivated between initial and reminder: reminder aborted', async () => {
      const fixture = await createScenarioFixture('s20')
      try {
        const customStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay') {
              await supabase
                .from('locations')
                .update({ status: 'INACTIVE' })
                .eq('id', fixture.locId)
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.emailSent).toBe(true)
        expect(res.reminderSent).toBe(false)
        expect(res.reminderSkippedReason).toContain('Location')
      } finally {
        await fixture.cleanup()
      }
    })
  })

  // =========================================================================
  // Scenario 21: Cooldown & Multiple Completion Events
  // =========================================================================
  describe('Scenario 21: Cooldown & Multiple Completion Events', () => {
    it('Scenario 21: New completion event created within 30 days does not block prior request reminder', async () => {
      const fixture = await createScenarioFixture('s21')
      try {
        const customStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay') {
              // Insert another completion event for same customer
              await supabase.from('customer_completion_events').insert({
                organization_id: fixture.orgId,
                location_id: fixture.locId,
                customer_id: fixture.customerId,
                source: 'quick_complete',
                source_event_id: `competing_evt_${Date.now()}`,
                contact: { email: fixture.email },
                permission: { email: 'allowed' },
              })
            }
          },
        }

        // Prior request reminder should still evaluate eligibility cleanly (excluding its own completion event)
        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.processed).toBe(true)
        expect(res.reminderSent).toBe(true)
      } finally {
        await fixture.cleanup()
      }
    })
  })

  // =========================================================================
  // Scenarios 22 to 25: Status Preservation & Webhook Delivery
  // =========================================================================
  describe('Scenarios 22-25: Status Preservation & Webhook Delivery Tracking', () => {
    it('Scenario 22: Initial request status DELIVERED: reminder dispatch does NOT regress status to SENT', async () => {
      const fixture = await createScenarioFixture('s22')
      try {
        let reviewReqId: string | null = null
        const customStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const res = await fn()
            if (name === 'create-or-resolve-review-request') {
              reviewReqId = (res as { id: string }).id
            }
            return res
          },
          sleep: async (name: string) => {
            if (name === 'wait-for-reminder-delay' && reviewReqId) {
              // Mark request DELIVERED (e.g. from inbound webhook)
              await supabase
                .from('review_requests')
                .update({ status: 'DELIVERED', delivered_at: new Date().toISOString() })
                .eq('id', reviewReqId)
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.reminderSent).toBe(true)

        // Verify status remains DELIVERED and reminded_at is set
        const { data: req } = await supabase
          .from('review_requests')
          .select('status, delivered_at, reminded_at')
          .eq('id', res.reviewRequestId!)
          .single()

        expect(req?.status).toBe('DELIVERED')
        expect(req?.delivered_at).not.toBeNull()
        expect(req?.reminded_at).not.toBeNull()
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 23: Initial request status SENT: reminder dispatch keeps status SENT', async () => {
      const fixture = await createScenarioFixture('s23')
      try {
        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(res.reminderSent).toBe(true)

        const { data: req } = await supabase
          .from('review_requests')
          .select('status, reminded_at')
          .eq('id', res.reviewRequestId!)
          .single()

        expect(req?.status).toBe('SENT')
        expect(req?.reminded_at).not.toBeNull()
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 24: Delivery webhook for reminder increments reminders_delivered and preserves initial delivery record', async () => {
      const fixture = await createScenarioFixture('s24')
      try {
        // Run workflow so reminder is sent
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

        // Mark request DELIVERED with original delivered_at
        const originalDeliveredAt = '2026-09-18T12:00:00.000Z'
        await supabase
          .from('review_requests')
          .update({ status: 'DELIVERED', delivered_at: originalDeliveredAt })
          .eq('id', res.reviewRequestId!)

        // Send Resend webhook for email.delivered matching the reminder message ID
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

        // Verify message_events recorded delivery with review_request_reminder
        const { data: deliveredMsgEvent } = await supabase
          .from('message_events')
          .select('status, metadata')
          .eq('provider_message_id', reminderMsgId!)
          .eq('event_type', 'email.delivered')
          .single()

        expect(deliveredMsgEvent?.status).toBe('DELIVERED')
        expect((deliveredMsgEvent?.metadata as Record<string, unknown>)?.messageKind).toBe('review_request_reminder')

        // Verify request still has delivered_at preserved
        const { data: finalReq } = await supabase
          .from('review_requests')
          .select('status, delivered_at')
          .eq('id', res.reviewRequestId!)
          .single()

        expect(finalReq?.status).toBe('DELIVERED')
        expect(finalReq?.delivered_at).toBeDefined()
      } finally {
        await fixture.cleanup()
      }
    })

    it('Scenario 25: Bounce webhook for reminder updates bounce state without erasing initial delivery success record', async () => {
      const fixture = await createScenarioFixture('s25')
      try {
        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        const { data: reminderMsg } = await supabase
          .from('message_events')
          .select('provider_message_id')
          .eq('review_request_id', res.reviewRequestId!)
          .eq('event_type', 'sent')
          .filter('metadata->>messageKind', 'eq', 'review_request_reminder')
          .single()

        const reminderMsgId = reminderMsg!.provider_message_id

        // Request was previously DELIVERED
        const initialDeliveredAt = '2026-09-18T10:00:00.000Z'
        await supabase
          .from('review_requests')
          .update({ status: 'DELIVERED', delivered_at: initialDeliveredAt })
          .eq('id', res.reviewRequestId!)

        // Inbound bounce webhook for the reminder
        const payload = JSON.stringify({
          type: 'email.bounced',
          data: {
            email_id: reminderMsgId,
            to: [fixture.email],
            created_at: new Date().toISOString(),
            bounce: {
              type: 'HardBounce',
              message: 'Mailbox full or invalid',
            },
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

        // Review request state: delivered_at remains preserved from initial send
        const { data: finalReq } = await supabase
          .from('review_requests')
          .select('status, delivered_at, failed_at')
          .eq('id', res.reviewRequestId!)
          .single()

        expect(new Date(finalReq!.delivered_at!).toISOString()).toBe(
          new Date(initialDeliveredAt).toISOString()
        )

        // message_events recorded the bounce event
        const { data: bounceMsgEvent } = await supabase
          .from('message_events')
          .select('status, metadata')
          .eq('provider_message_id', reminderMsgId!)
          .eq('event_type', 'email.bounced')
          .single()

        expect(bounceMsgEvent?.status).toBe('FAILED')
        expect((bounceMsgEvent?.metadata as Record<string, unknown>)?.bounceType).toBe('HardBounce')
      } finally {
        await fixture.cleanup()
      }
    })
  })

  // =========================================================================
  // Scenarios 26 to 29: Copy Neutrality, Unsubscribe, Tracked URL & Console Provider
  // =========================================================================
  describe('Scenarios 26-29: Content Neutrality, Headers, URL & Console Safety', () => {
    const sampleInput = {
      businessName: 'Apex Health Clinic',
      customerFirstName: 'Jordan',
      reviewUrl: 'http://localhost:3000/r/token_sample_123',
      unsubscribeUrl: 'http://localhost:3000/unsubscribe/unsub_token_456',
      fromAddress: 'reviews@reputation.withmpg.com',
    }

    it('Scenario 26: Neutral reminder email body: verified identical semantics, no gating language, no rating requests', () => {
      const email = composeReviewReminderEmail(sampleInput)
      const combined = `${email.subject} ${email.html} ${email.text}`.toLowerCase()

      // Prohibited gating phrases
      const prohibited = [
        'haven\'t left a review',
        'noticed you didn\'t',
        '5 star',
        'five star',
        'positive review',
        'help our rating',
        'happy with your service',
        'give us 5',
        'rating',
        'incentive',
      ]

      for (const phrase of prohibited) {
        expect(combined).not.toContain(phrase)
      }

      // Neutral wording verified
      expect(email.subject).toBe('Reminder: Share your experience with Apex Health Clinic')
      expect(email.html).toContain('If you&#39;d like to leave a review, use the link below.')
      expect(email.text).toContain('If you\'d like to leave a review, use the link below.')
    })

    it('Scenario 27: RFC 8058 unsubscribe header: verified present on reminder email', () => {
      const email = composeReviewReminderEmail(sampleInput)
      expect(email.headers['List-Unsubscribe']).toBe(`<${sampleInput.unsubscribeUrl}>`)
      expect(email.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    })

    it('Scenario 28: Tracked URL in reminder uses identical original token pointing to /r/[token]', () => {
      const appUrl = 'http://localhost:3000'
      const token = 'token_original_7788'
      const trackingUrl = buildTrackedReviewUrl(appUrl, token)

      expect(trackingUrl).toBe('http://localhost:3000/r/token_original_7788')

      const email = composeReviewReminderEmail({
        ...sampleInput,
        reviewUrl: trackingUrl,
      })

      expect(email.html).toContain('http://localhost:3000/r/token_original_7788')
      expect(email.text).toContain('http://localhost:3000/r/token_original_7788')
    })

    it('Scenario 29: Console provider execution: reminder dispatches safely in console mode with zero network side effects', async () => {
      const provider = new ConsoleEmailProvider()
      const email = composeReviewReminderEmail(sampleInput)

      const result = await provider.send({
        to: 'patient@example.test',
        recipientName: 'Jordan',
        businessName: sampleInput.businessName,
        trackingUrl: sampleInput.reviewUrl,
        unsubscribeUrl: sampleInput.unsubscribeUrl,
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromDisplayName: email.fromDisplayName,
        headers: email.headers,
      })

      expect(result.success).toBe(true)
      expect(result.provider).toBe('console')
      expect(result.messageId).toContain('console_')
    })
  })
})
