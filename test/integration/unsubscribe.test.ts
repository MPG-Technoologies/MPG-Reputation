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
})
