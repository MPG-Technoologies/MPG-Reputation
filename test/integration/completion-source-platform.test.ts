import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'
import type { Database } from '../../src/types/database'
import { hashCompletionApiSecret, hashCompletionRequestBody, signCompletionRequest } from '../../src/domain/completion/api-auth'
import { POST as handlePostCompletion } from '../../src/app/api/v1/completions/route'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_anon_key'

const isDbAvailable = !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'dummy_service_role_key'

interface IngestionClaimResult {
  accepted: boolean
  replay: boolean
  rate_limited: boolean
  stale: boolean
  ingestion_id: string | null
}

interface SystemCompletionAtomicResult {
  duplicate: boolean
  customer_id: string
  completion_event_id: string
  outbox_id: string | null
  source_event_id: string
}

function asClaim(data: unknown): IngestionClaimResult {
  return data as IngestionClaimResult
}

function asAtomic(data: unknown): SystemCompletionAtomicResult {
  return data as SystemCompletionAtomicResult
}

describe.skipIf(!isDbAvailable)('MR-3 Real PostgreSQL Completion Source Platform Acceptance Tests', () => {
  let adminClient: ReturnType<typeof createClient<Database>>
  let anonClient: ReturnType<typeof createClient<Database>>
  let userAClient: ReturnType<typeof createClient<Database>>

  let userAId: string
  let orgAId: string
  let orgBId: string
  let locAId: string
  let locBId: string
  let credAId: string
  let secretA: string
  let secretAHash: string

  const createdOrgIds: string[] = []
  const createdUserIds: string[] = []

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    anonClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const timestamp = Date.now()
    const emailA = `mr3_user_${timestamp}@test.local`

    // 1. Create test user
    const { data: uA, error: errA } = await adminClient.auth.admin.createUser({
      email: emailA,
      password: 'Password123!',
      email_confirm: true,
    })
    if (errA || !uA.user) throw new Error(`Failed to create test user: ${errA?.message}`)
    userAId = uA.user.id
    createdUserIds.push(userAId)

    // 2. Sign in user to get authenticated client
    userAClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signErr } = await userAClient.auth.signInWithPassword({
      email: emailA,
      password: 'Password123!',
    })
    if (signErr) throw new Error(`User A signin failed: ${signErr.message}`)

    // 3. Create Org A and Org B
    const { data: oA, error: oAErr } = await adminClient
      .from('organizations')
      .insert({ name: `MR3 Org A ${timestamp}`, slug: `mr3-org-a-${timestamp}` })
      .select('id')
      .single()
    if (oAErr || !oA) throw new Error(`Failed to create Org A: ${oAErr?.message}`)
    orgAId = oA.id
    createdOrgIds.push(orgAId)

    const { data: oB, error: oBErr } = await adminClient
      .from('organizations')
      .insert({ name: `MR3 Org B ${timestamp}`, slug: `mr3-org-b-${timestamp}` })
      .select('id')
      .single()
    if (oBErr || !oB) throw new Error(`Failed to create Org B: ${oBErr?.message}`)
    orgBId = oB.id
    createdOrgIds.push(orgBId)

    // 4. Add User A to Org A as OWNER
    await adminClient.from('organization_users').insert({
      organization_id: orgAId,
      user_id: userAId,
      role: 'OWNER',
    })

    // 5. Create Location in Org A and Org B
    const { data: lA, error: lAErr } = await adminClient
      .from('locations')
      .insert({
        organization_id: orgAId,
        name: 'Org A Main Clinic',
        country: 'CA',
        status: 'ACTIVE',
      })
      .select('id')
      .single()
    if (lAErr || !lA) throw new Error(`Failed to create Location A: ${lAErr?.message}`)
    locAId = lA.id

    const { data: lB, error: lBErr } = await adminClient
      .from('locations')
      .insert({
        organization_id: orgBId,
        name: 'Org B Branch',
        country: 'CA',
        status: 'ACTIVE',
      })
      .select('id')
      .single()
    if (lBErr || !lB) throw new Error(`Failed to create Location B: ${lBErr?.message}`)
    locBId = lB.id

    // 6. Confirm Google review destination for Location A (MR-2 activation gate)
    await adminClient.from('review_destinations').insert({
      organization_id: orgAId,
      location_id: locAId,
      provider: 'google',
      url: 'https://g.page/r/test-clinic-loc-a/review',
      canonical_url: 'https://g.page/r/test-clinic-loc-a/review',
      status: 'CONFIRMED',
      confirmed_at: new Date().toISOString(),
    })

    // 7. Create API Credential for Org A
    credAId = randomUUID()
    secretA = randomBytes(32).toString('base64url')
    secretAHash = hashCompletionApiSecret(secretA)

    const { error: credErr } = await adminClient
      .from('completion_api_credentials')
      .insert({
        id: credAId,
        organization_id: orgAId,
        name: 'Test Ingestion Key',
        secret_hash: secretAHash,
        status: 'ACTIVE',
        rate_limit_per_minute: 60,
      })
    if (credErr) throw new Error(`Failed to create Credential A: ${credErr.message}`)
  })

  afterAll(async () => {
    // Cleanup synthetic data
    for (const orgId of createdOrgIds) {
      await adminClient.from('completion_ingestion_requests').delete().eq('organization_id', orgId)
      await adminClient.from('completion_api_credentials').delete().eq('organization_id', orgId)
      await adminClient.from('review_destinations').delete().eq('organization_id', orgId)
      await adminClient.from('domain_event_outbox').delete().eq('organization_id', orgId)
      await adminClient.from('customer_completion_events').delete().eq('organization_id', orgId)
      await adminClient.from('customers').delete().eq('organization_id', orgId)
      await adminClient.from('locations').delete().eq('organization_id', orgId)
      await adminClient.from('organization_users').delete().eq('organization_id', orgId)
      await adminClient.from('organizations').delete().eq('id', orgId)
    }

    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId)
    }
  })

  // 1. Credential record stores only secret hash
  it('1. Credential record stores only SHA-256 secret hash and never plaintext', async () => {
    const { data, error } = await adminClient
      .from('completion_api_credentials')
      .select('*')
      .eq('id', credAId)
      .single()

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data?.secret_hash).toBe(secretAHash)
    expect(data?.secret_hash).toMatch(/^[0-9a-f]{64}$/)
    expect((data as unknown as Record<string, unknown>).secret).toBeUndefined()
    expect(data?.secret_hash).not.toBe(secretA)
  })

  // 2. Valid service-role credential claim succeeds
  it('2. Valid service-role credential claim succeeds', async () => {
    const nonce = `nonce-${randomBytes(12).toString('hex')}`
    const timestamp = new Date().toISOString()
    const bodyHash = hashCompletionRequestBody('{"event_id":"test-1"}')

    const { data, error } = await adminClient.rpc('claim_completion_ingestion', {
      p_org_id: orgAId,
      p_credential_id: credAId,
      p_nonce: nonce,
      p_request_timestamp: timestamp,
      p_request_body_hash: bodyHash,
    })

    expect(error).toBeNull()
    const claim = asClaim(data)
    expect(claim.accepted).toBe(true)
    expect(claim.replay).toBe(false)
    expect(claim.rate_limited).toBe(false)
    expect(claim.stale).toBe(false)
    expect(claim.ingestion_id).toBeDefined()
  })

  // 3. Same nonce replay is rejected
  it('3. Same nonce replay is rejected atomically', async () => {
    const nonce = `replay-nonce-${randomBytes(10).toString('hex')}`
    const timestamp = new Date().toISOString()
    const bodyHash = hashCompletionRequestBody('{"event_id":"replay-1"}')

    // First claim
    const { data: first } = await adminClient.rpc('claim_completion_ingestion', {
      p_org_id: orgAId,
      p_credential_id: credAId,
      p_nonce: nonce,
      p_request_timestamp: timestamp,
      p_request_body_hash: bodyHash,
    })
    expect(asClaim(first).accepted).toBe(true)

    // Replayed claim
    const { data: second } = await adminClient.rpc('claim_completion_ingestion', {
      p_org_id: orgAId,
      p_credential_id: credAId,
      p_nonce: nonce,
      p_request_timestamp: timestamp,
      p_request_body_hash: bodyHash,
    })

    expect(asClaim(second).accepted).toBe(false)
    expect(asClaim(second).replay).toBe(true)
  })

  // 4. Stored rate-limit value is enforced
  it('4. Stored rate-limit value is enforced from credential configuration', async () => {
    // Create dedicated credential with rate limit = 2
    const lowRateCredId = randomUUID()
    const lowSecret = randomBytes(32).toString('base64url')
    await adminClient.from('completion_api_credentials').insert({
      id: lowRateCredId,
      organization_id: orgAId,
      name: 'Low Rate Cred',
      secret_hash: hashCompletionApiSecret(lowSecret),
      status: 'ACTIVE',
      rate_limit_per_minute: 2,
    })

    // Also clean up any prior claims from orgA to test strict limit
    await adminClient.from('completion_ingestion_requests').delete().eq('organization_id', orgAId)

    const timestamp = new Date().toISOString()
    const bodyHash = hashCompletionRequestBody('{"test":true}')

    // Claim 1
    const { data: c1 } = await adminClient.rpc('claim_completion_ingestion', {
      p_org_id: orgAId,
      p_credential_id: lowRateCredId,
      p_nonce: `rl-nonce-1-${Date.now()}`,
      p_request_timestamp: timestamp,
      p_request_body_hash: bodyHash,
    })
    expect(asClaim(c1).accepted).toBe(true)

    // Claim 2
    const { data: c2 } = await adminClient.rpc('claim_completion_ingestion', {
      p_org_id: orgAId,
      p_credential_id: lowRateCredId,
      p_nonce: `rl-nonce-2-${Date.now()}`,
      p_request_timestamp: timestamp,
      p_request_body_hash: bodyHash,
    })
    expect(asClaim(c2).accepted).toBe(true)

    // Claim 3 (exceeds rate limit of 2)
    const { data: c3 } = await adminClient.rpc('claim_completion_ingestion', {
      p_org_id: orgAId,
      p_credential_id: lowRateCredId,
      p_nonce: `rl-nonce-3-${Date.now()}`,
      p_request_timestamp: timestamp,
      p_request_body_hash: bodyHash,
    })
    expect(asClaim(c3).accepted).toBe(false)
    expect(asClaim(c3).rate_limited).toBe(true)

    // Reset rate limit on credAId back to 100 for subsequent tests
    await adminClient.from('completion_api_credentials').update({ rate_limit_per_minute: 100 }).eq('id', credAId)
    await adminClient.from('completion_api_credentials').delete().eq('id', lowRateCredId)
    await adminClient.from('completion_ingestion_requests').delete().eq('organization_id', orgAId)
  })

  // 5. Concurrent requests cannot bypass rate limit
  it('5. Concurrent requests cannot bypass rate limit', async () => {
    const burstCredId = randomUUID()
    const burstSecret = randomBytes(32).toString('base64url')
    await adminClient.from('completion_api_credentials').insert({
      id: burstCredId,
      organization_id: orgAId,
      name: 'Burst Limit Cred',
      secret_hash: hashCompletionApiSecret(burstSecret),
      status: 'ACTIVE',
      rate_limit_per_minute: 4,
    })

    const timestamp = new Date().toISOString()
    const bodyHash = hashCompletionRequestBody('{"burst":true}')

    // Fire 10 concurrent claim requests
    const promises = Array.from({ length: 10 }).map((_, i) =>
      adminClient.rpc('claim_completion_ingestion', {
        p_org_id: orgAId,
        p_credential_id: burstCredId,
        p_nonce: `burst-nonce-${i}-${Date.now()}`,
        p_request_timestamp: timestamp,
        p_request_body_hash: bodyHash,
      })
    )

    const results = await Promise.all(promises)
    const acceptedCount = results.filter((r) => asClaim(r.data)?.accepted === true).length
    const rateLimitedCount = results.filter((r) => asClaim(r.data)?.rate_limited === true).length

    expect(acceptedCount).toBeLessThanOrEqual(4)
    expect(rateLimitedCount).toBeGreaterThanOrEqual(6)

    await adminClient.from('completion_api_credentials').delete().eq('id', burstCredId)
    await adminClient.from('completion_ingestion_requests').delete().eq('organization_id', orgAId)
  })

  // 6. Credential from Org A cannot claim/submit for Org B
  it('6. Credential from Org A cannot claim or submit for Org B', async () => {
    const timestamp = new Date().toISOString()
    const bodyHash = hashCompletionRequestBody('{"x":1}')

    // Attempt claim for Org B with Credential A
    const { error: claimErr } = await adminClient.rpc('claim_completion_ingestion', {
      p_org_id: orgBId,
      p_credential_id: credAId,
      p_nonce: `cross-org-nonce-${Date.now()}`,
      p_request_timestamp: timestamp,
      p_request_body_hash: bodyHash,
    })
    expect(claimErr).toBeDefined()
    expect(claimErr?.message).toContain('Invalid completion API credential')
  })

  // 7. Location from Org B cannot be submitted using Org A credential / Org A context
  it('7. Location from Org B cannot be submitted in Org A completion', async () => {
    const { error } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locBId, // Location B belongs to Org B!
      p_first_name: 'Cross',
      p_last_name: 'Tenant',
      p_email: 'cross.tenant@example.test',
      p_source: 'api_v1',
      p_source_event_id: `cross-loc-${Date.now()}`,
      p_country: 'CA',
    })

    expect(error).toBeDefined()
    expect(error?.message).toContain('Location does not belong to specified organization')
  })

  // 8. anon cannot execute claim/system RPC
  it('8. anon role cannot execute claim_completion_ingestion or submit_completion_system_atomic', async () => {
    const { error: claimErr } = await anonClient.rpc('claim_completion_ingestion', {
      p_org_id: orgAId,
      p_credential_id: credAId,
      p_nonce: 'anon-nonce-1234567890',
      p_request_timestamp: new Date().toISOString(),
      p_request_body_hash: hashCompletionRequestBody('{}'),
    })
    expect(claimErr).toBeDefined()
    expect(claimErr?.message).toMatch(/permission denied|does not exist/i)

    const { error: submitErr } = await anonClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locAId,
      p_first_name: 'Anon',
      p_email: 'anon@example.test',
      p_source: 'api_v1',
      p_source_event_id: 'anon-evt',
      p_country: 'CA',
    })
    expect(submitErr).toBeDefined()
    expect(submitErr?.message).toMatch(/permission denied|does not exist/i)
  })

  // 9. authenticated ordinary user cannot execute claim/system RPC
  it('9. authenticated ordinary tenant user cannot execute claim or submit system RPCs', async () => {
    const { error: claimErr } = await userAClient.rpc('claim_completion_ingestion', {
      p_org_id: orgAId,
      p_credential_id: credAId,
      p_nonce: 'user-nonce-1234567890',
      p_request_timestamp: new Date().toISOString(),
      p_request_body_hash: hashCompletionRequestBody('{}'),
    })
    expect(claimErr).toBeDefined()
    expect(claimErr?.message).toMatch(/permission denied/i)

    const { error: submitErr } = await userAClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locAId,
      p_first_name: 'User',
      p_email: 'user@example.test',
      p_source: 'api_v1',
      p_source_event_id: 'user-evt',
      p_country: 'CA',
    })
    expect(submitErr).toBeDefined()
    expect(submitErr?.message).toMatch(/permission denied/i)
  })

  // 10. service_role can execute both RPCs
  it('10. service_role can execute claim and submit system RPCs', async () => {
    const nonce = `srv-role-nonce-${Date.now()}`
    const { data: claimData, error: claimErr } = await adminClient.rpc('claim_completion_ingestion', {
      p_org_id: orgAId,
      p_credential_id: credAId,
      p_nonce: nonce,
      p_request_timestamp: new Date().toISOString(),
      p_request_body_hash: hashCompletionRequestBody('{}'),
    })
    expect(claimErr).toBeNull()
    expect(asClaim(claimData).accepted).toBe(true)

    const sourceEventId = `srv-role-submit-${Date.now()}`
    const { data: submitData, error: submitErr } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locAId,
      p_first_name: 'Service',
      p_last_name: 'Role',
      p_email: 'servicerole@example.test',
      p_source: 'api_v1',
      p_source_event_id: sourceEventId,
      p_country: 'CA',
    })
    expect(submitErr).toBeNull()
    expect(asAtomic(submitData).duplicate).toBe(false)
    expect(asAtomic(submitData).completion_event_id).toBeDefined()
  })

  // 11. Valid system completion creates exactly one customer completion
  it('11. Valid system completion creates exactly one customer completion record', async () => {
    const sourceEventId = `single-comp-${Date.now()}`
    const { data: submitRes } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locAId,
      p_first_name: 'Elena',
      p_last_name: 'Rostova',
      p_email: 'elena.rostova@example.test',
      p_source: 'api_v1',
      p_source_event_id: sourceEventId,
      p_country: 'CA',
    })

    const compId = asAtomic(submitRes).completion_event_id

    const { data: events, error } = await adminClient
      .from('customer_completion_events')
      .select('id, organization_id, location_id, customer_id, source_event_id')
      .eq('id', compId)

    expect(error).toBeNull()
    expect(events?.length).toBe(1)
    expect(events?.[0].source_event_id).toBe(sourceEventId)
  })

  // 12. Valid system completion creates exactly one customer.completed outbox record
  it('12. Valid system completion creates exactly one customer.completed outbox record', async () => {
    const sourceEventId = `outbox-check-${Date.now()}`
    const { data: submitRes } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locAId,
      p_first_name: 'Marcus',
      p_email: 'marcus.aurelius@example.test',
      p_source: 'api_v1',
      p_source_event_id: sourceEventId,
      p_country: 'CA',
    })

    const compId = asAtomic(submitRes).completion_event_id
    const outboxId = asAtomic(submitRes).outbox_id
    expect(outboxId).toBeTruthy()

    const { data: outboxRows, error } = await adminClient
      .from('domain_event_outbox')
      .select('id, event_type, aggregate_type, aggregate_id, status, payload')
      .eq('id', outboxId!)

    expect(error).toBeNull()
    expect(outboxRows?.length).toBe(1)
    expect(outboxRows?.[0].event_type).toBe('customer.completed')
    expect(outboxRows?.[0].aggregate_type).toBe('customer_completion_event')
    expect(outboxRows?.[0].aggregate_id).toBe(compId)
    expect(outboxRows?.[0].status).toBe('PENDING')
  })

  // 13. Same source_event_id retry is idempotent
  it('13. Same source_event_id retry returns duplicate: true and same IDs', async () => {
    const sourceEventId = `idempotent-check-${Date.now()}`

    const { data: first } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locAId,
      p_first_name: 'Sophia',
      p_email: 'sophia@example.test',
      p_source: 'api_v1',
      p_source_event_id: sourceEventId,
      p_country: 'CA',
    })

    expect(asAtomic(first).duplicate).toBe(false)

    const { data: second } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locAId,
      p_first_name: 'Sophia',
      p_email: 'sophia@example.test',
      p_source: 'api_v1',
      p_source_event_id: sourceEventId,
      p_country: 'CA',
    })

    expect(asAtomic(second).duplicate).toBe(true)
    expect(asAtomic(second).customer_id).toBe(asAtomic(first).customer_id)
    expect(asAtomic(second).completion_event_id).toBe(asAtomic(first).completion_event_id)
    expect(asAtomic(second).outbox_id).toBe(asAtomic(first).outbox_id)
  })

  // 14. Concurrent identical source_event_id remains one completion
  it('14. Concurrent identical source_event_id submissions result in exactly one completion and outbox record', async () => {
    const sourceEventId = `concurrent-dup-${Date.now()}`

    const submissions = Array.from({ length: 6 }).map(() =>
      adminClient.rpc('submit_completion_system_atomic', {
        p_org_id: orgAId,
        p_loc_id: locAId,
        p_first_name: 'Concurrent',
        p_email: 'concurrent@example.test',
        p_source: 'api_v1',
        p_source_event_id: sourceEventId,
        p_country: 'CA',
      })
    )

    const results = await Promise.all(submissions)

    // All must succeed and report the exact same completion_event_id
    const completionIds = new Set(results.map((r) => asAtomic(r.data).completion_event_id))
    expect(completionIds.size).toBe(1)

    // Exactly one non-duplicate
    const nonDuplicates = results.filter((r) => asAtomic(r.data).duplicate === false)
    const duplicates = results.filter((r) => asAtomic(r.data).duplicate === true)
    expect(nonDuplicates.length).toBe(1)
    expect(duplicates.length).toBe(5)

    // Verify DB count
    const { count: eventCount } = await adminClient
      .from('customer_completion_events')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgAId)
      .eq('source_event_id', sourceEventId)

    expect(eventCount).toBe(1)
  })

  // 15. Duplicate retry does not create an unrelated second customer mutation
  it('15. Duplicate retry does not mutate customer record or create secondary side effects', async () => {
    const sourceEventId = `no-cust-mutation-${Date.now()}`
    const email = `stable.cust.${Date.now()}@example.test`

    const { data: first } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locAId,
      p_first_name: 'Original',
      p_last_name: 'Name',
      p_email: email,
      p_phone: '+15551112222',
      p_source: 'api_v1',
      p_source_event_id: sourceEventId,
      p_country: 'CA',
    })

    const customerId = asAtomic(first).customer_id
    const { data: customerBefore } = await adminClient
      .from('customers')
      .select('first_name, updated_at')
      .eq('id', customerId)
      .single()

    // Retry with different name
    const { data: second } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locAId,
      p_first_name: 'ChangedName',
      p_last_name: 'Tampered',
      p_email: email,
      p_source: 'api_v1',
      p_source_event_id: sourceEventId,
      p_country: 'CA',
    })

    expect(asAtomic(second).duplicate).toBe(true)

    const { data: customerAfter } = await adminClient
      .from('customers')
      .select('first_name, updated_at')
      .eq('id', customerId)
      .single()

    // Customer first_name and updated_at remain untouched because duplicate check happens before mutation
    expect(customerAfter?.first_name).toBe('Original')
    expect(customerAfter?.updated_at).toBe(customerBefore?.updated_at)
  })

  // 16. Completion timestamp is preserved correctly
  it('16. Completion timestamp is preserved correctly in event records', async () => {
    const sourceEventId = `timestamp-test-${Date.now()}`
    const targetTime = '2026-08-10T12:00:00.000Z'

    const { data: submitRes } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locAId,
      p_first_name: 'Historical',
      p_email: 'historical@example.test',
      p_source: 'api_v1',
      p_source_event_id: sourceEventId,
      p_completed_at: targetTime,
      p_country: 'CA',
    })

    const compId = asAtomic(submitRes).completion_event_id
    const { data: event } = await adminClient
      .from('customer_completion_events')
      .select('completed_at')
      .eq('id', compId)
      .single()

    expect(event?.completed_at).toBe('2026-08-10T12:00:00+00:00')
  })

  // 17. Invalid location/tenant combinations fail atomically
  it('17. Invalid location combinations fail atomically without partial side effects', async () => {
    const fakeLocationId = randomUUID()
    const email = `fail.loc.${Date.now()}@example.test`

    const { error } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: fakeLocationId,
      p_first_name: 'FailLoc',
      p_email: email,
      p_source: 'api_v1',
      p_source_event_id: `fail-loc-evt-${Date.now()}`,
      p_country: 'CA',
    })

    expect(error).toBeDefined()
    expect(error?.message).toContain('Location does not belong to specified organization')

    // Verify no customer was created for this email
    const { data: cust } = await adminClient.from('customers').select('id').eq('email', email)
    expect(cust?.length).toBe(0)
  })

  // 18. Failed transactions do not leave partial completion/outbox records
  it('18. Failed transactions do not leave partial completion or outbox records', async () => {
    const email = `fail.permission.${Date.now()}@example.test`
    const sourceEventId = `fail-perm-evt-${Date.now()}`

    const { error } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgAId,
      p_loc_id: locAId,
      p_first_name: 'InvalidPerm',
      p_email: email,
      p_permission_email: 'bogus_permission_value', // Invalid enum value
      p_source: 'api_v1',
      p_source_event_id: sourceEventId,
      p_country: 'CA',
    })

    expect(error).toBeDefined()
    expect(error?.message).toContain('Invalid email permission state')

    // Confirm no completion event
    const { data: events } = await adminClient
      .from('customer_completion_events')
      .select('id')
      .eq('source_event_id', sourceEventId)
    expect(events?.length).toBe(0)

    // Confirm no outbox record
    const { data: outbox } = await adminClient
      .from('domain_event_outbox')
      .select('id')
      .eq('payload->>sourceEventId', sourceEventId)
    expect(outbox?.length).toBe(0)

    // Confirm no customer was inserted
    const { data: cust } = await adminClient.from('customers').select('id').eq('email', email)
    expect(cust?.length).toBe(0)
  })

  // 19. End-to-end POST /api/v1/completions with real database backing accepts valid request
  it('19. End-to-end POST /api/v1/completions with real DB accepts valid request with 202 and audit log', async () => {
    const eventId = `e2e-valid-${Date.now()}`
    const payload = {
      event_id: eventId,
      location_id: locAId,
      completed_at: new Date().toISOString(),
      country: 'CA',
      customer: {
        first_name: 'E2E',
        last_name: 'Tester',
        email: `e2e.tester.${Date.now()}@example.test`,
        phone: '+15551239999',
      },
      permission: {
        email: 'allowed',
        sms: 'unknown',
      },
    }

    const rawBody = JSON.stringify(payload)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = `nonce-e2e-${randomBytes(12).toString('hex')}`
    const sig = signCompletionRequest(secretA, timestamp, nonce, rawBody)

    const headers = new Headers({
      authorization: `Bearer mpg_v1.${credAId}.${secretA}`,
      'x-mpg-timestamp': timestamp,
      'x-mpg-nonce': nonce,
      'x-mpg-signature': sig,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(rawBody, 'utf8')),
    })

    const req = new Request('http://localhost:3000/api/v1/completions', {
      method: 'POST',
      headers,
      body: rawBody,
    })

    const res = await handlePostCompletion(req)
    expect(res.status).toBe(202)

    const data = await res.json()
    expect(data.accepted).toBe(true)
    expect(data.duplicate).toBe(false)
    expect(data.sourceEventId).toBe(eventId)
    expect(data.eventId).toBeDefined()

    // Verify DB completion event and outbox
    const { data: compEvents } = await adminClient
      .from('customer_completion_events')
      .select('id, customer_id')
      .eq('id', data.eventId)
    expect(compEvents?.length).toBe(1)

    // Verify audit log status in completion_ingestion_requests
    const { data: audits } = await adminClient
      .from('completion_ingestion_requests')
      .select('status, http_status, source_event_id')
      .eq('organization_id', orgAId)
      .eq('nonce', nonce)
    expect(audits?.length).toBe(1)
    expect(audits?.[0].status).toBe('ACCEPTED')
    expect(audits?.[0].http_status).toBe(202)
    expect(audits?.[0].source_event_id).toBe(eventId)
  })

  // 20. End-to-end duplicate POST /api/v1/completions returns 200 OK idempotent response
  it('20. End-to-end duplicate POST /api/v1/completions returns 200 OK with duplicate: true and same eventId', async () => {
    const eventId = `e2e-dup-${Date.now()}`
    const payload = {
      event_id: eventId,
      location_id: locAId,
      completed_at: new Date().toISOString(),
      country: 'CA',
      customer: {
        first_name: 'E2E',
        last_name: 'Duplicate',
        email: `e2e.dup.${Date.now()}@example.test`,
      },
    }

    const rawBody = JSON.stringify(payload)

    // First request
    const ts1 = String(Math.floor(Date.now() / 1000))
    const nonce1 = `nonce-dup-1-${randomBytes(10).toString('hex')}`
    const sig1 = signCompletionRequest(secretA, ts1, nonce1, rawBody)
    const req1 = new Request('http://localhost:3000/api/v1/completions', {
      method: 'POST',
      headers: new Headers({
        authorization: `Bearer mpg_v1.${credAId}.${secretA}`,
        'x-mpg-timestamp': ts1,
        'x-mpg-nonce': nonce1,
        'x-mpg-signature': sig1,
        'content-type': 'application/json',
      }),
      body: rawBody,
    })

    const res1 = await handlePostCompletion(req1)
    expect(res1.status).toBe(202)
    const data1 = await res1.json()

    // Second request with different nonce but same payload / source event
    const ts2 = String(Math.floor(Date.now() / 1000))
    const nonce2 = `nonce-dup-2-${randomBytes(10).toString('hex')}`
    const sig2 = signCompletionRequest(secretA, ts2, nonce2, rawBody)
    const req2 = new Request('http://localhost:3000/api/v1/completions', {
      method: 'POST',
      headers: new Headers({
        authorization: `Bearer mpg_v1.${credAId}.${secretA}`,
        'x-mpg-timestamp': ts2,
        'x-mpg-nonce': nonce2,
        'x-mpg-signature': sig2,
        'content-type': 'application/json',
      }),
      body: rawBody,
    })

    const res2 = await handlePostCompletion(req2)
    expect(res2.status).toBe(200)
    const data2 = await res2.json()
    expect(data2.accepted).toBe(true)
    expect(data2.duplicate).toBe(true)
    expect(data2.eventId).toBe(data1.eventId)

    // Verify DB count remains exactly 1
    const { count } = await adminClient
      .from('customer_completion_events')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgAId)
      .eq('source_event_id', eventId)
    expect(count).toBe(1)
  })

  // 21. End-to-end POST /api/v1/completions with tampered signature is rejected with 401
  it('21. End-to-end POST /api/v1/completions with tampered signature is rejected with 401', async () => {
    const rawBody = JSON.stringify({ event_id: 'e2e-tampered', location_id: locAId })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = `nonce-tampered-${randomBytes(10).toString('hex')}`

    const req = new Request('http://localhost:3000/api/v1/completions', {
      method: 'POST',
      headers: new Headers({
        authorization: `Bearer mpg_v1.${credAId}.${secretA}`,
        'x-mpg-timestamp': timestamp,
        'x-mpg-nonce': nonce,
        'x-mpg-signature': 'v1=baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'content-type': 'application/json',
      }),
      body: rawBody,
    })

    const res = await handlePostCompletion(req)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('UNAUTHORIZED')
  })

  // 22. Supplied valid completed_at survives end-to-end normalization and persistence without being replaced by ingestion time
  it('22. Supplied valid completed_at survives end-to-end normalization and persistence without replacement by ingestion time', async () => {
    const historicalTime = '2026-05-15T08:45:00.000Z'
    const eventId = `timestamp-e2e-${Date.now()}`
    const payload = {
      event_id: eventId,
      location_id: locAId,
      completed_at: historicalTime,
      country: 'CA',
      customer: {
        first_name: 'Historical',
        last_name: 'Timestamp',
        email: `hist.timestamp.${Date.now()}@example.test`,
      },
    }

    const rawBody = JSON.stringify(payload)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = `nonce-hist-${randomBytes(10).toString('hex')}`
    const sig = signCompletionRequest(secretA, timestamp, nonce, rawBody)

    const req = new Request('http://localhost:3000/api/v1/completions', {
      method: 'POST',
      headers: new Headers({
        authorization: `Bearer mpg_v1.${credAId}.${secretA}`,
        'x-mpg-timestamp': timestamp,
        'x-mpg-nonce': nonce,
        'x-mpg-signature': sig,
        'content-type': 'application/json',
      }),
      body: rawBody,
    })

    const res = await handlePostCompletion(req)
    expect(res.status).toBe(202)
    const data = (await res.json()) as { accepted: boolean; eventId: string; sourceEventId: string }
    expect(data.accepted).toBe(true)
    expect(data.eventId).toBeDefined()

    // 1. Verify persisted completed_at in customer_completion_events matches historicalTime
    const { data: compEvent, error: compErr } = await adminClient
      .from('customer_completion_events')
      .select('completed_at, created_at')
      .eq('id', data.eventId)
      .single()

    expect(compErr).toBeNull()
    expect(compEvent?.completed_at).toBe('2026-05-15T08:45:00+00:00')
    // Verify completed_at is distinct from created_at (ingestion time)
    expect(compEvent?.completed_at).not.toBe(compEvent?.created_at)

    // 2. Verify domain_event_outbox payload preserves the exact supplied timestamp
    const { data: outboxRows, error: outboxErr } = await adminClient
      .from('domain_event_outbox')
      .select('payload')
      .eq('aggregate_id', data.eventId)
      .eq('event_type', 'customer.completed')

    expect(outboxErr).toBeNull()
    expect(outboxRows?.length).toBe(1)
    const payloadData = outboxRows?.[0].payload as { completedAt: string }
    expect(payloadData.completedAt).toContain('2026-05-15T08:45:00')
  })
})
