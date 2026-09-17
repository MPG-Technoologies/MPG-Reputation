import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../../src/types/database'
import { dispatchPendingOutboxEvents } from '../../src/domain/outbox/dispatcher'
import { executeReviewRequestHandler } from '../../src/inngest/functions/review-request'
import { GET as trackingRouteGet } from '../../src/app/r/[token]/route'
import { NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

describe('True End-to-End Application Chain Test (Prompt Requirement 9)', () => {
  let adminClient: SupabaseClient<Database>
  let userClient: SupabaseClient<Database>
  let userId: string
  let orgId: string
  let locId: string
  let destinationUrl: string
  const timestamp = Date.now()

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const userEmail = `e2e_owner_${timestamp}@test.local`
    const { data: u, error: uErr } = await adminClient.auth.admin.createUser({
      email: userEmail,
      password: 'Password123!',
      email_confirm: true,
    })
    if (uErr || !u.user) throw new Error(`User creation failed: ${uErr?.message}`)
    userId = u.user.id

    userClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email: userEmail,
      password: 'Password123!',
    })
    if (signInErr) throw new Error(`User signin failed: ${signInErr.message}`)

    // 1. Atomic Onboarding via RPC
    const { data: orgRes, error: orgErr } = await userClient.rpc('create_org_with_owner_and_location', {
      p_org_name: `Northstar E2E Clinic ${timestamp}`,
      p_slug: `northstar-e2e-${timestamp}`,
      p_loc_name: 'Main Clinic',
      p_address: '500 E2E Blvd',
    })
    if (orgErr || !orgRes) throw new Error(`Onboarding failed: ${orgErr?.message}`)
    const parsed = orgRes as { organization_id: string; location_id: string }
    orgId = parsed.organization_id
    locId = parsed.location_id

    // 2. Configure Confirmed Google Destination
    destinationUrl = 'https://g.page/r/CWd814KXYZ123/review'
    const { data: dest, error: destErr } = await userClient
      .from('review_destinations')
      .insert({
        organization_id: orgId,
        location_id: locId,
        provider: 'google',
        url: destinationUrl,
        canonical_url: destinationUrl,
        status: 'CONFIRMED',
      })
      .select('id')
      .single()

    if (destErr || !dest) throw new Error(`Destination failed: ${destErr?.message}`)
  })

  afterAll(async () => {
    if (adminClient) {
      if (orgId) await adminClient.from('organizations').delete().eq('id', orgId)
      if (userId) await adminClient.auth.admin.deleteUser(userId)
    }
  })

  it('proves complete authentic production chain: Quick Complete -> Outbox -> Dispatcher -> Inngest Workflow -> Console Provider -> Tracking Route -> HTTP 302 -> Dashboard', async () => {
    const customerEmail = `synthetic.patient.${timestamp}@example.test`
    const sourceEventId = `qc_e2e_intent_${timestamp}`

    // 1. Quick Complete Transactional RPC: resolves customer, completion event, and outbox record atomically
    const { data: atomicRes, error: atomicErr } = await userClient.rpc('submit_quick_complete_atomic', {
      p_org_id: orgId,
      p_loc_id: locId,
      p_first_name: 'Jane',
      p_last_name: 'Doe',
      p_email: customerEmail,
      p_phone: '555-019-9000',
      p_permission_email: 'allowed',
      p_permission_sms: 'unknown',
      p_permission_source: 'quick_complete',
      p_source: 'quick_complete',
      p_source_event_id: sourceEventId,
      p_country: 'CA',
    })

    expect(atomicErr).toBeNull()
    expect(atomicRes).toBeDefined()
    const { customer_id: customerId, completion_event_id: completionEventId, outbox_id: outboxId } = atomicRes as {
      customer_id: string
      completion_event_id: string
      outbox_id: string
    }

    expect(customerId).toBeDefined()
    expect(completionEventId).toBeDefined()
    expect(outboxId).toBeDefined()

    // Verify outbox record is initially PENDING
    const { data: outboxBefore } = await adminClient
      .from('domain_event_outbox')
      .select('status, payload')
      .eq('id', outboxId)
      .single()

    expect(outboxBefore?.status).toBe('PENDING')

    // 2. Outbox Dispatcher dispatches pending event to Inngest with stable deduplication ID
    let inngestDispatchedPayload: { id: string; name: string; data: import('../../src/inngest/functions/review-request').ReviewRequestEventData } | null = null
    const inngestHarness = {
      send: async (event: { id: string; name: string; data: import('../../src/inngest/functions/review-request').ReviewRequestEventData }) => {
        inngestDispatchedPayload = event
        return { ids: ['ing_e2e_1'] }
      },
    } as unknown as import('inngest').Inngest

    const dispatchSummary = await dispatchPendingOutboxEvents(adminClient, inngestHarness, { batchSize: 10 })
    expect(dispatchSummary.dispatched).toBeGreaterThanOrEqual(1)
    expect(inngestDispatchedPayload).toBeDefined()
    const dispatchedEvent = inngestDispatchedPayload!
    expect(dispatchedEvent.id).toBe(outboxId) // Stable domain-event identifier

    // Verify outbox record transitioned to DISPATCHED
    const { data: outboxAfter } = await adminClient
      .from('domain_event_outbox')
      .select('status, dispatched_at')
      .eq('id', outboxId)
      .single()

    expect(outboxAfter?.status).toBe('DISPATCHED')
    expect(outboxAfter?.dispatched_at).toBeDefined()

    // 3. Inngest Workflow Execution via exported production handler
    const stepRunner = {
      run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
      sleep: async () => {}, // Instant sleep in test runtime
    }

    const workflowResult = await executeReviewRequestHandler({
      event: dispatchedEvent,
      step: stepRunner,
    })

    expect(workflowResult.processed).toBe(true)
    expect(workflowResult.emailSent).toBe(true)
    expect(workflowResult.reviewRequestId).toBeDefined()
    const reviewRequestId = workflowResult.reviewRequestId!

    // 4. Verify Review Request persisted with SENT status
    const { data: reviewReq } = await adminClient
      .from('review_requests')
      .select('id, token, token_hash, status, destination_id')
      .eq('id', reviewRequestId)
      .single()

    expect(reviewReq?.status).toBe('SENT')
    expect(reviewReq?.token).toBeDefined()
    const token = reviewReq!.token

    // Verify message_events recorded
    const { data: msgEvents } = await adminClient
      .from('message_events')
      .select('event_type, status, provider')
      .eq('review_request_id', reviewReq!.id)

    expect(msgEvents?.some((m) => m.event_type === 'sent' && m.status === 'SENT')).toBe(true)

    // 5. Customer clicks tracked link: Invoke actual HTTP GET /r/[token] route handler
    const req1 = new NextRequest(`http://localhost:3000/r/${token}`)
    const res1 = await trackingRouteGet(req1, {
      params: Promise.resolve({ token }),
    })

    // Expect HTTP 302 redirect directly to Google Review URL
    expect(res1.status).toBe(302)
    expect(res1.headers.get('location')).toBe(destinationUrl)

    // Verify review request status transitioned from SENT to CLICKED
    const { data: reviewReqAfterClick } = await adminClient
      .from('review_requests')
      .select('status, clicked_at')
      .eq('id', reviewReq!.id)
      .single()

    expect(reviewReqAfterClick?.status).toBe('CLICKED')
    expect(reviewReqAfterClick?.clicked_at).toBeDefined()

    // Verify first_click event recorded
    const { data: clickEvents } = await adminClient
      .from('review_request_events')
      .select('event_type')
      .eq('review_request_id', reviewReq!.id)
      .eq('event_type', 'first_click')

    expect(clickEvents?.length).toBe(1)

    // 6. Repeated Click: customer clicks the link again
    const req2 = new NextRequest(`http://localhost:3000/r/${token}`)
    const res2 = await trackingRouteGet(req2, {
      params: Promise.resolve({ token }),
    })

    expect(res2.status).toBe(302)
    expect(res2.headers.get('location')).toBe(destinationUrl)

    // Verify no duplicate first_click event was inserted
    const { data: clickEventsAfterDupe } = await adminClient
      .from('review_request_events')
      .select('id')
      .eq('review_request_id', reviewReq!.id)
      .eq('event_type', 'first_click')

    expect(clickEventsAfterDupe?.length).toBe(1)

    // 7. Verify Dashboard Source-of-Truth Metrics reflect real state
    const { count: completedCount } = await adminClient
      .from('customer_completion_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)

    const { count: sentCount } = await adminClient
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('status', ['SENT', 'DELIVERED', 'CLICKED'])

    const { count: clickedCount } = await adminClient
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'CLICKED')

    expect(completedCount).toBe(1)
    expect(sentCount).toBe(1)
    expect(clickedCount).toBe(1)
  })
})
