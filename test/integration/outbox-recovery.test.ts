import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { Database } from "../../src/types/database"
import { executeOutboxRecoveryHandler } from "../../src/inngest/functions/outbox-recovery"
import { executeReviewRequestHandler } from "../../src/inngest/functions/review-request"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54331"
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""

describe("Automatic Outbox Recovery Workflow (Prompt Trust-Boundary Correction 3)", () => {
  let adminClient: SupabaseClient<Database>
  let userClient: SupabaseClient<Database>
  let userId: string
  let orgId: string
  let locId: string
  const timestamp = Date.now()

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const userEmail = `outbox_recovery_${timestamp}@test.local`
    const { data: u, error: uErr } = await adminClient.auth.admin.createUser({
      email: userEmail,
      password: "Password123!",
      email_confirm: true,
    })
    if (uErr || !u.user) throw new Error(`User creation failed: ${uErr?.message}`)
    userId = u.user.id

    userClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email: userEmail,
      password: "Password123!",
    })
    if (signInErr) throw new Error(`User signin failed: ${signInErr.message}`)

    const { data: orgRes } = await userClient.rpc("create_org_with_owner_and_location", {
      p_org_name: `Outbox Recovery Org ${timestamp}`,
      p_slug: `outbox-rec-${timestamp}`,
      p_loc_name: "Central Recovery Clinic",
    })
    const parsed = orgRes as { organization_id: string; location_id: string }
    orgId = parsed.organization_id
    locId = parsed.location_id

    await userClient.from("review_destinations").insert({
      organization_id: orgId,
      location_id: locId,
      provider: "google",
      url: "https://g.page/r/OutboxRecTest123/review",
      canonical_url: "https://g.page/r/OutboxRecTest123/review",
      status: "CONFIRMED",
    })

    await adminClient.rpc("provision_organization_trial", {
      p_org_id: orgId,
      p_allocated_requests: 30,
      p_duration_days: 30,
    })
    await adminClient
      .from("organization_entitlements")
      .update({
        status: "ACTIVE",
        started_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      })
      .eq("organization_id", orgId)
  })

  afterAll(async () => {
    if (adminClient) {
      if (orgId) {
        await adminClient.from("domain_event_outbox").delete().eq("organization_id", orgId)
        await adminClient.from("organizations").delete().eq("id", orgId)
      }
      if (userId) await adminClient.auth.admin.deleteUser(userId)
    }
  })

  it("proves Quick Complete persists PENDING outbox, recovers via scheduled recovery handler, and processes workflow once without duplication", async () => {
    const custEmail = `patient.recovery.${timestamp}@example.test`
    const sourceEventId = `source_evt_${timestamp}`

    // 1. Quick Complete persists atomic completion and outbox record
    const { data: rpcRes, error: rpcErr } = await userClient.rpc("submit_quick_complete_atomic", {
      p_org_id: orgId,
      p_loc_id: locId,
      p_first_name: "Oliver",
      p_last_name: "Recovery",
      p_email: custEmail,
      p_source: "quick_complete",
      p_source_event_id: sourceEventId,
      p_permission_email: "allowed",
    })

    expect(rpcErr).toBeNull()
    const parsedRpc = rpcRes as { customer_id: string; completion_event_id: string; outbox_id: string }
    expect(parsedRpc.outbox_id).toBeDefined()

    // 2. Simulated immediate Inngest dispatch failure: outbox record remains PENDING
    const { data: outboxPending } = await adminClient
      .from("domain_event_outbox")
      .select("status, attempt_count")
      .eq("id", parsedRpc.outbox_id)
      .single()

    expect(outboxPending?.status).toBe("PENDING")
    expect(outboxPending?.attempt_count).toBe(0)

    // 3. Scheduled recovery dispatcher runs with mock inngest dispatch harness
    const inngestHarness = {
      send: async () => ({ ids: ["rec_1"] }),
    } as unknown as import("inngest").Inngest

    const recoveryResult = await executeOutboxRecoveryHandler({
      inngestClient: inngestHarness,
      organizationId: orgId,
      step: {
        run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => {
          return await fn()
        },
      },
    })

    expect(recoveryResult.processed).toBeGreaterThanOrEqual(1)
    expect(recoveryResult.dispatched).toBeGreaterThanOrEqual(1)

    // Verify outbox record transitioned to DISPATCHED
    const { data: outboxDispatched } = await adminClient
      .from("domain_event_outbox")
      .select("status, dispatched_at, attempt_count")
      .eq("id", parsedRpc.outbox_id)
      .single()

    expect(outboxDispatched?.status).toBe("DISPATCHED")
    expect(outboxDispatched?.dispatched_at).not.toBeNull()
    expect(outboxDispatched?.attempt_count).toBe(1)

    // 4. Workflow processes the recovered event
    const workflowEvent = {
      eventId: parsedRpc.completion_event_id,
      organizationId: orgId,
      locationId: locId,
      customerId: parsedRpc.customer_id,
      sourceEventId,
      contact: { email: custEmail },
      permission: { email: "allowed" as const },
    }

    const firstRun = await executeReviewRequestHandler({
      event: { data: workflowEvent },
      step: {
        run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => await fn(),
        sleep: async () => {},
      },
    })

    expect(firstRun.processed).toBe(true)
    expect(firstRun.reviewRequestId).toBeDefined()

    // 5. Subsequent run (or replay) of the same recovered event does not duplicate the customer send
    const secondRun = await executeReviewRequestHandler({
      event: { data: workflowEvent },
      step: {
        run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => await fn(),
        sleep: async () => {},
      },
    })

    expect(secondRun.processed).toBe(true)
    expect(secondRun.reviewRequestId).toBe(firstRun.reviewRequestId)

    // Verify exactly one review request exists for this customer completion event
    const { data: requests } = await adminClient
      .from("review_requests")
      .select("id, status")
      .eq("completion_event_id", parsedRpc.completion_event_id)

    expect(requests).toHaveLength(1)
    expect(requests![0].status).toBe("SENT")
  })
})
