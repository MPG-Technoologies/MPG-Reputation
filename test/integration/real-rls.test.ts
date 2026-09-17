import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_anon_key'

// Skip real Postgres RLS integration tests if local Supabase instance is not running
const isDbAvailable = !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'dummy_service_role_key'

describe.skipIf(!isDbAvailable)('Real PostgreSQL RLS and Multi-Tenant Isolation', () => {
  let adminClient: ReturnType<typeof createClient<Database>>
  let userAClient: ReturnType<typeof createClient<Database>>
  let userBClient: ReturnType<typeof createClient<Database>>
  let viewerClient: ReturnType<typeof createClient<Database>>
  let operatorClient: ReturnType<typeof createClient<Database>>
  let adminUserClient: ReturnType<typeof createClient<Database>>

  let userAId: string
  let userBId: string
  let userViewerId: string
  let userOperatorId: string
  let adminUserId: string

  let orgAId: string
  let orgBId: string
  let locAId: string
  let locBId: string

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const timestamp = Date.now()
    const emailA = `usera_${timestamp}@test.local`
    const emailB = `userb_${timestamp}@test.local`
    const emailV = `viewer_${timestamp}@test.local`
    const emailO = `operator_${timestamp}@test.local`
    const emailAdmin = `admin_${timestamp}@test.local`

    // 1. Create test users
    const { data: uA, error: errA } = await adminClient.auth.admin.createUser({
      email: emailA,
      password: 'Password123!',
      email_confirm: true,
    })
    if (errA || !uA.user) throw new Error(`Failed to create user A: ${errA?.message}`)
    userAId = uA.user.id

    const { data: uB, error: errB } = await adminClient.auth.admin.createUser({
      email: emailB,
      password: 'Password123!',
      email_confirm: true,
    })
    if (errB || !uB.user) throw new Error(`Failed to create user B: ${errB?.message}`)
    userBId = uB.user.id

    const { data: uV, error: errV } = await adminClient.auth.admin.createUser({
      email: emailV,
      password: 'Password123!',
      email_confirm: true,
    })
    if (errV || !uV.user) throw new Error(`Failed to create viewer: ${errV?.message}`)
    userViewerId = uV.user.id

    const { data: uO, error: errO } = await adminClient.auth.admin.createUser({
      email: emailO,
      password: 'Password123!',
      email_confirm: true,
    })
    if (errO || !uO.user) throw new Error(`Failed to create operator: ${errO?.message}`)
    userOperatorId = uO.user.id

    const { data: uAdmin, error: errAdmin } = await adminClient.auth.admin.createUser({
      email: emailAdmin,
      password: "Password123!",
      email_confirm: true,
    })
    if (errAdmin || !uAdmin.user) throw new Error(`Failed to create admin user: ${errAdmin?.message}`)
    adminUserId = uAdmin.user.id

    // 2. Initialize authenticated clients
    userAClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signErrA } = await userAClient.auth.signInWithPassword({
      email: emailA,
      password: 'Password123!',
    })
    if (signErrA) throw new Error(`User A signin failed: ${signErrA.message}`)

    userBClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signErrB } = await userBClient.auth.signInWithPassword({
      email: emailB,
      password: 'Password123!',
    })
    if (signErrB) throw new Error(`User B signin failed: ${signErrB.message}`)

    viewerClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signErrV } = await viewerClient.auth.signInWithPassword({
      email: emailV,
      password: 'Password123!',
    })
    if (signErrV) throw new Error(`Viewer signin failed: ${signErrV.message}`)

    operatorClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signErrO } = await operatorClient.auth.signInWithPassword({
      email: emailO,
      password: 'Password123!',
    })
    if (signErrO) throw new Error(`Operator signin failed: ${signErrO.message}`)

    adminUserClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signErrAdmin } = await adminUserClient.auth.signInWithPassword({
      email: emailAdmin,
      password: "Password123!",
    })
    if (signErrAdmin) throw new Error(`Admin user signin failed: ${signErrAdmin.message}`)

    // 3. Create Org A with User A as OWNER via atomic onboarding RPC
    const { data: resA, error: rpcErrA } = await userAClient.rpc('create_org_with_owner_and_location', {
      p_org_name: `Northstar Dental ${Date.now()}`,
      p_slug: `northstar-${Date.now()}`,
      p_loc_name: 'Main Clinic',
      p_address: '100 Medical Plaza',
    })
    if (rpcErrA || !resA) throw new Error(`Failed to onboard Org A: ${rpcErrA?.message}`)
    const parsedA = resA as { organization_id: string; location_id: string }
    orgAId = parsedA.organization_id
    locAId = parsedA.location_id

    // 4. Create Org B with User B as OWNER via atomic onboarding RPC
    const { data: resB, error: rpcErrB } = await userBClient.rpc('create_org_with_owner_and_location', {
      p_org_name: `Beacon Health ${Date.now()}`,
      p_slug: `beacon-${Date.now()}`,
      p_loc_name: 'West Branch',
      p_address: '200 Wellness Way',
    })
    if (rpcErrB || !resB) throw new Error(`Failed to onboard Org B: ${rpcErrB?.message}`)
    const parsedB = resB as { organization_id: string; location_id: string }
    orgBId = parsedB.organization_id
    locBId = parsedB.location_id

    // 5. Add VIEWER and OPERATOR to Org A
    await adminClient.from('organization_users').insert([
      { organization_id: orgAId, user_id: adminUserId, role: 'ADMIN' },
      { organization_id: orgAId, user_id: userViewerId, role: 'VIEWER' },
      { organization_id: orgAId, user_id: userOperatorId, role: 'OPERATOR' },
    ])
  })

  afterAll(async () => {
    if (adminClient) {
      if (orgAId) await adminClient.from('organizations').delete().eq('id', orgAId)
      if (orgBId) await adminClient.from('organizations').delete().eq('id', orgBId)
      if (userAId) await adminClient.auth.admin.deleteUser(userAId)
      if (userBId) await adminClient.auth.admin.deleteUser(userBId)
      if (userViewerId) await adminClient.auth.admin.deleteUser(userViewerId)
      if (userOperatorId) await adminClient.auth.admin.deleteUser(userOperatorId)
      if (adminUserId) await adminClient.auth.admin.deleteUser(adminUserId)
    }
  })

  it('proves User A cannot SELECT Org B or Location B rows', async () => {
    // Attempt to select Org B
    const { data: orgData } = await userAClient
      .from('organizations')
      .select('*')
      .eq('id', orgBId)

    expect(orgData).toEqual([])

    // Attempt to select Location B
    const { data: locData } = await userAClient
      .from('locations')
      .select('*')
      .eq('organization_id', orgBId)

    expect(locData).toEqual([])
  })

  it('proves User A cannot INSERT a customer or record into Org B', async () => {
    const { error: insertCustErr } = await userAClient
      .from('customers')
      .insert({
        organization_id: orgBId,
        location_id: locBId,
        first_name: 'CrossTenantAttacker',
        email: 'attacker@example.test',
        permission_email: 'unknown',
        permission_sms: 'unknown',
        permission_source: 'test',
      })

    // RLS check fails because User A does not have role in Org B
    expect(insertCustErr).not.toBeNull()
  })

  it('proves User A cannot UPDATE or DELETE Org B rows', async () => {
    const { data: updateData } = await userAClient
      .from('organizations')
      .update({ name: 'Hacked Organization' })
      .eq('id', orgBId)
      .select()

    expect(updateData).toEqual([])

    const { data: deleteData } = await userAClient
      .from('organizations')
      .delete()
      .eq('id', orgBId)
      .select()

    expect(deleteData).toEqual([])
  })

  it('proves User B cannot access Org A rows', async () => {
    const { data: orgAData } = await userBClient
      .from('organizations')
      .select('*')
      .eq('id', orgAId)

    expect(orgAData).toEqual([])

    const { data: locAData } = await userBClient
      .from('locations')
      .select('*')
      .eq('organization_id', orgAId)

    expect(locAData).toEqual([])
  })

  it('proves User B cannot escalate role by adding themselves to Org A (Prompt Correction 3)', async () => {
    const { error: selfAssignErr } = await userBClient
      .from('organization_users')
      .insert({
        organization_id: orgAId,
        user_id: userBId,
        role: 'OWNER',
      })

    // Must be rejected by RLS: only OWNER/ADMIN of Org A can add users to Org A
    expect(selfAssignErr).not.toBeNull()
  })

  it('proves VIEWER role cannot perform mutations on Org A (Prompt Correction 2)', async () => {
    // VIEWER can read locations
    const { data: viewLocs } = await viewerClient
      .from('locations')
      .select('*')
      .eq('organization_id', orgAId)

    expect(viewLocs?.length).toBeGreaterThan(0)

    // VIEWER cannot insert customer
    const { error: custErr } = await viewerClient
      .from('customers')
      .insert({
        organization_id: orgAId,
        location_id: locAId,
        first_name: 'ViewerTest',
        email: 'viewer.test@example.test',
        permission_email: 'unknown',
        permission_sms: 'unknown',
        permission_source: 'test',
      })

    expect(custErr).not.toBeNull()

    // VIEWER cannot create locations
    const { error: locErr } = await viewerClient
      .from('locations')
      .insert({
        organization_id: orgAId,
        name: 'Unauthorized Clinic',
        status: 'ACTIVE',
      })

    expect(locErr).not.toBeNull()
  })

  it('proves OPERATOR role can perform Quick Complete but cannot configure locations or destinations', async () => {
    // OPERATOR can insert customer
    const { data: newCust, error: custErr } = await operatorClient
      .from('customers')
      .insert({
        organization_id: orgAId,
        location_id: locAId,
        first_name: 'OperatorCreated',
        email: 'op.created@example.test',
        permission_email: 'allowed',
        permission_sms: 'unknown',
        permission_source: 'quick_complete',
      })
      .select()
      .single()

    expect(custErr).toBeNull()
    expect(newCust?.first_name).toBe('OperatorCreated')

    // OPERATOR cannot add locations (requires OWNER or ADMIN)
    const { error: locErr } = await operatorClient
      .from('locations')
      .insert({
        organization_id: orgAId,
        name: 'OperatorLocation',
        status: 'ACTIVE',
      })

    expect(locErr).not.toBeNull()

    // OPERATOR cannot create review destinations (requires OWNER or ADMIN)
    const { error: destErr } = await operatorClient
      .from('review_destinations')
      .insert({
        organization_id: orgAId,
        location_id: locAId,
        provider: 'google',
        url: 'https://g.page/r/test123/review',
        canonical_url: 'https://g.page/r/test123/review',
        status: 'CONFIRMED',
      })

    expect(destErr).not.toBeNull()
  })

  it('proves cross-tenant composite foreign key prevents mismatched relationships (Prompt Correction 11)', async () => {
    // Attempt to insert customer with Org A and Location B (which belongs to Org B)
    const { error: fkErr } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgAId,
        location_id: locBId, // MISMATCH: locB belongs to orgB
        first_name: 'CrossTenantMismatched',
        email: 'mismatch@example.test',
        permission_email: 'unknown',
        permission_sms: 'unknown',
        permission_source: 'test',
      })

    // PostgreSQL composite foreign key constraint (fk_customer_location) must reject this!
    expect(fkErr).not.toBeNull()
    expect(fkErr?.message).toContain('fk_customer_location')
  })

  it('proves direct INSERT into organizations by authenticated user is denied (Prompt Correction 4)', async () => {
    const { error: directInsertErr } = await userAClient
      .from('organizations')
      .insert({
        name: 'Bypass Direct Org',
        slug: `bypass-org-${Date.now()}`,
        country: 'CA',
        timezone: 'America/Toronto',
      })

    // Must be rejected because authenticated has no INSERT policy on organizations
    expect(directInsertErr).not.toBeNull()
  })

  it('proves direct execution of increment_organization_usage is denied to authenticated users (Prompt Correction 3)', async () => {
    const { error: usageErr } = await userAClient.rpc('increment_organization_usage', {
      p_org_id: orgAId,
      p_period: '2026-09',
      p_metric: 'link_clicks',
      p_amount: 1,
    })

    // Must be rejected because EXECUTE is revoked from authenticated and anon
    expect(usageErr).not.toBeNull()
    expect(usageErr?.message?.toLowerCase()).toContain('permission denied')
  })

  it('proves composite foreign keys prevent cross-tenant associations on downstream event tables (Prompt Correction 6)', async () => {
    // 1. Create valid customer, completion event, and review request in Org A
    const { data: custA } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgAId,
        location_id: locAId,
        first_name: 'TenantA',
        email: `tenant.a.${Date.now()}@example.test`,
        permission_email: 'allowed',
        permission_source: 'test',
      })
      .select('id')
      .single()

    const { data: cceA } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgAId,
        location_id: locAId,
        customer_id: custA!.id,
        source: 'quick_complete',
        source_event_id: `cce_tenanta_${Date.now()}`,
        contact: { email: `tenant.a.${Date.now()}@example.test` },
        permission: { email: 'allowed' },
      })
      .select('id')
      .single()

    const { data: rrA } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgAId,
        location_id: locAId,
        customer_id: custA!.id,
        completion_event_id: cceA!.id,
        channel: 'email',
        status: 'SCHEDULED',
        token: `token_tenanta_${Date.now()}`,
        token_hash: `hash_tenanta_${Date.now()}`,
      })
      .select('id')
      .single()

    expect(rrA?.id).toBeDefined()

    // 2. Attempt to insert review_request_events with review_request of Org A, but organization_id of Org B
    const { error: rreErr } = await adminClient
      .from('review_request_events')
      .insert({
        organization_id: orgBId, // MISMATCH: belongs to Org B while rrA belongs to Org A
        review_request_id: rrA!.id,
        event_type: 'first_click',
      })

    expect(rreErr).not.toBeNull()
    expect(rreErr?.message).toContain('fk_rre_review_request')

    // 3. Attempt to insert message_events with review_request of Org A, but organization_id of Org B
    const { error: meErr } = await adminClient
      .from('message_events')
      .insert({
        organization_id: orgBId, // MISMATCH
        review_request_id: rrA!.id,
        provider: 'console',
        event_type: 'sent',
        status: 'SENT',
      })

    expect(meErr).not.toBeNull()
    expect(meErr?.message).toContain('fk_me_review_request')
  })
  it('proves ADMIN cannot insert OWNER or ADMIN, but can insert OPERATOR or VIEWER, and VIEWER/OPERATOR cannot insert any membership (Trust Boundary 1)', async () => {
    // Create target synthetic users to invite
    const uOwner = (await adminClient.auth.admin.createUser({ email: `target_owner_${Date.now()}@test.local`, password: 'Password123!', email_confirm: true })).data.user!.id
    const uAdmin = (await adminClient.auth.admin.createUser({ email: `target_admin_${Date.now()}@test.local`, password: 'Password123!', email_confirm: true })).data.user!.id
    const uOp = (await adminClient.auth.admin.createUser({ email: `target_op_${Date.now()}@test.local`, password: 'Password123!', email_confirm: true })).data.user!.id
    const uVi = (await adminClient.auth.admin.createUser({ email: `target_vi_${Date.now()}@test.local`, password: 'Password123!', email_confirm: true })).data.user!.id
    const uDenied = (await adminClient.auth.admin.createUser({ email: `target_denied_${Date.now()}@test.local`, password: 'Password123!', email_confirm: true })).data.user!.id

    // ADMIN -> insert OWNER = denied
    const { error: errOwner } = await adminUserClient.from('organization_users').insert({
      organization_id: orgAId,
      user_id: uOwner,
      role: 'OWNER',
    })
    expect(errOwner).not.toBeNull()
    expect(errOwner?.code).toBe('42501')

    // ADMIN -> insert ADMIN = denied
    const { error: errAdmin } = await adminUserClient.from('organization_users').insert({
      organization_id: orgAId,
      user_id: uAdmin,
      role: 'ADMIN',
    })
    expect(errAdmin).not.toBeNull()
    expect(errAdmin?.code).toBe('42501')

    // ADMIN -> insert OPERATOR = allowed
    const { data: opData, error: errOp } = await adminUserClient.from('organization_users').insert({
      organization_id: orgAId,
      user_id: uOp,
      role: 'OPERATOR',
    }).select('id, role').single()
    expect(errOp).toBeNull()
    expect(opData?.role).toBe('OPERATOR')

    // ADMIN -> insert VIEWER = allowed
    const { data: viData, error: errVi } = await adminUserClient.from('organization_users').insert({
      organization_id: orgAId,
      user_id: uVi,
      role: 'VIEWER',
    }).select('id, role').single()
    expect(errVi).toBeNull()
    expect(viData?.role).toBe('VIEWER')

    // VIEWER -> insert membership = denied
    const { error: errViDenied } = await viewerClient.from('organization_users').insert({
      organization_id: orgAId,
      user_id: uDenied,
      role: 'VIEWER',
    })
    expect(errViDenied).not.toBeNull()
    expect(errViDenied?.code).toBe('42501')

    // OPERATOR -> insert membership = denied
    const { error: errOpDenied } = await operatorClient.from('organization_users').insert({
      organization_id: orgAId,
      user_id: uDenied,
      role: 'OPERATOR',
    })
    expect(errOpDenied).not.toBeNull()
    expect(errOpDenied?.code).toBe('42501')

    // Cleanup target users
    await adminClient.auth.admin.deleteUser(uOwner)
    await adminClient.auth.admin.deleteUser(uAdmin)
    await adminClient.auth.admin.deleteUser(uOp)
    await adminClient.auth.admin.deleteUser(uVi)
    await adminClient.auth.admin.deleteUser(uDenied)
  })

  it('proves system-owned tables are system-write-only and cannot be mutated by tenant users (Trust Boundary 2)', async () => {
    // 1. Setup real customer, completion event, and review request in Org A via adminClient
    const { data: testCust } = await adminClient.from('customers').insert({
      organization_id: orgAId,
      location_id: locAId,
      first_name: 'Trust',
      last_name: 'Boundary',
      email: `trust.boundary.${Date.now()}@example.test`,
    }).select('id').single()

    const { data: testCce } = await adminClient.from('customer_completion_events').insert({
      organization_id: orgAId,
      location_id: locAId,
      customer_id: testCust!.id,
      source: 'quick_complete',
      source_event_id: `cce_tb_${Date.now()}`,
      contact: { email: `trust.boundary.${Date.now()}@example.test` },
      permission: { email: 'allowed' },
    }).select('id').single()

    const { data: testRr } = await adminClient.from('review_requests').insert({
      organization_id: orgAId,
      location_id: locAId,
      customer_id: testCust!.id,
      completion_event_id: testCce!.id,
      channel: 'email',
      status: 'SCHEDULED',
      token: `token_tb_${Date.now()}`,
      token_hash: `hash_tb_${Date.now()}`,
    }).select('id').single()

    // 2. OPERATOR cannot mark outbox DISPATCHED or insert outbox records
    const { data: testOutbox } = await adminClient.from('domain_event_outbox').insert({
      organization_id: orgAId,
      event_type: 'customer.completed',
      aggregate_type: 'customer',
      aggregate_id: testCust!.id,
      payload: { test: true },
      status: 'PENDING',
    }).select('id').single()

    const { data: outboxUpdated } = await operatorClient.from('domain_event_outbox').update({
      status: 'DISPATCHED',
    }).eq('id', testOutbox!.id).select()
    expect(outboxUpdated).toEqual([])

    const { data: checkOutbox } = await adminClient.from('domain_event_outbox').select('status').eq('id', testOutbox!.id).single()
    expect(checkOutbox?.status).toBe('PENDING')

    const { error: outboxInsErr } = await operatorClient.from('domain_event_outbox').insert({
      organization_id: orgAId,
      event_type: 'customer.completed',
      aggregate_type: 'customer',
      aggregate_id: testCust!.id,
      payload: { test: true },
      status: 'PENDING',
    })
    expect(outboxInsErr).not.toBeNull()
    expect(outboxInsErr?.code).toBe('42501')

    // 3. OPERATOR cannot change organization usage directly
    const { error: usageInsErr } = await operatorClient.from('organization_usage').insert({
      organization_id: orgAId,
      period: '2026-09',
      metric: 'review_requests_sent',
      value: 9999,
    })
    expect(usageInsErr).not.toBeNull()
    expect(usageInsErr?.code).toBe('42501')

    const { data: usageUpdated } = await operatorClient.from('organization_usage').update({
      value: 0,
    }).eq('organization_id', orgAId).select()
    expect(usageUpdated).toEqual([])

    // 4. OPERATOR cannot forge audit_events
    const { error: auditErr } = await operatorClient.from('audit_events').insert({
      organization_id: orgAId,
      actor_type: 'user',
      entity_type: 'review_request',
      entity_id: testRr!.id,
      event_type: 'forged_audit_action',
    })
    expect(auditErr).not.toBeNull()
    expect(auditErr?.code).toBe('42501')

    // 5. OPERATOR cannot forge message_events
    const { error: msgErr } = await operatorClient.from('message_events').insert({
      organization_id: orgAId,
      review_request_id: testRr!.id,
      provider: 'console',
      event_type: 'sent',
      status: 'SENT',
    })
    expect(msgErr).not.toBeNull()
    expect(msgErr?.code).toBe('42501')

    // 6. OPERATOR cannot forge review_request_events
    const { error: rreErr } = await operatorClient.from('review_request_events').insert({
      organization_id: orgAId,
      review_request_id: testRr!.id,
      event_type: 'first_click',
    })
    expect(rreErr).not.toBeNull()
    expect(rreErr?.code).toBe('42501')

    // 7. OPERATOR cannot manually insert or set a review request to SENT or CLICKED
    const { data: rrUpdated } = await operatorClient.from('review_requests').update({
      status: 'SENT',
    }).eq('id', testRr!.id).select()
    expect(rrUpdated).toEqual([])

    const { data: checkRr } = await adminClient.from('review_requests').select('status').eq('id', testRr!.id).single()
    expect(checkRr?.status).toBe('SCHEDULED')

    const { error: rrInsErr } = await operatorClient.from('review_requests').insert({
      organization_id: orgAId,
      location_id: locAId,
      customer_id: testCust!.id,
      completion_event_id: testCce!.id,
      channel: 'email',
      status: 'SENT',
      token: `token_forged_${Date.now()}`,
      token_hash: `hash_forged_${Date.now()}`,
    })
    expect(rrInsErr).not.toBeNull()
    expect(rrInsErr?.code).toBe('42501')

    // 8. Legitimate trusted server workflows (service_role) still succeed
    const { data: updatedRr, error: adminRrErr } = await adminClient.from('review_requests').update({
      status: 'SENT',
      sent_at: new Date().toISOString(),
    }).eq('id', testRr!.id).select('status').single()
    expect(adminRrErr).toBeNull()
    expect(updatedRr?.status).toBe('SENT')

    const { error: adminRreErr } = await adminClient.from('review_request_events').insert({
      organization_id: orgAId,
      review_request_id: testRr!.id,
      event_type: 'sent',
    })
    expect(adminRreErr).toBeNull()

    const { error: adminMeErr } = await adminClient.from('message_events').insert({
      organization_id: orgAId,
      review_request_id: testRr!.id,
      provider: 'console',
      event_type: 'sent',
      status: 'SENT',
    })
    expect(adminMeErr).toBeNull()

    // 9. Authenticated dashboard SELECT queries continue to succeed
    const { data: selRr, error: selRrErr } = await operatorClient.from('review_requests').select('id, status').eq('id', testRr!.id)
    expect(selRrErr).toBeNull()
    expect(selRr).toHaveLength(1)

    const { data: selOutbox, error: selOutboxErr } = await operatorClient.from('domain_event_outbox').select('id, status').eq('id', testOutbox!.id)
    expect(selOutboxErr).toBeNull()
    expect(selOutbox).toHaveLength(1)
  })
});
