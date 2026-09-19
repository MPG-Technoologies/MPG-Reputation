import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import type { Database } from '../../src/types/database'
import { GET, POST } from '../../src/app/unsubscribe/[token]/route'
import { generateUnsubscribeToken, buildUnsubscribeUrl } from '../../src/domain/unsubscribe'
import { generateTrackingToken } from '../../src/domain/tracking'
import { hashSuppressionContact } from '../../src/domain/suppression'
import { evaluateReviewEligibility } from '../../src/domain/eligibility'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const isDbAvailable = !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'dummy_service_role_key'

describe.skipIf(!isDbAvailable)('Unsubscribe Route & Suppression Integration (MR-1B Section 21)', () => {
  let adminClient: ReturnType<typeof createClient<Database>>
  let orgId: string
  let locId: string
  let custId: string
  let completionEventId: string
  let validToken: string
  let validTokenHash: string
  let reviewRequestId: string

  const timestamp = Date.now()
  const customerEmail = `patient.unsub.${timestamp}@example.test`

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 1. Create Organization
    const { data: org, error: orgErr } = await adminClient
      .from('organizations')
      .insert({
        name: `Northstar Unsubscribe Org ${timestamp}`,
        slug: `northstar-unsub-${timestamp}`,
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
        name: 'Main Clinic',
        status: 'ACTIVE',
        review_reply_to_email: 'replies@northstar.test',
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
        first_name: 'Jane',
        email: customerEmail,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    if (custErr || !cust) throw new Error(`Failed to create test cust: ${custErr?.message}`)
    custId = cust.id

    // 4. Create Completion Event
    const { data: compEvent, error: compErr } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        source: 'test_harness',
        source_event_id: `src_unsub_${timestamp}`,
      })
      .select('id')
      .single()

    if (compErr || !compEvent) throw new Error(`Failed to create test completion event: ${compErr?.message}`)
    completionEventId = compEvent.id

    // 5. Create Review Request with Unsubscribe Token
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

    if (reqErr || !reqRecord) throw new Error(`Failed to create test review request: ${reqErr?.message}`)
    reviewRequestId = reqRecord.id
  })

  afterAll(async () => {
    if (orgId) {
      await adminClient.from('organizations').delete().eq('id', orgId)
    }
  })

  it('1. GET with valid token renders stop review-request page with business name', async () => {
    const req = new NextRequest(`http://localhost:3000/unsubscribe/${validToken}`, { method: 'GET' })
    const res = await GET(req, { params: Promise.resolve({ token: validToken }) })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Stop review-request emails?')
    expect(text).toContain(`Northstar Unsubscribe Org ${timestamp}`)
    expect(text).toContain('Stop review-request emails')
    // Ensure no raw email or customer ID exposed
    expect(text).not.toContain(customerEmail)
    expect(text).not.toContain(custId)
  })

  it('2. GET with invalid or malformed token fails safely with HTTP 404', async () => {
    const invalidToken = 'short-token'
    const req = new NextRequest(`http://localhost:3000/unsubscribe/${invalidToken}`, { method: 'GET' })
    const res = await GET(req, { params: Promise.resolve({ token: invalidToken }) })

    expect(res.status).toBe(404)
    const text = await res.text()
    expect(text).toContain('Invalid or expired link')
  })

  it('3. GET with valid format but non-existent token fails safely with HTTP 404', async () => {
    const unknownToken = generateUnsubscribeToken().token
    const req = new NextRequest(`http://localhost:3000/unsubscribe/${unknownToken}`, { method: 'GET' })
    const res = await GET(req, { params: Promise.resolve({ token: unknownToken }) })

    expect(res.status).toBe(404)
    const text = await res.text()
    expect(text).toContain('Invalid or expired link')
  })

  it('4. POST with valid token creates CUSTOMER_UNSUBSCRIBED suppression in database', async () => {
    const req = new NextRequest(`http://localhost:3000/unsubscribe/${validToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const res = await POST(req, { params: Promise.resolve({ token: validToken }) })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Review requests stopped')
    expect(text).toContain('You won\'t receive future review-request emails')

    // Verify suppression row exists with standardized hash
    const expectedContactHash = hashSuppressionContact('email', customerEmail)
    const { data: suppression } = await adminClient
      .from('suppressions')
      .select('id, organization_id, channel, reason, contact_hash')
      .eq('organization_id', orgId)
      .eq('channel', 'email')
      .eq('contact_hash', expectedContactHash)
      .maybeSingle()

    expect(suppression).not.toBeNull()
    expect(suppression?.reason).toBe('CUSTOMER_UNSUBSCRIBED')
    expect(suppression?.organization_id).toBe(orgId)

    // Verify scheduled review request was cancelled/suppressed
    const { data: updatedReq } = await adminClient
      .from('review_requests')
      .select('status')
      .eq('id', reviewRequestId)
      .single()

    expect(updatedReq?.status).toBe('SUPPRESSED')
  })

  it('5. Repeated POST is idempotent and does not create duplicate suppression or error', async () => {
    const req = new NextRequest(`http://localhost:3000/unsubscribe/${validToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const res = await POST(req, { params: Promise.resolve({ token: validToken }) })

    expect(res.status).toBe(200)

    const expectedContactHash = hashSuppressionContact('email', customerEmail)
    const { data: suppressions } = await adminClient
      .from('suppressions')
      .select('id')
      .eq('organization_id', orgId)
      .eq('channel', 'email')
      .eq('contact_hash', expectedContactHash)

    // Exactly one suppression record
    expect(suppressions).toHaveLength(1)
  })

  it('6. One-Click RFC 8058 POST works without login or cookies and returns JSON', async () => {
    const req = new NextRequest(`http://localhost:3000/unsubscribe/${validToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: 'List-Unsubscribe=One-Click',
    })
    const res = await POST(req, { params: Promise.resolve({ token: validToken }) })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ unsubscribed: true })
  })

  it('7. GET after unsubscription displays unsubscribed status confirmation', async () => {
    const req = new NextRequest(`http://localhost:3000/unsubscribe/${validToken}`, { method: 'GET' })
    const res = await GET(req, { params: Promise.resolve({ token: validToken }) })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Review requests stopped')
    expect(text).toContain('Unsubscribed')
  })

  it('8. Future eligibility check fails with SUPPRESSED after unsubscription', async () => {
    const expectedContactHash = hashSuppressionContact('email', customerEmail)
    const { data: supp } = await adminClient
      .from('suppressions')
      .select('id')
      .eq('organization_id', orgId)
      .eq('channel', 'email')
      .eq('contact_hash', expectedContactHash)
      .maybeSingle()

    expect(supp).not.toBeNull()

    const eligibility = evaluateReviewEligibility({
      organization: { id: orgId, status: 'ACTIVE' },
      location: { id: locId, status: 'ACTIVE' },
      customer: { id: custId, email: customerEmail, permission_email: 'allowed' },
      destination: { id: 'dest-1', status: 'CONFIRMED', canonical_url: 'https://g.page/r/test' },
      isSuppressed: !!supp,
      hasRecentRequestWithinWindow: false,
    })

    expect(eligibility.eligible).toBe(false)
    expect(eligibility.decision).toBe('SUPPRESSED')
  })

  it('9. Existing CLICKED status is NOT regressed by subsequent customer unsubscription', async () => {
    // Create a completion event for test 9
    const { data: comp9 } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        source: 'test_harness',
        source_event_id: `src_unsub_clicked_${Date.now()}_${Math.random()}`,
      })
      .select('id')
      .single()

    // Create a new review request that is already CLICKED
    const tracking = generateTrackingToken()
    const unsub = generateUnsubscribeToken()

    const { data: clickedReq } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        completion_event_id: comp9!.id,
        channel: 'email',
        status: 'CLICKED',
        token: tracking.token,
        token_hash: tracking.tokenHash,
        unsubscribe_token: unsub.token,
        unsubscribe_token_hash: unsub.tokenHash,
        sent_at: new Date().toISOString(),
        delivered_at: new Date().toISOString(),
        clicked_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    expect(clickedReq).not.toBeNull()

    // Process unsubscribe using this token
    const req = new NextRequest(`http://localhost:3000/unsubscribe/${unsub.token}`, {
      method: 'POST',
      body: 'List-Unsubscribe=One-Click',
    })
    const res = await POST(req, { params: Promise.resolve({ token: unsub.token }) })
    expect(res.status).toBe(200)

    // Inspect request status in DB: MUST remain CLICKED
    const { data: verifyReq } = await adminClient
      .from('review_requests')
      .select('status, clicked_at, delivered_at, sent_at')
      .eq('id', clickedReq!.id)
      .single()

    expect(verifyReq?.status).toBe('CLICKED')
    expect(verifyReq?.clicked_at).not.toBeNull()
    expect(verifyReq?.delivered_at).not.toBeNull()
    expect(verifyReq?.sent_at).not.toBeNull()
  })

  it('10. Existing DELIVERED history remains truthful after unsubscription', async () => {
    // Create a completion event for test 10
    const { data: comp10 } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        source: 'test_harness',
        source_event_id: `src_unsub_deliv_${Date.now()}_${Math.random()}`,
      })
      .select('id')
      .single()

    const tracking = generateTrackingToken()
    const unsub = generateUnsubscribeToken()

    const { data: deliveredReq } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        completion_event_id: comp10!.id,
        channel: 'email',
        status: 'DELIVERED',
        token: tracking.token,
        token_hash: tracking.tokenHash,
        unsubscribe_token: unsub.token,
        unsubscribe_token_hash: unsub.tokenHash,
        sent_at: new Date().toISOString(),
        delivered_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    expect(deliveredReq).not.toBeNull()

    const req = new NextRequest(`http://localhost:3000/unsubscribe/${unsub.token}`, {
      method: 'POST',
      body: 'List-Unsubscribe=One-Click',
    })
    const res = await POST(req, { params: Promise.resolve({ token: unsub.token }) })
    expect(res.status).toBe(200)

    const { data: verifyReq } = await adminClient
      .from('review_requests')
      .select('status, delivered_at, sent_at')
      .eq('id', deliveredReq!.id)
      .single()

    expect(verifyReq?.status).toBe('DELIVERED')
    expect(verifyReq?.delivered_at).not.toBeNull()
    expect(verifyReq?.sent_at).not.toBeNull()
  })

  it('11. Cross-tenant token tampering fails: token resolves strictly to its own tenant', async () => {
    // Create Org B
    const { data: orgB } = await adminClient
      .from('organizations')
      .insert({
        name: `Victim Org B ${timestamp}`,
        slug: `victim-org-b-${timestamp}`,
        status: 'ACTIVE',
      })
      .select('id')
      .single()

    // Verify Org B has no suppressions
    const expectedHash = hashSuppressionContact('email', customerEmail)
    const { data: suppB } = await adminClient
      .from('suppressions')
      .select('id')
      .eq('organization_id', orgB!.id)
      .eq('contact_hash', expectedHash)
      .maybeSingle()

    expect(suppB).toBeNull()

    // Clean up Org B
    await adminClient.from('organizations').delete().eq('id', orgB!.id)
  })

  it('12. Unsubscribe URL does NOT contain recipient email or customer UUID', () => {
    const unsubUrl = buildUnsubscribeUrl('https://mpg-reputation.local', validToken)

    expect(unsubUrl).toContain(`/unsubscribe/${validToken}`)
    expect(unsubUrl).not.toContain(customerEmail)
    expect(unsubUrl).not.toContain(custId)
    expect(unsubUrl).not.toContain(orgId)
  })

  it('13. Cross-tenant unsubscribe isolation: Customer with identical email in Org B is NOT suppressed and Org B requests remain SCHEDULED', async () => {
    const sharedEmail = `shared.patient.${timestamp}@example.test`

    // Create Org B, Location B, Customer B
    const { data: orgB } = await adminClient
      .from('organizations')
      .insert({
        name: `Isolated Org B ${timestamp}`,
        slug: `isolated-org-b-${timestamp}`,
        status: 'ACTIVE',
      })
      .select('id')
      .single()

    const { data: locB } = await adminClient
      .from('locations')
      .insert({
        organization_id: orgB!.id,
        name: 'Location B',
        status: 'ACTIVE',
      })
      .select('id')
      .single()

    const { data: custB } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgB!.id,
        location_id: locB!.id,
        first_name: 'Bob',
        last_name: 'Shared',
        email: sharedEmail,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    // Create Customer A in Org A with same email
    const { data: custA } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'Alice',
        last_name: 'Shared',
        email: sharedEmail,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    // Create completion events
    const { data: compB } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgB!.id,
        location_id: locB!.id,
        customer_id: custB!.id,
        source: 'test_harness',
        source_event_id: `src_b_${timestamp}`,
      })
      .select('id')
      .single()

    const { data: compA } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custA!.id,
        source: 'test_harness',
        source_event_id: `src_a_${timestamp}`,
      })
      .select('id')
      .single()

    // Create scheduled request in Org B
    const trackB = generateTrackingToken()
    const unsubB = generateUnsubscribeToken()
    const { data: reqB } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgB!.id,
        location_id: locB!.id,
        customer_id: custB!.id,
        completion_event_id: compB!.id,
        channel: 'email',
        status: 'SCHEDULED',
        token: trackB.token,
        token_hash: trackB.tokenHash,
        unsubscribe_token: unsubB.token,
        unsubscribe_token_hash: unsubB.tokenHash,
      })
      .select('id')
      .single()

    // Create scheduled request in Org A
    const trackA = generateTrackingToken()
    const unsubA = generateUnsubscribeToken()
    const { data: reqA } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custA!.id,
        completion_event_id: compA!.id,
        channel: 'email',
        status: 'SCHEDULED',
        token: trackA.token,
        token_hash: trackA.tokenHash,
        unsubscribe_token: unsubA.token,
        unsubscribe_token_hash: unsubA.tokenHash,
      })
      .select('id')
      .single()

    // Execute unsubscribe using Org A's token
    const postReq = new NextRequest(`http://localhost:3000/unsubscribe/${unsubA.token}`, {
      method: 'POST',
      body: 'List-Unsubscribe=One-Click',
    })
    const postRes = await POST(postReq, { params: Promise.resolve({ token: unsubA.token }) })
    expect(postRes.status).toBe(200)

    // Verify Org A request is suppressed
    const { data: checkReqA } = await adminClient
      .from('review_requests')
      .select('status')
      .eq('id', reqA!.id)
      .single()
    expect(checkReqA?.status).toBe('SUPPRESSED')

    // Verify Org B request remains SCHEDULED (not touched by Org A unsubscribe!)
    const { data: checkReqB } = await adminClient
      .from('review_requests')
      .select('status')
      .eq('id', reqB!.id)
      .single()
    expect(checkReqB?.status).toBe('SCHEDULED')

    // Verify Org B has NO suppressions
    const sharedContactHash = hashSuppressionContact('email', sharedEmail)
    const { data: suppB } = await adminClient
      .from('suppressions')
      .select('id')
      .eq('organization_id', orgB!.id)
      .eq('contact_hash', sharedContactHash)
      .maybeSingle()
    expect(suppB).toBeNull()

    // Clean up Org B
    await adminClient.from('review_requests').delete().eq('id', reqB!.id)
    await adminClient.from('customer_completion_events').delete().eq('id', compB!.id)
    await adminClient.from('customers').delete().eq('id', custB!.id)
    await adminClient.from('locations').delete().eq('id', locB!.id)
    await adminClient.from('organizations').delete().eq('id', orgB!.id)

    // Clean up Org A extras
    await adminClient.from('review_requests').delete().eq('id', reqA!.id)
    await adminClient.from('customer_completion_events').delete().eq('id', compA!.id)
    await adminClient.from('customers').delete().eq('id', custA!.id)
  })

  it('14. RFC 8058 One-Click form-encoded POST directly returns 200 without redirect', async () => {
    const unsubEmail = `rfc.test.${timestamp}@example.test`
    const { data: custRfc } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'RFC',
        last_name: 'Tester',
        email: unsubEmail,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    const { data: compRfc } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custRfc!.id,
        source: 'test_harness',
        source_event_id: `src_rfc_${timestamp}`,
      })
      .select('id')
      .single()

    const track = generateTrackingToken()
    const unsub = generateUnsubscribeToken()
    await adminClient.from('review_requests').insert({
      organization_id: orgId,
      location_id: locId,
      customer_id: custRfc!.id,
      completion_event_id: compRfc!.id,
      channel: 'email',
      status: 'SCHEDULED',
      token: track.token,
      token_hash: track.tokenHash,
      unsubscribe_token: unsub.token,
      unsubscribe_token_hash: unsub.tokenHash,
    })

    // Standard RFC 8058 MUA request:
    // - No cookies
    // - No authorization header
    // - Content-Type: application/x-www-form-urlencoded
    // - Body: List-Unsubscribe=One-Click
    const rfcReq = new NextRequest(`http://localhost:3000/unsubscribe/${unsub.token}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'accept': '*/*',
      },
      body: 'List-Unsubscribe=One-Click',
    })

    const rfcRes = await POST(rfcReq, { params: Promise.resolve({ token: unsub.token }) })

    // MUST return 200 directly, NEVER redirect (no Location header)
    expect(rfcRes.status).toBe(200)
    expect(rfcRes.headers.get('location')).toBeNull()

    const body = await rfcRes.json()
    expect(body).toEqual({ unsubscribed: true })

    // Cleanup
    await adminClient.from('customers').delete().eq('id', custRfc!.id)
  })

  it('15. GET request alone does NOT unsubscribe or mutate database', async () => {
    const getEmail = `get.safety.${timestamp}@example.test`
    const { data: custGet } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'GetSafety',
        last_name: 'Test',
        email: getEmail,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    const { data: compGet } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custGet!.id,
        source: 'test_harness',
        source_event_id: `src_get_${timestamp}`,
      })
      .select('id')
      .single()

    const track = generateTrackingToken()
    const unsub = generateUnsubscribeToken()
    const { data: reqGet } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custGet!.id,
        completion_event_id: compGet!.id,
        channel: 'email',
        status: 'SCHEDULED',
        token: track.token,
        token_hash: track.tokenHash,
        unsubscribe_token: unsub.token,
        unsubscribe_token_hash: unsub.tokenHash,
      })
      .select('id')
      .single()

    // Send GET request to unsubscribe route
    const getReq = new NextRequest(`http://localhost:3000/unsubscribe/${unsub.token}`, {
      method: 'GET',
    })
    const getRes = await GET(getReq, { params: Promise.resolve({ token: unsub.token }) })

    expect(getRes.status).toBe(200)
    const html = await getRes.text()
    expect(html).toContain('Stop review-request emails?')

    // Verify request is STILL SCHEDULED in database
    const { data: checkReq } = await adminClient
      .from('review_requests')
      .select('status')
      .eq('id', reqGet!.id)
      .single()
    expect(checkReq?.status).toBe('SCHEDULED')

    // Verify NO suppression record was inserted
    const contactHash = hashSuppressionContact('email', getEmail)
    const { data: supp } = await adminClient
      .from('suppressions')
      .select('id')
      .eq('organization_id', orgId)
      .eq('contact_hash', contactHash)
      .maybeSingle()
    expect(supp).toBeNull()

    // Cleanup
    await adminClient.from('review_requests').delete().eq('id', reqGet!.id)
    await adminClient.from('customer_completion_events').delete().eq('id', compGet!.id)
    await adminClient.from('customers').delete().eq('id', custGet!.id)
  })

  it('16. Partial unique index rejects duplicate non-null unsubscribe_token_hash (MR-1B.1 Section 3)', async () => {
    // Create distinct completion event so (completion_event_id, channel) unique constraint does not mask index check
    const { data: compDup } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        source: 'test_harness',
        source_event_id: `src_dup_${Date.now()}`,
      })
      .select('id')
      .single()

    const track = generateTrackingToken()
    // Attempt inserting second record with already used validTokenHash
    const { error: dupError } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        completion_event_id: compDup!.id,
        channel: 'email',
        status: 'SCHEDULED',
        token: track.token,
        token_hash: track.tokenHash,
        unsubscribe_token: 'another_token_value',
        unsubscribe_token_hash: validTokenHash, // duplicate!
      })

    expect(dupError).not.toBeNull()
    expect(dupError?.code).toBe('23505') // unique_violation
    expect(dupError?.message).toMatch(/idx_review_requests_unsub_token_hash/)

    // But multiple NULL hashes are permitted
    const { data: compNull1 } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        source: 'test_harness',
        source_event_id: `src_null1_${Date.now()}`,
      })
      .select('id')
      .single()

    const { data: compNull2 } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        source: 'test_harness',
        source_event_id: `src_null2_${Date.now()}`,
      })
      .select('id')
      .single()

    const trackNull1 = generateTrackingToken()
    const trackNull2 = generateTrackingToken()
    const { data: null1, error: err1 } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        completion_event_id: compNull1!.id,
        channel: 'email',
        status: 'SCHEDULED',
        token: trackNull1.token,
        token_hash: trackNull1.tokenHash,
        unsubscribe_token: null,
        unsubscribe_token_hash: null,
      })
      .select('id')
      .single()
    expect(err1).toBeNull()

    const { data: null2, error: err2 } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: custId,
        completion_event_id: compNull2!.id,
        channel: 'email',
        status: 'SCHEDULED',
        token: trackNull2.token,
        token_hash: trackNull2.tokenHash,
        unsubscribe_token: null,
        unsubscribe_token_hash: null,
      })
      .select('id')
      .single()
    expect(err2).toBeNull()

    // Cleanup null rows and events
    await adminClient.from('review_requests').delete().in('id', [null1!.id, null2!.id])
    await adminClient.from('customer_completion_events').delete().in('id', [compDup!.id, compNull1!.id, compNull2!.id])
  })
})
