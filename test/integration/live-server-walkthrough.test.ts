import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../../src/types/database'
import { dispatchPendingOutboxEvents } from '../../src/domain/outbox/dispatcher'
import { executeReviewRequestHandler } from '../../src/inngest/functions/review-request'
import { renderNeutralReviewEmail } from '../../src/providers/email/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const APP_URL = process.env.TEST_APP_URL || 'http://127.0.0.1:3000'

describe('Live Local Server Founder Walkthrough (19 Steps against running Next.js server)', () => {
  let adminClient: SupabaseClient<Database>
  let userClient: SupabaseClient<Database>
  let userId: string
  let orgId: string
  let locId: string
  const timestamp = Date.now()
  const destinationUrl = 'https://g.page/r/live-server-founder-walkthrough/review'
  const userEmail = `founder_live_${timestamp}@example.test`

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // STEP 2: Create synthetic user via local Supabase Auth
    const { data: u, error: uErr } = await adminClient.auth.admin.createUser({
      email: userEmail,
      password: 'SafePassword123!',
      email_confirm: true,
    })
    if (uErr || !u.user) throw new Error(`User creation failed: ${uErr?.message}`)
    userId = u.user.id

    // STEP 3: Authenticate
    userClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email: userEmail,
      password: 'SafePassword123!',
    })
    if (signInErr) throw new Error(`User signin failed: ${signInErr.message}`)
  }, 15000)

  afterAll(async () => {
    if (adminClient) {
      if (orgId) await adminClient.from('organizations').delete().eq('id', orgId)
      if (userId) await adminClient.auth.admin.deleteUser(userId)
    }
  })

  it('Step 1: Open local application - verifies root and login endpoints respond HTTP 200', async () => {
    const rootRes = await fetch(`${APP_URL}/`)
    expect(rootRes.status).toBe(200)

    const loginRes = await fetch(`${APP_URL}/login`)
    expect(loginRes.status).toBe(200)
  }, 15000)

  it('Steps 4-6: Complete onboarding, create organization and primary location', async () => {
    const orgName = `Northstar Dental Live ${timestamp}`
    const locName = 'Main Clinic'

    const { data: orgRes, error: orgErr } = await userClient.rpc('create_org_with_owner_and_location', {
      p_org_name: orgName,
      p_slug: `northstar-live-${timestamp}`,
      p_loc_name: locName,
      p_address: '100 Main Street, Suite 200',
    })
    expect(orgErr).toBeNull()
    expect(orgRes).toBeDefined()

    const parsed = orgRes as { organization_id: string; location_id: string }
    orgId = parsed.organization_id
    locId = parsed.location_id

    // Step 5: View Organization
    const { data: orgRecord } = await userClient
      .from('organizations')
      .select('id, name, status')
      .eq('id', orgId)
      .single()
    expect(orgRecord?.name).toBe(orgName)
    expect(orgRecord?.status).toBe('ACTIVE')

    // Step 6: View Location
    const { data: locRecord } = await userClient
      .from('locations')
      .select('id, name, status')
      .eq('id', locId)
      .single()
    expect(locRecord?.name).toBe(locName)
    expect(locRecord?.status).toBe('ACTIVE')
  }, 15000)

  it('Step 7: Configure a valid synthetic Google review destination', async () => {
    const { data: destRecord, error: destErr } = await userClient
      .from('review_destinations')
      .insert({
        organization_id: orgId,
        location_id: locId,
        provider: 'google',
        url: destinationUrl,
        canonical_url: destinationUrl,
        status: 'CONFIRMED',
      })
      .select('id, status, canonical_url')
      .single()

    expect(destErr).toBeNull()
    expect(destRecord?.status).toBe('CONFIRMED')
    expect(destRecord?.canonical_url).toBe(destinationUrl)

    // Explicit trusted trial activation (MR-4)
    await adminClient.rpc('activate_organization_trial', { p_org_id: orgId })
  }, 15000)

  it('Step 8: Open dashboard - verify initial baseline metrics', async () => {
    const { count: initialCompleted } = await userClient
      .from('customer_completion_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
    expect(initialCompleted).toBe(0)

    const { count: initialSent } = await userClient
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('status', ['SENT', 'DELIVERED', 'CLICKED'])
    expect(initialSent).toBe(0)

    const { count: initialClicked } = await userClient
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'CLICKED')
    expect(initialClicked).toBe(0)
  }, 15000)

  it('Steps 9-15: Quick Complete -> customer.completed -> outbox -> workflow -> email preview -> review_request', async () => {
    const customerEmail = `jane.doe.live.${timestamp}@example.test`
    const sourceEventId = `qc_live_${timestamp}`

    // Step 9 & 10: Submit Quick Complete atomically
    const { data: atomicRes, error: atomicErr } = await userClient.rpc('submit_quick_complete_atomic', {
      p_org_id: orgId,
      p_loc_id: locId,
      p_first_name: 'Jane',
      p_last_name: 'Doe',
      p_email: customerEmail,
      p_phone: null,
      p_permission_email: 'allowed',
      p_permission_sms: 'unknown',
      p_permission_source: 'quick_complete',
      p_source: 'quick_complete',
      p_source_event_id: sourceEventId,
      p_country: 'CA',
    })

    expect(atomicErr).toBeNull()
    const { customer_id: customerId, completion_event_id: completionEventId, outbox_id: outboxId } = atomicRes as {
      customer_id: string
      completion_event_id: string
      outbox_id: string
    }

    // Step 11: Confirm completion persisted
    const { data: completionRecord } = await userClient
      .from('customer_completion_events')
      .select('id, customer_id, source_event_id')
      .eq('id', completionEventId)
      .single()
    expect(completionRecord?.customer_id).toBe(customerId)
    expect(completionRecord?.source_event_id).toBe(sourceEventId)

    // Step 12 & 13: Confirm transactional outbox & dispatch to Inngest
    const { data: outboxRecord } = await adminClient
      .from('domain_event_outbox')
      .select('id, status, event_type')
      .eq('id', outboxId)
      .single()
    expect(outboxRecord?.status).toBe('PENDING')
    expect(outboxRecord?.event_type).toBe('customer.completed')

    let capturedEvent: { id: string; name: string; data: import('../../src/inngest/functions/review-request').ReviewRequestEventData } | null = null
    const inngestHarness = {
      send: async (event: { id: string; name: string; data: import('../../src/inngest/functions/review-request').ReviewRequestEventData }) => {
        capturedEvent = event
        return { ids: ['inngest_live_1'] }
      },
    } as unknown as import('inngest').Inngest

    const dispatchSummary = await dispatchPendingOutboxEvents(adminClient, inngestHarness, {
      organizationId: orgId,
      batchSize: 10,
    })
    expect(dispatchSummary.dispatched).toBe(1)
    expect(capturedEvent).toBeDefined()

    // Execute workflow step handler (eligibility -> delay -> post-delay recheck -> send)
    const stepRunner = {
      run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
      sleep: async () => {},
    }
    const workflowResult = await executeReviewRequestHandler({
      event: capturedEvent!,
      step: stepRunner,
    })
    expect(workflowResult.processed).toBe(true)
    expect(workflowResult.emailSent).toBe(true)

    const reviewRequestId = workflowResult.reviewRequestId!

    // Step 14: Confirm development email representation
    const { data: requestRecord } = await userClient
      .from('review_requests')
      .select('id, token, status, channel')
      .eq('id', reviewRequestId)
      .single()

    expect(requestRecord?.status).toBe('SENT')
    expect(requestRecord?.token).toBeDefined()

    const token = requestRecord!.token
    const trackingUrl = `${APP_URL}/r/${token}`

    const renderedEmail = renderNeutralReviewEmail({
      recipientName: 'Jane',
      businessName: `Northstar Dental Live ${timestamp}`,
      trackingUrl,
    })
    expect(renderedEmail.subject).toContain(`Northstar Dental Live ${timestamp}`)
    expect(renderedEmail.body).toContain(trackingUrl)
    expect(renderedEmail.body).toContain("we'd appreciate your honest feedback")

    // Step 15: Confirm review request exists in SENT state
    expect(requestRecord?.status).toBe('SENT')

    // Step 16 & 17: Open tracked URL on the live Next.js HTTP server!
    const liveTrackingRes = await fetch(trackingUrl, { redirect: 'manual' })
    expect(liveTrackingRes.status).toBe(302)
    expect(liveTrackingRes.headers.get('location')).toBe(destinationUrl)

    // Step 18 & 19: Return to dashboard and verify activity updates
    const { count: finalCompleted } = await userClient
      .from('customer_completion_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
    expect(finalCompleted).toBe(1)

    const { count: finalSent } = await userClient
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('status', ['SENT', 'DELIVERED', 'CLICKED'])
    expect(finalSent).toBe(1)

    const { count: finalClicked } = await userClient
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'CLICKED')
    expect(finalClicked).toBe(1)

    const { data: updatedRequest } = await userClient
      .from('review_requests')
      .select('status, clicked_at')
      .eq('id', reviewRequestId)
      .single()
    expect(updatedRequest?.status).toBe('CLICKED')
    expect(updatedRequest?.clicked_at).toBeDefined()
  }, 15000)
})
