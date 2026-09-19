import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import type { Database } from '../../src/types/database'
import { signCompletionRequest } from '../../src/domain/completion/api-auth'
import { POST as handlePostCompletion } from '../../src/app/api/v1/completions/route'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const isDbAvailable = !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'dummy_service_role_key'

// Mock createClient from '@/lib/supabase/server' so server actions use the designated authenticated test client
let activeClient: ReturnType<typeof createSupabaseClient<Database>> | null = null

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => activeClient),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import {
  createCompletionCredential,
  revokeCompletionCredential,
  listCompletionCredentials,
  listIngestionLogs,
} from '../../src/actions/completion-credentials'

describe.skipIf(!isDbAvailable)('MR-3 Completion Credential Trust Boundary & Rotation', () => {
  let adminClient: ReturnType<typeof createSupabaseClient<Database>>
  let ownerClient: ReturnType<typeof createSupabaseClient<Database>>
  let adminUserClient: ReturnType<typeof createSupabaseClient<Database>>
  let operatorClient: ReturnType<typeof createSupabaseClient<Database>>
  let viewerClient: ReturnType<typeof createSupabaseClient<Database>>

  let ownerUserId: string
  let adminUserId: string
  let operatorUserId: string
  let viewerUserId: string
  let orgId: string
  let locId: string

  const createdOrgIds: string[] = []
  const createdUserIds: string[] = []

  beforeAll(async () => {
    adminClient = createSupabaseClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const timestamp = Date.now()

    const createTestUser = async (email: string) => {
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password: 'Password123!',
        email_confirm: true,
      })
      if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
      const client = createSupabaseClient<Database>(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { error: loginErr } = await client.auth.signInWithPassword({ email, password: 'Password123!' })
      if (loginErr) throw new Error(`Failed to sign in test user: ${loginErr.message}`)
      return { id: data.user.id, client }
    }

    const uOwner = await createTestUser(`cred_owner_${timestamp}@test.local`)
    const uAdmin = await createTestUser(`cred_admin_${timestamp}@test.local`)
    const uOperator = await createTestUser(`cred_operator_${timestamp}@test.local`)
    const uViewer = await createTestUser(`cred_viewer_${timestamp}@test.local`)

    ownerUserId = uOwner.id
    ownerClient = uOwner.client
    adminUserId = uAdmin.id
    adminUserClient = uAdmin.client
    operatorUserId = uOperator.id
    operatorClient = uOperator.client
    viewerUserId = uViewer.id
    viewerClient = uViewer.client

    createdUserIds.push(ownerUserId, adminUserId, operatorUserId, viewerUserId)

    // Create test Org
    const { data: org } = await adminClient
      .from('organizations')
      .insert({ name: `Cred Test Org ${timestamp}`, slug: `cred-test-${timestamp}`, status: 'ACTIVE' })
      .select('id')
      .single()
    orgId = org!.id
    createdOrgIds.push(orgId)

    // Create test Location with confirmed Google review destination
    const { data: loc, error: locErr } = await adminClient
      .from('locations')
      .insert({
        organization_id: orgId,
        name: 'Main Clinic',
        country: 'CA',
        status: 'ACTIVE',
      })
      .select('id')
      .single()
    if (locErr || !loc) throw new Error(`Failed to create Location: ${locErr?.message}`)
    locId = loc.id

    await adminClient.from('review_destinations').insert({
      organization_id: orgId,
      location_id: locId,
      provider: 'google',
      url: 'https://g.page/r/test-review/review',
      canonical_url: 'https://g.page/r/test-review/review',
      status: 'CONFIRMED',
      confirmed_at: new Date().toISOString(),
    })

    // Assign roles in organization_users
    await adminClient.from('organization_users').insert([
      { organization_id: orgId, user_id: ownerUserId, role: 'OWNER' },
      { organization_id: orgId, user_id: adminUserId, role: 'ADMIN' },
      { organization_id: orgId, user_id: operatorUserId, role: 'OPERATOR' },
      { organization_id: orgId, user_id: viewerUserId, role: 'VIEWER' },
    ])
  })

  afterAll(async () => {
    for (const id of createdOrgIds) {
      await adminClient.from('domain_event_outbox').delete().eq('organization_id', id)
      await adminClient.from('customer_completion_events').delete().eq('organization_id', id)
      await adminClient.from('customers').delete().eq('organization_id', id)
      await adminClient.from('completion_ingestion_requests').delete().eq('organization_id', id)
      await adminClient.from('completion_api_credentials').delete().eq('organization_id', id)
      await adminClient.from('review_destinations').delete().eq('organization_id', id)
      await adminClient.from('locations').delete().eq('organization_id', id)
      await adminClient.from('organization_users').delete().eq('organization_id', id)
      await adminClient.from('organizations').delete().eq('id', id)
    }

    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId)
    }
  })

  // ============================================================
  // 1. CREDENTIAL TABLE TRUST BOUNDARY: DIRECT MUTATION DENIAL
  // ============================================================
  it('enforces table trust boundary: authenticated OWNER/ADMIN/OPERATOR/VIEWER cannot directly mutate or read credentials table', async () => {
    // 1. OWNER direct INSERT -> denied
    const { error: ownerInsertErr } = await ownerClient
      .from('completion_api_credentials')
      .insert({
        organization_id: orgId,
        name: 'Direct Injected Key',
        secret_hash: '1'.repeat(64),
        status: 'ACTIVE',
      })
    expect(ownerInsertErr).toBeDefined()
    expect(ownerInsertErr?.message).toMatch(/permission denied/i)

    // Insert a valid credential via service_role for subsequent update tests
    const { data: baseCred } = await adminClient
      .from('completion_api_credentials')
      .insert({
        organization_id: orgId,
        name: 'Base Test Credential',
        secret_hash: '2'.repeat(64),
        status: 'ACTIVE',
        rate_limit_per_minute: 60,
      })
      .select('id')
      .single()
    const credId = baseCred!.id

    // 2. OWNER direct secret_hash UPDATE -> denied
    const { error: ownerUpdateSecretErr } = await ownerClient
      .from('completion_api_credentials')
      .update({ secret_hash: '3'.repeat(64) })
      .eq('id', credId)
    expect(ownerUpdateSecretErr).toBeDefined()
    expect(ownerUpdateSecretErr?.message).toMatch(/permission denied/i)

    // 3. ADMIN direct secret_hash UPDATE -> denied
    const { error: adminUpdateSecretErr } = await adminUserClient
      .from('completion_api_credentials')
      .update({ secret_hash: '4'.repeat(64) })
      .eq('id', credId)
    expect(adminUpdateSecretErr).toBeDefined()
    expect(adminUpdateSecretErr?.message).toMatch(/permission denied/i)

    // 4. Revoke the credential via service_role, then verify OWNER direct revoked->ACTIVE change -> denied
    await adminClient
      .from('completion_api_credentials')
      .update({ status: 'REVOKED', revoked_at: new Date().toISOString() })
      .eq('id', credId)

    const { error: ownerReactivateErr } = await ownerClient
      .from('completion_api_credentials')
      .update({ status: 'ACTIVE' })
      .eq('id', credId)
    expect(ownerReactivateErr).toBeDefined()
    expect(ownerReactivateErr?.message).toMatch(/permission denied/i)

    // 5. OPERATOR mutations -> denied
    const { error: opInsertErr } = await operatorClient
      .from('completion_api_credentials')
      .insert({
        organization_id: orgId,
        name: 'Operator Key',
        secret_hash: '5'.repeat(64),
        status: 'ACTIVE',
      })
    expect(opInsertErr).toBeDefined()
    expect(opInsertErr?.message).toMatch(/permission denied/i)

    const { error: opUpdateErr } = await operatorClient
      .from('completion_api_credentials')
      .update({ rate_limit_per_minute: 1000 })
      .eq('id', credId)
    expect(opUpdateErr).toBeDefined()
    expect(opUpdateErr?.message).toMatch(/permission denied/i)

    // 6. VIEWER mutations -> denied
    const { error: viewerInsertErr } = await viewerClient
      .from('completion_api_credentials')
      .insert({
        organization_id: orgId,
        name: 'Viewer Key',
        secret_hash: '6'.repeat(64),
        status: 'ACTIVE',
      })
    expect(viewerInsertErr).toBeDefined()
    expect(viewerInsertErr?.message).toMatch(/permission denied/i)

    const { error: viewerUpdateErr } = await viewerClient
      .from('completion_api_credentials')
      .update({ status: 'ACTIVE' })
      .eq('id', credId)
    expect(viewerUpdateErr).toBeDefined()
    expect(viewerUpdateErr?.message).toMatch(/permission denied/i)

    // 7. Direct SELECT on completion_api_credentials -> denied (secret_hash never exposed directly to browser)
    const { data: selectData, error: selectErr } = await ownerClient
      .from('completion_api_credentials')
      .select('*')
      .eq('organization_id', orgId)
    expect(selectErr).toBeDefined()
    expect(selectErr?.message).toMatch(/permission denied/i)
    expect(selectData).toBeNull()

    // 8. Direct mutations on completion_ingestion_requests -> denied
    const { error: logInsertErr } = await ownerClient
      .from('completion_ingestion_requests')
      .insert({
        organization_id: orgId,
        credential_id: credId,
        nonce: 'direct-nonce-test',
        request_timestamp: new Date().toISOString(),
        request_body_hash: '7'.repeat(64),
      })
    expect(logInsertErr).toBeDefined()
    expect(logInsertErr?.message).toMatch(/permission denied/i)
  })

  // ============================================================
  // 2. SERVER-SIDE ACTION ROLE GATING & ONE-TIME PLAINTEXT REVEAL
  // ============================================================
  it('enforces server-side action role gating: OWNER/ADMIN succeed; OPERATOR/VIEWER are denied', async () => {
    // 1. OWNER can create credential -> plaintext secret returned once, stored as hash
    activeClient = ownerClient
    const ownerRes = await createCompletionCredential({
      organizationId: orgId,
      name: 'Owner Generated Key',
    })
    expect(ownerRes.success).toBe(true)
    expect(ownerRes.credential).toBeDefined()
    expect(ownerRes.credential?.apiKey).toMatch(/^mpg_v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/)
    expect(ownerRes.credential?.rateLimitPerMinute).toBe(60) // Verified authoritative stored default

    const ownerCredId = ownerRes.credential!.id

    // Verify DB stores ONLY secret_hash, never plaintext apiKey or secret
    const { data: dbRow } = await adminClient
      .from('completion_api_credentials')
      .select('*')
      .eq('id', ownerCredId)
      .single()
    expect(dbRow?.secret_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(dbRow?.secret_hash).not.toBe(ownerRes.credential!.apiKey)

    // 2. ADMIN can create credential
    activeClient = adminUserClient
    const adminRes = await createCompletionCredential({
      organizationId: orgId,
      name: 'Admin Generated Key',
    })
    expect(adminRes.success).toBe(true)
    expect(adminRes.credential?.id).toBeDefined()

    // 3. OPERATOR cannot create credential
    activeClient = operatorClient
    const operatorRes = await createCompletionCredential({
      organizationId: orgId,
      name: 'Operator Attempt Key',
    })
    expect(operatorRes.success).toBe(false)
    expect(operatorRes.error).toContain('Access denied: Only owners and administrators can create credentials')

    // 4. VIEWER cannot create credential
    activeClient = viewerClient
    const viewerRes = await createCompletionCredential({
      organizationId: orgId,
      name: 'Viewer Attempt Key',
    })
    expect(viewerRes.success).toBe(false)
    expect(viewerRes.error).toContain('Access denied: Only owners and administrators can create credentials')

    // 5. OPERATOR cannot revoke credential
    activeClient = operatorClient
    const opRevokeRes = await revokeCompletionCredential({
      organizationId: orgId,
      credentialId: ownerCredId,
    })
    expect(opRevokeRes.success).toBe(false)
    expect(opRevokeRes.error).toContain('Access denied: Only owners and administrators can revoke credentials')

    // 6. VIEWER cannot revoke credential
    activeClient = viewerClient
    const viewerRevokeRes = await revokeCompletionCredential({
      organizationId: orgId,
      credentialId: ownerCredId,
    })
    expect(viewerRevokeRes.success).toBe(false)
    expect(viewerRevokeRes.error).toContain('Access denied: Only owners and administrators can revoke credentials')

    // 7. OWNER can revoke credential
    activeClient = ownerClient
    const ownerRevokeRes = await revokeCompletionCredential({
      organizationId: orgId,
      credentialId: ownerCredId,
    })
    expect(ownerRevokeRes.success).toBe(true)

    // Verify in DB that status is REVOKED and revoked_at is stamped
    const { data: revokedRow } = await adminClient
      .from('completion_api_credentials')
      .select('status, revoked_at')
      .eq('id', ownerCredId)
      .single()
    expect(revokedRow?.status).toBe('REVOKED')
    expect(revokedRow?.revoked_at).toBeDefined()
  })

  // ============================================================
  // 3. CREDENTIAL ROTATION SEMANTICS (SECTION 2 PROOF)
  // ============================================================
  it('verifies safe credential rotation: replacement created -> both valid -> old revoked -> old rejected -> new valid', async () => {
    // Step 1: Create initial credential A via server action
    activeClient = ownerClient
    const resA = await createCompletionCredential({
      organizationId: orgId,
      name: 'POS Terminal Key (Old)',
    })
    expect(resA.success).toBe(true)
    const apiKeyA = resA.credential!.apiKey
    const [, credIdA, secretA] = apiKeyA.split('.')

    // Step 2: Ingest completion with Credential A -> 202 Accepted
    const rawBody1 = JSON.stringify({
      event_id: `rotation-evt-1-${Date.now()}`,
      location_id: locId,
      completed_at: new Date().toISOString(),
      country: 'CA',
      customer: { first_name: 'RotationA', email: `rotA.${Date.now()}@example.test` },
    })
    const ts1 = String(Math.floor(Date.now() / 1000))
    const nonce1 = `nonce-rot-1-${randomBytes(8).toString('hex')}`
    const sig1 = signCompletionRequest(secretA, ts1, nonce1, rawBody1)

    const req1 = new Request('http://localhost:3000/api/v1/completions', {
      method: 'POST',
      headers: new Headers({
        authorization: `Bearer ${apiKeyA}`,
        'x-mpg-timestamp': ts1,
        'x-mpg-nonce': nonce1,
        'x-mpg-signature': sig1,
        'content-type': 'application/json',
      }),
      body: rawBody1,
    })

    const httpRes1 = await handlePostCompletion(req1)
    expect(httpRes1.status).toBe(202)
    const data1 = await httpRes1.json()
    expect(data1.accepted).toBe(true)

    // Step 3: Create replacement Credential B via server action
    const resB = await createCompletionCredential({
      organizationId: orgId,
      name: 'POS Terminal Key (Replacement)',
    })
    expect(resB.success).toBe(true)
    const apiKeyB = resB.credential!.apiKey
    const [, credIdB, secretB] = apiKeyB.split('.')
    expect(credIdB).not.toBe(credIdA)
    expect(secretB).not.toBe(secretA)

    // Step 4: Overlap window: Both credentials can authenticate simultaneously before old is revoked
    const rawBody2 = JSON.stringify({
      event_id: `rotation-evt-2-${Date.now()}`,
      location_id: locId,
      completed_at: new Date().toISOString(),
      country: 'CA',
      customer: { first_name: 'RotationOverlapA', email: `rotOverlapA.${Date.now()}@example.test` },
    })
    const ts2 = String(Math.floor(Date.now() / 1000))
    const nonce2 = `nonce-rot-2-${randomBytes(8).toString('hex')}`
    const sig2 = signCompletionRequest(secretA, ts2, nonce2, rawBody2)
    const reqOverlapA = new Request('http://localhost:3000/api/v1/completions', {
      method: 'POST',
      headers: new Headers({
        authorization: `Bearer ${apiKeyA}`,
        'x-mpg-timestamp': ts2,
        'x-mpg-nonce': nonce2,
        'x-mpg-signature': sig2,
        'content-type': 'application/json',
      }),
      body: rawBody2,
    })
    const httpResOverlapA = await handlePostCompletion(reqOverlapA)
    expect(httpResOverlapA.status).toBe(202)

    const rawBody3 = JSON.stringify({
      event_id: `rotation-evt-3-${Date.now()}`,
      location_id: locId,
      completed_at: new Date().toISOString(),
      country: 'CA',
      customer: { first_name: 'RotationB', email: `rotB.${Date.now()}@example.test` },
    })
    const ts3 = String(Math.floor(Date.now() / 1000))
    const nonce3 = `nonce-rot-3-${randomBytes(8).toString('hex')}`
    const sig3 = signCompletionRequest(secretB, ts3, nonce3, rawBody3)
    const reqB = new Request('http://localhost:3000/api/v1/completions', {
      method: 'POST',
      headers: new Headers({
        authorization: `Bearer ${apiKeyB}`,
        'x-mpg-timestamp': ts3,
        'x-mpg-nonce': nonce3,
        'x-mpg-signature': sig3,
        'content-type': 'application/json',
      }),
      body: rawBody3,
    })
    const httpResB = await handlePostCompletion(reqB)
    expect(httpResB.status).toBe(202)

    // Step 5: Explicitly revoke old Credential A via server action
    const revokeRes = await revokeCompletionCredential({
      organizationId: orgId,
      credentialId: credIdA,
    })
    expect(revokeRes.success).toBe(true)

    // Step 6: Old Credential A is now REVOKED and cannot authenticate
    const rawBody4 = JSON.stringify({
      event_id: `rotation-evt-4-${Date.now()}`,
      location_id: locId,
      completed_at: new Date().toISOString(),
      country: 'CA',
      customer: { first_name: 'RotationDeadA', email: `rotDeadA.${Date.now()}@example.test` },
    })
    const ts4 = String(Math.floor(Date.now() / 1000))
    const nonce4 = `nonce-rot-4-${randomBytes(8).toString('hex')}`
    const sig4 = signCompletionRequest(secretA, ts4, nonce4, rawBody4)
    const reqDeadA = new Request('http://localhost:3000/api/v1/completions', {
      method: 'POST',
      headers: new Headers({
        authorization: `Bearer ${apiKeyA}`,
        'x-mpg-timestamp': ts4,
        'x-mpg-nonce': nonce4,
        'x-mpg-signature': sig4,
        'content-type': 'application/json',
      }),
      body: rawBody4,
    })
    const httpResDeadA = await handlePostCompletion(reqDeadA)
    expect(httpResDeadA.status).toBe(401)
    const deadAData = await httpResDeadA.json()
    expect(deadAData.error).toBe('UNAUTHORIZED')

    // Step 7: Replacement Credential B continues to authenticate successfully
    const rawBody5 = JSON.stringify({
      event_id: `rotation-evt-5-${Date.now()}`,
      location_id: locId,
      completed_at: new Date().toISOString(),
      country: 'CA',
      customer: { first_name: 'RotationLivingB', email: `rotLivingB.${Date.now()}@example.test` },
    })
    const ts5 = String(Math.floor(Date.now() / 1000))
    const nonce5 = `nonce-rot-5-${randomBytes(8).toString('hex')}`
    const sig5 = signCompletionRequest(secretB, ts5, nonce5, rawBody5)
    const reqLivingB = new Request('http://localhost:3000/api/v1/completions', {
      method: 'POST',
      headers: new Headers({
        authorization: `Bearer ${apiKeyB}`,
        'x-mpg-timestamp': ts5,
        'x-mpg-nonce': nonce5,
        'x-mpg-signature': sig5,
        'content-type': 'application/json',
      }),
      body: rawBody5,
    })
    const httpResLivingB = await handlePostCompletion(reqLivingB)
    expect(httpResLivingB.status).toBe(202)
    const livingBData = await httpResLivingB.json()
    expect(livingBData.accepted).toBe(true)
  })

  // ============================================================
  // 4. METADATA LISTING & PII-FREE AUDIT LOGS
  // ============================================================
  it('verifies list actions return safe metadata without secret_hash or customer PII', async () => {
    activeClient = ownerClient
    const credList = await listCompletionCredentials(orgId)
    expect(credList.length).toBeGreaterThanOrEqual(1)

    // Ensure secret_hash is NOT exposed on list items
    for (const cred of credList) {
      expect((cred as unknown as Record<string, unknown>).secret_hash).toBeUndefined()
      expect(cred.id).toBeDefined()
      expect(cred.name).toBeDefined()
      expect(cred.status).toBeDefined()
      expect(cred.rateLimitPerMinute).toBeDefined()
    }

    // Insert an audit log row to verify safe retrieval
    const nonce = `audit-log-check-${Date.now()}`
    const bodyHash = 'e'.repeat(64)
    await adminClient.from('completion_ingestion_requests').insert({
      organization_id: orgId,
      credential_id: credList[0].id,
      nonce,
      request_timestamp: new Date().toISOString(),
      request_body_hash: bodyHash,
      source_event_id: 'evt-audit-safe',
      status: 'ACCEPTED',
      http_status: 202,
      processed_at: new Date().toISOString(),
    })

    const logs = await listIngestionLogs(orgId, 20)
    expect(logs.length).toBeGreaterThanOrEqual(1)
    const matched = logs.find((l) => l.nonce === nonce)
    expect(matched).toBeDefined()
    expect(matched?.status).toBe('ACCEPTED')
    expect(matched?.httpStatus).toBe(202)
    expect(matched?.requestBodyHash).toBe(bodyHash)

    // Ensure raw payload and customer PII are absent
    expect((matched as unknown as Record<string, unknown>).raw_body).toBeUndefined()
    expect((matched as unknown as Record<string, unknown>).customer_email).toBeUndefined()
  })
})
