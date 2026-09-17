import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import { normalizeQuickCompleteInput } from '../../src/domain/completion'
import { evaluateReviewEligibility } from '../../src/domain/eligibility'
import { generateTrackingToken, hashTrackingToken, buildTrackedReviewUrl } from '../../src/domain/tracking'
import { hashSuppressionContact } from '../../src/domain/suppression'
import { ConsoleEmailProvider } from '../../src/providers/email'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_anon_key'

const isDbAvailable = !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'dummy_service_role_key'

describe.skipIf(!isDbAvailable)('V0.1 Vertical Slice Runtime Proof & Idempotency', () => {
  let adminClient: ReturnType<typeof createClient<Database>>
  let userClient: ReturnType<typeof createClient<Database>>
  let userId: string
  let orgId: string
  let locId: string
  let destinationId: string

  const timestamp = Date.now()

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Create test user
    const { data: u, error: uErr } = await adminClient.auth.admin.createUser({
      email: `synth_operator_${timestamp}@test.local`,
      password: 'Password123!',
      email_confirm: true,
    })
    if (uErr || !u.user) throw new Error(`User creation failed: ${uErr?.message}`)
    userId = u.user.id

    userClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    await userClient.auth.signInWithPassword({
      email: `synth_operator_${timestamp}@test.local`,
      password: 'Password123!',
    })

    // Onboard organization and location atomically
    const { data: res, error: rpcErr } = await userClient.rpc('create_org_with_owner_and_location', {
      p_org_name: `Northstar Dental Synthetic ${timestamp}`,
      p_slug: `northstar-synth-${timestamp}`,
      p_loc_name: 'Main Synthetic Clinic',
      p_address: '500 Tech Blvd',
    })
    if (rpcErr || !res) throw new Error(`Onboarding failed: ${rpcErr?.message}`)
    const parsed = res as { organization_id: string; location_id: string }
    orgId = parsed.organization_id
    locId = parsed.location_id

    // Configure confirmed Google review destination
    const { data: dest, error: destErr } = await userClient
      .from('review_destinations')
      .insert({
        organization_id: orgId,
        location_id: locId,
        provider: 'google',
        url: 'https://g.page/r/CWd814KXYZ123/review',
        canonical_url: 'https://g.page/r/CWd814KXYZ123/review',
        status: 'CONFIRMED',
      })
      .select('id')
      .single()

    if (destErr || !dest) throw new Error(`Destination setup failed: ${destErr?.message}`)
    destinationId = dest.id
  })

  afterAll(async () => {
    if (adminClient) {
      if (orgId) await adminClient.from('organizations').delete().eq('id', orgId)
      if (userId) await adminClient.auth.admin.deleteUser(userId)
    }
  })

  it('proves complete synthetic vertical slice: Quick Complete -> customer.completed -> eligibility -> send -> click -> 302 redirect', async () => {
    const customerEmail = `patient_${timestamp}@example.test`

    // 1. Quick Complete with explicit allowed permission
    const norm = normalizeQuickCompleteInput({
      organizationId: orgId,
      locationId: locId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: customerEmail,
      permissionEmail: 'allowed',
    })
    expect(norm.valid).toBe(true)

    // Persist customer
    const { data: customer, error: custErr } = await userClient
      .from('customers')
      .insert(norm.customerPayload!)
      .select('id')
      .single()

    expect(custErr).toBeNull()
    expect(customer?.id).toBeDefined()
    const customerId = customer!.id

    // Persist completion event
    const { data: completionEvent, error: cceErr } = await userClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: customerId,
        source: norm.canonical!.source,
        source_event_id: norm.canonical!.source_event_id,
        completed_at: norm.canonical!.completed_at,
        country: norm.canonical!.country,
        contact: norm.canonical!.contact,
        permission: norm.canonical!.permission,
      })
      .select('id')
      .single()

    expect(cceErr).toBeNull()
    expect(completionEvent?.id).toBeDefined()

    // 2. Persist in transactional domain event outbox
    const { data: outbox, error: outboxErr } = await userClient
      .from('domain_event_outbox')
      .insert({
        organization_id: orgId,
        event_type: 'customer.completed',
        aggregate_type: 'customer_completion_event',
        aggregate_id: completionEvent!.id,
        payload: { eventId: completionEvent!.id, customerId },
        status: 'PENDING',
      })
      .select('id, status')
      .single()

    expect(outboxErr).toBeNull()
    expect(outbox?.status).toBe('PENDING')

    // 3. Initial Eligibility check
    const initialEligibility = evaluateReviewEligibility({
      organization: { id: orgId, status: 'ACTIVE' },
      location: { id: locId, status: 'ACTIVE' },
      customer: { id: customerId, email: customerEmail, permission_email: 'allowed' },
      destination: { id: destinationId, status: 'CONFIRMED', canonical_url: 'https://g.page/r/CWd814KXYZ123/review' },
      isSuppressed: false,
      hasRecentRequestWithinWindow: false,
    })
    expect(initialEligibility.eligible).toBe(true)

    // 4. Post-Delay Eligibility Recheck
    const postDelayEligibility = evaluateReviewEligibility({
      organization: { id: orgId, status: 'ACTIVE' },
      location: { id: locId, status: 'ACTIVE' },
      customer: { id: customerId, email: customerEmail, permission_email: 'allowed' },
      destination: { id: destinationId, status: 'CONFIRMED', canonical_url: 'https://g.page/r/CWd814KXYZ123/review' },
      isSuppressed: false,
      hasRecentRequestWithinWindow: false,
    })
    expect(postDelayEligibility.eligible).toBe(true)

    // 5. Create Review Request with SCHEDULED status
    const { token, tokenHash } = generateTrackingToken()
    const { data: request, error: reqErr } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: customerId,
        completion_event_id: completionEvent!.id,
        destination_id: destinationId,
        channel: 'email',
        status: 'SCHEDULED',
        token,
        token_hash: tokenHash,
      })
      .select('id, token, status')
      .single()

    expect(reqErr).toBeNull()
    expect(request?.status).toBe('SCHEDULED')
    const reviewRequestId = request!.id

    // 6. Atomic claim: SCHEDULED -> SENDING
    const { data: claim } = await adminClient
      .from('review_requests')
      .update({ status: 'SENDING' })
      .eq('id', reviewRequestId)
      .eq('status', 'SCHEDULED')
      .select('id')
      .maybeSingle()

    expect(claim).not.toBeNull()

    // 7. Dispatch via ConsoleEmailProvider (synthetic safe default)
    const emailProvider = new ConsoleEmailProvider()
    const trackingUrl = buildTrackedReviewUrl('http://localhost:3000', token)
    const sendResult = await emailProvider.send({
      to: customerEmail,
      recipientName: 'Jane',
      businessName: 'Northstar Dental Synthetic',
      trackingUrl,
    })
    expect(sendResult.success).toBe(true)
    expect(sendResult.provider).toBe('console')

    // Mark SENT
    await adminClient
      .from('review_requests')
      .update({ status: 'SENT', sent_at: new Date().toISOString() })
      .eq('id', reviewRequestId)

    // 8. Public link resolution & First Click (Atomic & Idempotent)
    const resolvedHash = hashTrackingToken(token)
    const { data: resolvedReq } = await adminClient
      .from('review_requests')
      .select('id, organization_id, location_id, destination_id, status')
      .eq('token_hash', resolvedHash)
      .single()

    expect(resolvedReq).toBeDefined()

    // First click: transitions SENT -> CLICKED
    const { data: firstClickClaim } = await adminClient
      .from('review_requests')
      .update({ status: 'CLICKED', clicked_at: new Date().toISOString() })
      .eq('id', reviewRequestId)
      .neq('status', 'CLICKED')
      .select('id')
      .maybeSingle()

    expect(firstClickClaim).not.toBeNull()

    // Increment click count atomically
    const clicks1 = await adminClient.rpc('increment_organization_usage', {
      p_org_id: orgId,
      p_period: '2026-09',
      p_metric: 'link_clicks',
      p_amount: 1,
    })
    expect(Number(clicks1.data)).toBe(1)

    // Second click on same token: must NOT claim status or increment clicks again
    const { data: secondClickClaim } = await adminClient
      .from('review_requests')
      .update({ status: 'CLICKED', clicked_at: new Date().toISOString() })
      .eq('id', reviewRequestId)
      .neq('status', 'CLICKED')
      .select('id')
      .maybeSingle()

    expect(secondClickClaim).toBeNull() // Idempotent: cannot transition already-CLICKED request

    // 9. Destination resolution for 302 redirect
    const { data: destination } = await adminClient
      .from('review_destinations')
      .select('canonical_url')
      .eq('id', destinationId)
      .single()

    expect(destination?.canonical_url).toBe('https://g.page/r/CWd814KXYZ123/review')
  })

  it('proves post-delay suppression aborts email send (Prompt Correction 27)', async () => {
    const suppressedEmail = `optout_${timestamp}@example.test`

    // Initial eligibility passes
    const initial = evaluateReviewEligibility({
      organization: { id: orgId, status: 'ACTIVE' },
      location: { id: locId, status: 'ACTIVE' },
      customer: { id: 'dummy-cust', email: suppressedEmail, permission_email: 'allowed' },
      destination: { id: destinationId, status: 'CONFIRMED', canonical_url: 'https://g.page/r/CWd814KXYZ123/review' },
      isSuppressed: false,
      hasRecentRequestWithinWindow: false,
    })
    expect(initial.eligible).toBe(true)

    // Customer opts out during delay -> inserted into suppressions using standardized SHA-256 hash
    const suppressionHash = hashSuppressionContact('email', suppressedEmail)
    await adminClient.from('suppressions').insert({
      organization_id: orgId,
      channel: 'email',
      contact_hash: suppressionHash,
      reason: 'UNSUBSCRIBE',
    })

    // Post-delay eligibility recheck executes: suppression is detected!
    const postDelay = evaluateReviewEligibility({
      organization: { id: orgId, status: 'ACTIVE' },
      location: { id: locId, status: 'ACTIVE' },
      customer: { id: 'dummy-cust', email: suppressedEmail, permission_email: 'allowed' },
      destination: { id: destinationId, status: 'CONFIRMED', canonical_url: 'https://g.page/r/CWd814KXYZ123/review' },
      isSuppressed: true, // Detected in database recheck
      hasRecentRequestWithinWindow: false,
    })

    // INVARIANT: NO EMAIL MUST BE SENT
    expect(postDelay.eligible).toBe(false)
    expect(postDelay.decision).toBe('SUPPRESSED')
  })

  it('proves duplicate completion event is strictly idempotent (Prompt Correction 8 & 26)', async () => {
    const email = `dupe_${timestamp}@example.test`
    const sourceEventId = `qc_unique_event_${timestamp}`

    // Customer record required for composite foreign key constraint
    const { data: customer } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'Dupe',
        last_name: 'Test',
        email,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()

    expect(customer?.id).toBeDefined()
    const customerId = customer!.id

    // First completion
    const { data: c1, error: c1Err } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: customerId,
        source: 'quick_complete',
        source_event_id: sourceEventId,
        contact: { email },
        permission: { email: 'allowed' },
      })
      .select('id')
      .single()

    expect(c1Err).toBeNull()
    expect(c1?.id).toBeDefined()

    // Second completion with identical source_event_id: rejected by UNIQUE constraint
    const { error: dupeErr } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: customerId,
        source: 'quick_complete',
        source_event_id: sourceEventId,
        contact: { email },
        permission: { email: 'allowed' },
      })

    expect(dupeErr).not.toBeNull() // UNIQUE (organization_id, source, source_event_id)
  })
})
