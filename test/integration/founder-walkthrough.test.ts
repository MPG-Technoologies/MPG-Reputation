import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../../src/types/database'
import { dispatchPendingOutboxEvents } from '../../src/domain/outbox/dispatcher'
import { executeReviewRequestHandler } from '../../src/inngest/functions/review-request'
import { GET as trackingRouteGet } from '../../src/app/r/[token]/route'
import { renderNeutralReviewEmail } from '../../src/providers/email/types'
import { NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/**
 * V0.2 Founder Product Experience & Controlled Walkthrough Test Suite
 *
 * Verifies all 19 steps of the Founder Product Walkthrough:
 * 1. Open application / initial state
 * 2. Create synthetic user
 * 3. Authenticate
 * 4. Complete onboarding
 * 5. Create/view organization
 * 6. Create/view location
 * 7. Configure a valid synthetic Google review destination
 * 8. Open dashboard (observe setup status)
 * 9. Use Quick Complete
 * 10. Add a synthetic completed customer
 * 11. Confirm customer.completed persistence
 * 12. Confirm transactional outbox record
 * 13. Confirm workflow execution & eligibility handling
 * 14. Confirm development email representation
 * 15. Confirm review request state
 * 16. Open tracked URL
 * 17. Confirm HTTP 302 redirect
 * 18. Return to dashboard
 * 19. Confirm truthful activity/state update
 */
describe('V0.2 Founder Product Walkthrough (19 Steps Verification)', () => {
  let adminClient: SupabaseClient<Database>
  let userClient: SupabaseClient<Database>
  let userId: string
  let orgId: string
  let locId: string
  const timestamp = Date.now()
  const destinationUrl = 'https://g.page/r/synthetic-founder-walkthrough/review'
  const userEmail = `founder_walkthrough_${timestamp}@example.test`

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 2. Create synthetic user
    const { data: u, error: uErr } = await adminClient.auth.admin.createUser({
      email: userEmail,
      password: 'SafePassword123!',
      email_confirm: true,
    })
    if (uErr || !u.user) throw new Error(`User creation failed: ${uErr?.message}`)
    userId = u.user.id

    // 3. Authenticate
    userClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email: userEmail,
      password: 'SafePassword123!',
    })
    if (signInErr) throw new Error(`User signin failed: ${signInErr.message}`)
  })

  afterAll(async () => {
    if (adminClient) {
      if (orgId) await adminClient.from('organizations').delete().eq('id', orgId)
      if (userId) await adminClient.auth.admin.deleteUser(userId)
    }
  })

  it('executes the full 19-step founder product walkthrough seamlessly', async () => {
    // Step 4 & 5 & 6: Complete onboarding (organization + location created atomically)
    const orgName = `Northstar Dental ${timestamp}`
    const locName = 'Main Clinic'

    const { data: orgRes, error: orgErr } = await userClient.rpc('create_org_with_owner_and_location', {
      p_org_name: orgName,
      p_slug: `northstar-dental-${timestamp}`,
      p_loc_name: locName,
      p_address: '100 Market Street, Suite 400',
    })
    expect(orgErr).toBeNull()
    expect(orgRes).toBeDefined()

    const parsed = orgRes as { organization_id: string; location_id: string }
    orgId = parsed.organization_id
    locId = parsed.location_id

    // Verify Organization exists and is ACTIVE
    const { data: orgRecord } = await userClient
      .from('organizations')
      .select('id, name, status')
      .eq('id', orgId)
      .single()
    expect(orgRecord?.name).toBe(orgName)
    expect(orgRecord?.status).toBe('ACTIVE')

    // Verify Location exists and is ACTIVE
    const { data: locRecord } = await userClient
      .from('locations')
      .select('id, name, status')
      .eq('id', locId)
      .single()
    expect(locRecord?.name).toBe(locName)
    expect(locRecord?.status).toBe('ACTIVE')

    // Step 7: Configure a valid synthetic Google review destination
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

    // Step 8: Open Dashboard (Initial Baseline Check)
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

    // Step 9 & 10: Quick Complete — Add a synthetic completed customer
    const customerEmail = `jane.doe.${timestamp}@example.test`
    const sourceEventId = `qc_walkthrough_${timestamp}`

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
    expect(customerId).toBeDefined()
    expect(completionEventId).toBeDefined()
    expect(outboxId).toBeDefined()

    // Step 11: Confirm customer.completed persistence
    const { data: completionRecord } = await userClient
      .from('customer_completion_events')
      .select('id, customer_id, location_id, source_event_id')
      .eq('id', completionEventId)
      .single()
    expect(completionRecord?.customer_id).toBe(customerId)
    expect(completionRecord?.location_id).toBe(locId)
    expect(completionRecord?.source_event_id).toBe(sourceEventId)

    // Step 12: Confirm transactional outbox record
    const { data: outboxRecord } = await adminClient
      .from('domain_event_outbox')
      .select('id, status, event_type')
      .eq('id', outboxId)
      .single()
    expect(outboxRecord?.status).toBe('PENDING')
    expect(outboxRecord?.event_type).toBe('customer.completed')

    // Step 13: Outbox Dispatcher & Inngest Workflow Execution
    let capturedEvent: { id: string; name: string; data: import('../../src/inngest/functions/review-request').ReviewRequestEventData } | null = null
    const inngestHarness = {
      send: async (event: { id: string; name: string; data: import('../../src/inngest/functions/review-request').ReviewRequestEventData }) => {
        capturedEvent = event
        return { ids: ['inngest_walkthrough_1'] }
      },
    } as unknown as import('inngest').Inngest

    const dispatchSummary = await dispatchPendingOutboxEvents(adminClient, inngestHarness, {
      organizationId: orgId,
      batchSize: 10,
    })
    expect(dispatchSummary.dispatched).toBe(1)
    expect(capturedEvent).toBeDefined()

    // Step 13: Inngest Workflow runs (eligibility check + delay + post-delay recheck + send)
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
    expect(workflowResult.reviewRequestId).toBeDefined()

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
    const trackingUrl = `http://localhost:3000/r/${token}`

    const renderedEmail = renderNeutralReviewEmail({
      recipientName: 'Jane',
      businessName: orgName,
      trackingUrl,
    })
    expect(renderedEmail.subject).toContain(orgName)
    expect(renderedEmail.body).toContain(trackingUrl)
    expect(renderedEmail.body).toContain("we'd appreciate your honest feedback")
    // Ensure strictly neutral: no stars, no incentives, no bias
    expect(renderedEmail.body).not.toContain('5 stars')
    expect(renderedEmail.body).not.toContain('discount')

    // Step 15: Confirm review request state in DB
    expect(requestRecord?.status).toBe('SENT')
    expect(requestRecord?.channel).toBe('email')

    // Step 16 & 17: Open tracked URL -> Confirm HTTP 302 redirect to Google destination
    const trackReq = new NextRequest(trackingUrl)
    const trackRes = await trackingRouteGet(trackReq, {
      params: Promise.resolve({ token }),
    })

    expect(trackRes.status).toBe(302)
    expect(trackRes.headers.get('location')).toBe(destinationUrl)

    // Step 18 & 19: Return to dashboard -> Confirm truthful activity and state update
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
  })
})
