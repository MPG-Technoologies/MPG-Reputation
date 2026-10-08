import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../../src/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const CANONICAL_KEYS = [
  'customerId',
  'eventId',
  'locationId',
  'organizationId',
  'sourceEventId',
]

const FORBIDDEN_KEYS = [
  'contact',
  'permission',
  'country',
  'completedAt',
  'source',
  'sourceCustomerId',
  'sourceTransactionId',
  'email',
  'phone',
  'firstName',
  'lastName',
]

describe('MR-7B.3 Integration: Database Outbox Payload Minimization & Historical Scrub', () => {
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

    const userEmail = `mr7b3_test_${timestamp}@test.local`
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

    const { data: orgRes } = await userClient.rpc('create_org_with_owner_and_location', {
      p_org_name: `MR7B3 Test Org ${timestamp}`,
      p_slug: `mr7b3-test-${timestamp}`,
      p_loc_name: 'Main Location',
    })
    const parsed = orgRes as { organization_id: string; location_id: string }
    orgId = parsed.organization_id
    locId = parsed.location_id
  })

  afterAll(async () => {
    if (adminClient) {
      if (orgId) {
        await adminClient.from('domain_event_outbox').delete().eq('organization_id', orgId)
        await adminClient.from('customer_completion_events').delete().eq('organization_id', orgId)
        await adminClient.from('customers').delete().eq('organization_id', orgId)
        await adminClient.from('organizations').delete().eq('id', orgId)
      }
      if (userId) await adminClient.auth.admin.deleteUser(userId)
    }
  })

  it('proves submit_quick_complete_atomic writes exactly five-key outbox payload while retaining rich customer_completion_events evidence', async () => {
    const custEmail = `qc_patient_${timestamp}@example.test`
    const sourceEventId = `qc_src_${timestamp}`

    const { data: rpcRes, error: rpcErr } = await userClient.rpc('submit_quick_complete_atomic', {
      p_org_id: orgId,
      p_loc_id: locId,
      p_first_name: 'Arthur',
      p_last_name: 'Dent',
      p_email: custEmail,
      p_phone: '555-4242',
      p_permission_email: 'allowed',
      p_permission_sms: 'unknown',
      p_permission_source: 'quick_complete',
      p_source: 'quick_complete',
      p_source_event_id: sourceEventId,
      p_country: 'CA',
    })

    expect(rpcErr).toBeNull()
    const parsed = rpcRes as {
      customer_id: string
      completion_event_id: string
      outbox_id: string
      source_event_id: string
    }

    // 1. Inspect domain_event_outbox row
    const { data: outboxRow, error: outboxErr } = await adminClient
      .from('domain_event_outbox')
      .select('*')
      .eq('id', parsed.outbox_id)
      .single()

    expect(outboxErr).toBeNull()
    expect(outboxRow).toBeDefined()

    const payload = outboxRow!.payload as Record<string, unknown>
    const payloadKeys = Object.keys(payload).sort()

    // Payload keys MUST be exactly the canonical five
    expect(payloadKeys).toEqual(CANONICAL_KEYS)
    expect(payload.eventId).toBe(parsed.completion_event_id)
    expect(payload.organizationId).toBe(orgId)
    expect(payload.locationId).toBe(locId)
    expect(payload.customerId).toBe(parsed.customer_id)
    expect(payload.sourceEventId).toBe(sourceEventId)

    // Payload MUST NOT contain forbidden PII or transport baggage
    for (const forbiddenKey of FORBIDDEN_KEYS) {
      expect(payload).not.toHaveProperty(forbiddenKey)
    }

    // 2. Inspect customer_completion_events row to verify rich evidence is PRESERVED
    const { data: completionEvent, error: compErr } = await adminClient
      .from('customer_completion_events')
      .select('*')
      .eq('id', parsed.completion_event_id)
      .single()

    expect(compErr).toBeNull()
    expect(completionEvent).toBeDefined()
    expect(completionEvent!.country).toBe('CA')

    const contact = completionEvent!.contact as Record<string, unknown>
    expect(contact.email).toBe(custEmail)
    expect(contact.firstName).toBe('Arthur')
    expect(contact.lastName).toBe('Dent')
    expect(contact.phone).toBe('555-4242')

    const permission = completionEvent!.permission as Record<string, unknown>
    expect(permission.email).toBe('allowed')
    expect(permission.source).toBe('quick_complete')
  })

  it('proves submit_completion_system_atomic writes exactly five-key outbox payload while retaining rich customer_completion_events evidence', async () => {
    const custEmail = `api_patient_${timestamp}@example.test`
    const sourceEventId = `api_src_${timestamp}`

    const { data: rpcRes, error: rpcErr } = await adminClient.rpc('submit_completion_system_atomic', {
      p_org_id: orgId,
      p_loc_id: locId,
      p_first_name: 'Ford',
      p_last_name: 'Prefect',
      p_email: custEmail,
      p_phone: '555-1979',
      p_permission_email: 'allowed',
      p_permission_sms: 'denied',
      p_permission_source: 'api_v1',
      p_source: 'api_v1',
      p_source_event_id: sourceEventId,
      p_source_customer_id: 'src_cust_42',
      p_source_transaction_id: 'src_txn_42',
      p_country: 'US',
    })

    expect(rpcErr).toBeNull()
    const parsed = rpcRes as {
      duplicate: boolean
      customer_id: string
      completion_event_id: string
      outbox_id: string
      source_event_id: string
    }

    expect(parsed.duplicate).toBe(false)

    // 1. Inspect domain_event_outbox row
    const { data: outboxRow, error: outboxErr } = await adminClient
      .from('domain_event_outbox')
      .select('*')
      .eq('id', parsed.outbox_id)
      .single()

    expect(outboxErr).toBeNull()
    expect(outboxRow).toBeDefined()

    const payload = outboxRow!.payload as Record<string, unknown>
    const payloadKeys = Object.keys(payload).sort()

    // Payload keys MUST be exactly the canonical five
    expect(payloadKeys).toEqual(CANONICAL_KEYS)
    expect(payload.eventId).toBe(parsed.completion_event_id)
    expect(payload.organizationId).toBe(orgId)
    expect(payload.locationId).toBe(locId)
    expect(payload.customerId).toBe(parsed.customer_id)
    expect(payload.sourceEventId).toBe(sourceEventId)

    // Payload MUST NOT contain forbidden PII or transport baggage
    for (const forbiddenKey of FORBIDDEN_KEYS) {
      expect(payload).not.toHaveProperty(forbiddenKey)
    }

    // 2. Inspect customer_completion_events row to verify rich evidence is PRESERVED
    const { data: completionEvent, error: compErr } = await adminClient
      .from('customer_completion_events')
      .select('*')
      .eq('id', parsed.completion_event_id)
      .single()

    expect(compErr).toBeNull()
    expect(completionEvent).toBeDefined()
    expect(completionEvent!.country).toBe('US')
    expect(completionEvent!.source_customer_id).toBe('src_cust_42')
    expect(completionEvent!.source_transaction_id).toBe('src_txn_42')

    const contact = completionEvent!.contact as Record<string, unknown>
    expect(contact.email).toBe(custEmail)
    expect(contact.firstName).toBe('Ford')
    expect(contact.lastName).toBe('Prefect')
    expect(contact.phone).toBe('555-1979')

    const permission = completionEvent!.permission as Record<string, unknown>
    expect(permission.email).toBe('allowed')
    expect(permission.sms).toBe('denied')
    expect(permission.source).toBe('api_v1')
  })

  it('proves historical scrub minimizes legacy rows and fail-closed validation aborts on missing keys', async () => {
    // 1. Insert a synthetic legacy row with extra contact/permission fields
    const syntheticEventId = 'comp_legacy_synth_001'
    const syntheticSourceEventId = `synth_src_${timestamp}`
    const legacyPayload = {
      eventId: syntheticEventId,
      organizationId: orgId,
      locationId: locId,
      customerId: 'cust_legacy_synth_001',
      sourceEventId: syntheticSourceEventId,
      completedAt: new Date().toISOString(),
      country: 'CA',
      contact: { email: 'legacy@test.local', phone: '555-0000', firstName: 'Legacy', lastName: 'User' },
      permission: { email: 'allowed', sms: 'unknown', source: 'legacy_import' },
      source: 'quick_complete',
      sourceCustomerId: 'src_c_01',
      sourceTransactionId: 'src_t_01',
    }

    const { data: insertedLegacy, error: insertErr } = await adminClient
      .from('domain_event_outbox')
      .insert({
        organization_id: orgId,
        event_type: 'customer.completed',
        aggregate_type: 'customer_completion_event',
        aggregate_id: '00000000-0000-0000-0000-000000000001',
        payload: legacyPayload,
        status: 'DISPATCHED',
        attempt_count: 1,
      })
      .select('id, status, attempt_count, created_at, dispatched_at')
      .single()

    expect(insertErr).toBeNull()
    expect(insertedLegacy).toBeDefined()
    const syntheticOutboxId = insertedLegacy!.id

    // 2. Execute historical scrub update on this synthetic row
    const { error: scrubErr } = await adminClient
      .from('domain_event_outbox')
      .update({
        payload: {
          eventId: legacyPayload.eventId,
          organizationId: legacyPayload.organizationId,
          locationId: legacyPayload.locationId,
          customerId: legacyPayload.customerId,
          sourceEventId: legacyPayload.sourceEventId,
        },
      })
      .eq('id', syntheticOutboxId)

    expect(scrubErr).toBeNull()

    // Verify row payload was scrubbed to canonical five keys
    const { data: scrubbedRow } = await adminClient
      .from('domain_event_outbox')
      .select('*')
      .eq('id', syntheticOutboxId)
      .single()

    expect(scrubbedRow).toBeDefined()
    const scrubbedPayload = scrubbedRow!.payload as Record<string, unknown>
    expect(Object.keys(scrubbedPayload).sort()).toEqual(CANONICAL_KEYS)

    for (const forbiddenKey of FORBIDDEN_KEYS) {
      expect(scrubbedPayload).not.toHaveProperty(forbiddenKey)
    }

    // Verify status, attempt_count, created_at were preserved
    expect(scrubbedRow!.status).toBe(insertedLegacy!.status)
    expect(scrubbedRow!.attempt_count).toBe(insertedLegacy!.attempt_count)

    // 3. Test fail-closed validation: row missing required key must be rejected by validation block
    const malformedPayload = {
      eventId: syntheticEventId,
      organizationId: orgId,
      locationId: locId,
      customerId: 'cust_legacy_synth_001',
      // sourceEventId is missing!
    }

    const { data: insertedMalformed, error: malformedInsertErr } = await adminClient
      .from('domain_event_outbox')
      .insert({
        organization_id: orgId,
        event_type: 'customer.completed',
        aggregate_type: 'customer_completion_event',
        aggregate_id: '00000000-0000-0000-0000-000000000002',
        payload: malformedPayload,
        status: 'DISPATCHED',
        attempt_count: 1,
      })
      .select('id')
      .single()

    expect(malformedInsertErr).toBeNull()
    const malformedId = insertedMalformed!.id

    // Check if the validation query correctly identifies the malformed row
    const { data: invalidRows, error: checkErr } = await adminClient
      .from('domain_event_outbox')
      .select('id, payload')
      .eq('id', malformedId)
      .filter('payload->>sourceEventId', 'is', null)

    expect(checkErr).toBeNull()
    expect(invalidRows).toHaveLength(1)

    // Clean up synthetic rows
    await adminClient.from('domain_event_outbox').delete().in('id', [syntheticOutboxId, malformedId])
  })
})
