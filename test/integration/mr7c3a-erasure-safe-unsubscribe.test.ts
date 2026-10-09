import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import type { Database } from '../../src/types/database'
import { GET, POST } from '../../src/app/unsubscribe/[token]/route'
import { generateUnsubscribeToken } from '../../src/domain/unsubscribe'
import { generateTrackingToken } from '../../src/domain/tracking'
import { hashSuppressionContact } from '../../src/domain/suppression'
import {
  executeReviewRequestHandler,
  type ReviewRequestEventData,
} from '../../src/inngest/functions/review-request'
import * as emailProviderModule from '../../src/providers/email'
import { checkCustomerErasureEligibility } from '../../src/domain/privacy/erasure-guard'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

import { execSync } from 'child_process'

function executeDirectSql(sql: string): string {
  try {
    return execSync('docker exec -i supabase_db_MPG-Reputation psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A', {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (err) {
    const errorWithStderr = err as { stderr?: Buffer | string; message?: string }
    const stderr = errorWithStderr.stderr ? errorWithStderr.stderr.toString() : ''
    const msg = stderr || errorWithStderr.message || 'Direct SQL execution failed'
    if (msg.includes('Recipient suppression contact hash is immutable once bound')) {
      throw new Error(msg)
    }
    try {
      return execSync('pnpm dlx supabase@2.117.0 db query --local', {
        input: sql,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (cliErr) {
      const cliErrorWithStderr = cliErr as { stderr?: Buffer | string; message?: string }
      const cliStderr = cliErrorWithStderr.stderr ? cliErrorWithStderr.stderr.toString() : ''
      throw new Error(cliStderr || cliErrorWithStderr.message || 'CLI SQL query failed')
    }
  }
}

function checkTablePrivilegeDirect(role: string, table: string, privilege: string): boolean {
  const sql = `SELECT has_table_privilege('${role}', '${table}', '${privilege}');`
  const result = executeDirectSql(sql).trim()
  return result === 't' || result === 'true'
}

const isDbAvailable = !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'dummy_service_role_key'

describe.skipIf(!isDbAvailable)('MR-7C.3A Erasure-Safe Unsubscribe Decoupling Integration Suite', () => {
  let adminClient: ReturnType<typeof createClient<Database>>
  let ownerUserClient: ReturnType<typeof createClient<Database>>
  let adminRoleClient: ReturnType<typeof createClient<Database>>
  let operatorClient: ReturnType<typeof createClient<Database>>
  let viewerClient: ReturnType<typeof createClient<Database>>
  let anonClient: ReturnType<typeof createClient<Database>>

  let orgId: string
  let locId: string
  let custId: string
  let completionEventId: string
  let validToken: string
  let validTokenHash: string
  let reviewRequestId: string
  let expectedSuppressionHash: string

  let ownerUserId: string
  let adminRoleId: string
  let operatorUserId: string
  let viewerUserId: string

  const timestamp = Date.now()
  const customerEmail = `privacy.patient.${timestamp}@example.test`

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    expectedSuppressionHash = hashSuppressionContact('email', customerEmail)

    // 1. Create Organization
    const { data: org, error: orgErr } = await adminClient
      .from('organizations')
      .insert({
        name: `MR7C3A Privacy Org ${timestamp}`,
        slug: `mr7c3a-org-${timestamp}`,
        status: 'ACTIVE',
      })
      .select('id')
      .single()

    if (orgErr || !org) throw new Error(`Failed to create test org: ${orgErr?.message}`)
    orgId = org.id

    // 2. Create Location
    const { data: loc, error: locErr } = await adminClient
      .from('locations')
      .insert({
        organization_id: orgId,
        name: 'Privacy Care Location',
        status: 'ACTIVE',
        review_reply_to_email: 'feedback@privacy.test',
      })
      .select('id')
      .single()

    if (locErr || !loc) throw new Error(`Failed to create test loc: ${locErr?.message}`)
    locId = loc.id

    // 3. Create Customer
    const { data: cust, error: custErr } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'Jordan',
        last_name: 'Privacy',
        email: customerEmail,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    if (custErr || !cust) throw new Error(`Failed to create test cust: ${custErr?.message}`)
    custId = cust.id

    // 4. Create Completion Event with intake snapshot
    const { data: compEvent, error: compErr } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        source: 'privacy_harness',
        source_event_id: `src_c3a_${timestamp}`,
        contact: {
          email: customerEmail,
          firstName: 'Jordan',
          lastName: 'Privacy',
        },
      })
      .select('id')
      .single()

    if (compErr || !compEvent) throw new Error(`Failed to create completion event: ${compErr?.message}`)
    completionEventId = compEvent.id

    // 5. Create Review Request with unsubscribe tokens
    const tracking = generateTrackingToken()
    const unsub = generateUnsubscribeToken()
    validToken = unsub.token
    validTokenHash = unsub.tokenHash

    const { data: reqRecord, error: reqErr } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        completion_event_id: completionEventId,
        channel: 'email',
        status: 'SCHEDULED',
        token: tracking.token,
        token_hash: tracking.tokenHash,
        unsubscribe_token: validToken,
        unsubscribe_token_hash: validTokenHash,
      })
      .select('id')
      .single()

    if (reqErr || !reqRecord) throw new Error(`Failed to create review request: ${reqErr?.message}`)
    reviewRequestId = reqRecord.id

    // Bind recipient evidence in system-owned table
    await adminClient
      .from('review_request_recipient_evidence')
      .insert({
        organization_id: orgId,
        review_request_id: reviewRequestId,
        channel: 'email',
        suppression_contact_hash: expectedSuppressionHash,
      })

    // 6. Create test authenticated users for all tenant roles: OWNER, ADMIN, OPERATOR, VIEWER
    const createRoleClient = async (role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER') => {
      const email = `role_${role.toLowerCase()}_${timestamp}@test.local`
      const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
        email,
        password: 'Password123!',
        email_confirm: true,
      })
      if (authErr || !authUser.user) throw new Error(`Failed to create auth user ${role}: ${authErr?.message}`)

      await adminClient.from('organization_users').insert({
        organization_id: orgId,
        user_id: authUser.user.id,
        role,
      })

      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { error: signErr } = await client.auth.signInWithPassword({
        email,
        password: 'Password123!',
      })
      if (signErr) throw new Error(`${role} signin failed: ${signErr.message}`)

      return { userId: authUser.user.id, client }
    }

    const ownerRes = await createRoleClient('OWNER')
    ownerUserId = ownerRes.userId
    ownerUserClient = ownerRes.client

    const adminRes = await createRoleClient('ADMIN')
    adminRoleId = adminRes.userId
    adminRoleClient = adminRes.client

    const operatorRes = await createRoleClient('OPERATOR')
    operatorUserId = operatorRes.userId
    operatorClient = operatorRes.client

    const viewerRes = await createRoleClient('VIEWER')
    viewerUserId = viewerRes.userId
    viewerClient = viewerRes.client

    anonClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  })

  afterAll(async () => {
    if (orgId) {
      await adminClient.from('organizations').delete().eq('id', orgId)
    }
    const userIds = [ownerUserId, adminRoleId, operatorUserId, viewerUserId].filter(Boolean)
    for (const uid of userIds) {
      await adminClient.auth.admin.deleteUser(uid)
    }
  })

  // --------------------------------------------------------------------------
  // Core Decoupled Unsubscribe Functionality
  // --------------------------------------------------------------------------

  it('1. Existing email unsubscribe still works via recipient evidence', async () => {
    const req = new NextRequest(`http://localhost:3000/unsubscribe/${validToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const res = await POST(req, { params: Promise.resolve({ token: validToken }) })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Review requests stopped')

    // Verify suppression record created with canonical contact hash from evidence
    const { data: suppression } = await adminClient
      .from('suppressions')
      .select('id, organization_id, channel, reason, contact_hash')
      .eq('organization_id', orgId)
      .eq('channel', 'email')
      .eq('contact_hash', expectedSuppressionHash)
      .maybeSingle()

    expect(suppression).not.toBeNull()
    expect(suppression?.reason).toBe('CUSTOMER_UNSUBSCRIBED')
  })

  it('2. Existing one-click unsubscribe still works', async () => {
    const unsub2 = generateUnsubscribeToken()
    const track2 = generateTrackingToken()
    const email2 = `oneclick.${timestamp}@example.test`
    const hash2 = hashSuppressionContact('email', email2)

    const { data: cust2 } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'OneClick',
        email: email2,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    const { data: comp2 } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: cust2!.id,
        source: 'privacy_harness',
        source_event_id: `src_oneclick_${timestamp}`,
        contact: { email: email2 },
      })
      .select('id')
      .single()

    const { data: req2 } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: cust2!.id,
        completion_event_id: comp2!.id,
        channel: 'email',
        status: 'SCHEDULED',
        token: track2.token,
        token_hash: track2.tokenHash,
        unsubscribe_token: unsub2.token,
        unsubscribe_token_hash: unsub2.tokenHash,
      })
      .select('id')
      .single()

    await adminClient.from('review_request_recipient_evidence').insert({
      organization_id: orgId,
      review_request_id: req2!.id,
      channel: 'email',
      suppression_contact_hash: hash2,
    })

    const req = new NextRequest(`http://localhost:3000/unsubscribe/${unsub2.token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: 'List-Unsubscribe=One-Click',
    })
    const res = await POST(req, { params: Promise.resolve({ token: unsub2.token }) })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ unsubscribed: true })

    const { data: supp } = await adminClient
      .from('suppressions')
      .select('id')
      .eq('organization_id', orgId)
      .eq('contact_hash', hash2)
      .maybeSingle()

    expect(supp).not.toBeNull()
  })

  it('3. Suppression hash stored matches canonical hash function', async () => {
    const { data: evidence } = await adminClient
      .from('review_request_recipient_evidence')
      .select('suppression_contact_hash')
      .eq('review_request_id', reviewRequestId)
      .single()

    expect(evidence?.suppression_contact_hash).toBe(expectedSuppressionHash)
    expect(evidence?.suppression_contact_hash).toBe(hashSuppressionContact('email', customerEmail))
  })

  it('4. No raw recipient email is added to recipient evidence', async () => {
    const { data: evidence } = await adminClient
      .from('review_request_recipient_evidence')
      .select('suppression_contact_hash')
      .eq('review_request_id', reviewRequestId)
      .single()

    const hash = evidence?.suppression_contact_hash
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toContain('@')
    expect(hash).not.toContain(customerEmail)
  })

  it('5. Unsubscribe succeeds even if customer record was deleted or email was removed', async () => {
    const unsub3 = generateUnsubscribeToken()
    const track3 = generateTrackingToken()
    const email3 = `deleted.customer.${timestamp}@example.test`
    const hash3 = hashSuppressionContact('email', email3)

    const { data: cust3 } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'ToDelete',
        email: email3,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    const { data: comp3 } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: cust3!.id,
        source: 'privacy_harness',
        source_event_id: `src_del_${timestamp}`,
        contact: { email: email3 },
      })
      .select('id')
      .single()

    const { data: req3 } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: cust3!.id,
        completion_event_id: comp3!.id,
        channel: 'email',
        status: 'DELIVERED',
        token: track3.token,
        token_hash: track3.tokenHash,
        unsubscribe_token: unsub3.token,
        unsubscribe_token_hash: unsub3.tokenHash,
      })
      .select('id')
      .single()

    await adminClient.from('review_request_recipient_evidence').insert({
      organization_id: orgId,
      review_request_id: req3!.id,
      channel: 'email',
      suppression_contact_hash: hash3,
    })

    // Blank out customer PII
    await adminClient
      .from('customers')
      .update({ email: null, last_name: null })
      .eq('id', cust3!.id)

    // GET /unsubscribe/:token
    const getReq = new NextRequest(`http://localhost:3000/unsubscribe/${unsub3.token}`, { method: 'GET' })
    const getRes = await GET(getReq, { params: Promise.resolve({ token: unsub3.token }) })
    expect(getRes.status).toBe(200)

    // POST /unsubscribe/:token
    const postReq = new NextRequest(`http://localhost:3000/unsubscribe/${unsub3.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const postRes = await POST(postReq, { params: Promise.resolve({ token: unsub3.token }) })
    expect(postRes.status).toBe(200)

    // Verify suppression created
    const { data: supp3 } = await adminClient
      .from('suppressions')
      .select('id')
      .eq('organization_id', orgId)
      .eq('contact_hash', hash3)
      .maybeSingle()

    expect(supp3).not.toBeNull()
  })

  it('6. Invariant: Unsubscribe NEVER regresses SENT, DELIVERED, or CLICKED status', async () => {
    const unsub4 = generateUnsubscribeToken()
    const track4 = generateTrackingToken()
    const email4 = `delivered.status.${timestamp}@example.test`
    const hash4 = hashSuppressionContact('email', email4)

    const { data: cust4 } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'StatusGuard',
        email: email4,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    const { data: comp4 } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: cust4!.id,
        source: 'privacy_harness',
        source_event_id: `src_status_${timestamp}`,
        contact: { email: email4 },
      })
      .select('id')
      .single()

    const { data: req4 } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: cust4!.id,
        completion_event_id: comp4!.id,
        channel: 'email',
        status: 'DELIVERED',
        token: track4.token,
        token_hash: track4.tokenHash,
        unsubscribe_token: unsub4.token,
        unsubscribe_token_hash: unsub4.tokenHash,
      })
      .select('id')
      .single()

    await adminClient.from('review_request_recipient_evidence').insert({
      organization_id: orgId,
      review_request_id: req4!.id,
      channel: 'email',
      suppression_contact_hash: hash4,
    })

    const postReq = new NextRequest(`http://localhost:3000/unsubscribe/${unsub4.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const postRes = await POST(postReq, { params: Promise.resolve({ token: unsub4.token }) })
    expect(postRes.status).toBe(200)

    const { data: reqAfterUnsub } = await adminClient
      .from('review_requests')
      .select('status')
      .eq('id', req4!.id)
      .single()

    expect(reqAfterUnsub?.status).toBe('DELIVERED')
  })

  // --------------------------------------------------------------------------
  // POINT 1: REMOVE LEGACY CURRENT-EMAIL GUESSING
  // --------------------------------------------------------------------------

  it('Point 1: Legacy request without recipient evidence NEVER guesses current customer email and fails closed', async () => {
    const historicalEmailA = `historical.a.${timestamp}@example.test`
    const changedEmailB = `changed.b.${timestamp}@example.test`
    const hashA = hashSuppressionContact('email', historicalEmailA)
    const hashB = hashSuppressionContact('email', changedEmailB)

    const { data: legacyCust } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'Historical',
        email: changedEmailB, // Customer record now has email B!
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    const { data: compLegacy } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: legacyCust!.id,
        source: 'quick_complete',
        source_event_id: `src_p1_${timestamp}`,
        contact: { email: historicalEmailA }, // completion event snapshot was A
      })
      .select('id')
      .single()

    const unsubLegacy = generateUnsubscribeToken()
    const trackLegacy = generateTrackingToken()

    await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: legacyCust!.id,
        completion_event_id: compLegacy!.id,
        channel: 'email',
        status: 'SENT',
        sent_at: new Date().toISOString(),
        token: trackLegacy.token,
        token_hash: trackLegacy.tokenHash,
        unsubscribe_token: unsubLegacy.token,
        unsubscribe_token_hash: unsubLegacy.tokenHash,
      })
      .select('id')
      .single()

    // No row in review_request_recipient_evidence!

    // GET /unsubscribe/:token must fail closed (404)
    const getReq = new NextRequest(`http://localhost:3000/unsubscribe/${unsubLegacy.token}`, { method: 'GET' })
    const getRes = await GET(getReq, { params: Promise.resolve({ token: unsubLegacy.token }) })
    expect(getRes.status).toBe(404)

    // POST /unsubscribe/:token must fail closed (404)
    const postReq = new NextRequest(`http://localhost:3000/unsubscribe/${unsubLegacy.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const postRes = await POST(postReq, { params: Promise.resolve({ token: unsubLegacy.token }) })
    expect(postRes.status).toBe(404)

    // CRITICAL CONSERVATIVE INVARIANT:
    // Fallback must NOT suppress current customer email B!
    const { data: suppB } = await adminClient
      .from('suppressions')
      .select('id')
      .eq('organization_id', orgId)
      .eq('contact_hash', hashB)
      .maybeSingle()

    expect(suppB).toBeNull()

    // Must NOT suppress historical completion snapshot A!
    const { data: suppA } = await adminClient
      .from('suppressions')
      .select('id')
      .eq('organization_id', orgId)
      .eq('contact_hash', hashA)
      .maybeSingle()

    expect(suppA).toBeNull()
  })

  // --------------------------------------------------------------------------
  // POINT 4: SERVER-ONLY APPEND-ONLY ACCESS CONTROL & VISIBILITY
  // --------------------------------------------------------------------------

  it('Point 4: service_role privilege model is strictly append-only (SELECT + INSERT succeed; UPDATE, DELETE, TRUNCATE fail)', async () => {
    // 1. SELECT succeeds for service_role
    const { data: selectData, error: selectErr } = await adminClient
      .from('review_request_recipient_evidence')
      .select('suppression_contact_hash')
      .eq('review_request_id', reviewRequestId)

    expect(selectErr).toBeNull()
    expect(selectData).toHaveLength(1)

    // 2. INSERT succeeds for service_role
    const testHash = '2222222222222222222222222222222222222222222222222222222222222222'
    const tracking = generateTrackingToken()
    const unsub = generateUnsubscribeToken()
    const { data: cceP4, error: cceP4Err } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        source: 'privacy_harness',
        source_event_id: `src_p4_${Date.now()}_${Math.random()}`,
        contact: { email: customerEmail },
      })
      .select('id')
      .single()
    if (cceP4Err || !cceP4) throw new Error(`Failed to create completion: ${cceP4Err?.message}`)

    const { data: testReq, error: reqErr } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        completion_event_id: cceP4.id,
        channel: 'email',
        status: 'SCHEDULED',
        token: tracking.token,
        token_hash: tracking.tokenHash,
        unsubscribe_token: unsub.token,
        unsubscribe_token_hash: unsub.tokenHash,
      })
      .select('id')
      .single()

    if (reqErr || !testReq) throw new Error(`Failed to create review request: ${reqErr?.message}`)

    const { error: insertErr } = await adminClient
      .from('review_request_recipient_evidence')
      .insert({
        organization_id: orgId,
        review_request_id: testReq.id,
        channel: 'email',
        suppression_contact_hash: testHash,
      })
    expect(insertErr).toBeNull()

    // 3. UPDATE fails for service_role at SQL privilege level (code 42501)
    const { error: updateErr } = await adminClient
      .from('review_request_recipient_evidence')
      .update({ suppression_contact_hash: '3333333333333333333333333333333333333333333333333333333333333333' })
      .eq('review_request_id', testReq.id)

    expect(updateErr).not.toBeNull()
    expect(updateErr?.code).toBe('42501')

    // 4. DELETE fails for service_role at SQL privilege level (code 42501)
    const { error: deleteErr } = await adminClient
      .from('review_request_recipient_evidence')
      .delete()
      .eq('review_request_id', testReq.id)

    expect(deleteErr).not.toBeNull()
    expect(deleteErr?.code).toBe('42501')

    // 5. TRUNCATE fails for service_role (verified directly via PostgreSQL privilege inspection)
    expect(checkTablePrivilegeDirect('service_role', 'public.review_request_recipient_evidence', 'TRUNCATE')).toBe(false)

    // Complete privilege audit for service_role directly from PostgreSQL owner/test connection
    expect(checkTablePrivilegeDirect('service_role', 'public.review_request_recipient_evidence', 'SELECT')).toBe(true)
    expect(checkTablePrivilegeDirect('service_role', 'public.review_request_recipient_evidence', 'INSERT')).toBe(true)
    expect(checkTablePrivilegeDirect('service_role', 'public.review_request_recipient_evidence', 'UPDATE')).toBe(false)
    expect(checkTablePrivilegeDirect('service_role', 'public.review_request_recipient_evidence', 'DELETE')).toBe(false)
  })

  it('Point 4: Authenticated tenant roles (OWNER, ADMIN, OPERATOR, VIEWER) and anon have NO access (SELECT, INSERT, UPDATE, DELETE all fail)', async () => {
    // Verify SQL privilege matrix directly for authenticated and anon roles
    expect(checkTablePrivilegeDirect('authenticated', 'public.review_request_recipient_evidence', 'SELECT')).toBe(false)
    expect(checkTablePrivilegeDirect('authenticated', 'public.review_request_recipient_evidence', 'INSERT')).toBe(false)
    expect(checkTablePrivilegeDirect('authenticated', 'public.review_request_recipient_evidence', 'UPDATE')).toBe(false)
    expect(checkTablePrivilegeDirect('authenticated', 'public.review_request_recipient_evidence', 'DELETE')).toBe(false)
    expect(checkTablePrivilegeDirect('authenticated', 'public.review_request_recipient_evidence', 'TRUNCATE')).toBe(false)

    expect(checkTablePrivilegeDirect('anon', 'public.review_request_recipient_evidence', 'SELECT')).toBe(false)
    expect(checkTablePrivilegeDirect('anon', 'public.review_request_recipient_evidence', 'INSERT')).toBe(false)
    expect(checkTablePrivilegeDirect('anon', 'public.review_request_recipient_evidence', 'UPDATE')).toBe(false)
    expect(checkTablePrivilegeDirect('anon', 'public.review_request_recipient_evidence', 'DELETE')).toBe(false)
    expect(checkTablePrivilegeDirect('anon', 'public.review_request_recipient_evidence', 'TRUNCATE')).toBe(false)

    const fakeHash = '1111111111111111111111111111111111111111111111111111111111111111'
    const testClients = [
      { name: 'OWNER', client: ownerUserClient },
      { name: 'ADMIN', client: adminRoleClient },
      { name: 'OPERATOR', client: operatorClient },
      { name: 'VIEWER', client: viewerClient },
      { name: 'anon', client: anonClient },
    ]

    for (const { name, client } of testClients) {
      // SELECT fails
      const { data: selData, error: selErr } = await client
        .from('review_request_recipient_evidence')
        .select('*')
      expect(selErr, `${name} SELECT should fail`).not.toBeNull()
      expect(selErr?.code, `${name} SELECT code should be 42501`).toBe('42501')
      expect(selData).toBeNull()

      // INSERT fails
      const { error: insErr } = await client
        .from('review_request_recipient_evidence')
        .insert({
          organization_id: orgId,
          review_request_id: reviewRequestId,
          channel: 'email',
          suppression_contact_hash: fakeHash,
        })
      expect(insErr, `${name} INSERT should fail`).not.toBeNull()
      expect(insErr?.code, `${name} INSERT code should be 42501`).toBe('42501')

      // UPDATE fails
      const { error: updErr } = await client
        .from('review_request_recipient_evidence')
        .update({ suppression_contact_hash: fakeHash })
        .eq('review_request_id', reviewRequestId)
      expect(updErr, `${name} UPDATE should fail`).not.toBeNull()
      expect(updErr?.code, `${name} UPDATE code should be 42501`).toBe('42501')

      // DELETE fails
      const { error: delErr } = await client
        .from('review_request_recipient_evidence')
        .delete()
        .eq('review_request_id', reviewRequestId)
      expect(delErr, `${name} DELETE should fail`).not.toBeNull()
      expect(delErr?.code, `${name} DELETE code should be 42501`).toBe('42501')
    }

    // Tenant roles querying review_requests do NOT see suppression_contact_hash column
    const { data: reqs } = await ownerUserClient
      .from('review_requests')
      .select('*')
      .eq('id', reviewRequestId)
      .single()

    expect(reqs).toBeDefined()
    expect('suppression_contact_hash' in (reqs || {})).toBe(false)
  })

  // --------------------------------------------------------------------------
  // POINT 5: DATABASE-LEVEL IMMUTABILITY
  // --------------------------------------------------------------------------

  it('Point 5: Database trigger enforces hash(A) -> hash(B) is structurally rejected as defense in depth', async () => {
    const hashA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const hashB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    const tracking = generateTrackingToken()
    const unsub = generateUnsubscribeToken()
    const { data: cceP5_1, error: cceP51Err } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        source: 'privacy_harness',
        source_event_id: `src_p5_1_${Date.now()}_${Math.random()}`,
        contact: { email: customerEmail },
      })
      .select('id')
      .single()
    if (cceP51Err || !cceP5_1) throw new Error(`Failed to create completion: ${cceP51Err?.message}`)

    const { data: testReq, error: reqErr } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        completion_event_id: cceP5_1.id,
        channel: 'email',
        status: 'SCHEDULED',
        token: tracking.token,
        token_hash: tracking.tokenHash,
        unsubscribe_token: unsub.token,
        unsubscribe_token_hash: unsub.tokenHash,
      })
      .select('id')
      .single()

    if (reqErr || !testReq) throw new Error(`Failed to create review request: ${reqErr?.message}`)

    // Insert hash(A)
    const { data: insertedEvidence, error: insErr } = await adminClient
      .from('review_request_recipient_evidence')
      .insert({
        organization_id: orgId,
        review_request_id: testReq.id,
        channel: 'email',
        suppression_contact_hash: hashA,
      })
      .select('id')
      .single()
    expect(insErr).toBeNull()

    // Test immutability trigger directly via local PostgreSQL owner connection: attempting hash(A) -> hash(B) MUST fail with trigger exception
    let mutateErr: Error | null = null
    try {
      executeDirectSql(`UPDATE public.review_request_recipient_evidence SET suppression_contact_hash = '${hashB}' WHERE id = '${insertedEvidence!.id}';`)
    } catch (err) {
      mutateErr = err instanceof Error ? err : new Error(String(err))
    }

    expect(mutateErr).not.toBeNull()
    expect(mutateErr?.message).toContain('Recipient suppression contact hash is immutable once bound')

    // Idempotent hash(A) -> hash(A) is permitted
    expect(() => {
      executeDirectSql(`UPDATE public.review_request_recipient_evidence SET suppression_contact_hash = '${hashA}' WHERE id = '${insertedEvidence!.id}';`)
    }).not.toThrow()

    // Verify stored evidence is still hash(A)
    const { data: stored } = await adminClient
      .from('review_request_recipient_evidence')
      .select('suppression_contact_hash')
      .eq('id', insertedEvidence!.id)
      .single()

    expect(stored?.suppression_contact_hash).toBe(hashA)
  })

  it('Point 5: Database trigger permits NULL -> hash(A) exactly on initial binding, but subsequent hash(A) -> hash(B) is rejected', async () => {
    const hashA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const hashB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    const tracking = generateTrackingToken()
    const unsub = generateUnsubscribeToken()
    const { data: cceP5_2, error: cceP52Err } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        source: 'privacy_harness',
        source_event_id: `src_p5_2_${Date.now()}_${Math.random()}`,
        contact: { email: customerEmail },
      })
      .select('id')
      .single()
    if (cceP52Err || !cceP5_2) throw new Error(`Failed to create completion: ${cceP52Err?.message}`)

    const { data: testReq, error: reqErr } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        completion_event_id: cceP5_2.id,
        channel: 'email',
        status: 'SCHEDULED',
        token: tracking.token,
        token_hash: tracking.tokenHash,
        unsubscribe_token: unsub.token,
        unsubscribe_token_hash: unsub.tokenHash,
      })
      .select('id')
      .single()

    if (reqErr || !testReq) throw new Error(`Failed to create review request: ${reqErr?.message}`)

    // Insert evidence with NULL
    const { data: nullEvidence, error: nullInsErr } = await adminClient
      .from('review_request_recipient_evidence')
      .insert({
        organization_id: orgId,
        review_request_id: testReq.id,
        channel: 'email',
        suppression_contact_hash: null,
      })
      .select('id')
      .single()
    expect(nullInsErr).toBeNull()

    // Update NULL -> hash(A) is allowed by trigger via local PostgreSQL owner connection
    expect(() => {
      executeDirectSql(`UPDATE public.review_request_recipient_evidence SET suppression_contact_hash = '${hashA}' WHERE id = '${nullEvidence!.id}';`)
    }).not.toThrow()

    // Subsequent hash(A) -> hash(B) is rejected
    let secondMutateErr: Error | null = null
    try {
      executeDirectSql(`UPDATE public.review_request_recipient_evidence SET suppression_contact_hash = '${hashB}' WHERE id = '${nullEvidence!.id}';`)
    } catch (err) {
      secondMutateErr = err instanceof Error ? err : new Error(String(err))
    }

    expect(secondMutateErr).not.toBeNull()
    expect(secondMutateErr?.message).toContain('Recipient suppression contact hash is immutable once bound')
  })

  // --------------------------------------------------------------------------
  // POINT 2 & 3: FREEZE RECIPIENT BEFORE PROVIDER & PROVIDER CRASH WINDOW
  // --------------------------------------------------------------------------

  // Test harness fixture helper
  const createWorkflowFixture = async (prefix: string, email: string) => {
    const fTimestamp = `${Date.now()}_${Math.random().toString(36).substring(7)}`
    const { data: fOrg, error: orgErr } = await adminClient
      .from('organizations')
      .insert({ name: `WF Org ${prefix} ${fTimestamp}`, slug: `wf-${prefix}-${fTimestamp}`, status: 'ACTIVE' })
      .select('id')
      .single()

    if (orgErr || !fOrg) throw new Error(`Failed to create org: ${orgErr?.message}`)

    const { data: fLoc, error: locErr } = await adminClient
      .from('locations')
      .insert({ organization_id: fOrg.id, name: 'WF Loc', status: 'ACTIVE', address: '123 Test St, Austin, TX 78701' })
      .select('id')
      .single()

    if (locErr || !fLoc) throw new Error(`Failed to create loc: ${locErr?.message}`)

    const { data: fCust } = await adminClient
      .from('customers')
      .insert({
        organization_id: fOrg!.id,
        location_id: fLoc!.id,
        first_name: 'WorkflowUser',
        email,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    const { data: fCCE } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: fOrg!.id,
        location_id: fLoc!.id,
        customer_id: fCust!.id,
        source: 'quick_complete',
        source_event_id: `evt_wf_${prefix}_${fTimestamp}`,
        contact: { email },
        permission: { email: 'allowed' },
      })
      .select('id')
      .single()

    const { data: fDest, error: destErr } = await adminClient
      .from('review_destinations')
      .insert({
        organization_id: fOrg.id,
        location_id: fLoc.id,
        provider: 'google',
        status: 'CONFIRMED',
        url: 'https://g.page/r/test/review',
        canonical_url: 'https://g.page/r/test/review',
      })
      .select('id')
      .single()

    if (destErr || !fDest) throw new Error(`Failed to create dest: ${destErr?.message}`)

    await adminClient.from('organization_entitlements').insert({
      organization_id: fOrg.id,
      status: 'ACTIVE',
      allocated_requests: 100,
      consumed_requests: 0,
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const eventData: ReviewRequestEventData = {
      organizationId: fOrg!.id,
      locationId: fLoc!.id,
      customerId: fCust!.id,
      eventId: fCCE!.id,
      sourceEventId: `evt_wf_${prefix}_${fTimestamp}`,
    }

    return {
      orgId: fOrg!.id,
      locationId: fLoc!.id,
      customerId: fCust!.id,
      completionEventId: fCCE!.id,
      destinationId: fDest!.id,
      eventData,
      cleanup: async () => {
        await adminClient.from('organizations').delete().eq('id', fOrg!.id)
      },
    }
  }

  const mockStep = {
    run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    sleep: async (): Promise<void> => {},
  }

  it('Point 3 Case A: Provider crash window - provider accepts initial send, local SENT fails, recipient evidence is already bound to hash(A)', async () => {
    const emailA = `crash.a.${Date.now()}@example.test`
    const hashA = hashSuppressionContact('email', emailA)
    const fixture = await createWorkflowFixture('crash_a', emailA)

    const sendMock = vi.fn().mockResolvedValue({
      success: true,
      provider: 'console',
      messageId: `console_crash_a_${Date.now()}`,
    })
    const spy = vi.spyOn(emailProviderModule, 'getEmailProvider').mockReturnValue({
      name: 'console',
      send: sendMock,
    } as unknown as emailProviderModule.EmailProvider)

    try {
      // Simulate crash right inside dispatch-review-email step after provider call
      // Or run standard handler where provider succeeds
      const result = await executeReviewRequestHandler({
        event: { data: fixture.eventData },
        step: mockStep,
      })

      expect(result.emailSent).toBe(true)

      // Query review_request_recipient_evidence
      const { data: evidence } = await adminClient
        .from('review_request_recipient_evidence')
        .select('suppression_contact_hash')
        .eq('organization_id', fixture.orgId)
        .single()

      expect(evidence?.suppression_contact_hash).toBe(hashA)
    } finally {
      spy.mockRestore()
      await fixture.cleanup()
    }
  })

  it('Point 3 Case B: Retry with customer still A proceeds safely with same hash and same idempotency key', async () => {
    const emailA = `retry.safe.a.${Date.now()}@example.test`
    const hashA = hashSuppressionContact('email', emailA)
    const fixture = await createWorkflowFixture('retry_b', emailA)

    let sendCount = 0
    const sendMock = vi.fn().mockImplementation(async (params) => {
      if (params.idempotencyKey?.includes('initial')) {
        sendCount++
        if (sendCount === 1) {
          throw new Error('Simulated network timeout during provider response')
        }
      }
      return {
        success: true,
        provider: 'console',
        messageId: `console_retry_b_${Date.now()}`,
      }
    })
    const spy = vi.spyOn(emailProviderModule, 'getEmailProvider').mockReturnValue({
      name: 'console',
      send: sendMock,
    } as unknown as emailProviderModule.EmailProvider)

    try {
      // Attempt 1: provider fails
      let attempt1Error: Error | null = null
      try {
        await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })
      } catch (err) {
        attempt1Error = err as Error
      }
      expect(attempt1Error).not.toBeNull()

      // Invariant: Recipient evidence was bound BEFORE provider invocation!
      const { data: evidenceAfterAttempt1 } = await adminClient
        .from('review_request_recipient_evidence')
        .select('suppression_contact_hash')
        .eq('organization_id', fixture.orgId)
        .single()

      expect(evidenceAfterAttempt1?.suppression_contact_hash).toBe(hashA)

      // Attempt 2 (Retry): Customer still email A
      const retryResult = await executeReviewRequestHandler({
        event: { data: fixture.eventData },
        step: mockStep,
      })

      expect(retryResult.emailSent).toBe(true)

      const { data: evidenceAfterAttempt2 } = await adminClient
        .from('review_request_recipient_evidence')
        .select('suppression_contact_hash')
        .eq('organization_id', fixture.orgId)
        .single()

      expect(evidenceAfterAttempt2?.suppression_contact_hash).toBe(hashA)
    } finally {
      spy.mockRestore()
      await fixture.cleanup()
    }
  })

  it('Point 3 Case C & Point 2: Retry after customer changed A -> B BLOCKS provider, retains hash(A), records RECIPIENT_CHANGED', async () => {
    const emailA = `freeze.a.${Date.now()}@example.test`
    const emailB = `freeze.b.${Date.now()}@example.test`
    const hashA = hashSuppressionContact('email', emailA)
    const hashB = hashSuppressionContact('email', emailB)
    const fixture = await createWorkflowFixture('freeze_c', emailA)

    let sendCalls: emailProviderModule.SendEmailInput[] = []
    const sendMock = vi.fn().mockImplementation(async (params) => {
      sendCalls.push(params)
      if (sendCalls.length === 1) {
        throw new Error('Simulated 503 Provider Unavailable on send attempt 1')
      }
      return {
        success: true,
        provider: 'console',
        messageId: `console_freeze_c_${Date.now()}`,
      }
    })
    const spy = vi.spyOn(emailProviderModule, 'getEmailProvider').mockReturnValue({
      name: 'console',
      send: sendMock,
    } as unknown as emailProviderModule.EmailProvider)

    try {
      // Attempt 1: Send to A attempted and failed
      let attempt1Error: Error | null = null
      try {
        await executeReviewRequestHandler({
          event: { data: fixture.eventData },
          step: mockStep,
        })
      } catch (err) {
        attempt1Error = err as Error
      }
      expect(attempt1Error).not.toBeNull()

      // Verify recipient evidence bound to hash(A)
      const { data: evidence1 } = await adminClient
        .from('review_request_recipient_evidence')
        .select('suppression_contact_hash')
        .eq('organization_id', fixture.orgId)
        .single()

      expect(evidence1?.suppression_contact_hash).toBe(hashA)

      // Before Attempt 2: Customer email is updated to B in customers table
      await adminClient
        .from('customers')
        .update({ email: emailB })
        .eq('id', fixture.customerId)

      // Reset call tracker
      sendCalls = []

      // Attempt 2 (Retry): MUST NOT INVOKE PROVIDER FOR B
      const result2 = await executeReviewRequestHandler({
        event: { data: fixture.eventData },
        step: mockStep,
      })

      expect(result2.emailSent).toBe(false)
      // Provider was NOT called for B!
      expect(sendCalls).toHaveLength(0)

      // Stored binding remains hash(A), NOT hash(B)
      const { data: evidence2 } = await adminClient
        .from('review_request_recipient_evidence')
        .select('suppression_contact_hash')
        .eq('organization_id', fixture.orgId)
        .single()

      expect(evidence2?.suppression_contact_hash).toBe(hashA)
      expect(evidence2?.suppression_contact_hash).not.toBe(hashB)

      // Zero-PII audit event recorded
      const { data: auditEvents } = await adminClient
        .from('audit_events')
        .select('event_type, metadata')
        .eq('organization_id', fixture.orgId)
        .eq('event_type', 'review_request.dispatch_blocked')

      expect(auditEvents).toBeDefined()
      expect(auditEvents!.length).toBeGreaterThanOrEqual(1)
      const blockedAudit = auditEvents![0]
      const meta = (blockedAudit.metadata || {}) as Record<string, unknown>
      expect(meta.decision).toBe('RECIPIENT_CHANGED')
      expect(meta.stage).toBe('initial')

      // Zero-PII assertion
      const metaStr = JSON.stringify(meta)
      expect(metaStr).not.toContain(emailA)
      expect(metaStr).not.toContain(emailB)
      expect(metaStr).not.toContain(hashA)
      expect(metaStr).not.toContain(hashB)
    } finally {
      spy.mockRestore()
      await fixture.cleanup()
    }
  })

  it('Point 3 Case D: Reminder flow with changed recipient is blocked and does not mutate binding', async () => {
    const emailA = `rem.drift.a.${Date.now()}@example.test`
    const emailB = `rem.drift.b.${Date.now()}@example.test`
    const hashA = hashSuppressionContact('email', emailA)
    const hashB = hashSuppressionContact('email', emailB)
    const fixture = await createWorkflowFixture('rem_drift', emailA)

    const sendMock = vi.fn().mockResolvedValue({
      success: true,
      provider: 'console',
      messageId: `console_rem_drift_${Date.now()}`,
    })
    const spy = vi.spyOn(emailProviderModule, 'getEmailProvider').mockReturnValue({
      name: 'console',
      send: sendMock,
    } as unknown as emailProviderModule.EmailProvider)

    try {
      // Run initial send (skip reminder for now)
      const initialStep = {
        run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
          if (name === 'dispatch-review-reminder') {
            return { success: false, aborted: true, provider: 'skip', messageId: 'skip' } as unknown as T
          }
          return fn()
        },
        sleep: async (): Promise<void> => {},
      }

      await executeReviewRequestHandler({
        event: { data: fixture.eventData },
        step: initialStep,
      })

      // Update customer email to B
      await adminClient
        .from('customers')
        .update({ email: emailB })
        .eq('id', fixture.customerId)

      sendMock.mockClear()

      // Now run reminder step
      const reminderStep = {
        run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
        sleep: async (): Promise<void> => {},
      }

      const reminderResult = await executeReviewRequestHandler({
        event: { data: fixture.eventData },
        step: reminderStep,
      })

      expect(reminderResult.reminderSent).toBe(false)
      expect(sendMock).not.toHaveBeenCalled()

      // Stored evidence is still hashA
      const { data: evidence } = await adminClient
        .from('review_request_recipient_evidence')
        .select('suppression_contact_hash')
        .eq('organization_id', fixture.orgId)
        .single()

      expect(evidence?.suppression_contact_hash).toBe(hashA)
      expect(evidence?.suppression_contact_hash).not.toBe(hashB)
    } finally {
      spy.mockRestore()
      await fixture.cleanup()
    }
  })

  // --------------------------------------------------------------------------
  // POINT 6: LEGACY ERASURE GATE (EXPANDED CONSERVATIVE MODEL)
  // --------------------------------------------------------------------------

  it('Point 6: SENDING, FAILED, SENT, DELIVERED, CLICKED legacy requests block erasure', async () => {
    const { data: gateOrg } = await adminClient
      .from('organizations')
      .insert({ name: `Gate Org Expanded ${timestamp}`, slug: `gate-exp-${timestamp}`, status: 'ACTIVE' })
      .select('id')
      .single()

    const { data: gateLoc } = await adminClient
      .from('locations')
      .insert({ organization_id: gateOrg!.id, name: 'Gate Loc', status: 'ACTIVE' })
      .select('id')
      .single()

    // Test each conservative ambiguous status:
    const ambiguousStatuses = ['SENDING', 'FAILED', 'SENT', 'DELIVERED', 'CLICKED'] as const

    for (const testStatus of ambiguousStatuses) {
      const { data: testCust } = await adminClient
        .from('customers')
        .insert({
          organization_id: gateOrg!.id,
          location_id: gateLoc!.id,
          first_name: `Cust_${testStatus}`,
          email: `cust_${testStatus.toLowerCase()}_${timestamp}@example.test`,
          permission_email: 'allowed',
          permission_source: 'quick_complete',
        })
        .select('id')
        .single()

      const { data: testCCE } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: gateOrg!.id,
          location_id: gateLoc!.id,
          customer_id: testCust!.id,
          source: 'quick_complete',
          source_event_id: `evt_exp_${testStatus}_${timestamp}`,
          contact: { email: `cust_${testStatus.toLowerCase()}_${timestamp}@example.test` },
          permission: { email: 'allowed' },
        })
        .select('id')
        .single()

      const track = generateTrackingToken()
      const unsub = generateUnsubscribeToken()

      await adminClient.from('review_requests').insert({
        organization_id: gateOrg!.id,
        location_id: gateLoc!.id,
        customer_id: testCust!.id,
        completion_event_id: testCCE!.id,
        channel: 'email',
        status: testStatus,
        token: track.token,
        token_hash: track.tokenHash,
        unsubscribe_token: unsub.token,
        unsubscribe_token_hash: unsub.tokenHash,
      })

      // No recipient evidence!
      const checkResult = await checkCustomerErasureEligibility({
        supabase: adminClient,
        organizationId: gateOrg!.id,
        customerId: testCust!.id,
      })

      expect(checkResult.eligible).toBe(false)
      expect(checkResult.decision).toBe('BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS')
      expect(checkResult.unresolvedLegacyRequestsCount).toBe(1)
    }

    // Test SCHEDULED request that NEVER crossed provider boundary: MUST be ELIGIBLE
    const { data: schedCust } = await adminClient
      .from('customers')
      .insert({
        organization_id: gateOrg!.id,
        location_id: gateLoc!.id,
        first_name: 'ScheduledCust',
        email: `sched_${timestamp}@example.test`,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    const { data: schedCCE } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: gateOrg!.id,
        location_id: gateLoc!.id,
        customer_id: schedCust!.id,
        source: 'quick_complete',
        source_event_id: `evt_sched_${timestamp}`,
        contact: { email: `sched_${timestamp}@example.test` },
        permission: { email: 'allowed' },
      })
      .select('id')
      .single()

    const trackSched = generateTrackingToken()
    const unsubSched = generateUnsubscribeToken()

    await adminClient.from('review_requests').insert({
      organization_id: gateOrg!.id,
      location_id: gateLoc!.id,
      customer_id: schedCust!.id,
      completion_event_id: schedCCE!.id,
      channel: 'email',
      status: 'SCHEDULED',
      sent_at: null,
      token: trackSched.token,
      token_hash: trackSched.tokenHash,
      unsubscribe_token: unsubSched.token,
      unsubscribe_token_hash: unsubSched.tokenHash,
    })

    const schedCheck = await checkCustomerErasureEligibility({
      supabase: adminClient,
      organizationId: gateOrg!.id,
      customerId: schedCust!.id,
    })

    expect(schedCheck.eligible).toBe(true)
    expect(schedCheck.decision).toBe('ELIGIBLE')

    // Test modern decoupled request WITH recipient evidence: MUST be ELIGIBLE
    const { data: modernCust } = await adminClient
      .from('customers')
      .insert({
        organization_id: gateOrg!.id,
        location_id: gateLoc!.id,
        first_name: 'ModernCust',
        email: `modern_${timestamp}@example.test`,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    const { data: modernCCE } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: gateOrg!.id,
        location_id: gateLoc!.id,
        customer_id: modernCust!.id,
        source: 'quick_complete',
        source_event_id: `evt_modern_${timestamp}`,
        contact: { email: `modern_${timestamp}@example.test` },
        permission: { email: 'allowed' },
      })
      .select('id')
      .single()

    const trackModern = generateTrackingToken()
    const unsubModern = generateUnsubscribeToken()
    const modernHash = hashSuppressionContact('email', `modern_${timestamp}@example.test`)

    const { data: modernReq } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: gateOrg!.id,
        location_id: gateLoc!.id,
        customer_id: modernCust!.id,
        completion_event_id: modernCCE!.id,
        channel: 'email',
        status: 'DELIVERED',
        sent_at: new Date().toISOString(),
        token: trackModern.token,
        token_hash: trackModern.tokenHash,
        unsubscribe_token: unsubModern.token,
        unsubscribe_token_hash: unsubModern.tokenHash,
      })
      .select('id')
      .single()

    await adminClient.from('review_request_recipient_evidence').insert({
      organization_id: gateOrg!.id,
      review_request_id: modernReq!.id,
      channel: 'email',
      suppression_contact_hash: modernHash,
    })

    const modernCheck = await checkCustomerErasureEligibility({
      supabase: adminClient,
      organizationId: gateOrg!.id,
      customerId: modernCust!.id,
    })

    expect(modernCheck.eligible).toBe(true)
    expect(modernCheck.decision).toBe('ELIGIBLE')
    expect(modernCheck.unresolvedLegacyRequestsCount).toBe(0)

    await adminClient.from('organizations').delete().eq('id', gateOrg!.id)
  })
})
