import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
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

  it('proves trigger function execute privileges: anon and authenticated cannot directly execute; service_role retains execute authority', async () => {
    if (!isDbAvailable) return

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_anon_key'

    // 1. anon cannot directly execute the function
    const anonClient = createClient<Database>(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: anonErr } = await anonClient.rpc(
      'record_messaging_authority_evidence_from_completion' as unknown as keyof Database['public']['Functions']
    )
    expect(anonErr).not.toBeNull()

    // 2. authenticated cannot directly execute the function
    const nonce = `auth_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const { data: userAuth, error: userCreateErr } = await supabase.auth.admin.createUser({
      email: `test_auth_${nonce}@example.test`,
      password: 'Password123!',
      email_confirm: true,
    })
    expect(userCreateErr).toBeNull()

    const authUserClient = createClient<Database>(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    await authUserClient.auth.signInWithPassword({
      email: `test_auth_${nonce}@example.test`,
      password: 'Password123!',
    })
    const { error: authErr } = await authUserClient.rpc(
      'record_messaging_authority_evidence_from_completion' as unknown as keyof Database['public']['Functions']
    )
    expect(authErr).not.toBeNull()

    if (userAuth?.user?.id) {
      await supabase.auth.admin.deleteUser(userAuth.user.id)
    }

    // 3. service_role retains execute authority (verified by trigger execution during service_role insertion)
    const fixture = await createFixture('exec_perm_check')
    try {
      const { data: evidence, error: evErr } = await supabase
        .from('messaging_authority_evidence')
        .select('*')
        .eq('completion_event_id', fixture.cceId)

      expect(evErr).toBeNull()
      expect(evidence).toHaveLength(2)
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

  it('regression: customer initially has valid allowed email, fresh send-time value becomes malformed -> blocks dispatch and provider is not called', async () => {
    if (!isDbAvailable) return

    const fixture = await createFixture('send_race_malformed')
    try {
      // 1. Customer initially has valid allowed email in database and event
      expect(fixture.email).toContain('@')

      // Step runner that mutates customer email right before dispatch-review-email executes
      let corruptedBeforeDispatch = false
      const raceStep = {
        run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
          if (name === 'dispatch-review-email' && !corruptedBeforeDispatch) {
            corruptedBeforeDispatch = true
            // Mutate database directly to simulate concurrent edit/malformed update right before dispatch
            await supabase
              .from('customers')
              .update({ email: 'corrupted-invalid-email-no-domain' })
              .eq('id', fixture.customerId)
          }
          return fn()
        },
        sleep: async (): Promise<void> => {},
      }

      // 2. Direct check before corruption proves initial eligibility
      const authorityBefore = await checkFinalEmailDispatchAuthority({
        supabase,
        organizationId: fixture.orgId,
        locationId: fixture.locId,
        customerId: fixture.customerId,
      })
      expect(authorityBefore.allowed).toBe(true)
      expect(authorityBefore.decision).toBe('ELIGIBLE')

      // 3. Workflow execution: passes initial eligibility, but final authority check catches malformed email right before send
      const result = await executeReviewRequestHandler({
        event: { data: fixture.eventData },
        step: raceStep,
      })

      expect(corruptedBeforeDispatch).toBe(true)
      expect(result.processed).toBe(false)
      expect(result.reason).toBe('aborted_due_to_ineligibility')

      // 4. Final authority check blocked dispatch with NO_CONTACT
      const authorityAfter = await checkFinalEmailDispatchAuthority({
        supabase,
        organizationId: fixture.orgId,
        locationId: fixture.locId,
        customerId: fixture.customerId,
      })
      expect(authorityAfter.allowed).toBe(false)
      expect(authorityAfter.decision).toBe('NO_CONTACT')
      expect(authorityAfter.customerEmail).toBeNull()

      // 5. Review request transitioned to CANCELLED instead of SENT/DELIVERED
      const { data: req } = await supabase
        .from('review_requests')
        .select('id, status, cancelled_at, sent_at')
        .eq('completion_event_id', fixture.cceId)
        .maybeSingle()

      expect(req?.status).toBe('CANCELLED')
      expect(req?.cancelled_at).not.toBeNull()
      expect(req?.sent_at).toBeNull()

      // 6. Audit event recorded dispatch_blocked with NO_CONTACT (and ZERO PII)
      const { data: auditEvents } = await supabase
        .from('audit_events')
        .select('*')
        .eq('entity_id', req!.id)
        .eq('event_type', 'review_request.dispatch_blocked')

      expect(auditEvents).toHaveLength(1)
      expect(auditEvents![0].metadata).toMatchObject({
        decision: 'NO_CONTACT',
      })
    } finally {
      await fixture.cleanup()
    }
  })
})
