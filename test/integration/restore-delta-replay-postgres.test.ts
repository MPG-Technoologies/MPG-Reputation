import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import {
  replayPrivacyRestoreDelta,
} from '../../src/domain/privacy/restore-replay'
import {
  verifyRestoredPrivacyState,
  type PrivacyRestoreDeltaV1,
} from '../../src/domain/privacy/restore-verification'
import { hashSuppressionContact } from '../../src/domain/suppression'
import { CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME } from '../../src/domain/privacy/customer-erasure'

vi.mock('server-only', () => ({}))

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const options = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
}

function executeDirectSql(sql: string): string {
  try {
    return execSync(
      'docker exec -i supabase_db_MPG-Reputation psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A',
      {
        input: sql,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )
  } catch (err) {
    const errorWithStderr = err as { stderr?: Buffer | string; message?: string }
    const stderr = errorWithStderr.stderr ? errorWithStderr.stderr.toString() : ''
    const msg = stderr || errorWithStderr.message || 'Direct SQL execution failed'
    try {
      return execSync('pnpm dlx supabase@2.117.0 db query --local', {
        input: sql,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      throw new Error(msg)
    }
  }
}

function checkFunctionPrivilegeDirect(
  role: string,
  funcSignature: string,
  privilege: string
): boolean {
  const sql = `SELECT has_function_privilege('${role}', '${funcSignature}', '${privilege}');`
  const result = executeDirectSql(sql).trim()
  return result === 't' || result === 'true'
}

const isDbAvailable =
  !!SERVICE_ROLE_KEY &&
  /^(127\.0\.0\.1|localhost)$/.test(new URL(SUPABASE_URL).hostname)

describe.skipIf(!isDbAvailable)(
  'MR-7C.5C2 Real PostgreSQL Integration Suite',
  { timeout: 60000 },
  () => {
    let adminClient: SupabaseClient<Database>
    let anonClient: SupabaseClient<Database>
    let authUserClient: SupabaseClient<Database>

    let orgA: string
    let locA: string
    let orgB: string

    let authUserId: string
    const cleanupOrgIds: string[] = []
    const cleanupUserIds: string[] = []

    async function checked<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
      const res = await promise
      if (res.error) {
        throw new Error(`DB Error: ${JSON.stringify(res.error)}`)
      }
      return res.data as NonNullable<T>
    }

    beforeAll(async () => {
      adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, options)
      anonClient = createClient<Database>(SUPABASE_URL, ANON_KEY, options)

      // Create test user for authenticated role tests
      const email = `test.user.${randomUUID().slice(0, 8)}@example.test`
      const password = 'Password123!'
      const userRes = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (userRes.error || !userRes.data.user) {
        throw new Error(`Failed to create test auth user: ${JSON.stringify(userRes.error)}`)
      }
      authUserId = userRes.data.user.id
      cleanupUserIds.push(authUserId)

      authUserClient = createClient<Database>(SUPABASE_URL, ANON_KEY, options)
      const signinRes = await authUserClient.auth.signInWithPassword({ email, password })
      if (signinRes.error) {
        throw new Error(`Failed to sign in: ${JSON.stringify(signinRes.error)}`)
      }

      // Create synthetic test organizations
      const orgARes = await checked(
        adminClient
          .from('organizations')
          .insert({
            name: 'MR7C5C2 Test Org A',
            slug: `mr7c5c2-org-a-${randomUUID().slice(0, 8)}`,
          })
          .select('id')
          .single()
      )
      orgA = orgARes.id
      cleanupOrgIds.push(orgA)

      const locARes = await checked(
        adminClient
          .from('locations')
          .insert({
            organization_id: orgA,
            name: 'Org A HQ',
            address: '100 Main St',
          })
          .select('id')
          .single()
      )
      locA = locARes.id

      const orgBRes = await checked(
        adminClient
          .from('organizations')
          .insert({
            name: 'MR7C5C2 Test Org B',
            slug: `mr7c5c2-org-b-${randomUUID().slice(0, 8)}`,
          })
          .select('id')
          .single()
      )
      orgB = orgBRes.id
      cleanupOrgIds.push(orgB)

      // Add auth user to Org A as MEMBER / VIEWER
      await checked(
        adminClient.from('organization_users').insert({
          organization_id: orgA,
          user_id: authUserId,
          role: 'VIEWER',
        })
      )
    }, 60_000)

    afterAll(async () => {
      try {
        executeDirectSql(`
          DROP TRIGGER IF EXISTS tr_test_fail_restore_replay_audit ON public.audit_events;
          DROP FUNCTION IF EXISTS public.test_fail_restore_replay_audit();
        `)
      } catch {
        // Ignored
      }
      for (const orgId of cleanupOrgIds) {
        await adminClient.from('organizations').delete().eq('id', orgId)
      }
      for (const uid of cleanupUserIds) {
        await adminClient.auth.admin.deleteUser(uid)
      }
    })

    // =========================================================================
    // 1 & 2: RPC Existence and Direct Service-Role Execution
    // =========================================================================

    it('1. replay_customer_erasure_maintenance exists and executes under service_role', async () => {
      // Create a test customer to erase
      const cust = await checked(
        adminClient
          .from('customers')
          .insert({
            organization_id: orgA,
            location_id: locA,
            first_name: 'Test',
            last_name: 'User',
            email: 'test@example.com',
          })
          .select('id')
          .single()
      )

      const { data, error } = await adminClient.rpc('replay_customer_erasure_maintenance', {
        p_org_id: orgA,
        p_customer_id: cust.id,
        p_erased_at: '2026-10-01T12:00:00.000Z',
      })

      expect(error).toBeNull()
      expect(data).toBeDefined()
      const res = data as { replayed: boolean; customer_id: string }
      expect(res.replayed).toBe(true)
      expect(res.customer_id).toBe(cust.id)
    })

    it('2. replay_suppression_maintenance exists and executes under service_role', async () => {
      const hash = hashSuppressionContact('email', 'user1@example.com')
      const { data, error } = await adminClient.rpc('replay_suppression_maintenance', {
        p_org_id: orgA,
        p_channel: 'email',
        p_contact_hash: hash,
        p_reason: 'UNSUBSCRIBE',
        p_created_at: '2026-10-01T14:00:00.000Z',
      })

      expect(error).toBeNull()
      expect(data).toBeDefined()
      const res = data as { inserted: boolean; channel: string }
      expect(res.inserted).toBe(true)
      expect(res.channel).toBe('email')
    })

    // =========================================================================
    // PRIVILEGES (3 - 9)
    // =========================================================================

    it('3. PUBLIC cannot execute customer replay (SQL privilege check)', () => {
      const hasPriv = checkFunctionPrivilegeDirect(
        'public',
        'public.replay_customer_erasure_maintenance(uuid, uuid, timestamptz)',
        'EXECUTE'
      )
      expect(hasPriv).toBe(false)
    })

    it('4. anon cannot execute customer replay (SQL & client execution)', async () => {
      const hasPriv = checkFunctionPrivilegeDirect(
        'anon',
        'public.replay_customer_erasure_maintenance(uuid, uuid, timestamptz)',
        'EXECUTE'
      )
      expect(hasPriv).toBe(false)

      const { error } = await anonClient.rpc('replay_customer_erasure_maintenance', {
        p_org_id: orgA,
        p_customer_id: randomUUID(),
        p_erased_at: new Date().toISOString(),
      })
      expect(error).toBeDefined()
    })

    it('5. authenticated cannot execute customer replay (SQL & client execution)', async () => {
      const hasPriv = checkFunctionPrivilegeDirect(
        'authenticated',
        'public.replay_customer_erasure_maintenance(uuid, uuid, timestamptz)',
        'EXECUTE'
      )
      expect(hasPriv).toBe(false)

      const { error } = await authUserClient.rpc('replay_customer_erasure_maintenance', {
        p_org_id: orgA,
        p_customer_id: randomUUID(),
        p_erased_at: new Date().toISOString(),
      })
      expect(error).toBeDefined()
    })

    it('6. PUBLIC cannot execute suppression replay (SQL privilege check)', () => {
      const hasPriv = checkFunctionPrivilegeDirect(
        'public',
        'public.replay_suppression_maintenance(uuid, text, text, text, timestamptz)',
        'EXECUTE'
      )
      expect(hasPriv).toBe(false)
    })

    it('7. anon cannot execute suppression replay (SQL & client execution)', async () => {
      const hasPriv = checkFunctionPrivilegeDirect(
        'anon',
        'public.replay_suppression_maintenance(uuid, text, text, text, timestamptz)',
        'EXECUTE'
      )
      expect(hasPriv).toBe(false)

      const { error } = await anonClient.rpc('replay_suppression_maintenance', {
        p_org_id: orgA,
        p_channel: 'email',
        p_contact_hash: hashSuppressionContact('email', 'anon@test.com'),
        p_reason: 'UNSUBSCRIBE',
        p_created_at: new Date().toISOString(),
      })
      expect(error).toBeDefined()
    })

    it('8. authenticated cannot execute suppression replay (SQL & client execution)', async () => {
      const hasPriv = checkFunctionPrivilegeDirect(
        'authenticated',
        'public.replay_suppression_maintenance(uuid, text, text, text, timestamptz)',
        'EXECUTE'
      )
      expect(hasPriv).toBe(false)

      const { error } = await authUserClient.rpc('replay_suppression_maintenance', {
        p_org_id: orgA,
        p_channel: 'email',
        p_contact_hash: hashSuppressionContact('email', 'auth@test.com'),
        p_reason: 'UNSUBSCRIBE',
        p_created_at: new Date().toISOString(),
      })
      expect(error).toBeDefined()
    })

    it('9. service_role can execute both maintenance functions', () => {
      const custPriv = checkFunctionPrivilegeDirect(
        'service_role',
        'public.replay_customer_erasure_maintenance(uuid, uuid, timestamptz)',
        'EXECUTE'
      )
      expect(custPriv).toBe(true)

      const supPriv = checkFunctionPrivilegeDirect(
        'service_role',
        'public.replay_suppression_maintenance(uuid, text, text, text, timestamptz)',
        'EXECUTE'
      )
      expect(supPriv).toBe(true)
    })

    // =========================================================================
    // ERASURE INVARIANTS (10 - 21)
    // =========================================================================

    describe('Customer Erasure Replay Invariants', () => {
      let custId: string
      const sourceEventId = `src-evt-${randomUUID().slice(0, 8)}`
      const erasedAtTimestamp = '2026-10-01T15:30:00.000Z'

      beforeAll(async () => {
        // Create full customer graph with PII, completion, review request, and message event
        const cust = await checked(
          adminClient
            .from('customers')
            .insert({
              organization_id: orgA,
              location_id: locA,
              first_name: 'Bob',
              last_name: 'Jones',
              email: 'bob.jones@example.com',
              phone: '+15551239876',
            })
            .select('id')
            .single()
        )
        custId = cust.id

        const completion = await checked(
          adminClient
            .from('customer_completion_events')
            .insert({
              organization_id: orgA,
              location_id: locA,
              customer_id: custId,
              source: 'pos',
              source_event_id: sourceEventId,
              source_customer_id: 'src-cust-123',
              source_transaction_id: 'src-tx-456',
              contact: { email: 'bob.jones@example.com', name: 'Bob Jones' },
            })
            .select('id')
            .single()
        )

        const rr = await checked(
          adminClient
            .from('review_requests')
            .insert({
              organization_id: orgA,
              location_id: locA,
              customer_id: custId,
              completion_event_id: completion.id,
              token: randomUUID(),
              token_hash: 'a'.repeat(64),
              status: 'FAILED',
              error_message: 'DISPATCH_ERROR: Provider rejected send',
            })
            .select('id')
            .single()
        )

        await checked(
          adminClient.from('message_events').insert({
            organization_id: orgA,
            review_request_id: rr.id,
            provider: 'resend',
            status: 'FAILED',
            event_type: 'FAILED',
            sanitized_error: 'RATE_LIMIT_EXCEEDED',
          })
        )

        // Execute erasure replay via maintenance RPC
        const { data, error } = await adminClient.rpc('replay_customer_erasure_maintenance', {
          p_org_id: orgA,
          p_customer_id: custId,
          p_erased_at: erasedAtTimestamp,
        })
        expect(error).toBeNull()
        expect(data).toBeDefined()
      }, 60_000)

      it('10. customer is tombstoned correctly', async () => {
        const cust = await checked(
          adminClient.from('customers').select('*').eq('id', custId).single()
        )
        expect(cust.first_name).toBe(CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME)
        expect(cust.last_name).toBeNull()
        expect(cust.email).toBeNull()
        expect(cust.phone).toBeNull()
      })

      it('11. completion contact becomes exact {}', async () => {
        const comp = await checked(
          adminClient
            .from('customer_completion_events')
            .select('*')
            .eq('customer_id', custId)
            .single()
        )
        expect(comp.contact).toEqual({})
      })

      it('12. source_customer_id becomes NULL', async () => {
        const comp = await checked(
          adminClient
            .from('customer_completion_events')
            .select('*')
            .eq('customer_id', custId)
            .single()
        )
        expect(comp.source_customer_id).toBeNull()
      })

      it('13. source_transaction_id becomes NULL', async () => {
        const comp = await checked(
          adminClient
            .from('customer_completion_events')
            .select('*')
            .eq('customer_id', custId)
            .single()
        )
        expect(comp.source_transaction_id).toBeNull()
      })

      it('14. source_event_id remains unchanged', async () => {
        const comp = await checked(
          adminClient
            .from('customer_completion_events')
            .select('*')
            .eq('customer_id', custId)
            .single()
        )
        expect(comp.source_event_id).toBe(sourceEventId)
      })

      it('15. review_request error_message is NULL', async () => {
        const rr = await checked(
          adminClient.from('review_requests').select('*').eq('customer_id', custId).single()
        )
        expect(rr.error_message).toBeNull()
      })

      it('16. message_event sanitized_error is NULL', async () => {
        const rr = await checked(
          adminClient.from('review_requests').select('id').eq('customer_id', custId).single()
        )
        const me = await checked(
          adminClient
            .from('message_events')
            .select('*')
            .eq('review_request_id', rr.id)
            .single()
        )
        expect(me.sanitized_error).toBeNull()
      })

      it('17. erasure certificate preserves delta erased_at', async () => {
        const cert = await checked(
          adminClient
            .from('customer_erasure_records')
            .select('*')
            .eq('customer_id', custId)
            .eq('organization_id', orgA)
            .single()
        )
        expect(new Date(cert.erased_at).toISOString()).toBe(new Date(erasedAtTimestamp).toISOString())
        expect(cert.actor_type).toBe('maintenance')
      })

      it('18. exact repeat is idempotent', async () => {
        const { data, error } = await adminClient.rpc('replay_customer_erasure_maintenance', {
          p_org_id: orgA,
          p_customer_id: custId,
          p_erased_at: erasedAtTimestamp,
        })
        expect(error).toBeNull()
        const res = data as { replayed: boolean; already_erased: boolean }
        expect(res.replayed).toBe(true)
        expect(res.already_erased).toBe(true)

        // Verify no duplicate certificates
        const certs = await checked(
          adminClient
            .from('customer_erasure_records')
            .select('*')
            .eq('customer_id', custId)
            .eq('organization_id', orgA)
        )
        expect(certs.length).toBe(1)
      })

      it('19. conflicting certificate erased_at fails with ERASURE_CERTIFICATE_MISMATCH', async () => {
        const conflictingErasedAt = '2026-10-02T00:00:00.000Z'
        const { data, error } = await adminClient.rpc('replay_customer_erasure_maintenance', {
          p_org_id: orgA,
          p_customer_id: custId,
          p_erased_at: conflictingErasedAt,
        })

        expect(error).toBeDefined()
        expect(error!.message).toContain('ERASURE_CERTIFICATE_MISMATCH')
        expect(data).toBeNull()

        // Original certificate remains unmodified
        const cert = await checked(
          adminClient
            .from('customer_erasure_records')
            .select('*')
            .eq('customer_id', custId)
            .eq('organization_id', orgA)
            .single()
        )
        expect(new Date(cert.erased_at).toISOString()).toBe(new Date(erasedAtTimestamp).toISOString())
      })

      it('20. failed erasure unit rolls back atomically after mid-transaction failure', async () => {
        // Step 1: Pre-mutation fail-closed verification (nonexistent customer)
        const fakeCustId = randomUUID()
        const { error: notFoundErr } = await adminClient.rpc('replay_customer_erasure_maintenance', {
          p_org_id: orgA,
          p_customer_id: fakeCustId,
          p_erased_at: new Date().toISOString(),
        })
        expect(notFoundErr).toBeDefined()
        expect(notFoundErr!.message).toContain('CUSTOMER_NOT_FOUND')

        // Verify zero certificate created for fake customer
        const fakeCerts = await checked(
          adminClient
            .from('customer_erasure_records')
            .select('*')
            .eq('customer_id', fakeCustId)
        )
        expect(fakeCerts.length).toBe(0)

        // Step 2: Real mid-transaction rollback proof
        // 1. Create a synthetic customer with PII, completion event with contact & external IDs,
        // review request with error message, and message event with sanitized error.
        const rollbackCust = await checked(
          adminClient
            .from('customers')
            .insert({
              organization_id: orgA,
              location_id: locA,
              first_name: 'Alice',
              last_name: 'Rollback',
              email: 'alice.rollback@example.com',
              phone: '+15551234567',
            })
            .select('id')
            .single()
        )
        const rollbackCustId = rollbackCust.id

        const rollbackSourceEventId = `rb-evt-${randomUUID().slice(0, 8)}`
        const completion = await checked(
          adminClient
            .from('customer_completion_events')
            .insert({
              organization_id: orgA,
              location_id: locA,
              customer_id: rollbackCustId,
              source: 'pos',
              source_event_id: rollbackSourceEventId,
              source_customer_id: 'src-cust-rollback-999',
              source_transaction_id: 'src-tx-rollback-888',
              contact: { email: 'alice.rollback@example.com', name: 'Alice Rollback' },
            })
            .select('id')
            .single()
        )

        const rr = await checked(
          adminClient
            .from('review_requests')
            .insert({
              organization_id: orgA,
              location_id: locA,
              customer_id: rollbackCustId,
              completion_event_id: completion.id,
              token: randomUUID(),
              token_hash: 'b'.repeat(64),
              status: 'FAILED',
              error_message: 'DISPATCH_ERROR: Provider timeout',
            })
            .select('id')
            .single()
        )

        await checked(
          adminClient.from('message_events').insert({
            organization_id: orgA,
            review_request_id: rr.id,
            provider: 'resend',
            status: 'FAILED',
            event_type: 'FAILED',
            sanitized_error: 'RATE_LIMIT_EXCEEDED',
          })
        )

        // 2. Install a TEMPORARY TEST-ONLY failure mechanism in local PostgreSQL:
        // A trigger on public.audit_events that raises a fixed exception only when
        // event_type = 'privacy.restore_replay_erasure'.
        // This causes replay_customer_erasure_maintenance to fail at step 9 (audit insert),
        // AFTER it has already attempted:
        // - erasure certificate insert;
        // - customer tombstone;
        // - completion contact/external-ID redaction;
        // - review error scrub;
        // - message error scrub.
        const installTriggerSql = `
          CREATE OR REPLACE FUNCTION public.test_fail_restore_replay_audit()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
              IF NEW.event_type = 'privacy.restore_replay_erasure' THEN
                  RAISE EXCEPTION 'TEST_INJECTED_AUDIT_FAILURE';
              END IF;
              RETURN NEW;
          END;
          $$;

          DROP TRIGGER IF EXISTS tr_test_fail_restore_replay_audit ON public.audit_events;
          CREATE TRIGGER tr_test_fail_restore_replay_audit
          BEFORE INSERT ON public.audit_events
          FOR EACH ROW
          EXECUTE FUNCTION public.test_fail_restore_replay_audit();
        `
        const removeTriggerSql = `
          DROP TRIGGER IF EXISTS tr_test_fail_restore_replay_audit ON public.audit_events;
          DROP FUNCTION IF EXISTS public.test_fail_restore_replay_audit();
        `

        executeDirectSql(installTriggerSql)

        try {
          // 3. Call replay_customer_erasure_maintenance. Require RPC to fail.
          const { data, error } = await adminClient.rpc('replay_customer_erasure_maintenance', {
            p_org_id: orgA,
            p_customer_id: rollbackCustId,
            p_erased_at: '2026-10-01T16:00:00.000Z',
          })

          expect(error).toBeDefined()
          expect(error!.message).toContain('TEST_INJECTED_AUDIT_FAILURE')
          expect(data).toBeNull()

          // 4. Verify PostgreSQL rolled back ALL earlier writes:
          // - customer still has original synthetic PII
          const custAfter = await checked(
            adminClient.from('customers').select('*').eq('id', rollbackCustId).single()
          )
          expect(custAfter.first_name).toBe('Alice')
          expect(custAfter.last_name).toBe('Rollback')
          expect(custAfter.email).toBe('alice.rollback@example.com')
          expect(custAfter.phone).toBe('+15551234567')

          // - completion contact remains original synthetic value
          // - source_customer_id remains original value
          // - source_transaction_id remains original value
          // - source_event_id remains unchanged
          const compAfter = await checked(
            adminClient.from('customer_completion_events').select('*').eq('id', completion.id).single()
          )
          expect(compAfter.contact).toEqual({ email: 'alice.rollback@example.com', name: 'Alice Rollback' })
          expect(compAfter.source_customer_id).toBe('src-cust-rollback-999')
          expect(compAfter.source_transaction_id).toBe('src-tx-rollback-888')
          expect(compAfter.source_event_id).toBe(rollbackSourceEventId)

          // - review_requests.error_message remains original synthetic value
          const rrAfter = await checked(
            adminClient.from('review_requests').select('*').eq('id', rr.id).single()
          )
          expect(rrAfter.error_message).toBe('DISPATCH_ERROR: Provider timeout')

          // - message_events.sanitized_error remains original synthetic value
          const meAfter = await checked(
            adminClient.from('message_events').select('*').eq('review_request_id', rr.id).single()
          )
          expect(meAfter.sanitized_error).toBe('RATE_LIMIT_EXCEEDED')

          // - NO customer_erasure_records certificate exists
          const certsAfter = await checked(
            adminClient.from('customer_erasure_records').select('*').eq('customer_id', rollbackCustId)
          )
          expect(certsAfter.length).toBe(0)

          // - NO restore replay audit event exists
          const auditsAfter = await checked(
            adminClient
              .from('audit_events')
              .select('*')
              .eq('organization_id', orgA)
              .eq('entity_id', rollbackCustId)
              .eq('event_type', 'privacy.restore_replay_erasure')
          )
          expect(auditsAfter.length).toBe(0)
        } finally {
          // 5. Remove the test trigger/function in cleanup/finally.
          executeDirectSql(removeTriggerSql)
        }
      })

      it('21. cross-tenant/mismatched customer fails closed', async () => {
        // custId belongs to orgA, try to replay under orgB
        const { error } = await adminClient.rpc('replay_customer_erasure_maintenance', {
          p_org_id: orgB,
          p_customer_id: custId,
          p_erased_at: new Date().toISOString(),
        })

        expect(error).toBeDefined()
        expect(error!.message).toContain('CUSTOMER_NOT_FOUND')
      })
    })

    // =========================================================================
    // SUPPRESSION INVARIANTS (22 - 30)
    // =========================================================================

    describe('Suppression Replay Invariants', () => {
      const emailHash = hashSuppressionContact('email', 'suppress.user@example.com')
      const smsHash = hashSuppressionContact('sms', '+15559998888')
      const suppressionCreatedAt = '2026-10-01T16:00:00.000Z'

      it('22. valid email suppression inserts', async () => {
        const { data, error } = await adminClient.rpc('replay_suppression_maintenance', {
          p_org_id: orgA,
          p_channel: 'email',
          p_contact_hash: emailHash,
          p_reason: 'UNSUBSCRIBE',
          p_created_at: suppressionCreatedAt,
        })

        expect(error).toBeNull()
        const res = data as { inserted: boolean; channel: string }
        expect(res.inserted).toBe(true)
        expect(res.channel).toBe('email')
      })

      it('23. valid SMS suppression inserts', async () => {
        const { data, error } = await adminClient.rpc('replay_suppression_maintenance', {
          p_org_id: orgA,
          p_channel: 'sms',
          p_contact_hash: smsHash,
          p_reason: 'STOP',
          p_created_at: suppressionCreatedAt,
        })

        expect(error).toBeNull()
        const res = data as { inserted: boolean; channel: string }
        expect(res.inserted).toBe(true)
        expect(res.channel).toBe('sms')
      })

      it('24. duplicate suppression replay does not duplicate', async () => {
        const { data, error } = await adminClient.rpc('replay_suppression_maintenance', {
          p_org_id: orgA,
          p_channel: 'email',
          p_contact_hash: emailHash,
          p_reason: 'UNSUBSCRIBE',
          p_created_at: suppressionCreatedAt,
        })

        expect(error).toBeNull()
        const res = data as { inserted: boolean }
        expect(res.inserted).toBe(false)

        const records = await checked(
          adminClient
            .from('suppressions')
            .select('*')
            .eq('organization_id', orgA)
            .eq('channel', 'email')
            .eq('contact_hash', emailHash)
        )
        expect(records.length).toBe(1)
      })

      it('25. empty reason rejected', async () => {
        const { error } = await adminClient.rpc('replay_suppression_maintenance', {
          p_org_id: orgA,
          p_channel: 'email',
          p_contact_hash: hashSuppressionContact('email', 'empty.reason@example.com'),
          p_reason: '',
          p_created_at: suppressionCreatedAt,
        })

        expect(error).toBeDefined()
        expect(error!.message).toContain('DENIED: Invalid reason')
      })

      it('26. whitespace-only reason rejected', async () => {
        const { error } = await adminClient.rpc('replay_suppression_maintenance', {
          p_org_id: orgA,
          p_channel: 'email',
          p_contact_hash: hashSuppressionContact('email', 'space.reason@example.com'),
          p_reason: '   ',
          p_created_at: suppressionCreatedAt,
        })

        expect(error).toBeDefined()
        expect(error!.message).toContain('DENIED: Invalid reason')
      })

      it('27. invalid channel rejected', async () => {
        const { error } = await adminClient.rpc('replay_suppression_maintenance', {
          p_org_id: orgA,
          p_channel: 'push',
          p_contact_hash: hashSuppressionContact('email', 'push.chan@example.com'),
          p_reason: 'UNSUBSCRIBE',
          p_created_at: suppressionCreatedAt,
        })

        expect(error).toBeDefined()
        expect(error!.message).toContain('DENIED: Invalid channel')
      })

      it('28. invalid hash rejected', async () => {
        const { error } = await adminClient.rpc('replay_suppression_maintenance', {
          p_org_id: orgA,
          p_channel: 'email',
          p_contact_hash: 'not-a-valid-sha256-hex-hash',
          p_reason: 'UNSUBSCRIBE',
          p_created_at: suppressionCreatedAt,
        })

        expect(error).toBeDefined()
        expect(error!.message).toContain('DENIED: Invalid contact hash')
      })

      it('29. nonexistent organization rejected', async () => {
        const fakeOrg = randomUUID()
        const { error } = await adminClient.rpc('replay_suppression_maintenance', {
          p_org_id: fakeOrg,
          p_channel: 'email',
          p_contact_hash: hashSuppressionContact('email', 'fake.org@example.com'),
          p_reason: 'UNSUBSCRIBE',
          p_created_at: suppressionCreatedAt,
        })

        expect(error).toBeDefined()
        expect(error!.message).toContain('ORGANIZATION_NOT_FOUND')
      })

      it('30. created_at and reason preserved on new insert', async () => {
        const specificHash = hashSuppressionContact('email', 'specific.user@example.com')
        const specificCreatedAt = '2026-10-01T17:45:00.000Z'
        const specificReason = 'USER_PREFERENCE_UPDATE'

        await adminClient.rpc('replay_suppression_maintenance', {
          p_org_id: orgA,
          p_channel: 'email',
          p_contact_hash: specificHash,
          p_reason: specificReason,
          p_created_at: specificCreatedAt,
        })

        const record = await checked(
          adminClient
            .from('suppressions')
            .select('*')
            .eq('organization_id', orgA)
            .eq('channel', 'email')
            .eq('contact_hash', specificHash)
            .single()
        )

        expect(record.reason).toBe(specificReason)
        expect(new Date(record.created_at).toISOString()).toBe(new Date(specificCreatedAt).toISOString())
      })
    })

    // =========================================================================
    // FINAL GATE: REPLAY FOLLOWED BY VERIFICATION (31 & 32)
    // =========================================================================

    describe('Final Restore Gate End-to-End', () => {
      it('31. replay followed by verifyRestoredPrivacyState() returns PASS for a valid restored-state fixture', async () => {
        // Setup: Create a customer that was erased after backup
        const customer = await checked(
          adminClient
            .from('customers')
            .insert({
              organization_id: orgA,
              location_id: locA,
              first_name: 'Resurrected',
              last_name: 'Customer',
              email: 'resurrected@example.com',
              phone: '+15550001111',
            })
            .select('id')
            .single()
        )

        const compEventId = `comp-${randomUUID().slice(0, 8)}`
        await checked(
          adminClient.from('customer_completion_events').insert({
            organization_id: orgA,
            location_id: locA,
            customer_id: customer.id,
            source: 'crm',
            source_event_id: compEventId,
            source_customer_id: 'cust-raw-1',
            source_transaction_id: 'tx-raw-1',
            contact: { email: 'resurrected@example.com' },
          })
        )

        const testSuppressionHash = hashSuppressionContact('email', 'resurrected.suppress@example.com')

        const validDelta: PrivacyRestoreDeltaV1 = {
          schemaVersion: '1.0',
          backupCreatedAt: '2026-10-01T00:00:00.000Z',
          exportedAt: '2026-10-02T00:00:00.000Z',
          erasures: [
            {
              organizationId: orgA,
              customerId: customer.id,
              erasedAt: '2026-10-01T12:00:00.000Z',
            },
          ],
          suppressions: [
            {
              organizationId: orgA,
              channel: 'email',
              contactHash: testSuppressionHash,
              reason: 'UNSUBSCRIBE',
              createdAt: '2026-10-01T14:00:00.000Z',
            },
          ],
        }

        // Before replay: verifier detects resurrected PII / missing protections
        const preVerification = await verifyRestoredPrivacyState({
          supabase: adminClient,
          delta: validDelta,
        })
        expect(preVerification.ok).toBe(false)
        expect(preVerification.decision).toBe('BLOCK_RESTORE_ACTIVATION')

        // Execute replay engine
        const replayResult = await replayPrivacyRestoreDelta({
          supabase: adminClient,
          delta: validDelta,
        })

        expect(replayResult.ok).toBe(true)
        expect(replayResult.decision).toBe('PASS')
        expect(replayResult.reason).toBe('ALL_REPLAYED_AND_VERIFIED')
        expect(replayResult.erasuresReplayed).toBe(1)
        expect(replayResult.suppressionsInserted).toBe(1)
        expect(replayResult.verification.ok).toBe(true)
        expect(replayResult.verification.decision).toBe('PASS')
      })

      it('32. an unreconciled state returns BLOCK_RESTORE_ACTIVATION', async () => {
        // Create an un-reconciled customer in a delta that is NOT replayed
        const unrecCustomer = await checked(
          adminClient
            .from('customers')
            .insert({
              organization_id: orgA,
              location_id: locA,
              first_name: 'Unreconciled',
              last_name: 'Person',
              email: 'unreconciled@example.com',
            })
            .select('id')
            .single()
        )

        const unrecDelta: PrivacyRestoreDeltaV1 = {
          schemaVersion: '1.0',
          backupCreatedAt: '2026-10-01T00:00:00.000Z',
          exportedAt: '2026-10-02T00:00:00.000Z',
          erasures: [
            {
              organizationId: orgA,
              customerId: unrecCustomer.id,
              erasedAt: '2026-10-01T12:00:00.000Z',
            },
          ],
          suppressions: [],
        }

        // Running verifier directly on unreconciled customer must fail closed
        const verification = await verifyRestoredPrivacyState({
          supabase: adminClient,
          delta: unrecDelta,
        })

        expect(verification.ok).toBe(false)
        expect(verification.decision).toBe('BLOCK_RESTORE_ACTIVATION')
        expect(verification.missingErasureProtections).toBeGreaterThan(0)
      })
    })
  }
)
