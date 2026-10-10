import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { executeReviewRequestHandler } from '../../src/inngest/functions/review-request'
import { ConsoleEmailProvider } from '../../src/providers/email/console'
import * as emailProviderModule from '../../src/providers/email'
import { hashSuppressionContact } from '../../src/domain/suppression'

describe('MR-7C.5B Inngest / Provider Privacy Hardening', () => {
  const supabase = createAdminClient()
  const baseNonce = Date.now()
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  async function createTestFixture(suffix: string) {
    const nonce = `${baseNonce}_${suffix}_${Math.random().toString(36).slice(2, 7)}`
    const email = `adversarial.victim.${nonce}@privacy-test.mpg`
    const firstName = `AdversarialName_${nonce}`

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
        first_name: firstName,
        last_name: 'TestVictim',
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

  // =========================================================================
  // PROOFS 1-6 & 14-15: Step Output Minimization & Normal Flow
  // =========================================================================
  describe('Step Output Minimization (Proofs 1-6, 14, 15)', () => {
    it('1. initial eligibility step result contains no customerName', async () => {
      const fixture = await createTestFixture('p1_p6')
      try {
        const stepOutputs: Record<string, unknown> = {}
        const recordingStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const res = await fn()
            stepOutputs[name] = res
            return res
          },
          sleep: async (): Promise<void> => {},
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: recordingStep,
        })

        expect(res.processed).toBe(true)

        const initialElig = stepOutputs['evaluate-initial-eligibility'] as Record<string, unknown>
        expect(initialElig).toBeDefined()
        expect(initialElig.customerName).toBeUndefined()
        expect(JSON.stringify(initialElig)).not.toContain(fixture.firstName)
      } finally {
        await fixture.cleanup()
      }
    })

    it('2. initial eligibility step result contains no customerEmail', async () => {
      const fixture = await createTestFixture('p2')
      try {
        const stepOutputs: Record<string, unknown> = {}
        const recordingStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const res = await fn()
            stepOutputs[name] = res
            return res
          },
          sleep: async (): Promise<void> => {},
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: recordingStep,
        })

        expect(res.processed).toBe(true)

        const initialElig = stepOutputs['evaluate-initial-eligibility'] as Record<string, unknown>
        expect(initialElig).toBeDefined()
        expect(initialElig.customerEmail).toBeUndefined()
        expect(JSON.stringify(initialElig)).not.toContain(fixture.email)
      } finally {
        await fixture.cleanup()
      }
    })

    it('3. post-delay eligibility contains no name/email', async () => {
      const fixture = await createTestFixture('p3')
      try {
        const stepOutputs: Record<string, unknown> = {}
        const recordingStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const res = await fn()
            stepOutputs[name] = res
            return res
          },
          sleep: async (): Promise<void> => {},
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: recordingStep,
        })

        expect(res.processed).toBe(true)

        const preReminder = stepOutputs['evaluate-pre-reminder-eligibility'] as Record<string, unknown>
        expect(preReminder).toBeDefined()
        expect(preReminder.customerName).toBeUndefined()
        expect(preReminder.customerEmail).toBeUndefined()
        expect(JSON.stringify(preReminder)).not.toContain(fixture.firstName)
        expect(JSON.stringify(preReminder)).not.toContain(fixture.email)
      } finally {
        await fixture.cleanup()
      }
    })

    it('4. review dispatch result contains no renderedSubject', async () => {
      const fixture = await createTestFixture('p4')
      try {
        const stepOutputs: Record<string, unknown> = {}
        const recordingStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const res = await fn()
            stepOutputs[name] = res
            return res
          },
          sleep: async (): Promise<void> => {},
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: recordingStep,
        })

        expect(res.processed).toBe(true)

        const dispatchResult = stepOutputs['dispatch-review-email'] as Record<string, unknown>
        expect(dispatchResult).toBeDefined()
        expect(dispatchResult.renderedSubject).toBeUndefined()
        expect(JSON.stringify(dispatchResult)).not.toContain('renderedSubject')
      } finally {
        await fixture.cleanup()
      }
    })

    it('5. review dispatch result contains no renderedBody', async () => {
      const fixture = await createTestFixture('p5')
      try {
        const stepOutputs: Record<string, unknown> = {}
        const recordingStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const res = await fn()
            stepOutputs[name] = res
            return res
          },
          sleep: async (): Promise<void> => {},
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: recordingStep,
        })

        expect(res.processed).toBe(true)

        const dispatchResult = stepOutputs['dispatch-review-email'] as Record<string, unknown>
        expect(dispatchResult).toBeDefined()
        expect(dispatchResult.renderedBody).toBeUndefined()
        expect(JSON.stringify(dispatchResult)).not.toContain('renderedBody')
        expect(JSON.stringify(dispatchResult)).not.toContain(fixture.email)
        expect(JSON.stringify(dispatchResult)).not.toContain(fixture.firstName)
      } finally {
        await fixture.cleanup()
      }
    })

    it('6. reminder dispatch contains no rendered content', async () => {
      const fixture = await createTestFixture('p6')
      try {
        const stepOutputs: Record<string, unknown> = {}
        const recordingStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const res = await fn()
            stepOutputs[name] = res
            return res
          },
          sleep: async (): Promise<void> => {},
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: recordingStep,
        })

        expect(res.processed).toBe(true)

        const reminderDispatchResult = stepOutputs['dispatch-review-reminder'] as Record<string, unknown>
        expect(reminderDispatchResult).toBeDefined()
        expect(reminderDispatchResult.renderedSubject).toBeUndefined()
        expect(reminderDispatchResult.renderedBody).toBeUndefined()
        expect(JSON.stringify(reminderDispatchResult)).not.toContain('renderedSubject')
        expect(JSON.stringify(reminderDispatchResult)).not.toContain('renderedBody')
        expect(JSON.stringify(reminderDispatchResult)).not.toContain(fixture.email)
        expect(JSON.stringify(reminderDispatchResult)).not.toContain(fixture.firstName)
      } finally {
        await fixture.cleanup()
      }
    })

    it('14. successful send still works', async () => {
      const fixture = await createTestFixture('p14')
      try {
        const mockStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (): Promise<void> => {},
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(res.processed).toBe(true)
        expect(res.emailSent).toBe(true)

        // Check review_requests row is SENT
        const { data: req } = await supabase
          .from('review_requests')
          .select('status, sent_at')
          .eq('id', res.reviewRequestId!)
          .single()

        expect(req).toBeDefined()
        expect(req?.status).toBe('SENT')
        expect(req?.sent_at).not.toBeNull()
      } finally {
        await fixture.cleanup()
      }
    })

    it('15. reminder still works', async () => {
      const fixture = await createTestFixture('p15')
      try {
        const mockStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (): Promise<void> => {},
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(res.processed).toBe(true)
        expect(res.reminderSent).toBe(true)

        // Check review_requests row has reminded_at populated
        const { data: req } = await supabase
          .from('review_requests')
          .select('status, reminded_at')
          .eq('id', res.reviewRequestId!)
          .single()

        expect(req).toBeDefined()
        expect(req?.reminded_at).not.toBeNull()
      } finally {
        await fixture.cleanup()
      }
    })
  })

  // =========================================================================
  // PROOFS 7-11: Provider Error & Adversarial PII Leakage Hardening
  // =========================================================================
  describe('Provider Error Hardening & Adversarial Leakage (Proofs 7-11)', () => {
    async function runAdversarialTest(adversarialPayload: string) {
      const fixture = await createTestFixture('adv_err')
      try {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        vi.spyOn(emailProviderModule, 'getEmailProvider').mockReturnValue({
          name: 'console',
          send: async () => {
            throw new Error(`Provider raw failure: ${adversarialPayload}`)
          },
        })

        const mockStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (): Promise<void> => {},
        }

        let thrownError: Error | null = null
        try {
          await executeReviewRequestHandler({
            event: { data: fixture.eventData },
            step: mockStep,
          })
        } catch (err: unknown) {
          thrownError = err as Error
        }

        // Query review_requests table
        const { data: req } = await supabase
          .from('review_requests')
          .select('status, error_message')
          .eq('customer_id', fixture.cust.id)
          .maybeSingle()

        // Query message_events
        const { data: msgEvents } = await supabase
          .from('message_events')
          .select('*')
          .eq('organization_id', fixture.org.id)

        // Query audit_events
        const { data: auditEvents } = await supabase
          .from('audit_events')
          .select('*')
          .eq('organization_id', fixture.org.id)

        const logs = consoleErrorSpy.mock.calls
          .map((c) => c.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' '))
          .join('\n')

        return {
          fixture,
          thrownError,
          req,
          msgEvents: msgEvents || [],
          auditEvents: auditEvents || [],
          logs,
        }
      } finally {
        await fixture.cleanup()
      }
    }

    it('7. provider error containing email does not leak', async () => {
      const email = 'adversarial.leak.victim@dangerous-domain.test'
      const { thrownError, req, msgEvents, auditEvents, logs } = await runAdversarialTest(email)

      expect(thrownError).not.toBeNull()
      expect(thrownError?.message).toBe('EMAIL_DISPATCH_FAILED')
      expect(thrownError?.message).not.toContain(email)
      expect(logs).not.toContain(email)
      expect(req?.error_message).toBe('EMAIL_DISPATCH_FAILED')
      expect(JSON.stringify(msgEvents)).not.toContain(email)
      expect(JSON.stringify(auditEvents)).not.toContain(email)
    })

    it('8. provider error containing name/phone does not leak', async () => {
      const name = 'TargetCustomerFullName'
      const phone = '+1-555-867-5309'
      const payload = `recipient ${name} with telephone ${phone}`
      const { thrownError, req, msgEvents, auditEvents, logs } = await runAdversarialTest(payload)

      expect(thrownError).not.toBeNull()
      expect(thrownError?.message).toBe('EMAIL_DISPATCH_FAILED')
      expect(thrownError?.message).not.toContain(name)
      expect(thrownError?.message).not.toContain(phone)
      expect(logs).not.toContain(name)
      expect(logs).not.toContain(phone)
      expect(req?.error_message).toBe('EMAIL_DISPATCH_FAILED')
      expect(JSON.stringify(msgEvents)).not.toContain(name)
      expect(JSON.stringify(msgEvents)).not.toContain(phone)
      expect(JSON.stringify(auditEvents)).not.toContain(name)
      expect(JSON.stringify(auditEvents)).not.toContain(phone)
    })

    it('9. provider error containing review token does not leak', async () => {
      const reviewToken = 'adversarial_review_token_SECRET_TOKEN_99999'
      const { thrownError, req, msgEvents, auditEvents, logs } = await runAdversarialTest(reviewToken)

      expect(thrownError).not.toBeNull()
      expect(thrownError?.message).toBe('EMAIL_DISPATCH_FAILED')
      expect(thrownError?.message).not.toContain(reviewToken)
      expect(logs).not.toContain(reviewToken)
      expect(req?.error_message).toBe('EMAIL_DISPATCH_FAILED')
      expect(JSON.stringify(msgEvents)).not.toContain(reviewToken)
      expect(JSON.stringify(auditEvents)).not.toContain(reviewToken)
    })

    it('10. provider error containing unsubscribe token does not leak', async () => {
      const unsubToken = 'adversarial_unsub_token_SECRET_TOKEN_88888'
      const { thrownError, req, msgEvents, auditEvents, logs } = await runAdversarialTest(unsubToken)

      expect(thrownError).not.toBeNull()
      expect(thrownError?.message).toBe('EMAIL_DISPATCH_FAILED')
      expect(thrownError?.message).not.toContain(unsubToken)
      expect(logs).not.toContain(unsubToken)
      expect(req?.error_message).toBe('EMAIL_DISPATCH_FAILED')
      expect(JSON.stringify(msgEvents)).not.toContain(unsubToken)
      expect(JSON.stringify(auditEvents)).not.toContain(unsubToken)
    })

    it('11. provider error containing long hash/UUID does not leak unnecessarily', async () => {
      const longHash = '4a5e2f7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f'
      const rawUuid = randomUUID()
      const payload = `hash=${longHash} uuid=${rawUuid} secret=re_live_secretkey12345`
      const { thrownError, req, msgEvents, auditEvents, logs } = await runAdversarialTest(payload)

      expect(thrownError).not.toBeNull()
      expect(thrownError?.message).toBe('EMAIL_DISPATCH_FAILED')
      expect(thrownError?.message).not.toContain(longHash)
      expect(thrownError?.message).not.toContain(rawUuid)
      expect(thrownError?.message).not.toContain('re_live_secretkey12345')
      expect(logs).not.toContain(longHash)
      expect(logs).not.toContain(rawUuid)
      expect(req?.error_message).toBe('EMAIL_DISPATCH_FAILED')
      expect(JSON.stringify(msgEvents)).not.toContain(longHash)
      expect(JSON.stringify(msgEvents)).not.toContain(rawUuid)
      expect(JSON.stringify(auditEvents)).not.toContain(longHash)
      expect(JSON.stringify(auditEvents)).not.toContain(rawUuid)
    })
  })

  // =========================================================================
  // PROOFS 12-13: Console Email Provider Production Guard
  // =========================================================================
  describe('Console Email Provider Guard (Proofs 12-13)', () => {
    it('12. ConsoleEmailProvider fails before logging in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const consoleLogSpy = vi.spyOn(console, 'log')
      const provider = new ConsoleEmailProvider()

      await expect(
        provider.send({
          to: 'customer@example.test',
          recipientName: 'Jane',
          businessName: 'Northstar Dental',
          trackingUrl: 'https://example.test/r/token-123',
        })
      ).rejects.toThrow('CONSOLE_EMAIL_PROVIDER_DISABLED_IN_PRODUCTION')

      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('13. ConsoleEmailProvider remains usable locally', async () => {
      vi.stubEnv('NODE_ENV', 'development')
      const provider = new ConsoleEmailProvider()
      const result = await provider.send({
        to: 'customer@example.test',
        recipientName: 'Jane',
        businessName: 'Northstar Dental',
        trackingUrl: 'https://example.test/r/token-123',
      })

      expect(result.success).toBe(true)
      expect(result.provider).toBe('console')
    })
  })

  // =========================================================================
  // PROOFS 16-19: Operational Invariants Preservation
  // =========================================================================
  describe('Operational Invariants (Proofs 16-19)', () => {
    it('16. suppression still works', async () => {
      const fixture = await createTestFixture('p16')
      try {
        // Suppress the customer email prior to workflow execution
        const contactHash = hashSuppressionContact('email', fixture.email)
        await supabase.from('suppressions').insert({
          organization_id: fixture.org.id,
          channel: 'email',
          contact_hash: contactHash,
          reason: 'MANUAL',
        })

        const mockStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (): Promise<void> => {},
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(res.processed).toBe(false)
        expect(res.decision).toBe('SUPPRESSED')

        // Ensure review_requests was never created
        const { data: requests } = await supabase
          .from('review_requests')
          .select('id')
          .eq('organization_id', fixture.org.id)

        expect(requests?.length).toBe(0)
      } finally {
        await fixture.cleanup()
      }
    })

    it('17. unsubscribe still works', async () => {
      const fixture = await createTestFixture('p17')
      try {
        let reminderAttempted = false
        const customStep = {
          run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            if (name === 'dispatch-review-reminder') {
              reminderAttempted = true
            }
            return fn()
          },
          sleep: async (name: string): Promise<void> => {
            // Simulate customer clicking unsubscribe during reminder sleep window only
            if (name === 'wait-for-reminder-delay') {
              const contactHash = hashSuppressionContact('email', fixture.email)
              await supabase.from('suppressions').insert({
                organization_id: fixture.org.id,
                channel: 'email',
                contact_hash: contactHash,
                reason: 'UNSUBSCRIBED',
              })
            }
          },
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: customStep,
        })

        expect(res.processed).toBe(true)
        expect(res.emailSent).toBe(true)
        expect(res.reminderSent).toBe(false)
        expect(res.stage).toBe('reminder_skipped')
        expect(res.reminderSkippedReason).toContain('suppression')
        expect(reminderAttempted).toBe(false)
      } finally {
        await fixture.cleanup()
      }
    })

    it('18. authority/sender checks still work', async () => {
      const fixture = await createTestFixture('p18')
      try {
        // Deny email permission on the customer
        await supabase
          .from('customers')
          .update({ permission_email: 'denied' })
          .eq('id', fixture.cust.id)

        const mockStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (): Promise<void> => {},
        }

        const res = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(res.processed).toBe(false)
        expect(res.decision).toBe('EMAIL_PERMISSION_DENIED')
      } finally {
        await fixture.cleanup()
      }
    })

    it('19. retry/idempotency behavior remains correct', async () => {
      const fixture = await createTestFixture('p19')
      try {
        const mockStep = {
          run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          sleep: async (): Promise<void> => {},
        }

        // First execution
        const firstRes = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(firstRes.processed).toBe(true)
        expect(firstRes.emailSent).toBe(true)

        // Second execution with identical completion event data
        const secondRes = await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })

        expect(secondRes.processed).toBe(true)
        expect(secondRes.emailSent).toBe(true)
        // Reminder was already sent in first run, so second run returns reminderSent: false
        expect(secondRes.reminderSent).toBe(false)

        // Only ONE review_requests record exists
        const { data: requests } = await supabase
          .from('review_requests')
          .select('id')
          .eq('organization_id', fixture.org.id)

        expect(requests?.length).toBe(1)
      } finally {
        await fixture.cleanup()
      }
    })
  })
})
