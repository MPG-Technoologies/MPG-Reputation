import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

let activeClient: ReturnType<typeof createClient<Database>> | null = null

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => activeClient),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { executeReviewRequestHandler } from '../../src/inngest/functions/review-request'
import {
  getOrganizationUsageSummary,
  startOrganizationTrialAction,
} from '../../src/actions/usage'
import { hashSuppressionContact } from '../../src/domain/suppression'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_anon_key'

const isDbAvailable = !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'dummy_service_role_key'

describe.skipIf(!isDbAvailable)('MR-4 Trial, Usage, and Internal Economics Real PostgreSQL Tests', () => {
  let adminClient: ReturnType<typeof createClient<Database>>
  let ownerAClient: ReturnType<typeof createClient<Database>>
  let adminAClient: ReturnType<typeof createClient<Database>>
  let operatorAClient: ReturnType<typeof createClient<Database>>
  let viewerAClient: ReturnType<typeof createClient<Database>>
  let tenantBClient: ReturnType<typeof createClient<Database>>

  let userOwnerAId: string
  let userAdminAId: string
  let userOperatorAId: string
  let userViewerAId: string
  let userOwnerBId: string

  let orgAId: string
  let orgBId: string
  let locAId: string
  let locBId: string

  const mockStep = {
    run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    sleep: async (): Promise<void> => {},
  }

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const timestamp = Date.now()
    const emailOwnerA = `owner_a_${timestamp}@test.local`
    const emailAdminA = `admin_a_${timestamp}@test.local`
    const emailOpA = `operator_a_${timestamp}@test.local`
    const emailViewerA = `viewer_a_${timestamp}@test.local`
    const emailOwnerB = `owner_b_${timestamp}@test.local`

    // 1. Create test users
    const { data: uOA } = await adminClient.auth.admin.createUser({
      email: emailOwnerA,
      password: 'Password123!',
      email_confirm: true,
    })
    userOwnerAId = uOA.user!.id

    const { data: uAA } = await adminClient.auth.admin.createUser({
      email: emailAdminA,
      password: 'Password123!',
      email_confirm: true,
    })
    userAdminAId = uAA.user!.id

    const { data: uOpA } = await adminClient.auth.admin.createUser({
      email: emailOpA,
      password: 'Password123!',
      email_confirm: true,
    })
    userOperatorAId = uOpA.user!.id

    const { data: uVA } = await adminClient.auth.admin.createUser({
      email: emailViewerA,
      password: 'Password123!',
      email_confirm: true,
    })
    userViewerAId = uVA.user!.id

    const { data: uOB } = await adminClient.auth.admin.createUser({
      email: emailOwnerB,
      password: 'Password123!',
      email_confirm: true,
    })
    userOwnerBId = uOB.user!.id

    // 2. Create authenticated clients
    ownerAClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    await ownerAClient.auth.signInWithPassword({ email: emailOwnerA, password: 'Password123!' })

    adminAClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    await adminAClient.auth.signInWithPassword({ email: emailAdminA, password: 'Password123!' })

    operatorAClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    await operatorAClient.auth.signInWithPassword({ email: emailOpA, password: 'Password123!' })

    viewerAClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    await viewerAClient.auth.signInWithPassword({ email: emailViewerA, password: 'Password123!' })

    tenantBClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    await tenantBClient.auth.signInWithPassword({ email: emailOwnerB, password: 'Password123!' })

    // 3. Onboard Organization A via ownerAClient
    const { data: orgARes } = await ownerAClient.rpc('create_org_with_owner_and_location', {
      p_org_name: `Org A ${timestamp}`,
      p_slug: `org-a-${timestamp}`,
      p_loc_name: 'Location A',
    })
    orgAId = (orgARes as { organization_id: string }).organization_id
    locAId = (orgARes as { location_id: string }).location_id

    // 4. Onboard Organization B via tenantBClient
    const { data: orgBRes } = await tenantBClient.rpc('create_org_with_owner_and_location', {
      p_org_name: `Org B ${timestamp}`,
      p_slug: `org-b-${timestamp}`,
      p_loc_name: 'Location B',
    })
    orgBId = (orgBRes as { organization_id: string }).organization_id
    locBId = (orgBRes as { location_id: string }).location_id

    // 5. Add Admin, Operator, Viewer to Org A
    await adminClient.from('organization_users').insert([
      { organization_id: orgAId, user_id: userAdminAId, role: 'ADMIN' },
      { organization_id: orgAId, user_id: userOperatorAId, role: 'OPERATOR' },
      { organization_id: orgAId, user_id: userViewerAId, role: 'VIEWER' },
    ])

    // Note: Org A review_destination is NOT inserted initially so prerequisite checks can be validated
    // Org B destination is confirmed
    await adminClient.from('review_destinations').insert({
      organization_id: orgBId,
      location_id: locBId,
      provider: 'google',
      url: 'https://g.page/r/test-dest-b/review',
      canonical_url: 'https://g.page/r/test-dest-b/review',
      status: 'CONFIRMED',
    })
  })

  afterAll(async () => {
    if (orgAId) await adminClient.from('organizations').delete().eq('id', orgAId)
    if (orgBId) await adminClient.from('organizations').delete().eq('id', orgBId)
    if (userOwnerAId) await adminClient.auth.admin.deleteUser(userOwnerAId)
    if (userAdminAId) await adminClient.auth.admin.deleteUser(userAdminAId)
    if (userOperatorAId) await adminClient.auth.admin.deleteUser(userOperatorAId)
    if (userViewerAId) await adminClient.auth.admin.deleteUser(userViewerAId)
    if (userOwnerBId) await adminClient.auth.admin.deleteUser(userOwnerBId)
  })

  describe('1. Provisioning & Trust Boundary (Security & RLS)', () => {
    it('provisions org entitlement in NOT_STARTED state with default hypothesis allowance', async () => {
      const { data: ent, error } = await adminClient
        .from('organization_entitlements')
        .select('*')
        .eq('organization_id', orgAId)
        .single()

      expect(error).toBeNull()
      expect(ent).toBeDefined()
      expect(ent?.status).toBe('NOT_STARTED')
      expect(ent?.allocated_requests).toBe(30)
      expect(ent?.consumed_requests).toBe(0)
      expect(ent?.duration_days).toBe(30)
      expect(ent?.started_at).toBeNull()
      expect(ent?.expires_at).toBeNull()
    })

    it('denies direct mutations on organization_entitlements by tenant clients', async () => {
      // Direct UPDATE
      const { error: updateErr } = await ownerAClient
        .from('organization_entitlements')
        .update({ allocated_requests: 99999 })
        .eq('organization_id', orgAId)

      expect(updateErr).toBeDefined()
      expect(updateErr?.code).toBe('42501') // permission denied

      // Direct DELETE
      const { error: deleteErr } = await ownerAClient
        .from('organization_entitlements')
        .delete()
        .eq('organization_id', orgAId)

      expect(deleteErr).toBeDefined()
      expect(deleteErr?.code).toBe('42501')
    })

    it('denies direct mutations on usage_ledger by tenant clients', async () => {
      const { error: insertErr } = await ownerAClient.from('usage_ledger').insert({
        organization_id: orgAId,
        event_type: 'initial_request_created',
        channel: 'email',
        units: 1,
        entity_type: 'review_request',
        entity_id: crypto.randomUUID(),
        idempotency_key: `fake-key-${Date.now()}`,
      })

      expect(insertErr).toBeDefined()
      expect(insertErr?.code).toBe('42501') // permission denied
    })

    it('completely denies direct access to cost_ledger for authenticated tenant clients', async () => {
      // Owner
      const { error: ownerErr } = await ownerAClient.from('cost_ledger').select('*').eq('organization_id', orgAId)
      expect(ownerErr).toBeDefined()
      expect(ownerErr?.code).toBe('42501')

      // Admin
      const { error: adminErr } = await adminAClient.from('cost_ledger').select('*').eq('organization_id', orgAId)
      expect(adminErr).toBeDefined()
      expect(adminErr?.code).toBe('42501')

      // Operator
      const { error: opErr } = await operatorAClient.from('cost_ledger').select('*').eq('organization_id', orgAId)
      expect(opErr).toBeDefined()
      expect(opErr?.code).toBe('42501')

      // Viewer
      const { error: viewerErr } = await viewerAClient.from('cost_ledger').select('*').eq('organization_id', orgAId)
      expect(viewerErr).toBeDefined()
      expect(viewerErr?.code).toBe('42501')
    })

    it('allows tenant clients to read their own entitlement and usage ledger rows', async () => {
      const { data: ent, error: entErr } = await ownerAClient
        .from('organization_entitlements')
        .select('status, allocated_requests, consumed_requests')
        .eq('organization_id', orgAId)
        .single()

      expect(entErr).toBeNull()
      expect(ent).toBeDefined()
      expect(ent?.status).toBe('NOT_STARTED')
    })

    it('enforces cross-tenant isolation: Tenant A cannot read Tenant B rows', async () => {
      const { data: entB } = await ownerAClient
        .from('organization_entitlements')
        .select('*')
        .eq('organization_id', orgBId)

      expect(entB).toEqual([])
    })
  })

  describe('2. Explicit Trial Start & Activation Boundary (Section 1)', () => {
    it('completion received before trial start consumes zero units and returns TRIAL_NOT_ACTIVE', async () => {
      const key = `pre-start-${Date.now()}`
      const { data: res } = await adminClient.rpc('consume_trial_entitlement', {
        p_org_id: orgAId,
        p_review_request_id: crypto.randomUUID(),
        p_idempotency_key: key,
      })

      const result = res as { allowed: boolean; reason: string; remaining: number }
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('TRIAL_NOT_ACTIVE')
      expect(result.remaining).toBe(0)

      // Verify consumed_requests remains 0 and status remains NOT_STARTED
      const { data: ent } = await adminClient
        .from('organization_entitlements')
        .select('status, consumed_requests')
        .eq('organization_id', orgAId)
        .single()

      expect(ent?.status).toBe('NOT_STARTED')
      expect(ent?.consumed_requests).toBe(0)

      // Verify no entry was added to usage_ledger
      const { data: ledgerRow } = await adminClient
        .from('usage_ledger')
        .select('id')
        .eq('idempotency_key', key)
        .maybeSingle()

      expect(ledgerRow).toBeNull()
    })

    it('attempting to start trial without any review destination fails with ACTIVATION_NOT_READY', async () => {
      activeClient = ownerAClient
      const res = await startOrganizationTrialAction(orgAId)

      expect(res.success).toBe(false)
      expect(res.reason).toBe('ACTIVATION_NOT_READY')
      expect(res.error).toContain('ACTIVATION_NOT_READY')

      // Verify status is still NOT_STARTED
      const { data: ent } = await adminClient
        .from('organization_entitlements')
        .select('status')
        .eq('organization_id', orgAId)
        .single()

      expect(ent?.status).toBe('NOT_STARTED')
    })

    it('pending destination cannot start trial (ACTIVATION_NOT_READY)', async () => {
      activeClient = ownerAClient
      const { data: destPending } = await adminClient
        .from('review_destinations')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          provider: 'google',
          url: 'https://g.page/r/test-dest-a/review',
          canonical_url: 'https://g.page/r/test-dest-a/review',
          status: 'PENDING_CONFIRMATION',
        })
        .select('id')
        .single()

      const resPending = await startOrganizationTrialAction(orgAId)
      expect(resPending.success).toBe(false)
      expect(resPending.reason).toBe('ACTIVATION_NOT_READY')

      // Clean up the pending destination for subsequent tests
      await adminClient.from('review_destinations').delete().eq('id', destPending!.id)
    })

    it('confirmed destination with invalid non-Google URL cannot start trial (ACTIVATION_NOT_READY)', async () => {
      activeClient = ownerAClient
      const { data: destInvalid } = await adminClient
        .from('review_destinations')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          provider: 'google',
          url: 'https://not-google.com/review',
          canonical_url: 'https://not-google.com/review',
          status: 'CONFIRMED',
        })
        .select('id')
        .single()

      const resInvalid = await startOrganizationTrialAction(orgAId)
      expect(resInvalid.success).toBe(false)
      expect(resInvalid.reason).toBe('ACTIVATION_NOT_READY')

      await adminClient.from('review_destinations').delete().eq('id', destInvalid!.id)
    })

    it('confirmed destination with malicious URL cannot start trial (ACTIVATION_NOT_READY)', async () => {
      activeClient = ownerAClient
      const { data: destMalicious } = await adminClient
        .from('review_destinations')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          provider: 'google',
          url: 'https://malicious.evil.attacker.test/phishing',
          canonical_url: 'https://malicious.evil.attacker.test/phishing',
          status: 'CONFIRMED',
        })
        .select('id')
        .single()

      const resMalicious = await startOrganizationTrialAction(orgAId)
      expect(resMalicious.success).toBe(false)
      expect(resMalicious.reason).toBe('ACTIVATION_NOT_READY')

      await adminClient.from('review_destinations').delete().eq('id', destMalicious!.id)
    })

    it('confirmed destination on inactive location cannot start trial (ACTIVATION_NOT_READY)', async () => {
      // Deactivate Location A temporarily
      await adminClient.from('locations').update({ status: 'INACTIVE' }).eq('id', locAId)

      const { data: destValid } = await adminClient
        .from('review_destinations')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          provider: 'google',
          url: 'https://g.page/r/test-dest-a/review',
          canonical_url: 'https://g.page/r/test-dest-a/review',
          status: 'CONFIRMED',
        })
        .select('id')
        .single()

      activeClient = ownerAClient
      const resInactiveLoc = await startOrganizationTrialAction(orgAId)
      expect(resInactiveLoc.success).toBe(false)
      expect(resInactiveLoc.reason).toBe('ACTIVATION_NOT_READY')

      // Restore Location A to ACTIVE for subsequent tests
      await adminClient.from('locations').update({ status: 'ACTIVE' }).eq('id', locAId)
      // Clean up destination so next tests can configure cleanly
      await adminClient.from('review_destinations').delete().eq('id', destValid!.id)
    })

    it('OPERATOR and VIEWER trial-start attempts are denied', async () => {
      // Configure confirmed valid Google destination for Org A
      await adminClient.from('review_destinations').insert({
        organization_id: orgAId,
        location_id: locAId,
        provider: 'google',
        url: 'https://g.page/r/test-dest-a/review',
        canonical_url: 'https://g.page/r/test-dest-a/review',
        status: 'CONFIRMED',
      })

      // Operator attempt
      activeClient = operatorAClient
      const opRes = await startOrganizationTrialAction(orgAId)
      expect(opRes.success).toBe(false)
      expect(opRes.reason).toBe('UNAUTHORIZED')
      expect(opRes.error).toContain('Unauthorized')

      // Viewer attempt
      activeClient = viewerAClient
      const viewerRes = await startOrganizationTrialAction(orgAId)
      expect(viewerRes.success).toBe(false)
      expect(viewerRes.reason).toBe('UNAUTHORIZED')
      expect(viewerRes.error).toContain('Unauthorized')
    })

    it('direct table update of status to ACTIVE by tenant client is denied by RLS', async () => {
      const { error: directUpdateErr } = await ownerAClient
        .from('organization_entitlements')
        .update({
          status: 'ACTIVE',
          started_at: new Date().toISOString(),
        })
        .eq('organization_id', orgAId)

      expect(directUpdateErr).toBeDefined()
      expect(directUpdateErr?.code).toBe('42501') // permission denied
    })

    it('explicit authorized start by OWNER activates trial with stable timestamps and configured duration', async () => {
      activeClient = ownerAClient
      const res = await startOrganizationTrialAction(orgAId)

      expect(res.success).toBe(true)
      expect(res.data?.status).toBe('ACTIVE')
      expect(res.data?.startedAt).toBeDefined()
      expect(res.data?.expiresAt).toBeDefined()

      const startedAt = new Date(res.data!.startedAt!)
      const expiresAt = new Date(res.data!.expiresAt!)
      const durationMs = expiresAt.getTime() - startedAt.getTime()
      const durationDays = Math.round(durationMs / (24 * 60 * 60 * 1000))

      expect(durationDays).toBe(30)

      // Verify persisted state in database
      const { data: ent } = await adminClient
        .from('organization_entitlements')
        .select('*')
        .eq('organization_id', orgAId)
        .single()

      expect(ent?.status).toBe('ACTIVE')
      expect(ent?.started_at).toBeDefined()
      expect(ent?.expires_at).toBeDefined()
    })

    it('repeated start does not reset or extend trial (idempotent)', async () => {
      const { data: entBefore } = await adminClient
        .from('organization_entitlements')
        .select('started_at, expires_at')
        .eq('organization_id', orgAId)
        .single()

      // Start again via ADMIN role
      activeClient = adminAClient
      const res = await startOrganizationTrialAction(orgAId)

      expect(res.success).toBe(true)
      expect(res.data?.status).toBe('ACTIVE')
      expect(res.data?.alreadyActive).toBe(true)

      const { data: entAfter } = await adminClient
        .from('organization_entitlements')
        .select('started_at, expires_at')
        .eq('organization_id', orgAId)
        .single()

      // Timestamps must remain identical
      expect(entAfter?.started_at).toBe(entBefore?.started_at)
      expect(entAfter?.expires_at).toBe(entBefore?.expires_at)
    })

    it('concurrent trial-start attempts remain safe and idempotent', async () => {
      activeClient = ownerAClient
      const promises = [
        startOrganizationTrialAction(orgAId),
        startOrganizationTrialAction(orgAId),
        startOrganizationTrialAction(orgAId),
      ]

      const results = await Promise.all(promises)
      for (const r of results) {
        expect(r.success).toBe(true)
        expect(r.data?.status).toBe('ACTIVE')
      }
    })

    it('proves configuration-derived duration/allowance reaches the read model and UI with no hardcoded 30-day assumption', async () => {
      // 1. Re-provision Org B with non-default hypothesis: 45 requests, 60 days
      await adminClient.rpc('provision_organization_trial', {
        p_org_id: orgBId,
        p_allocated_requests: 45,
        p_duration_days: 60,
      })

      // 2. Set up valid confirmed Google review destination for Org B
      await adminClient.from('review_destinations').insert({
        organization_id: orgBId,
        location_id: locBId,
        provider: 'google',
        url: 'https://g.page/r/test-dest-b/review',
        canonical_url: 'https://g.page/r/test-dest-b/review',
        status: 'CONFIRMED',
      })

      // 3. Verify read model via tenantBClient receives configured values, not hardcoded 30
      activeClient = tenantBClient
      const usageB = await getOrganizationUsageSummary(orgBId)

      expect(usageB.success).toBe(true)
      expect(usageB.data?.entitlement.allocatedRequests).toBe(45)
      expect(usageB.data?.entitlement.durationDays).toBe(60)
      expect(usageB.data?.entitlement.remainingRequests).toBe(45)
      expect(usageB.data?.canStartTrial).toBe(true)

      // 4. Start trial for Org B: expiry must be calculated from 60 days duration
      const startB = await startOrganizationTrialAction(orgBId)
      expect(startB.success).toBe(true)
      expect(startB.data?.status).toBe('ACTIVE')

      const startBTime = new Date(startB.data!.startedAt!).getTime()
      const expiresBTime = new Date(startB.data!.expiresAt!).getTime()
      const durationBDays = Math.round((expiresBTime - startBTime) / (24 * 60 * 60 * 1000))

      expect(durationBDays).toBe(60)
    })
  })

  describe('3. Entitlement Consumption & Idempotency (Post-Activation)', () => {
    it('eligible request after explicit start claims entitlement, increments consumed_requests, and appends to usage_ledger', async () => {
      const reviewReqId = crypto.randomUUID()
      const key = `claim-test-1-${Date.now()}`

      const { data: res, error } = await adminClient.rpc('consume_trial_entitlement', {
        p_org_id: orgAId,
        p_review_request_id: reviewReqId,
        p_idempotency_key: key,
      })

      expect(error).toBeNull()
      const result = res as {
        allowed: boolean
        reason: string
        already_consumed: boolean
        consumed: number
        remaining: number
      }

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('ENTITLEMENT_GRANTED')
      expect(result.already_consumed).toBe(false)
      expect(result.consumed).toBe(1)
      expect(result.remaining).toBe(29)

      // Verify usage_ledger has the initial_request_created entry
      const { data: ledgerRow } = await adminClient
        .from('usage_ledger')
        .select('*')
        .eq('idempotency_key', key)
        .single()

      expect(ledgerRow).toBeDefined()
      expect(ledgerRow?.event_type).toBe('initial_request_created')
      expect(ledgerRow?.units).toBe(1)
      expect(ledgerRow?.entity_id).toBe(reviewReqId)
    })

    it('idempotently handles identical claim keys without double-consuming allowance', async () => {
      const reviewReqId = crypto.randomUUID()
      const key = `claim-idempotent-${Date.now()}`

      // First call
      const { data: firstRes } = await adminClient.rpc('consume_trial_entitlement', {
        p_org_id: orgAId,
        p_review_request_id: reviewReqId,
        p_idempotency_key: key,
      })
      expect((firstRes as { allowed: boolean }).allowed).toBe(true)

      // Re-read consumed count
      const { data: entBefore } = await adminClient
        .from('organization_entitlements')
        .select('consumed_requests')
        .eq('organization_id', orgAId)
        .single()

      // Second call with same idempotency key
      const { data: secondRes } = await adminClient.rpc('consume_trial_entitlement', {
        p_org_id: orgAId,
        p_review_request_id: reviewReqId,
        p_idempotency_key: key,
      })

      const second = secondRes as {
        allowed: boolean
        reason: string
        already_consumed: boolean
      }
      expect(second.allowed).toBe(true)
      expect(second.reason).toBe('ENTITLEMENT_ALREADY_CONSUMED')
      expect(second.already_consumed).toBe(true)

      // Verify consumed count has NOT incremented
      const { data: entAfter } = await adminClient
        .from('organization_entitlements')
        .select('consumed_requests')
        .eq('organization_id', orgAId)
        .single()

      expect(entAfter?.consumed_requests).toBe(entBefore?.consumed_requests)
    })
  })

  describe('4. Specific Denial Reasons & Lifecycle Limits', () => {
    it('denies consumption with REQUEST_LIMIT_REACHED when consumed >= allocated', async () => {
      // Set org allowance to 1 and consumed to 1
      await adminClient
        .from('organization_entitlements')
        .update({
          allocated_requests: 1,
          consumed_requests: 1,
          status: 'EXHAUSTED',
        })
        .eq('organization_id', orgAId)

      const key = `limit-reached-${Date.now()}`
      const { data: res } = await adminClient.rpc('consume_trial_entitlement', {
        p_org_id: orgAId,
        p_review_request_id: crypto.randomUUID(),
        p_idempotency_key: key,
      })

      const result = res as { allowed: boolean; reason: string; remaining: number }
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('REQUEST_LIMIT_REACHED')
      expect(result.remaining).toBe(0)
    })

    it('denies consumption with TRIAL_EXPIRED when trial time has elapsed', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      await adminClient
        .from('organization_entitlements')
        .update({
          allocated_requests: 30,
          consumed_requests: 2,
          expires_at: yesterday,
          status: 'ACTIVE',
        })
        .eq('organization_id', orgAId)

      const key = `expired-test-${Date.now()}`
      const { data: res } = await adminClient.rpc('consume_trial_entitlement', {
        p_org_id: orgAId,
        p_review_request_id: crypto.randomUUID(),
        p_idempotency_key: key,
      })

      const result = res as { allowed: boolean; reason: string }
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('TRIAL_EXPIRED')

      // Verify status was transitioned to EXPIRED in database
      const { data: ent } = await adminClient
        .from('organization_entitlements')
        .select('status')
        .eq('organization_id', orgAId)
        .single()

      expect(ent?.status).toBe('EXPIRED')
    })

    it('denies consumption with TRIAL_NOT_ACTIVE when status is SUSPENDED or ENDED', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      await adminClient
        .from('organization_entitlements')
        .update({
          status: 'SUSPENDED',
          expires_at: tomorrow,
          allocated_requests: 30,
          consumed_requests: 0,
        })
        .eq('organization_id', orgAId)

      const { data: resSuspended } = await adminClient.rpc('consume_trial_entitlement', {
        p_org_id: orgAId,
        p_review_request_id: crypto.randomUUID(),
        p_idempotency_key: `suspended-${Date.now()}`,
      })

      expect((resSuspended as { reason: string }).reason).toBe('TRIAL_NOT_ACTIVE')

      await adminClient
        .from('organization_entitlements')
        .update({ status: 'ENDED' })
        .eq('organization_id', orgAId)

      const { data: resEnded } = await adminClient.rpc('consume_trial_entitlement', {
        p_org_id: orgAId,
        p_review_request_id: crypto.randomUUID(),
        p_idempotency_key: `ended-${Date.now()}`,
      })

      expect((resEnded as { reason: string }).reason).toBe('TRIAL_NOT_ACTIVE')
    })
  })

  describe('5. Concurrency Safety with Advisory Locks', () => {
    it('allows exactly 1 claim and blocks 4 when 1 unit remains under concurrent contention', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      // Reset Org A to 1 remaining unit
      await adminClient
        .from('organization_entitlements')
        .update({
          status: 'ACTIVE',
          allocated_requests: 5,
          consumed_requests: 4,
          expires_at: tomorrow,
        })
        .eq('organization_id', orgAId)

      const promises = Array.from({ length: 5 }, (_, i) => {
        const reqId = crypto.randomUUID()
        const key = `race-lock-${i}-${Date.now()}`
        return adminClient.rpc('consume_trial_entitlement', {
          p_org_id: orgAId,
          p_review_request_id: reqId,
          p_idempotency_key: key,
        })
      })

      const results = await Promise.all(promises)
      const allowedCount = results.filter((r) => (r.data as { allowed: boolean })?.allowed).length
      const blockedCount = results.filter((r) => !(r.data as { allowed: boolean })?.allowed).length

      expect(allowedCount).toBe(1)
      expect(blockedCount).toBe(4)

      // Final state must be EXHAUSTED with consumed = 5
      const { data: finalEnt } = await adminClient
        .from('organization_entitlements')
        .select('status, consumed_requests')
        .eq('organization_id', orgAId)
        .single()

      expect(finalEnt?.status).toBe('EXHAUSTED')
      expect(finalEnt?.consumed_requests).toBe(5)
    })
  })

  describe('6. Canonical Workflow Integration (Zero-Consumption on Ineligible & Suppressed)', () => {
    beforeAll(async () => {
      // Re-provision Org A to active with fresh allowance
      await adminClient
        .from('organization_entitlements')
        .update({
          status: 'ACTIVE',
          allocated_requests: 30,
          consumed_requests: 0,
          started_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        })
        .eq('organization_id', orgAId)
    })

    it('ineligible customer (permission denied) consumes ZERO entitlement units', async () => {
      const { data: entBefore } = await adminClient
        .from('organization_entitlements')
        .select('consumed_requests')
        .eq('organization_id', orgAId)
        .single()

      const email = `ineligible.${Date.now()}@example.test`
      const { data: cust } = await adminClient
        .from('customers')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          first_name: 'Ineligible',
          last_name: 'Customer',
          email,
          permission_email: 'denied',
        })
        .select('id')
        .single()

      const { data: cce } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: cust!.id,
          source: 'quick_complete',
          source_event_id: `evt_ineligible_${Date.now()}`,
          contact: { email },
          permission: { email: 'denied' },
        })
        .select('id, source_event_id')
        .single()

      const res = await executeReviewRequestHandler({
        event: {
          data: {
            eventId: cce!.id,
            organizationId: orgAId,
            locationId: locAId,
            customerId: cust!.id,
            sourceEventId: cce!.source_event_id,
          },
        },
        step: mockStep as unknown as Parameters<typeof executeReviewRequestHandler>[0]['step'],
      })

      expect(res.processed).toBe(false)
      expect(res.decision).toBe('EMAIL_PERMISSION_DENIED')

      const { data: entAfter } = await adminClient
        .from('organization_entitlements')
        .select('consumed_requests')
        .eq('organization_id', orgAId)
        .single()

      expect(entAfter?.consumed_requests).toBe(entBefore?.consumed_requests)
    })

    it('suppressed customer consumes ZERO entitlement units', async () => {
      const email = `suppressed.${Date.now()}@example.test`
      await adminClient.from('suppressions').insert({
        organization_id: orgAId,
        channel: 'email',
        contact_hash: hashSuppressionContact('email', email),
        reason: 'UNSUBSCRIBE',
      })

      const { data: entBefore } = await adminClient
        .from('organization_entitlements')
        .select('consumed_requests')
        .eq('organization_id', orgAId)
        .single()

      const { data: cust } = await adminClient
        .from('customers')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          first_name: 'Suppressed',
          last_name: 'Customer',
          email,
          permission_email: 'allowed',
        })
        .select('id')
        .single()

      const { data: cce } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: cust!.id,
          source: 'quick_complete',
          source_event_id: `evt_suppressed_${Date.now()}`,
          contact: { email },
          permission: { email: 'allowed' },
        })
        .select('id, source_event_id')
        .single()

      const res = await executeReviewRequestHandler({
        event: {
          data: {
            eventId: cce!.id,
            organizationId: orgAId,
            locationId: locAId,
            customerId: cust!.id,
            sourceEventId: cce!.source_event_id,
          },
        },
        step: mockStep as unknown as Parameters<typeof executeReviewRequestHandler>[0]['step'],
      })

      expect(res.processed).toBe(false)
      expect(res.decision).toBe('SUPPRESSED')

      const { data: entAfter } = await adminClient
        .from('organization_entitlements')
        .select('consumed_requests')
        .eq('organization_id', orgAId)
        .single()

      expect(entAfter?.consumed_requests).toBe(entBefore?.consumed_requests)
    })

    it('stops reminder cleanly with TRIAL_EXPIRED when trial expires while reminder is pending', async () => {
      await adminClient
        .from('organization_entitlements')
        .update({
          status: 'ACTIVE',
          allocated_requests: 30,
          consumed_requests: 0,
          started_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        })
        .eq('organization_id', orgAId)

      const email = `trialexp.${Date.now()}@example.test`
      const { data: cust } = await adminClient
        .from('customers')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          first_name: 'Trial',
          last_name: 'ExpireTest',
          email,
          permission_email: 'allowed',
        })
        .select('id')
        .single()

      const { data: cce } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgAId,
          location_id: locAId,
          customer_id: cust!.id,
          source: 'quick_complete',
          source_event_id: `evt_trialexp_${Date.now()}`,
          contact: { email },
          permission: { email: 'allowed' },
        })
        .select('id, source_event_id')
        .single()

      const customMockStep = {
        run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
        sleep: async (stepName: string) => {
          // Only expire the trial while reminder is waiting (not during initial request delay)
          if (stepName === 'wait-for-reminder-delay') {
            await adminClient
              .from('organization_entitlements')
              .update({
                expires_at: new Date(Date.now() - 60000).toISOString(),
                status: 'EXPIRED',
              })
              .eq('organization_id', orgAId)
          }
        },
      }

      const res = await executeReviewRequestHandler({
        event: {
          data: {
            eventId: cce!.id,
            organizationId: orgAId,
            locationId: locAId,
            customerId: cust!.id,
            sourceEventId: cce!.source_event_id,
          },
        },
        step: customMockStep as unknown as Parameters<typeof executeReviewRequestHandler>[0]['step'],
      })

      expect(res.processed).toBe(true)
      expect(res.emailSent).toBe(true) // initial send succeeded
      expect(res.reminderSent).toBe(false)
      expect(res.reminderSkippedReason).toBe('TRIAL_EXPIRED')
    })
  })

  describe('7. Customer Visibility & Internal Economics Isolation (Section 2)', () => {
    beforeAll(async () => {
      // Re-provision Org A to active with fresh allowance
      await adminClient
        .from('organization_entitlements')
        .update({
          status: 'ACTIVE',
          allocated_requests: 30,
          consumed_requests: 0,
          started_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        })
        .eq('organization_id', orgAId)
    })

    it('returns factual usage summary matching ledger counts without cost fields', async () => {
      activeClient = ownerAClient
      const summary = await getOrganizationUsageSummary(orgAId)

      expect(summary.success).toBe(true)
      expect(summary.data).toBeDefined()
      expect(summary.data?.organizationId).toBe(orgAId)
      expect(summary.data?.entitlement.status).toBe('ACTIVE')
      expect(summary.data?.entitlement.allocatedRequests).toBe(30)
      expect(summary.data?.ledgerCounts).toBeDefined()
      expect(summary.data?.ledgerCounts.initialRequestsCreated).toBeGreaterThanOrEqual(1)

      // Strict boundary: data shape MUST NOT contain any cost or economics fields
      const summaryData = summary.data as unknown as Record<string, unknown>
      expect(summaryData.cost).toBeUndefined()
      expect(summaryData.cogs).toBeUndefined()
      expect(summaryData.economics).toBeUndefined()
      expect(summaryData.microUsd).toBeUndefined()
      expect(summaryData.providerCost).toBeUndefined()

      // Viewer can also view factual usage
      activeClient = viewerAClient
      const viewerSummary = await getOrganizationUsageSummary(orgAId)
      expect(viewerSummary.success).toBe(true)

      // Cross-tenant access is blocked
      activeClient = tenantBClient
      const blockedSummary = await getOrganizationUsageSummary(orgAId)
      expect(blockedSummary.success).toBe(false)
    })

    it('proves service_role can write and read the internal cost ledger while tenant access is completely denied', async () => {
      // 1. Service role writes internal cost entry
      const { error: insertErr } = await adminClient.from('cost_ledger').insert({
        organization_id: orgAId,
        cost_category: 'email_provider',
        cost_status: 'CONFIGURED_ESTIMATE',
        currency: 'USD',
        amount_micro_usd: 1000,
        description: 'Internal operational estimate',
      })
      expect(insertErr).toBeNull()

      // 2. Service role can read cost entries
      const { data: adminRows, error: adminReadErr } = await adminClient
        .from('cost_ledger')
        .select('*')
        .eq('organization_id', orgAId)
      expect(adminReadErr).toBeNull()
      expect(adminRows?.length).toBeGreaterThanOrEqual(1)

      // 3. Tenant OWNER, ADMIN, OPERATOR, VIEWER are all denied access
      const { error: ownerReadErr } = await ownerAClient.from('cost_ledger').select('*').eq('organization_id', orgAId)
      expect(ownerReadErr).toBeDefined()
      expect(ownerReadErr?.code).toBe('42501')

      const { error: adminReadErr2 } = await adminAClient.from('cost_ledger').select('*').eq('organization_id', orgAId)
      expect(adminReadErr2).toBeDefined()
      expect(adminReadErr2?.code).toBe('42501')

      const { error: opReadErr } = await operatorAClient.from('cost_ledger').select('*').eq('organization_id', orgAId)
      expect(opReadErr).toBeDefined()
      expect(opReadErr?.code).toBe('42501')

      const { error: viewerReadErr } = await viewerAClient.from('cost_ledger').select('*').eq('organization_id', orgAId)
      expect(viewerReadErr).toBeDefined()
      expect(viewerReadErr?.code).toBe('42501')
    })
  })
})
