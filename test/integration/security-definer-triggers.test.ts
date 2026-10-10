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

  describe('2. Normal Database Trigger Execution Remains Functional', () => {
    it('executes broadcast_customer_completion trigger on customer completion insert', async () => {
      const { data, error } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: customerAId,
          source: 'crm',
          source_event_id: `sec-comp-trg-${Date.now()}`,
          contact: { email: 'sec_test_trg@example.test' },
        })
        .select()
        .single()

      expect(error).toBeNull()
      expect(data).toBeDefined()
      expect(data?.id).toBeDefined()
    })

    it('executes broadcast_audit_checking and broadcast_audit_ineligible triggers on audit_events insert', async () => {
      const { data: auditChecking, error: errChecking } = await adminClient
        .from('audit_events')
        .insert({
          organization_id: orgAId,
          actor_type: 'system',
          event_type: 'eligibility.checked',
          entity_type: 'customer',
          entity_id: customerAId,
          metadata: { decision: 'CHECKING' },
        })
        .select()
        .single()

      expect(errChecking).toBeNull()
      expect(auditChecking?.id).toBeDefined()

      const { data: auditIneligible, error: errIneligible } = await adminClient
        .from('audit_events')
        .insert({
          organization_id: orgAId,
          actor_type: 'system',
          event_type: 'eligibility.checked',
          entity_type: 'customer',
          entity_id: customerAId,
          metadata: { decision: 'INELIGIBLE', reason: 'RECENT_REQUEST' },
        })
        .select()
        .single()

      expect(errIneligible).toBeNull()
      expect(auditIneligible?.id).toBeDefined()
    })

    it('executes broadcast_audit_entitlement_blocked trigger on entitlement audit insert', async () => {
      const { data: auditBlocked, error: errBlocked } = await adminClient
        .from('audit_events')
        .insert({
          organization_id: orgAId,
          actor_type: 'system',
          event_type: 'billing.entitlement_blocked',
          entity_type: 'organization',
          entity_id: orgAId,
          metadata: { reason: 'TRIAL_EXPIRED' },
        })
        .select()
        .single()

      expect(errBlocked).toBeNull()
      expect(auditBlocked?.id).toBeDefined()
    })

    it('executes broadcast_review_request_change trigger on review_requests insert and update', async () => {
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

      const { data: rrUpdated, error: updateErr } = await adminClient
        .from('review_requests')
        .update({ status: 'SENT' })
        .eq('id', rr!.id)
        .select()
        .single()

      expect(updateErr).toBeNull()
      expect(rrUpdated?.status).toBe('SENT')
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
})
