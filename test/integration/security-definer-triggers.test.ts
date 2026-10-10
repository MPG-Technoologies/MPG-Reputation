import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'child_process'
import type { Database } from '../../src/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_anon_key'

const isDbAvailable = !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'dummy_service_role_key'

function executeDirectSql(sql: string): string {
  try {
    return execSync('docker exec -i supabase_db_MPG-Reputation psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A', {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (err: unknown) {
    const errorWithStderr = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
    const stderr = errorWithStderr.stderr ? errorWithStderr.stderr.toString() : ''
    const stdout = errorWithStderr.stdout ? errorWithStderr.stdout.toString() : ''
    const msg = stderr || stdout || errorWithStderr.message || ''
    if (msg.includes('permission denied') || msg.includes('ERROR:')) {
      throw new Error(msg)
    }
    try {
      return execSync('pnpm dlx supabase@2.117.0 db query --local', {
        input: sql,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (cliErr: unknown) {
      const cliError = cliErr as { stderr?: Buffer | string; message?: string }
      const cliStderr = cliError.stderr ? cliError.stderr.toString() : ''
      throw new Error(cliStderr || cliError.message || msg)
    }
  }
}

function checkFunctionPrivilegeDirect(role: string, func: string, privilege = 'EXECUTE'): boolean {
  const sql = `SELECT has_function_privilege('${role}', '${func}', '${privilege}');`
  const result = executeDirectSql(sql).trim()
  return result === 't' || result === 'true'
}

function getLatestRealtimeBroadcast(topic: string, event: string): { payload: Record<string, unknown> } | null {
  const sql = `SELECT payload::text FROM realtime.messages WHERE topic = '${topic}' AND event = '${event}' ORDER BY inserted_at DESC LIMIT 1;`
  const result = executeDirectSql(sql).trim()
  if (!result) return null
  try {
    return { payload: JSON.parse(result) as Record<string, unknown> }
  } catch {
    return null
  }
}

describe.skipIf(!isDbAvailable)('Security Definer Realtime Broadcast Trigger Privileges & Hardening', () => {
  let adminClient: ReturnType<typeof createClient<Database>>
  let userAClient: ReturnType<typeof createClient<Database>>
  let userBClient: ReturnType<typeof createClient<Database>>

  let userAId: string
  let userBId: string
  let orgAId: string
  let orgBId: string
  let locAId: string
  let locBId: string
  let customerAId: string
  let customerBId: string
  let cceAId: string
  let cceBId: string

  const targetFunctions = [
    'public.broadcast_audit_checking()',
    'public.broadcast_audit_entitlement_blocked()',
    'public.broadcast_audit_ineligible()',
    'public.broadcast_customer_completion()',
    'public.broadcast_review_request_change()',
  ]

  const privacyTriggerFunctions = [
    'public.protect_recipient_evidence_immutability()',
    'public.protect_erased_customer_immutability()',
  ]

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const timestamp = Date.now()
    const emailA = `sec_user_a_${timestamp}@test.local`
    const emailB = `sec_user_b_${timestamp}@test.local`

    const { data: uA, error: errA } = await adminClient.auth.admin.createUser({
      email: emailA,
      password: 'Password123!',
      email_confirm: true,
    })
    if (errA || !uA.user) throw new Error(`Failed to create test user A: ${errA?.message}`)
    userAId = uA.user.id

    const { data: uB, error: errB } = await adminClient.auth.admin.createUser({
      email: emailB,
      password: 'Password123!',
      email_confirm: true,
    })
    if (errB || !uB.user) throw new Error(`Failed to create test user B: ${errB?.message}`)
    userBId = uB.user.id

    // Setup Organizations
    const { data: oA, error: oAErr } = await adminClient
      .from('organizations')
      .insert({ name: `Org Sec A ${timestamp}`, slug: `org-sec-a-${timestamp}` })
      .select()
      .single()
    if (oAErr || !oA) throw new Error(`Failed to create Org A: ${oAErr?.message}`)
    orgAId = oA.id

    const { data: oB, error: oBErr } = await adminClient
      .from('organizations')
      .insert({ name: `Org Sec B ${timestamp}`, slug: `org-sec-b-${timestamp}` })
      .select()
      .single()
    if (oBErr || !oB) throw new Error(`Failed to create Org B: ${oBErr?.message}`)
    orgBId = oB.id

    // Setup Locations
    const { data: locA } = await adminClient
      .from('locations')
      .insert({ organization_id: orgAId, name: 'Main Clinic A' })
      .select()
      .single()
    locAId = locA!.id

    const { data: locB } = await adminClient
      .from('locations')
      .insert({ organization_id: orgBId, name: 'Main Clinic B' })
      .select()
      .single()
    locBId = locB!.id

    // Membership
    await adminClient.from('organization_users').insert([
      { organization_id: orgAId, user_id: userAId, role: 'OWNER' },
      { organization_id: orgBId, user_id: userBId, role: 'OWNER' },
    ])

    // Customers
    const { data: cA, error: cAErr } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgAId,
        location_id: locAId,
        first_name: 'CustomerSecA',
        email: `c_a_${timestamp}@example.test`,
      })
      .select()
      .single()
    if (cAErr || !cA) throw new Error(`Failed to create customer A: ${cAErr?.message}`)
    customerAId = cA.id

    const { data: cB, error: cBErr } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgBId,
        location_id: locBId,
        first_name: 'CustomerSecB',
        email: `c_b_${timestamp}@example.test`,
      })
      .select()
      .single()
    if (cBErr || !cB) throw new Error(`Failed to create customer B: ${cBErr?.message}`)
    customerBId = cB.id

    // Customer completions (baseline)
    const { data: initCceA } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgAId,
        location_id: locAId,
        customer_id: customerAId,
        source: 'crm',
        source_event_id: `sec-comp-init-a-${timestamp}`,
        contact: { email: `c_a_${timestamp}@example.test` },
      })
      .select()
      .single()
    cceAId = initCceA!.id

    const { data: initCceB } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgBId,
        location_id: locBId,
        customer_id: customerBId,
        source: 'crm',
        source_event_id: `sec-comp-init-b-${timestamp}`,
        contact: { email: `c_b_${timestamp}@example.test` },
      })
      .select()
      .single()
    cceBId = initCceB!.id

    // User clients
    userAClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: sAErr } = await userAClient.auth.signInWithPassword({
      email: emailA,
      password: 'Password123!',
    })
    if (sAErr) throw new Error(`Sign in user A failed: ${sAErr.message}`)

    userBClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: sBErr } = await userBClient.auth.signInWithPassword({
      email: emailB,
      password: 'Password123!',
    })
    if (sBErr) throw new Error(`Sign in user B failed: ${sBErr.message}`)
  })

  afterAll(async () => {
    if (orgAId) await adminClient.from('organizations').delete().eq('id', orgAId)
    if (orgBId) await adminClient.from('organizations').delete().eq('id', orgBId)
    if (userAId) await adminClient.auth.admin.deleteUser(userAId)
    if (userBId) await adminClient.auth.admin.deleteUser(userBId)
  })

  describe('1. Direct Function Privilege Verification (Migration #24)', () => {
    it.each(targetFunctions)(
      'proves anon role has no direct EXECUTE privilege on %s',
      (func) => {
        const hasPriv = checkFunctionPrivilegeDirect('anon', func, 'EXECUTE')
        expect(hasPriv).toBe(false)
      }
    )

    it.each(targetFunctions)(
      'proves authenticated role has no direct EXECUTE privilege on %s',
      (func) => {
        const hasPriv = checkFunctionPrivilegeDirect('authenticated', func, 'EXECUTE')
        expect(hasPriv).toBe(false)
      }
    )

    it.each(targetFunctions)(
      'proves public pseudo-role has no direct EXECUTE privilege on %s',
      (func) => {
        const hasPriv = checkFunctionPrivilegeDirect('public', func, 'EXECUTE')
        expect(hasPriv).toBe(false)
      }
    )

    it.each(targetFunctions)(
      'proves direct SQL call as anon fails with permission denied on %s',
      (func) => {
        expect(() => {
          executeDirectSql(`SET ROLE anon; SELECT ${func};`)
        }).toThrow(/permission denied/)
      }
    )

    it.each(targetFunctions)(
      'proves direct SQL call as authenticated fails with permission denied on %s',
      (func) => {
        expect(() => {
          executeDirectSql(`SET ROLE authenticated; SELECT ${func};`)
        }).toThrow(/permission denied/)
      }
    )
  })

  describe('2. Normal Database Trigger Execution Remains Functional and Emits Broadcasts', () => {
    it('executes broadcast_customer_completion trigger on customer completion insert and emits realtime message', async () => {
      const sourceEventId = `sec-comp-trg-${Date.now()}`
      const { data, error } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: customerAId,
          source: 'crm',
          source_event_id: sourceEventId,
          contact: { email: 'sec_test_trg@example.test' },
        })
        .select()
        .single()

      expect(error).toBeNull()
      expect(data).toBeDefined()
      expect(data?.id).toBeDefined()

      const broadcast = getLatestRealtimeBroadcast(`organization:${orgAId}:dashboard`, 'customer.completed')
      expect(broadcast).not.toBeNull()
      expect(broadcast?.payload.type).toBe('customer.completed')
      expect(broadcast?.payload.completionEventId).toBe(data!.id)
      expect(broadcast?.payload.organizationId).toBe(orgAId)
    })

    it('executes broadcast_audit_checking trigger on review_request.checking insert and emits realtime message', async () => {
      const { data: auditChecking, error: errChecking } = await adminClient
        .from('audit_events')
        .insert({
          organization_id: orgAId,
          actor_type: 'system',
          event_type: 'review_request.checking',
          entity_type: 'customer_completion_event',
          entity_id: cceAId,
          metadata: { completionEventId: cceAId },
        })
        .select()
        .single()

      expect(errChecking).toBeNull()
      expect(auditChecking?.id).toBeDefined()

      const broadcast = getLatestRealtimeBroadcast(`organization:${orgAId}:dashboard`, 'review_request.checking')
      expect(broadcast).not.toBeNull()
      expect(broadcast?.payload.type).toBe('review_request.checking')
      expect(broadcast?.payload.organizationId).toBe(orgAId)
      expect(broadcast?.payload.completionEventId).toBe(cceAId)
    })

    it('executes broadcast_audit_ineligible trigger on review_request.ineligible insert and emits realtime message', async () => {
      const { data: auditIneligible, error: errIneligible } = await adminClient
        .from('audit_events')
        .insert({
          organization_id: orgAId,
          actor_type: 'system',
          event_type: 'review_request.ineligible',
          entity_type: 'customer_completion_event',
          entity_id: cceAId,
          metadata: { completionEventId: cceAId, reason: 'RECENT_REQUEST' },
        })
        .select()
        .single()

      expect(errIneligible).toBeNull()
      expect(auditIneligible?.id).toBeDefined()

      const broadcast = getLatestRealtimeBroadcast(`organization:${orgAId}:dashboard`, 'review_request.ineligible')
      expect(broadcast).not.toBeNull()
      expect(broadcast?.payload.type).toBe('review_request.ineligible')
      expect(broadcast?.payload.organizationId).toBe(orgAId)
      expect(broadcast?.payload.completionEventId).toBe(cceAId)
    })

    it('executes broadcast_audit_entitlement_blocked trigger on review_request.blocked_by_entitlement insert and emits realtime message', async () => {
      const { data: auditBlocked, error: errBlocked } = await adminClient
        .from('audit_events')
        .insert({
          organization_id: orgAId,
          actor_type: 'system',
          event_type: 'review_request.blocked_by_entitlement',
          entity_type: 'customer_completion_event',
          entity_id: cceAId,
          metadata: { completionEventId: cceAId, reason: 'TRIAL_EXPIRED' },
        })
        .select()
        .single()

      expect(errBlocked).toBeNull()
      expect(auditBlocked?.id).toBeDefined()

      const broadcast = getLatestRealtimeBroadcast(`organization:${orgAId}:dashboard`, 'review_request.blocked_by_entitlement')
      expect(broadcast).not.toBeNull()
      expect(broadcast?.payload.type).toBe('review_request.blocked_by_entitlement')
      expect(broadcast?.payload.organizationId).toBe(orgAId)
      expect(broadcast?.payload.completionEventId).toBe(cceAId)
      expect(broadcast?.payload.reason).toBe('TRIAL_EXPIRED')
    })

    it('executes broadcast_review_request_change trigger on review_requests insert and update and emits realtime messages', async () => {
      const token = `tok_sec_trg_${Date.now()}`
      const { data: rr, error: rrErr } = await adminClient
        .from('review_requests')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: customerAId,
          completion_event_id: cceAId,
          token: token,
          token_hash: `hash_${token}`,
          status: 'SCHEDULED',
        })
        .select()
        .single()

      expect(rrErr).toBeNull()
      expect(rr?.id).toBeDefined()

      const broadcastCreated = getLatestRealtimeBroadcast(`organization:${orgAId}:dashboard`, 'review_request.created')
      expect(broadcastCreated).not.toBeNull()
      expect(broadcastCreated?.payload.type).toBe('review_request.created')
      expect(broadcastCreated?.payload.requestId).toBe(rr!.id)
      expect(broadcastCreated?.payload.organizationId).toBe(orgAId)

      const { data: rrUpdated, error: updateErr } = await adminClient
        .from('review_requests')
        .update({ status: 'SENT' })
        .eq('id', rr!.id)
        .select()
        .single()

      expect(updateErr).toBeNull()
      expect(rrUpdated?.status).toBe('SENT')

      const broadcastUpdated = getLatestRealtimeBroadcast(`organization:${orgAId}:dashboard`, 'review_request.updated')
      expect(broadcastUpdated).not.toBeNull()
      expect(broadcastUpdated?.payload.type).toBe('review_request.updated')
      expect(broadcastUpdated?.payload.requestId).toBe(rr!.id)
      expect(broadcastUpdated?.payload.status).toBe('SENT')
    })
  })

  describe('3. Tenant Isolation Remains Strictly Enforced', () => {
    it('proves User A cannot select audit events belonging to Org B', async () => {
      await adminClient.from('audit_events').insert({
        organization_id: orgBId,
        actor_type: 'system',
        event_type: 'test.tenant_isolation',
        entity_type: 'customer',
        entity_id: customerBId,
        metadata: { secret: 'org_b_secret' },
      })

      const { data: userAReads, error } = await userAClient
        .from('audit_events')
        .select('*')
        .eq('organization_id', orgBId)

      expect(error).toBeNull()
      expect(userAReads).toHaveLength(0)
    })

    it('proves User A cannot select review requests belonging to Org B', async () => {
      const tokenB = `tok_sec_b_${Date.now()}`
      await adminClient.from('review_requests').insert({
        organization_id: orgBId,
        location_id: locBId,
        customer_id: customerBId,
        completion_event_id: cceBId,
        token: tokenB,
        token_hash: `hash_${tokenB}`,
        status: 'SCHEDULED',
      })

      const { data: userAReads, error } = await userAClient
        .from('review_requests')
        .select('*')
        .eq('organization_id', orgBId)

      expect(error).toBeNull()
      expect(userAReads).toHaveLength(0)
    })

    it('proves User A cannot select customer completion events belonging to Org B', async () => {
      const { data: userAReads, error } = await userAClient
        .from('customer_completion_events')
        .select('*')
        .eq('organization_id', orgBId)

      expect(error).toBeNull()
      expect(userAReads).toHaveLength(0)
    })
  })

  describe('4. Privacy Lifecycle Trigger Hardening & Verification (Migration #25)', () => {
    it.each(privacyTriggerFunctions)(
      'proves anon role has no direct EXECUTE privilege on %s',
      (func) => {
        const hasPriv = checkFunctionPrivilegeDirect('anon', func, 'EXECUTE')
        expect(hasPriv).toBe(false)
      }
    )

    it.each(privacyTriggerFunctions)(
      'proves authenticated role has no direct EXECUTE privilege on %s',
      (func) => {
        const hasPriv = checkFunctionPrivilegeDirect('authenticated', func, 'EXECUTE')
        expect(hasPriv).toBe(false)
      }
    )

    it.each(privacyTriggerFunctions)(
      'proves public pseudo-role has no direct EXECUTE privilege on %s',
      (func) => {
        const hasPriv = checkFunctionPrivilegeDirect('public', func, 'EXECUTE')
        expect(hasPriv).toBe(false)
      }
    )

    it.each(privacyTriggerFunctions)(
      'proves direct SQL call as anon fails with permission denied on %s',
      (func) => {
        expect(() => {
          executeDirectSql(`SET ROLE anon; SELECT ${func};`)
        }).toThrow(/permission denied/)
      }
    )

    it.each(privacyTriggerFunctions)(
      'proves direct SQL call as authenticated fails with permission denied on %s',
      (func) => {
        expect(() => {
          executeDirectSql(`SET ROLE authenticated; SELECT ${func};`)
        }).toThrow(/permission denied/)
      }
    )

    it('verifies protect_recipient_evidence_immutability has explicit search_path = public, pg_temp in proconfig', () => {
      const sql = `SELECT proconfig::text FROM pg_proc WHERE proname = 'protect_recipient_evidence_immutability';`
      const result = executeDirectSql(sql).trim()
      expect(result).toContain('search_path=public, pg_temp')
    })

    it('verifies protect_erased_customer_immutability has explicit search_path = public, pg_temp in proconfig', () => {
      const sql = `SELECT proconfig::text FROM pg_proc WHERE proname = 'protect_erased_customer_immutability';`
      const result = executeDirectSql(sql).trim()
      expect(result).toContain('search_path=public, pg_temp')
    })

    it('proves trg_protect_recipient_evidence_immutability blocks changing suppression_contact_hash A -> B but permits idempotent A -> A', async () => {
      const { data: newCce, error: cceErr } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: customerAId,
          source: 'crm',
          source_event_id: `sec-imm-cce-${Date.now()}`,
          contact: { email: `imm_test_${Date.now()}@example.test` },
        })
        .select()
        .single()
      expect(cceErr).toBeNull()

      const token = `tok_imm_${Date.now()}`
      const { data: rr, error: rrErr } = await adminClient
        .from('review_requests')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: customerAId,
          completion_event_id: newCce!.id,
          token,
          token_hash: `hash_${token}`,
          status: 'SCHEDULED',
        })
        .select()
        .single()
      expect(rrErr).toBeNull()

      const hashA = 'a'.repeat(64)
      const hashB = 'b'.repeat(64)

      const { data: evidence, error: evErr } = await adminClient
        .from('review_request_recipient_evidence')
        .insert({
          organization_id: orgAId,
          review_request_id: rr!.id,
          channel: 'email',
          suppression_contact_hash: hashA,
        })
        .select()
        .single()
      expect(evErr).toBeNull()

      // Attempting to update hash to hashB should throw from trigger
      const attemptHashUpdate = () => {
        executeDirectSql(`
          UPDATE public.review_request_recipient_evidence
          SET suppression_contact_hash = '${hashB}'
          WHERE id = '${evidence!.id}';
        `)
      }
      expect(attemptHashUpdate).toThrow(/Recipient suppression contact hash is immutable once bound/)

      // Updating with same hash (idempotent) must succeed
      executeDirectSql(`
        UPDATE public.review_request_recipient_evidence
        SET suppression_contact_hash = '${hashA}'
        WHERE id = '${evidence!.id}';
      `)
      const { data: evidenceAfter } = await adminClient
        .from('review_request_recipient_evidence')
        .select('suppression_contact_hash')
        .eq('id', evidence!.id)
        .single()
      expect(evidenceAfter?.suppression_contact_hash).toBe(hashA)
    })

    it('proves trg_protect_erased_customer_immutability blocks restoring PII onto an erased customer while non-erased customer updates succeed', async () => {
      // 1. Mark customer A as erased in customer_erasure_records
      await adminClient.from('customer_erasure_records').insert({
        organization_id: orgAId,
        customer_id: customerAId,
        actor_type: 'system',
      })

      // Anonymize customer A initially
      await adminClient
        .from('customers')
        .update({
          first_name: '[Deleted Customer]',
          last_name: null,
          email: null,
          phone: null,
        })
        .eq('id', customerAId)

      // Attempting to restore email on erased customer A must throw
      const attemptRestoreEmail = () => {
        executeDirectSql(`
          UPDATE public.customers
          SET email = 'restored@example.test'
          WHERE id = '${customerAId}';
        `)
      }
      expect(attemptRestoreEmail).toThrow(/Customer is privacy-erased and cannot have PII restored/)

      // Updating non-erased customer B must succeed without trigger errors
      const newLastName = `Updated_${Date.now()}`
      const { error: nonErasedUpdateErr } = await adminClient
        .from('customers')
        .update({ last_name: newLastName })
        .eq('id', customerBId)
      expect(nonErasedUpdateErr).toBeNull()

      const { data: custB } = await adminClient
        .from('customers')
        .select('last_name')
        .eq('id', customerBId)
        .single()
      expect(custB?.last_name).toBe(newLastName)
    })
  })
})
