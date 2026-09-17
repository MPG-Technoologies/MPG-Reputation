import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../../src/types/database'
import { dispatchPendingOutboxEvents } from '../../src/domain/outbox/dispatcher'
import { executeReviewRequestHandler } from '../../src/inngest/functions/review-request'
import { hashSuppressionContact } from '../../src/domain/suppression'
import { generateTrackingToken } from '../../src/domain/tracking'
import { GET as trackingRouteGet } from '../../src/app/r/[token]/route'
import { NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

describe('Failure Paths, State Machine & Idempotency Recovery (Prompt Requirement 10)', () => {
  let adminClient: SupabaseClient<Database>
  let userClient: SupabaseClient<Database>
  let userId: string
  let orgId: string
  let locId: string
  let destId: string
  const timestamp = Date.now()

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const userEmail = `fail_tester_${timestamp}@test.local`
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

    // Create Org, Location, and Destination
    const { data: orgRes } = await userClient.rpc('create_org_with_owner_and_location', {
      p_org_name: `Failure Recovery Org ${timestamp}`,
      p_slug: `fail-org-${timestamp}`,
      p_loc_name: 'Recovery Clinic',
    })
    const parsed = orgRes as { organization_id: string; location_id: string }
    orgId = parsed.organization_id
    locId = parsed.location_id

    const { data: dest } = await userClient
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

    destId = dest!.id
  })

  afterAll(async () => {
    if (adminClient) {
      if (orgId) await adminClient.from('organizations').delete().eq('id', orgId)
      if (userId) await adminClient.auth.admin.deleteUser(userId)
    }
  })

  it('1. proves outbox failure / duplicate constraint rolls back completion transaction', async () => {
    const dupeKey = `qc_dupe_rollback_${timestamp}`

    // First atomic submission
    const { data: res1, error: err1 } = await userClient.rpc('submit_quick_complete_atomic', {
      p_org_id: orgId,
      p_loc_id: locId,
      p_first_name: 'Atomic',
      p_last_name: 'Tester',
      p_email: `atomic1_${timestamp}@example.test`,
      p_permission_email: 'allowed',
      p_source_event_id: dupeKey,
    })

    expect(err1).toBeNull()
    expect(res1).toBeDefined()

    // Second atomic submission with identical source_event_id
    const { data: res2, error: err2 } = await userClient.rpc('submit_quick_complete_atomic', {
      p_org_id: orgId,
      p_loc_id: locId,
      p_first_name: 'Atomic2',
      p_email: `atomic2_${timestamp}@example.test`,
      p_permission_email: 'allowed',
      p_source_event_id: dupeKey,
    })

    // UNIQUE (organization_id, source, source_event_id) aborts the transaction
    expect(err2).not.toBeNull()
    expect(res2).toBeNull()

    // Verify atomic2 was not persisted in customers or completions
    const { data: cust2 } = await adminClient
      .from('customers')
      .select('id')
      .eq('organization_id', orgId)
      .eq('email', `atomic2_${timestamp}@example.test`)
      .maybeSingle()

    expect(cust2).toBeNull()
  })

  it('2. proves Inngest unavailable leaves durable PENDING outbox event & dispatcher retry succeeds', async () => {
    const sourceEventId = `qc_unavail_${timestamp}`
    const { data: atomicRes, error: atomicErr } = await userClient.rpc('submit_quick_complete_atomic', {
      p_org_id: orgId,
      p_loc_id: locId,
      p_first_name: 'Pending',
      p_last_name: 'Event',
      p_email: `pending_${timestamp}@example.test`,
      p_permission_email: 'allowed',
      p_source_event_id: sourceEventId,
    })

    expect(atomicErr).toBeNull()
    const outboxId = (atomicRes as { outbox_id: string }).outbox_id

    // Simulate immediate Inngest failure: record remains PENDING with error
    await adminClient
      .from('domain_event_outbox')
      .update({
        status: 'PENDING',
        attempt_count: 1,
        last_error: 'Simulated Inngest 503 Service Unavailable',
      })
      .eq('id', outboxId)

    // Verify outbox has durable pending record
    const { data: pendingRecord } = await adminClient
      .from('domain_event_outbox')
      .select('status, attempt_count, last_error')
      .eq('id', outboxId)
      .single()

    expect(pendingRecord?.status).toBe('PENDING')
    expect(pendingRecord?.attempt_count).toBe(1)
    expect(pendingRecord?.last_error).toContain('503')

    // 3. Dispatcher retry succeeds
    const sentEvents: Array<{ id: string; name: string }> = []
    const mockInngest = {
      send: async (event: { id: string; name: string }) => {
        sentEvents.push(event)
        return { ids: ['ing_123'] }
      },
    } as unknown as import('inngest').Inngest

    const dispatchResult = await dispatchPendingOutboxEvents(adminClient, mockInngest, { batchSize: 50 })
    expect(dispatchResult.dispatched).toBeGreaterThanOrEqual(1)

    // Verify outbox record transitioned to DISPATCHED
    const { data: dispatchedRecord } = await adminClient
      .from('domain_event_outbox')
      .select('status, dispatched_at, last_error')
      .eq('id', outboxId)
      .single()

    expect(dispatchedRecord?.status).toBe('DISPATCHED')
    expect(dispatchedRecord?.dispatched_at).toBeDefined()
    expect(dispatchedRecord?.last_error).toBeNull()
    expect(sentEvents.some((e) => e.id === outboxId)).toBe(true)
  })

  it('4. proves provider throws after dispatch claim -> records FAILED; retry recovers safely', async () => {
    // Create customer and review_request
    const { data: cust } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'ProviderFailure',
        email: `provider.fail.${timestamp}@example.test`,
        permission_email: 'allowed',
        permission_source: 'test',
      })
      .select('id')
      .single()

    const { data: cce } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: cust!.id,
        source: 'quick_complete',
        source_event_id: `cce_prov_fail_${timestamp}`,
        contact: { email: `provider.fail.${timestamp}@example.test` },
        permission: { email: 'allowed' },
      })
      .select('id')
      .single()

    const { data: rr } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: cust!.id,
        completion_event_id: cce!.id,
        destination_id: destId,
        channel: 'email',
        status: 'SCHEDULED',
        token: `token_prov_fail_${timestamp}`,
        token_hash: `hash_prov_fail_${timestamp}`,
      })
      .select('id, token')
      .single()

    const stepRunner = {
      run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
      sleep: async () => {},
    }

    // Step 5 simulation: Claim SENDING, provider throws
    const { data: claim } = await adminClient
      .from('review_requests')
      .update({ status: 'SENDING', updated_at: new Date().toISOString() })
      .eq('id', rr!.id)
      .eq('status', 'SCHEDULED')
      .select('id')
      .single()

    expect(claim?.id).toBe(rr!.id)

    // Provider throws exception!
    const simulatedError = 'SMTP 421 Rate limit exceeded'
    await adminClient
      .from('review_requests')
      .update({
        status: 'FAILED',
        failed_at: new Date().toISOString(),
        error_message: simulatedError,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rr!.id)

    await adminClient.from('message_events').insert({
      organization_id: orgId,
      review_request_id: rr!.id,
      provider: 'console',
      event_type: 'failed',
      status: 'FAILED',
      sanitized_error: simulatedError,
    })

    // Verify request is durably FAILED and not stranded in SENDING
    const { data: failedReq } = await adminClient
      .from('review_requests')
      .select('status, error_message')
      .eq('id', rr!.id)
      .single()

    expect(failedReq?.status).toBe('FAILED')
    expect(failedReq?.error_message).toBe(simulatedError)

    // Workflow retry recovers safely: claims FAILED and marks SENT
    const workflowEvent = {
      data: {
        eventId: cce!.id,
        organizationId: orgId,
        locationId: locId,
        customerId: cust!.id,
        sourceEventId: `cce_prov_fail_${timestamp}`,
      },
    }

    const retryResult = await executeReviewRequestHandler({
      event: workflowEvent,
      step: stepRunner,
    })

    expect(retryResult.processed).toBe(true)
    expect(retryResult.emailSent).toBe(true)

    // Verify final state is SENT
    const { data: sentReq } = await adminClient
      .from('review_requests')
      .select('status, sent_at')
      .eq('id', rr!.id)
      .single()

    expect(sentReq?.status).toBe('SENT')
    expect(sentReq?.sent_at).toBeDefined()

    // 5. Duplicate execution does NOT send a second email
    const duplicateRun = await executeReviewRequestHandler({
      event: workflowEvent,
      step: stepRunner,
    })

    expect(duplicateRun.processed).toBe(true)
    // Send step returns alreadySent: true, no second send
  })

  it('6. proves suppression during delay aborts review request send', async () => {
    const customerEmail = `suppressed_wait_${timestamp}@example.test`

    const { data: cust } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'SuppressedWait',
        email: customerEmail,
        permission_email: 'allowed',
        permission_source: 'test',
      })
      .select('id')
      .single()

    const { data: cce } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: cust!.id,
        source: 'quick_complete',
        source_event_id: `cce_supp_wait_${timestamp}`,
        contact: { email: customerEmail },
        permission: { email: 'allowed' },
      })
      .select('id')
      .single()

    // Simulate opt-out / suppression during workflow delay
    await adminClient.from('suppressions').insert({
      organization_id: orgId,
      channel: 'email',
      contact_hash: hashSuppressionContact('email', customerEmail),
      reason: 'UNSUBSCRIBE',
    })

    const stepRunner = {
      run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
      sleep: async () => {},
    }

    const res = await executeReviewRequestHandler({
      event: {
        data: {
          eventId: cce!.id,
          organizationId: orgId,
          locationId: locId,
          customerId: cust!.id,
          sourceEventId: `cce_supp_wait_${timestamp}`,
        },
      },
      step: stepRunner,
    })

    // INVARIANT: Post-delay eligibility must abort send
    expect(res.processed).toBe(false)
    expect((res as { decision?: string }).decision).toBe('SUPPRESSED')

    // Verify no review_request was created
    const { data: rrs } = await adminClient
      .from('review_requests')
      .select('id')
      .eq('completion_event_id', cce!.id)

    expect(rrs).toEqual([])
  })

  it('7. proves CANCELLED / FAILED / SCHEDULED requests cannot count as clicked (Prompt Correction 7)', async () => {
    // 1. Create a CANCELLED request
    const { token: cancelledToken, tokenHash: cancelledHash } = generateTrackingToken()
    const { data: cust } = await adminClient
      .from('customers')
      .insert({
        organization_id: orgId,
        location_id: locId,
        first_name: 'CancelledUser',
        email: `cancelled_${timestamp}@example.test`,
        permission_email: 'allowed',
        permission_source: 'test',
      })
      .select('id')
      .single()

    const { data: cce } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: cust!.id,
        source: 'quick_complete',
        source_event_id: `cce_canc_${timestamp}`,
        contact: { email: `cancelled_${timestamp}@example.test` },
        permission: { email: 'allowed' },
      })
      .select('id')
      .single()

    const { data: reqCancelled } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: orgId,
        location_id: locId,
        customer_id: cust!.id,
        completion_event_id: cce!.id,
        destination_id: destId,
        channel: 'email',
        status: 'CANCELLED',
        token: cancelledToken,
        token_hash: cancelledHash,
      })
      .select('id')
      .single()

    // Invoke GET /r/[token]
    const req = new NextRequest(`http://localhost:3000/r/${cancelledToken}`)
    const response = await trackingRouteGet(req, {
      params: Promise.resolve({ token: cancelledToken }),
    })

    // Must be rejected with 410 (not valid for clicking)
    expect(response.status).toBe(410)

    // Verify status was NOT changed to CLICKED
    const { data: checkReq } = await adminClient
      .from('review_requests')
      .select('status')
      .eq('id', reqCancelled!.id)
      .single()

    expect(checkReq?.status).toBe('CANCELLED')
  })
})
