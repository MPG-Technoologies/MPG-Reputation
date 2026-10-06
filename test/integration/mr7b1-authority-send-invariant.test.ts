import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  executeReviewRequestHandler,
  checkFinalEmailDispatchAuthority,
  type ReviewRequestEventData,
} from '../../src/inngest/functions/review-request'
import { hashSuppressionContact } from '../../src/domain/suppression'

describe('MR-7B.1 Integration: Database Authority Evidence & Send Invariant', () => {
  const supabase = createAdminClient()
  let isDbAvailable = false
  const originalEnv = process.env

  const baseNonce = Date.now()

  const mockStep = {
    run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    sleep: async (): Promise<void> => {},
  }

  async function createFixture(suffix: string, opts?: { permissionEmail?: 'allowed' | 'unknown' | 'denied' }) {
    const nonce = `${baseNonce}_${suffix}_${Math.random().toString(36).slice(2, 7)}`
    const email = `patient.${nonce}@example.test`

    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({
        name: `Org MR7B1 ${nonce}`,
        slug: `org-mr7b1-${nonce}`,
        status: 'ACTIVE',
      })
      .select('id, name')
      .single()
    if (orgErr || !org) throw new Error(`Org setup failed: ${orgErr?.message}`)

    const { data: loc, error: locErr } = await supabase
      .from('locations')
      .insert({
        organization_id: org.id,
        name: `Clinic ${nonce}`,
        status: 'ACTIVE',
      })
      .select('id')
      .single()
    if (locErr || !loc) throw new Error(`Loc setup failed: ${locErr?.message}`)

    const { data: cust, error: custErr } = await supabase
      .from('customers')
      .insert({
        organization_id: org.id,
        location_id: loc.id,
        first_name: 'Jordan',
        last_name: 'Fixture',
        email,
        permission_email: opts?.permissionEmail || 'allowed',
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
        source_event_id: `evt_mr7b1_${nonce}`,
        country: 'CA',
        contact: { email },
        permission: { email: opts?.permissionEmail || 'allowed', sms: 'unknown' },
      })
      .select('id')
      .single()
    if (cceErr || !cce) throw new Error(`CCE setup failed: ${cceErr?.message}`)

    const eventData: ReviewRequestEventData = {
      eventId: cce.id,
      organizationId: org.id,
      locationId: loc.id,
      customerId: cust.id,
      sourceEventId: `evt_mr7b1_${nonce}`,
    }

    return {
      orgId: org.id,
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

  it('proves trigger records messaging authority evidence upon customer_completion_events insertion', async () => {
    if (!isDbAvailable) return

    const fixture = await createFixture('evidence_trigger')
    try {
      const { data: evidence, error: evErr } = await supabase
        .from('messaging_authority_evidence')
        .select('*')
        .eq('completion_event_id', fixture.cceId)

      expect(evErr).toBeNull()
      expect(evidence).toHaveLength(2) // 1 email, 1 sms

      const emailEv = evidence?.find((e) => e.channel === 'email')
      const smsEv = evidence?.find((e) => e.channel === 'sms')

      expect(emailEv).toBeDefined()
      expect(emailEv?.asserted_state).toBe('allowed')
      expect(emailEv?.assertion_kind).toBe('OPERATIONAL_PERMISSION_STATE')
      expect(emailEv?.asserted_at).toBeNull()
      expect(emailEv?.capture_method).toBe('completion_event_assertion')
      expect(emailEv?.actor_type).toBe('system')

      expect(smsEv).toBeDefined()
      expect(smsEv?.asserted_state).toBe('unknown')
      expect(smsEv?.asserted_at).toBeNull()
    } finally {
      await fixture.cleanup()
    }
  })

  it('proves final authority check blocks dispatch if customer is suppressed right before send', async () => {
    if (!isDbAvailable) return

    const fixture = await createFixture('send_race_supp')
    try {
      // Insert suppression before final dispatch
      const contactHash = hashSuppressionContact('email', fixture.email)
      await supabase.from('suppressions').insert({
        organization_id: fixture.orgId,
        channel: 'email',
        contact_hash: contactHash,
        reason: 'UNSUBSCRIBE',
      })

      const authority = await checkFinalEmailDispatchAuthority({
        supabase,
        organizationId: fixture.orgId,
        locationId: fixture.locId,
        customerId: fixture.customerId,
      })

      expect(authority.allowed).toBe(false)
      expect(authority.decision).toBe('SUPPRESSED')

      const result = await executeReviewRequestHandler({
        event: { data: fixture.eventData },
        step: mockStep,
      })

      // The handler must not have sent an email
      expect(result.processed).toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })

  it('proves final authority check blocks dispatch if permission is denied right before send', async () => {
    if (!isDbAvailable) return

    const fixture = await createFixture('send_race_denied', { permissionEmail: 'denied' })
    try {
      const authority = await checkFinalEmailDispatchAuthority({
        supabase,
        organizationId: fixture.orgId,
        locationId: fixture.locId,
        customerId: fixture.customerId,
      })

      expect(authority.allowed).toBe(false)
      expect(authority.decision).toBe('EMAIL_PERMISSION_DENIED')
    } finally {
      await fixture.cleanup()
    }
  })
})
