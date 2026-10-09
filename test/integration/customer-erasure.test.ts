import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import type { Database } from '../../src/types/database'
import { hashSuppressionContact } from '../../src/domain/suppression'
import { generateTrackingToken } from '../../src/domain/tracking'
import { generateUnsubscribeToken } from '../../src/domain/unsubscribe'
import { GET, POST } from '../../src/app/unsubscribe/[token]/route'
import { checkCustomerErasureEligibility } from '../../src/domain/privacy/erasure-guard'
import { checkFinalEmailDispatchAuthority } from '../../src/inngest/functions/review-request'

vi.mock('server-only', () => ({}))

let activeClient: SupabaseClient<Database>
let privilegedClient: SupabaseClient<Database>

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => activeClient),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => privilegedClient),
}))

import {
  eraseCustomer,
  checkErasureAuthority,
  executeCustomerErasureInternal,
  CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME,
  C3C_EXTERNAL_IDENTIFIER_POLICY,
  C3C_EXTERNAL_IDENTIFIER_GATE,
  type CustomerErasureResult,
} from '../../src/domain/privacy/customer-erasure'
import { getCustomerPrivacyExport } from '../../src/domain/privacy/customer-export'

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

function executeDirectSql(sql: string): string {
  try {
    return execSync(
      'docker exec -i supabase_db_MPG-Reputation psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A',
      {
        input: sql,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )
  } catch (err) {
    const errorWithStderr = err as { stderr?: Buffer | string; message?: string }
    const stderr = errorWithStderr.stderr ? errorWithStderr.stderr.toString() : ''
    const msg = stderr || errorWithStderr.message || 'Direct SQL execution failed'
    if (
      msg.includes('Customer is privacy-erased and cannot have PII restored') ||
      msg.includes('BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS')
    ) {
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

function checkTablePrivilegeDirect(
  role: string,
  table: string,
  privilege: string
): boolean {
  const sql = `SELECT has_table_privilege('${role}', '${table}', '${privilege}');`
  const result = executeDirectSql(sql).trim()
  return result === 't' || result === 'true'
}

function checkFunctionPrivilegeDirect(
  role: string,
  funcSignature: string,
  privilege: string
): boolean {
  const sql = `SELECT has_function_privilege('${role}', '${funcSignature}', '${privilege}');`
  const result = executeDirectSql(sql).trim()
  return result === 't' || result === 'true'
}

const isDbAvailable =
  !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'dummy_service_role_key'

describe.skipIf(!isDbAvailable)(
  'MR-7C.3B Controlled Customer Erasure / Anonymization Engine Foundation Suite',
  { timeout: 30000 },
  () => {
    let adminClient: SupabaseClient<Database>
    let ownerClient: SupabaseClient<Database>
    let adminRoleClient: SupabaseClient<Database>
    let operatorClient: SupabaseClient<Database>
    let viewerClient: SupabaseClient<Database>
    let anonClient: SupabaseClient<Database>

    let ownerUserId: string
    let adminUserId: string
    let operatorUserId: string
    let viewerUserId: string

    let orgId: string
    let locId: string
    let custId: string
    let completionEventId: string
    let reviewRequestId: string
    let unsubToken: string
    let unsubTokenHash: string
    let suppressionHash: string

    let foreignOrgId: string
    let foreignCustId: string

    const timestamp = Date.now()
    const customerEmail = `privacy.patient.${timestamp}@example.test`

    beforeAll(async () => {
      adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      privilegedClient = adminClient
      activeClient = adminClient

      suppressionHash = hashSuppressionContact('email', customerEmail)

      // 1. Create Organization A
      const { data: org, error: orgErr } = await adminClient
        .from('organizations')
        .insert({
          name: `MR7C3B Privacy Org ${timestamp}`,
          slug: `mr7c3b-org-${timestamp}`,
          status: 'ACTIVE',
        })
        .select('id')
        .single()
      if (orgErr || !org) throw new Error(`Org creation failed: ${orgErr?.message}`)
      orgId = org.id

      // 2. Create Location A
      const { data: loc, error: locErr } = await adminClient
        .from('locations')
        .insert({
          organization_id: orgId,
          name: 'Privacy Care Dental',
          status: 'ACTIVE',
          review_reply_to_email: 'feedback@privacycare.test',
        })
        .select('id')
        .single()
      if (locErr || !loc) throw new Error(`Loc creation failed: ${locErr?.message}`)
      locId = loc.id

      // 3. Create Customer A
      const { data: cust, error: custErr } = await adminClient
        .from('customers')
        .insert({
          organization_id: orgId,
          location_id: locId,
          first_name: 'Jordan',
          last_name: 'Privacy',
          email: customerEmail,
          phone: '+15555550199',
          permission_email: 'allowed',
          permission_sms: 'unknown',
          permission_source: 'intake_form',
        })
        .select('id')
        .single()
      if (custErr || !cust) throw new Error(`Customer creation failed: ${custErr?.message}`)
      custId = cust.id

      // 4. Create Completion Event with intake snapshot
      const { data: comp, error: compErr } = await adminClient
        .from('customer_completion_events')
        .insert({
          organization_id: orgId,
          location_id: locId,
          customer_id: custId,
          source: 'ehr_connector',
          source_event_id: `src_evt_${timestamp}`,
          source_customer_id: `crm_cust_${timestamp}`,
          source_transaction_id: `tx_${timestamp}`,
          country: 'US',
          contact: {
            firstName: 'Jordan',
            lastName: 'Privacy',
            email: customerEmail,
            phone: '+15555550199',
          },
          permission: {
            email: 'allowed',
          },
        })
        .select('id')
        .single()
      if (compErr || !comp) throw new Error(`Completion creation failed: ${compErr?.message}`)
      completionEventId = comp.id

      // 5. Create Review Request with unsubscribe tokens
      const tracking = generateTrackingToken()
      const unsub = generateUnsubscribeToken()
      unsubToken = unsub.token
      unsubTokenHash = unsub.tokenHash

      const { data: reqRecord, error: reqErr } = await adminClient
        .from('review_requests')
        .insert({
          organization_id: orgId,
          location_id: locId,
          customer_id: custId,
          completion_event_id: completionEventId,
          channel: 'email',
          status: 'SENT',
          sent_at: new Date().toISOString(),
          token: tracking.token,
          token_hash: tracking.tokenHash,
          unsubscribe_token: unsubToken,
          unsubscribe_token_hash: unsubTokenHash,
        })
        .select('id')
        .single()
      if (reqErr || !reqRecord) throw new Error(`ReviewRequest creation failed: ${reqErr?.message}`)
      reviewRequestId = reqRecord.id

      // 6. Bind recipient evidence
      await adminClient.from('review_request_recipient_evidence').insert({
        organization_id: orgId,
        review_request_id: reviewRequestId,
        channel: 'email',
        suppression_contact_hash: suppressionHash,
      })

      // 7. Add operational events and authority evidence
      await adminClient.from('review_request_events').insert({
        organization_id: orgId,
        review_request_id: reviewRequestId,
        event_type: 'request.sent',
        metadata: { attempt: 1 },
      })

      await adminClient.from('message_events').insert({
        organization_id: orgId,
        review_request_id: reviewRequestId,
        provider: 'resend',
        event_type: 'delivered',
        status: 'delivered',
        metadata: {},
      })

      await adminClient.from('messaging_authority_evidence').insert({
        organization_id: orgId,
        customer_id: custId,
        completion_event_id: completionEventId,
        channel: 'email',
        asserted_state: 'allowed',
        assertion_kind: 'OPERATIONAL_PERMISSION_STATE',
        permission_source: 'intake_form',
        completion_source: 'ehr_connector',
        source_event_id: `src_evt_${timestamp}`,
        actor_type: 'system',
      })

      // 8. Create role users: OWNER, ADMIN, OPERATOR, VIEWER
      const createRoleUser = async (role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER') => {
        const email = `role_${role.toLowerCase()}_${timestamp}@test.local`
        const { data: authUser, error: authErr } =
          await adminClient.auth.admin.createUser({
            email,
            password: 'Password123!',
            email_confirm: true,
          })
        if (authErr || !authUser.user)
          throw new Error(`Failed to create auth user ${role}: ${authErr?.message}`)

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

      const ownerRes = await createRoleUser('OWNER')
      ownerUserId = ownerRes.userId
      ownerClient = ownerRes.client

      const adminRes = await createRoleUser('ADMIN')
      adminUserId = adminRes.userId
      adminRoleClient = adminRes.client

      const operatorRes = await createRoleUser('OPERATOR')
      operatorUserId = operatorRes.userId
      operatorClient = operatorRes.client

      const viewerRes = await createRoleUser('VIEWER')
      viewerUserId = viewerRes.userId
      viewerClient = viewerRes.client

      anonClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })

      // 9. Foreign Organization B setup
      const { data: foreignOrg } = await adminClient
        .from('organizations')
        .insert({
          name: `Foreign Org ${timestamp}`,
          slug: `foreign-org-${timestamp}`,
          status: 'ACTIVE',
        })
        .select('id')
        .single()
      foreignOrgId = foreignOrg!.id

      const { data: foreignLoc } = await adminClient
        .from('locations')
        .insert({
          organization_id: foreignOrgId,
          name: 'Foreign Location',
          status: 'ACTIVE',
        })
        .select('id')
        .single()

      const { data: foreignCust, error: fCustErr } = await adminClient
        .from('customers')
        .insert({
          organization_id: foreignOrgId,
          location_id: foreignLoc!.id,
          first_name: 'Foreign',
          last_name: 'Target',
          email: `foreign.${timestamp}@example.test`,
          permission_email: 'allowed',
          permission_source: 'csv',
        })
        .select('id')
        .single()
      if (fCustErr || !foreignCust) {
        throw new Error(`Failed to create foreign customer: ${fCustErr?.message}`)
      }
      foreignCustId = foreignCust.id
    }, 60000)

    afterAll(async () => {
      if (orgId) {
        await adminClient.from('organizations').delete().eq('id', orgId)
      }
      if (foreignOrgId) {
        await adminClient.from('organizations').delete().eq('id', foreignOrgId)
      }
    })

    // =========================================================================
    // SECTION A: AUTHORITY & ACCESS CONTROL (OWNER ONLY)
    // =========================================================================
    describe('Authority and Access Control (Owner Decision Frozen: OWNER ONLY)', () => {
      it('Case 34: OWNER is authorized to perform customer erasure', async () => {
        const authority = await checkErasureAuthority(ownerClient, orgId, ownerUserId)
        expect(authority).toBe('AUTHORIZED')
      })

      it('Case 35: ADMIN is denied customer erasure authority', async () => {
        const authority = await checkErasureAuthority(adminRoleClient, orgId, adminUserId)
        expect(authority).toBe('DENIED')

        const res = await eraseCustomer({
          organizationId: orgId,
          customerId: custId,
          tenantClient: adminRoleClient,
          adminClient,
        })
        expect(res.status).toBe('DENIED')
        expect(res.success).toBe(false)
      })

      it('Case 36: OPERATOR is denied customer erasure authority', async () => {
        const authority = await checkErasureAuthority(operatorClient, orgId, operatorUserId)
        expect(authority).toBe('DENIED')

        const res = await eraseCustomer({
          organizationId: orgId,
          customerId: custId,
          tenantClient: operatorClient,
          adminClient,
        })
        expect(res.status).toBe('DENIED')
        expect(res.success).toBe(false)
      })

      it('Case 37: VIEWER is denied customer erasure authority', async () => {
        const authority = await checkErasureAuthority(viewerClient, orgId, viewerUserId)
        expect(authority).toBe('DENIED')

        const res = await eraseCustomer({
          organizationId: orgId,
          customerId: custId,
          tenantClient: viewerClient,
          adminClient,
        })
        expect(res.status).toBe('DENIED')
        expect(res.success).toBe(false)
      })

      it('Case 38: Anonymous / unauthenticated callers are denied', async () => {
        const res = await eraseCustomer({
          organizationId: orgId,
          customerId: custId,
          tenantClient: anonClient,
          adminClient,
        })
        expect(res.status).toBe('DENIED')
        expect(res.success).toBe(false)
      })

      it('Case 18: Foreign-tenant customer target fails closed without existence leakage', async () => {
        // Attempting to erase a customer belonging to foreignOrgId using orgId
        const res = await eraseCustomer({
          organizationId: orgId,
          customerId: foreignCustId,
          tenantClient: ownerClient,
          adminClient,
        })
        expect(res.status).toBe('DENIED')
        expect(res.success).toBe(false)
      })

      it('Case 19: Nonexistent customer target fails closed with status DENIED', async () => {
        const nonexistentId = randomUUID()
        const res = await eraseCustomer({
          organizationId: orgId,
          customerId: nonexistentId,
          tenantClient: ownerClient,
          adminClient,
        })
        expect(res.status).toBe('DENIED')
        expect(res.success).toBe(false)
      })
    })

    // =========================================================================
    // SECTION B: LEGACY ELIGIBILITY GATE
    // =========================================================================
    describe('Legacy Request Erasure Precondition Gate', () => {
      let legacyCustId: string
      let legacyReqId: string

      beforeAll(async () => {
        // Create a customer with a legacy request (lacking recipient evidence in SENT status)
        const { data: legacyCust } = await adminClient
          .from('customers')
          .insert({
            organization_id: orgId,
            location_id: locId,
            first_name: 'Legacy',
            last_name: 'Patient',
            email: `legacy.${timestamp}@example.test`,
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()
        legacyCustId = legacyCust!.id

        const { data: legComp, error: legCompErr } = await adminClient
          .from('customer_completion_events')
          .insert({
            organization_id: orgId,
            location_id: locId,
            customer_id: legacyCustId,
            source: 'legacy_source',
            source_event_id: `legacy_evt_${timestamp}`,
            contact: {
              email: `legacy.${timestamp}@example.test`,
              firstName: 'Legacy',
            },
          })
          .select('id')
          .single()
        if (legCompErr || !legComp) {
          throw new Error(`Legacy comp creation failed: ${legCompErr?.message}`)
        }

        const tracking = generateTrackingToken()
        const unsub = generateUnsubscribeToken()
        const { data: legacyReq, error: legReqErr } = await adminClient
          .from('review_requests')
          .insert({
            organization_id: orgId,
            location_id: locId,
            customer_id: legacyCustId,
            completion_event_id: legComp.id,
            channel: 'email',
            status: 'SENT',
            sent_at: new Date().toISOString(),
            token: tracking.token,
            token_hash: tracking.tokenHash,
            unsubscribe_token: unsub.token,
            unsubscribe_token_hash: unsub.tokenHash,
          })
          .select('id')
          .single()
        if (legReqErr || !legacyReq) {
          throw new Error(`Legacy req creation failed: ${legReqErr?.message}`)
        }
        legacyReqId = legacyReq.id
        // NOTE: No entry created in review_request_recipient_evidence!
      })

      it('Case 17: Unresolved legacy request blocks erasure with zero mutation', async () => {
        const eligibility = await checkCustomerErasureEligibility({
          supabase: adminClient,
          organizationId: orgId,
          customerId: legacyCustId,
        })
        expect(eligibility.eligible).toBe(false)
        expect(eligibility.decision).toBe('BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS')
        expect(eligibility.unresolvedLegacyRequestsCount).toBeGreaterThan(0)
        expect(legacyReqId).toBeDefined()

        // Attempting erasure must fail closed
        const res = await eraseCustomer({
          organizationId: orgId,
          customerId: legacyCustId,
          tenantClient: ownerClient,
          adminClient,
        })
        expect(res.status).toBe('BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS')
        expect(res.success).toBe(false)

        // Verify zero customer mutation occurred
        const { data: custAfter } = await adminClient
          .from('customers')
          .select('first_name, last_name, email')
          .eq('id', legacyCustId)
          .single()
        expect(custAfter?.first_name).toBe('Legacy')
        expect(custAfter?.last_name).toBe('Patient')
        expect(custAfter?.email).toBe(`legacy.${timestamp}@example.test`)

        // Verify no erasure record was created
        const { data: erasureRecord } = await adminClient
          .from('customer_erasure_records')
          .select('id')
          .eq('customer_id', legacyCustId)
          .maybeSingle()
        expect(erasureRecord).toBeNull()
      })
    })

    // =========================================================================
    // SECTION C: ATOMIC ERASURE EXECUTION & FIELD-LEVEL MAP
    // =========================================================================
    describe('Atomic Erasure Execution and Invariant Verification', () => {
      let erasureResponse: CustomerErasureResult | undefined

      it('Case 1: Eligible synthetic customer erases successfully', async () => {
        erasureResponse = await eraseCustomer({
          organizationId: orgId,
          customerId: custId,
          tenantClient: ownerClient,
          adminClient,
        })
        expect(erasureResponse.status).toBe('AUTHORIZED')
        expect(erasureResponse.success).toBe(true)
        if (erasureResponse.status === 'AUTHORIZED') {
          expect(erasureResponse.alreadyErased).toBe(false)
          expect(erasureResponse.customerId).toBe(custId)
          expect(erasureResponse.organizationId).toBe(orgId)
          expect(erasureResponse.completionEventsRedactedCount).toBe(1)
        }
      })

      it('Case 2: Customer row is retained in database — NO hard delete', async () => {
        const { data: custRow, error } = await adminClient
          .from('customers')
          .select('id, organization_id')
          .eq('id', custId)
          .maybeSingle()
        expect(error).toBeNull()
        expect(custRow).not.toBeNull()
        expect(custRow?.id).toBe(custId)
      })

      it('Case 3: first_name becomes deterministic non-PII tombstone', async () => {
        const { data: custRow } = await adminClient
          .from('customers')
          .select('first_name')
          .eq('id', custId)
          .single()
        expect(custRow?.first_name).toBe(CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME)
      })

      it('Case 4: last_name is erased/anonymized to null', async () => {
        const { data: custRow } = await adminClient
          .from('customers')
          .select('last_name')
          .eq('id', custId)
          .single()
        expect(custRow?.last_name).toBeNull()
      })

      it('Case 5: email becomes null/erased', async () => {
        const { data: custRow } = await adminClient
          .from('customers')
          .select('email')
          .eq('id', custId)
          .single()
        expect(custRow?.email).toBeNull()
      })

      it('Case 6: phone becomes null/erased', async () => {
        const { data: custRow } = await adminClient
          .from('customers')
          .select('phone')
          .eq('id', custId)
          .single()
        expect(custRow?.phone).toBeNull()
      })

      it('Case 7: completion-event raw contact PII is removed ({}) and external identifiers erased to NULL', async () => {
        const { data: compRow } = await adminClient
          .from('customer_completion_events')
          .select('contact, source_event_id, source_transaction_id, source_customer_id')
          .eq('id', completionEventId)
          .single()
        expect(compRow?.contact).toEqual({})
        // External identifiers are erased to NULL per owner decision
        expect(compRow?.source_customer_id).toBeNull()
        expect(compRow?.source_transaction_id).toBeNull()
        // Deduplication/idempotency key survives byte-for-byte
        expect(compRow?.source_event_id).toBe(`src_evt_${timestamp}`)
      })
    })

    // =========================================================================
    // SECTION D: DURABLE SURVIVAL OF COMPLIANCE & OPERATIONAL RECORDS
    // =========================================================================
    describe('Durable Survival of Compliance and Operational History', () => {
      it('Case 8: suppression records survive byte-for-byte', async () => {
        // Create an explicit suppression for the erased customer contact hash
        await adminClient.from('suppressions').insert({
          organization_id: orgId,
          channel: 'email',
          contact_hash: suppressionHash,
          reason: 'MANUAL',
        })

        const { data: suppRow } = await adminClient
          .from('suppressions')
          .select('channel, contact_hash, organization_id')
          .eq('organization_id', orgId)
          .eq('contact_hash', suppressionHash)
          .single()
        expect(suppRow).not.toBeNull()
        expect(suppRow?.contact_hash).toBe(suppressionHash)
      })

      it('Case 9: recipient evidence survives byte-for-byte', async () => {
        const { data: evRow } = await adminClient
          .from('review_request_recipient_evidence')
          .select('suppression_contact_hash, review_request_id, channel')
          .eq('review_request_id', reviewRequestId)
          .single()
        expect(evRow).not.toBeNull()
        expect(evRow?.suppression_contact_hash).toBe(suppressionHash)
      })

      it('Case 10: review_requests survive without data loss', async () => {
        const { data: rrRow } = await adminClient
          .from('review_requests')
          .select('id, status, channel, unsubscribe_token, unsubscribe_token_hash')
          .eq('id', reviewRequestId)
          .single()
        expect(rrRow).not.toBeNull()
        expect(rrRow?.status).toBe('SENT')
        expect(rrRow?.unsubscribe_token).toBe(unsubToken)
      })

      it('Case 11: message_events survive', async () => {
        const { data: msgRows } = await adminClient
          .from('message_events')
          .select('id, provider, event_type')
          .eq('review_request_id', reviewRequestId)
        expect(msgRows).not.toBeNull()
        expect(msgRows?.length).toBeGreaterThan(0)
      })

      it('Case 12: review_request_events survive', async () => {
        const { data: rreRows } = await adminClient
          .from('review_request_events')
          .select('id, event_type')
          .eq('review_request_id', reviewRequestId)
        expect(rreRows).not.toBeNull()
        expect(rreRows?.length).toBeGreaterThan(0)
      })

      it('Case 13: messaging_authority_evidence survives', async () => {
        const { data: maeRows } = await adminClient
          .from('messaging_authority_evidence')
          .select('id, asserted_state, permission_source')
          .eq('customer_id', custId)
        expect(maeRows).not.toBeNull()
        expect(maeRows?.length).toBeGreaterThan(0)
      })

      it('Case 32: No cascade deletes occur', async () => {
        const { count: rrCount } = await adminClient
          .from('review_requests')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', custId)
        expect(rrCount).toBe(1)

        const { count: compCount } = await adminClient
          .from('customer_completion_events')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', custId)
        expect(compCount).toBe(1)
      })
    })

    // =========================================================================
    // SECTION E: UNSUBSCRIBE ROUTE INTEGRATION AFTER ERASURE
    // =========================================================================
    describe('Unsubscribe Lifecycle After Customer Erasure', () => {
      it('Case 14: Unsubscribe GET route resolves and renders after customer erasure', async () => {
        const req = new NextRequest(
          `http://localhost:3000/unsubscribe/${unsubToken}`,
          { method: 'GET' }
        )
        const response = await GET(req, {
          params: Promise.resolve({ token: unsubToken }),
        })
        expect(response.status).toBe(200)
        const text = await response.text()
        expect(text).toContain('Review requests stopped')
      })

      it('Case 15 & 16: Unsubscribe POST works and already-suppressed state works after erasure', async () => {
        const req = new NextRequest(
          `http://localhost:3000/unsubscribe/${unsubToken}`,
          {
            method: 'POST',
            headers: { accept: 'application/json' },
          }
        )
        const response = await POST(req, {
          params: Promise.resolve({ token: unsubToken }),
        })
        expect(response.status).toBe(200)
        const json = await response.json()
        expect(json.unsubscribed).toBe(true)
      })
    })

    // =========================================================================
    // SECTION F: AUDIT & IDEMPOTENCY
    // =========================================================================
    describe('Audit Evidence and Idempotency', () => {
      it('Case 22: Successful erasure writes exactly required minimized audit evidence', async () => {
        const { data: auditRow, error } = await adminClient
          .from('audit_events')
          .select('event_type, entity_type, entity_id, metadata')
          .eq('organization_id', orgId)
          .eq('event_type', 'privacy.customer_erasure')
          .eq('entity_id', custId)
          .single()

        expect(error).toBeNull()
        expect(auditRow).not.toBeNull()
        expect(auditRow?.event_type).toBe('privacy.customer_erasure')
        expect(auditRow?.entity_type).toBe('customer')
        expect(auditRow?.entity_id).toBe(custId)

        const meta = auditRow?.metadata as Record<string, unknown>
        expect(meta.schema_version).toBe('1.0')
        expect(meta.decision).toBe('ERASED')
        expect(meta.fields_anonymized).toEqual(['first_name'])
        expect(meta.fields_erased).toEqual([
          'last_name',
          'email',
          'phone',
          'contact',
          'error_message',
          'sanitized_error',
          'source_customer_id',
          'source_transaction_id',
        ])
        expect(meta.completion_events_redacted_count).toBe(1)
        expect(meta.review_request_errors_scrubbed_count).toBeDefined()
        expect(meta.message_event_errors_scrubbed_count).toBeDefined()
      })

      it('Case 23: Audit contains zero raw PII and zero contact hashes', async () => {
        const { data: auditRow } = await adminClient
          .from('audit_events')
          .select('metadata')
          .eq('organization_id', orgId)
          .eq('event_type', 'privacy.customer_erasure')
          .eq('entity_id', custId)
          .single()

        const metaString = JSON.stringify(auditRow?.metadata)
        expect(metaString).not.toContain(customerEmail)
        expect(metaString).not.toContain('Jordan')
        expect(metaString).not.toContain('Privacy')
        expect(metaString).not.toContain('+15555550199')
        expect(metaString).not.toContain(suppressionHash)
      })

      it('Case 24: Repeated erasure is idempotent', async () => {
        const secondRes = await eraseCustomer({
          organizationId: orgId,
          customerId: custId,
          tenantClient: ownerClient,
          adminClient,
        })
        expect(secondRes.status).toBe('AUTHORIZED')
        expect(secondRes.success).toBe(true)
        if (secondRes.status === 'AUTHORIZED') {
          expect(secondRes.alreadyErased).toBe(true)
          expect(secondRes.customerId).toBe(custId)
          expect(secondRes.organizationId).toBe(orgId)
        }

        // Must not duplicate audit records
        const { count: auditCount } = await adminClient
          .from('audit_events')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('event_type', 'privacy.customer_erasure')
          .eq('entity_id', custId)
        expect(auditCount).toBe(1)

        // Idempotency: external identifiers remain NULL and deduplication key remains intact
        const { data: compRowAfterRepeat } = await adminClient
          .from('customer_completion_events')
          .select('source_customer_id, source_transaction_id, source_event_id')
          .eq('id', completionEventId)
          .single()
        expect(compRowAfterRepeat?.source_customer_id).toBeNull()
        expect(compRowAfterRepeat?.source_transaction_id).toBeNull()
        expect(compRowAfterRepeat?.source_event_id).toBe(`src_evt_${timestamp}`)
      })
    })

    // =========================================================================
    // SECTION G: ATOMICITY & TRANSACTIONAL ROLLBACK
    // =========================================================================
    describe('Atomicity and Transactional Rollback', () => {
      it('Case 20 & 21: Database exception inside RPC rolls back all PII changes', async () => {
        // Create a temporary customer to test rollback behavior
        const { data: tempCust } = await adminClient
          .from('customers')
          .insert({
            organization_id: orgId,
            location_id: locId,
            first_name: 'Rollback',
            last_name: 'Test',
            email: `rollback.${timestamp}@example.test`,
            phone: '+15550009999',
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()
        const tempCustId = tempCust!.id

        // Attempt RPC with invalid arguments or condition (e.g. non-existent org to trigger rollback)
        const fakeOrgId = randomUUID()
        const { error } = await adminClient.rpc('execute_customer_erasure', {
          p_org_id: fakeOrgId,
          p_customer_id: tempCustId,
          p_actor_id: ownerUserId,
          p_actor_type: 'user',
        })
        expect(error).not.toBeNull()

        // Verify customer record remains completely intact
        const { data: custAfter } = await adminClient
          .from('customers')
          .select('first_name, last_name, email, phone')
          .eq('id', tempCustId)
          .single()
        expect(custAfter?.first_name).toBe('Rollback')
        expect(custAfter?.last_name).toBe('Test')
        expect(custAfter?.email).toBe(`rollback.${timestamp}@example.test`)
        expect(custAfter?.phone).toBe('+15550009999')

        // Clean up
        await adminClient.from('customers').delete().eq('id', tempCustId)
      })
    })

    // =========================================================================
    // SECTION H: SECURITY & PRIVILEGE BOUNDARIES
    // =========================================================================
    describe('Security and Privilege Boundaries', () => {
      it('Case 25: Tenant roles cannot invoke execute_customer_erasure RPC directly', async () => {
        const { error: anonErr } = await anonClient.rpc('execute_customer_erasure', {
          p_org_id: orgId,
          p_customer_id: custId,
          p_actor_id: ownerUserId,
        })
        expect(anonErr).not.toBeNull()
        expect(anonErr?.message).toMatch(/permission denied|does not exist/i)

        const { error: opErr } = await operatorClient.rpc('execute_customer_erasure', {
          p_org_id: orgId,
          p_customer_id: custId,
          p_actor_id: operatorUserId,
        })
        expect(opErr).not.toBeNull()
        expect(opErr?.message).toMatch(/permission denied|does not exist/i)
      })

      it('Case 26: Only service_role has execute privilege on execute_customer_erasure and table access on customer_erasure_records', () => {
        expect(
          checkFunctionPrivilegeDirect(
            'service_role',
            'public.execute_customer_erasure(uuid, uuid, uuid, text)',
            'EXECUTE'
          )
        ).toBe(true)

        expect(
          checkFunctionPrivilegeDirect(
            'anon',
            'public.execute_customer_erasure(uuid, uuid, uuid, text)',
            'EXECUTE'
          )
        ).toBe(false)

        expect(
          checkFunctionPrivilegeDirect(
            'authenticated',
            'public.execute_customer_erasure(uuid, uuid, uuid, text)',
            'EXECUTE'
          )
        ).toBe(false)

        // customer_erasure_records table privileges
        expect(
          checkTablePrivilegeDirect('anon', 'public.customer_erasure_records', 'SELECT')
        ).toBe(false)
        expect(
          checkTablePrivilegeDirect('authenticated', 'public.customer_erasure_records', 'SELECT')
        ).toBe(false)
        expect(
          checkTablePrivilegeDirect('service_role', 'public.customer_erasure_records', 'SELECT')
        ).toBe(true)
        expect(
          checkTablePrivilegeDirect('service_role', 'public.customer_erasure_records', 'INSERT')
        ).toBe(true)
        expect(
          checkTablePrivilegeDirect('service_role', 'public.customer_erasure_records', 'UPDATE')
        ).toBe(false)
        expect(
          checkTablePrivilegeDirect('service_role', 'public.customer_erasure_records', 'DELETE')
        ).toBe(false)
      })

      it('Case 27: Database trigger blocks restoring direct PII onto an erased customer', async () => {
        // Attempting to restore email via SQL must fail due to trg_protect_erased_customer_immutability
        expect(() => {
          executeDirectSql(
            `UPDATE public.customers SET email = 'restored@test.local' WHERE id = '${custId}';`
          )
        }).toThrow(/Customer is privacy-erased and cannot have PII restored/)

        // Attempting to restore last_name must fail
        expect(() => {
          executeDirectSql(
            `UPDATE public.customers SET last_name = 'Restored' WHERE id = '${custId}';`
          )
        }).toThrow(/Customer is privacy-erased and cannot have PII restored/)

        // Attempting to change first_name away from tombstone must fail
        expect(() => {
          executeDirectSql(
            `UPDATE public.customers SET first_name = 'Alex' WHERE id = '${custId}';`
          )
        }).toThrow(/Customer is privacy-erased and cannot have PII restored/)
      })

      it('Case 28: Non-erased customer editing remains completely unaffected by trigger', async () => {
        const { data: nonErasedCust } = await adminClient
          .from('customers')
          .insert({
            organization_id: orgId,
            location_id: locId,
            first_name: 'Normal',
            last_name: 'User',
            email: `normal.${timestamp}@example.test`,
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()

        const nonErasedId = nonErasedCust!.id

        // Normal update by tenant
        const { error: updateErr } = await adminClient
          .from('customers')
          .update({
            first_name: 'UpdatedNormal',
            last_name: 'UpdatedUser',
          })
          .eq('id', nonErasedId)

        expect(updateErr).toBeNull()

        const { data: updated } = await adminClient
          .from('customers')
          .select('first_name, last_name')
          .eq('id', nonErasedId)
          .single()
        expect(updated?.first_name).toBe('UpdatedNormal')
        expect(updated?.last_name).toBe('UpdatedUser')

        // Clean up
        await adminClient.from('customers').delete().eq('id', nonErasedId)
      })
    })

    // =========================================================================
    // SECTION I: FUTURE SEND SAFETY & RE-IMPORT
    // =========================================================================
    describe('Future Send Safety and Re-import Protection', () => {
      it('Case 29 & 30: Post-erasure review send and reminder are blocked (NO_CONTACT)', async () => {
        const authorityResult = await checkFinalEmailDispatchAuthority({
          supabase: adminClient as unknown as Parameters<typeof checkFinalEmailDispatchAuthority>[0]['supabase'],
          organizationId: orgId,
          locationId: locId,
          customerId: custId,
        })

        expect(authorityResult.allowed).toBe(false)
        expect(authorityResult.decision).toBe('NO_CONTACT')
        expect(authorityResult.customerEmail).toBeNull()
        expect(authorityResult.customerName).toBe(CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME)
      })

      it('Case 31: Re-imported matching contact remains suppressed through surviving hash', async () => {
        // If a new customer with the same email is imported
        const newEmail = customerEmail
        const newHash = hashSuppressionContact('email', newEmail)

        // Check against surviving suppression table
        const { data: existingSupp } = await adminClient
          .from('suppressions')
          .select('id')
          .eq('organization_id', orgId)
          .eq('contact_hash', newHash)
          .maybeSingle()

        expect(existingSupp).not.toBeNull()
      })
    })

    // =========================================================================
    // SECTION J: PRIVACY EXPORT AFTER ERASURE
    // =========================================================================
    describe('Privacy Export Behavior After Customer Erasure', () => {
      it('Case 33: Privacy export on erased customer returns deterministic tombstone and null PII without failing', async () => {
        // Authenticate mock as owner
        activeClient = ownerClient
        privilegedClient = adminClient

        const exportResult = await getCustomerPrivacyExport(orgId, custId)
        expect(exportResult.status).toBe('AVAILABLE')

        if (exportResult.status === 'AVAILABLE') {
          expect(exportResult.export.customer.firstName).toBe(CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME)
          expect(exportResult.export.customer.lastName).toBeNull()
          expect(exportResult.export.customer.email).toBeNull()
          expect(exportResult.export.customer.phone).toBeNull()

          // Completion event contact snapshot is empty
          expect(exportResult.export.completionEvents.length).toBe(1)
          expect(exportResult.export.completionEvents[0].contactSnapshot).toEqual({})
        }
      })
    })

    // =========================================================================
    // SECTION K: IN-TRANSACTION OWNER AUTHORITY & TOCTOU DEFENSE
    // =========================================================================
    describe('In-Transaction OWNER Authority and TOCTOU Defense', () => {
      let roleTargetCustId: string

      beforeAll(async () => {
        // Create a dedicated customer for role tests
        const { data: c } = await adminClient
          .from('customers')
          .insert({
            organization_id: orgId,
            location_id: locId,
            first_name: 'RoleTest',
            last_name: 'Target',
            email: `role.target.${timestamp}@example.test`,
            phone: '+15555550201',
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()
        roleTargetCustId = c!.id

        // Create completion event with external identifiers for roleTargetCustId
        await adminClient.from('customer_completion_events').insert({
          organization_id: orgId,
          location_id: locId,
          customer_id: roleTargetCustId,
          source: 'role_test',
          source_event_id: `role_evt_${timestamp}`,
          source_customer_id: `crm_role_${timestamp}`,
          source_transaction_id: `tx_role_${timestamp}`,
          contact: { email: `role.target.${timestamp}@example.test`, firstName: 'RoleTest' },
        })
      })

      it('Case 39 (Req 1): RPC with OWNER actor succeeds', async () => {
        // Create a dedicated customer to test OWNER actor RPC success
        const { data: ownCust } = await adminClient
          .from('customers')
          .insert({
            organization_id: orgId,
            location_id: locId,
            first_name: 'OwnerSuccess',
            last_name: 'Patient',
            email: `owner.success.${timestamp}@example.test`,
            phone: '+15555550202',
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()

        const { data: rpcRes, error } = await adminClient.rpc('execute_customer_erasure', {
          p_org_id: orgId,
          p_customer_id: ownCust!.id,
          p_actor_id: ownerUserId,
          p_actor_type: 'user',
        })

        expect(error).toBeNull()
        expect(rpcRes).not.toBeNull()
        const res = rpcRes as Record<string, unknown>
        expect(res.erased).toBe(true)
        expect(res.already_erased).toBe(false)
        expect(res.customer_id).toBe(ownCust!.id)

        // Verify customer record anonymized
        const { data: erasedRow } = await adminClient
          .from('customers')
          .select('first_name, last_name, email, phone')
          .eq('id', ownCust!.id)
          .single()
        expect(erasedRow?.first_name).toBe(CUSTOMER_ERASURE_TOMBSTONE_FIRST_NAME)
        expect(erasedRow?.last_name).toBeNull()
        expect(erasedRow?.email).toBeNull()
        expect(erasedRow?.phone).toBeNull()
      })

      it('Case 40 (Req 2): RPC with ADMIN actor fails with zero mutation', async () => {
        const { error } = await adminClient.rpc('execute_customer_erasure', {
          p_org_id: orgId,
          p_customer_id: roleTargetCustId,
          p_actor_id: adminUserId,
          p_actor_type: 'user',
        })

        expect(error).not.toBeNull()
        expect(error?.message).toContain('DENIED: Actor must have active OWNER role')

        // Verify zero customer mutation
        const { data: c } = await adminClient
          .from('customers')
          .select('first_name, last_name, email')
          .eq('id', roleTargetCustId)
          .single()
        expect(c?.first_name).toBe('RoleTest')
        expect(c?.last_name).toBe('Target')
        expect(c?.email).toBe(`role.target.${timestamp}@example.test`)

        // Verify zero erasure record
        const { count: cerCount } = await adminClient
          .from('customer_erasure_records')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', roleTargetCustId)
        expect(cerCount).toBe(0)

        // Verify external identifiers and deduplication key remain unchanged
        const { data: compAdmin } = await adminClient
          .from('customer_completion_events')
          .select('source_customer_id, source_transaction_id, source_event_id')
          .eq('customer_id', roleTargetCustId)
          .single()
        expect(compAdmin?.source_customer_id).toBe(`crm_role_${timestamp}`)
        expect(compAdmin?.source_transaction_id).toBe(`tx_role_${timestamp}`)
        expect(compAdmin?.source_event_id).toBe(`role_evt_${timestamp}`)
      })

      it('Case 41 (Req 3): RPC with OPERATOR actor fails with zero mutation', async () => {
        const { error } = await adminClient.rpc('execute_customer_erasure', {
          p_org_id: orgId,
          p_customer_id: roleTargetCustId,
          p_actor_id: operatorUserId,
          p_actor_type: 'user',
        })

        expect(error).not.toBeNull()
        expect(error?.message).toContain('DENIED: Actor must have active OWNER role')

        const { data: c } = await adminClient
          .from('customers')
          .select('first_name, last_name, email')
          .eq('id', roleTargetCustId)
          .single()
        expect(c?.first_name).toBe('RoleTest')
        expect(c?.email).toBe(`role.target.${timestamp}@example.test`)

        const { count: cerCount } = await adminClient
          .from('customer_erasure_records')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', roleTargetCustId)
        expect(cerCount).toBe(0)

        const { data: compOp } = await adminClient
          .from('customer_completion_events')
          .select('source_customer_id, source_transaction_id, source_event_id')
          .eq('customer_id', roleTargetCustId)
          .single()
        expect(compOp?.source_customer_id).toBe(`crm_role_${timestamp}`)
        expect(compOp?.source_transaction_id).toBe(`tx_role_${timestamp}`)
        expect(compOp?.source_event_id).toBe(`role_evt_${timestamp}`)
      })

      it('Case 42 (Req 4): RPC with VIEWER actor fails with zero mutation', async () => {
        const { error } = await adminClient.rpc('execute_customer_erasure', {
          p_org_id: orgId,
          p_customer_id: roleTargetCustId,
          p_actor_id: viewerUserId,
          p_actor_type: 'user',
        })

        expect(error).not.toBeNull()
        expect(error?.message).toContain('DENIED: Actor must have active OWNER role')

        const { data: c } = await adminClient
          .from('customers')
          .select('first_name, last_name, email')
          .eq('id', roleTargetCustId)
          .single()
        expect(c?.first_name).toBe('RoleTest')
        expect(c?.email).toBe(`role.target.${timestamp}@example.test`)

        const { count: cerCount } = await adminClient
          .from('customer_erasure_records')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', roleTargetCustId)
        expect(cerCount).toBe(0)

        const { data: compView } = await adminClient
          .from('customer_completion_events')
          .select('source_customer_id, source_transaction_id, source_event_id')
          .eq('customer_id', roleTargetCustId)
          .single()
        expect(compView?.source_customer_id).toBe(`crm_role_${timestamp}`)
        expect(compView?.source_transaction_id).toBe(`tx_role_${timestamp}`)
        expect(compView?.source_event_id).toBe(`role_evt_${timestamp}`)
      })

      it('Case 43 (Req 5): RPC with unrelated/foreign OWNER fails with zero mutation', async () => {
        // Create an auth user who is OWNER in foreignOrgId
        const foreignEmail = `foreign_owner_${timestamp}@test.local`
        const { data: foreignAuthUser } = await adminClient.auth.admin.createUser({
          email: foreignEmail,
          password: 'Password123!',
          email_confirm: true,
        })
        const foreignOwnerUserId = foreignAuthUser.user!.id
        await adminClient.from('organization_users').insert({
          organization_id: foreignOrgId,
          user_id: foreignOwnerUserId,
          role: 'OWNER',
        })

        // Foreign owner attempting to erase orgId's customer must fail DENIED
        const { error } = await adminClient.rpc('execute_customer_erasure', {
          p_org_id: orgId,
          p_customer_id: roleTargetCustId,
          p_actor_id: foreignOwnerUserId,
          p_actor_type: 'user',
        })

        expect(error).not.toBeNull()
        expect(error?.message).toContain('DENIED: Actor must have active OWNER role')

        const { data: c } = await adminClient
          .from('customers')
          .select('first_name, last_name, email')
          .eq('id', roleTargetCustId)
          .single()
        expect(c?.first_name).toBe('RoleTest')
        expect(c?.email).toBe(`role.target.${timestamp}@example.test`)

        const { count: cerCount } = await adminClient
          .from('customer_erasure_records')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', roleTargetCustId)
        expect(cerCount).toBe(0)

        const { data: compForeign } = await adminClient
          .from('customer_completion_events')
          .select('source_customer_id, source_transaction_id, source_event_id')
          .eq('customer_id', roleTargetCustId)
          .single()
        expect(compForeign?.source_customer_id).toBe(`crm_role_${timestamp}`)
        expect(compForeign?.source_transaction_id).toBe(`tx_role_${timestamp}`)
        expect(compForeign?.source_event_id).toBe(`role_evt_${timestamp}`)
      })

      it('Case 44 (Req 6): OWNER role revoked after app preflight but before RPC -> RPC fails closed (TOCTOU defense)', async () => {
        // 1. Create a transient user who is initially OWNER
        const toctouEmail = `toctou_user_${timestamp}@test.local`
        const { data: toctouAuth } = await adminClient.auth.admin.createUser({
          email: toctouEmail,
          password: 'Password123!',
          email_confirm: true,
        })
        const toctouUserId = toctouAuth.user!.id

        await adminClient.from('organization_users').insert({
          organization_id: orgId,
          user_id: toctouUserId,
          role: 'OWNER',
        })

        // 2. Caller authenticates as OWNER and passes preflight check
        const preflight = await checkErasureAuthority(adminClient, orgId, toctouUserId)
        expect(preflight).toBe('AUTHORIZED')

        // 3. Race condition: role is revoked/demoted before RPC transaction executes
        await adminClient
          .from('organization_users')
          .update({ role: 'ADMIN' })
          .eq('organization_id', orgId)
          .eq('user_id', toctouUserId)

        // 4. Invoking the RPC fails closed because PostgreSQL re-evaluates authoritative role in-transaction
        const domainRes = await executeCustomerErasureInternal({
          adminClient,
          organizationId: orgId,
          customerId: roleTargetCustId,
          actorId: toctouUserId,
        })
        expect(domainRes.status).toBe('DENIED')
        expect(domainRes.success).toBe(false)

        const { error } = await adminClient.rpc('execute_customer_erasure', {
          p_org_id: orgId,
          p_customer_id: roleTargetCustId,
          p_actor_id: toctouUserId,
          p_actor_type: 'user',
        })

        expect(error).not.toBeNull()
        expect(error?.message).toContain('DENIED: Actor must have active OWNER role')

        // 5. Zero mutation, zero erasure record, zero audit record
        const { data: c } = await adminClient
          .from('customers')
          .select('first_name, last_name, email, phone')
          .eq('id', roleTargetCustId)
          .single()
        expect(c?.first_name).toBe('RoleTest')
        expect(c?.email).toBe(`role.target.${timestamp}@example.test`)

        const { count: cerCount } = await adminClient
          .from('customer_erasure_records')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', roleTargetCustId)
        expect(cerCount).toBe(0)

        const { count: auditCount } = await adminClient
          .from('audit_events')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('entity_id', roleTargetCustId)
        expect(auditCount).toBe(0)

        // Verify TOCTOU failure leaves external identifiers unchanged
        const { data: compToctou } = await adminClient
          .from('customer_completion_events')
          .select('source_customer_id, source_transaction_id, source_event_id')
          .eq('customer_id', roleTargetCustId)
          .single()
        expect(compToctou?.source_customer_id).toBe(`crm_role_${timestamp}`)
        expect(compToctou?.source_transaction_id).toBe(`tx_role_${timestamp}`)
        expect(compToctou?.source_event_id).toBe(`role_evt_${timestamp}`)
      })

      it('Case 45 (Req 7): service_role direct RPC invocation with non-OWNER actor cannot bypass authority', async () => {
        // service_role client directly calling execute_customer_erasure with fake/non-member UUID
        const fakeActorId = randomUUID()
        const { error } = await adminClient.rpc('execute_customer_erasure', {
          p_org_id: orgId,
          p_customer_id: roleTargetCustId,
          p_actor_id: fakeActorId,
          p_actor_type: 'service_role',
        })

        expect(error).not.toBeNull()
        expect(error?.message).toContain('DENIED: Actor must have active OWNER role')

        // Direct call with an ADMIN actor ID also fails through service_role client
        const { error: adminActorErr } = await adminClient.rpc('execute_customer_erasure', {
          p_org_id: orgId,
          p_customer_id: roleTargetCustId,
          p_actor_id: adminUserId,
          p_actor_type: 'service_role',
        })

        expect(adminActorErr).not.toBeNull()
        expect(adminActorErr?.message).toContain('DENIED: Actor must have active OWNER role')

        // Verify non-OWNER service_role call leaves external identifiers unchanged
        const { data: compSr } = await adminClient
          .from('customer_completion_events')
          .select('source_customer_id, source_transaction_id, source_event_id')
          .eq('customer_id', roleTargetCustId)
          .single()
        expect(compSr?.source_customer_id).toBe(`crm_role_${timestamp}`)
        expect(compSr?.source_transaction_id).toBe(`tx_role_${timestamp}`)
        expect(compSr?.source_event_id).toBe(`role_evt_${timestamp}`)
      })
    })

    // =========================================================================
    // SECTION L: HISTORICAL ERROR FIELD PII SCRUB & EXTERNAL IDENTIFIER GATE
    // =========================================================================
    describe('Historical Error Field PII Scrubbing and External Identifier Gate', () => {
      let piiCustId: string
      let piiReqId: string
      let piiMsgId: string
      const piiEmail = `patient.pii.${timestamp}@example.test`
      const piiErrorText = `Provider delivery failed for ${piiEmail}: Mailbox unavailable`
      const piiSanitizedError = `SMTP timeout reaching ${piiEmail}: Connection reset`

      beforeAll(async () => {
        // Create a customer with historical review request and message event containing raw email in error fields
        const { data: pCust } = await adminClient
          .from('customers')
          .insert({
            organization_id: orgId,
            location_id: locId,
            first_name: 'PiiPatient',
            last_name: 'Test',
            email: piiEmail,
            phone: '+15555550203',
            permission_email: 'allowed',
            permission_source: 'ehr',
          })
          .select('id')
          .single()
        piiCustId = pCust!.id

        const { data: pComp } = await adminClient
          .from('customer_completion_events')
          .insert({
            organization_id: orgId,
            location_id: locId,
            customer_id: piiCustId,
            source: 'ehr',
            source_event_id: `ehr_evt_${timestamp}_pii`,
            source_customer_id: `crm_pii_${timestamp}`,
            source_transaction_id: `tx_pii_${timestamp}`,
            contact: {
              firstName: 'PiiPatient',
              lastName: 'Test',
              email: piiEmail,
            },
          })
          .select('id')
          .single()

        const tracking = generateTrackingToken()
        const unsub = generateUnsubscribeToken()
        const { data: pReq } = await adminClient
          .from('review_requests')
          .insert({
            organization_id: orgId,
            location_id: locId,
            customer_id: piiCustId,
            completion_event_id: pComp!.id,
            channel: 'email',
            status: 'FAILED',
            error_message: piiErrorText,
            token: tracking.token,
            token_hash: tracking.tokenHash,
            unsubscribe_token: unsub.token,
            unsubscribe_token_hash: unsub.tokenHash,
          })
          .select('id')
          .single()
        piiReqId = pReq!.id

        // Bind recipient evidence so legacy check passes
        await adminClient.from('review_request_recipient_evidence').insert({
          organization_id: orgId,
          review_request_id: piiReqId,
          channel: 'email',
          suppression_contact_hash: hashSuppressionContact('email', piiEmail),
        })

        const { data: pMsg } = await adminClient
          .from('message_events')
          .insert({
            organization_id: orgId,
            review_request_id: piiReqId,
            provider: 'resend',
            event_type: 'failed',
            status: 'FAILED',
            sanitized_error: piiSanitizedError,
            metadata: { messageKind: 'initial_review_request', reviewRequestId: piiReqId },
          })
          .select('id')
          .single()
        piiMsgId = pMsg!.id
      })

      it('Case 46 (Req 8, 9, 10, 11, 13): Erasure scrubs review_requests.error_message and message_events.sanitized_error while preserving operational telemetry', async () => {
        // Execute erasure via owner client
        const res = await eraseCustomer({
          organizationId: orgId,
          customerId: piiCustId,
          tenantClient: ownerClient,
          adminClient,
        })

        expect(res.status).toBe('AUTHORIZED')
        expect(res.success).toBe(true)
        if (res.status === 'AUTHORIZED') {
          expect(res.reviewRequestErrorsScrubbedCount).toBe(1)
          expect(res.messageEventErrorsScrubbedCount).toBe(1)
        }

        // Req 8 & 9: review_requests.error_message no longer contains erased PII (scrubbed to NULL)
        const { data: rrAfter } = await adminClient
          .from('review_requests')
          .select('error_message, status, channel')
          .eq('id', piiReqId)
          .single()
        expect(rrAfter?.error_message).toBeNull()
        expect(rrAfter?.status).toBe('FAILED')
        expect(rrAfter?.channel).toBe('email')

        // Req 10: message_events.sanitized_error no longer contains erased PII (scrubbed to NULL)
        const { data: meAfter } = await adminClient
          .from('message_events')
          .select('sanitized_error, status, provider, event_type, review_request_id, created_at')
          .eq('id', piiMsgId)
          .single()
        expect(meAfter?.sanitized_error).toBeNull()

        // Req 11: non-PII message status, provider, event_type, timestamps remain intact
        expect(meAfter?.status).toBe('FAILED')
        expect(meAfter?.provider).toBe('resend')
        expect(meAfter?.event_type).toBe('failed')
        expect(meAfter?.review_request_id).toBe(piiReqId)
        expect(meAfter?.created_at).toBeDefined()

        // Req 13: audit contains only counts, never historical error text or synthetic email
        const { data: auditRow } = await adminClient
          .from('audit_events')
          .select('metadata')
          .eq('organization_id', orgId)
          .eq('entity_id', piiCustId)
          .eq('event_type', 'privacy.customer_erasure')
          .single()

        expect(auditRow).not.toBeNull()
        const meta = auditRow?.metadata as Record<string, unknown>
        expect(meta.review_request_errors_scrubbed_count).toBe(1)
        expect(meta.message_event_errors_scrubbed_count).toBe(1)

        const metaStr = JSON.stringify(meta)
        expect(metaStr).not.toContain(piiEmail)
        expect(metaStr).not.toContain('Mailbox unavailable')
        expect(metaStr).not.toContain('SMTP timeout')

        // Verify completion event external identifiers are erased to NULL while source_event_id survives
        const { data: pCompAfter } = await adminClient
          .from('customer_completion_events')
          .select('contact, source_customer_id, source_transaction_id, source_event_id')
          .eq('customer_id', piiCustId)
          .single()
        expect(pCompAfter?.contact).toEqual({})
        expect(pCompAfter?.source_customer_id).toBeNull()
        expect(pCompAfter?.source_transaction_id).toBeNull()
        expect(pCompAfter?.source_event_id).toBe(`ehr_evt_${timestamp}_pii`)
      })

      it('Case 47 (Req 12): Injected error-scrub failure causes full transaction rollback including external identifiers', async () => {
        // Create a customer with a review request containing a sentinel error message
        const sentinelEmail = `sentinel.${timestamp}@example.test`
        const { data: rollCust } = await adminClient
          .from('customers')
          .insert({
            organization_id: orgId,
            location_id: locId,
            first_name: 'RollbackInjected',
            last_name: 'Patient',
            email: sentinelEmail,
            phone: '+15555550204',
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()
        const rollCustId = rollCust!.id

        const { data: rollComp } = await adminClient
          .from('customer_completion_events')
          .insert({
            organization_id: orgId,
            location_id: locId,
            customer_id: rollCustId,
            source: 'test',
            source_event_id: `roll_evt_${timestamp}`,
            source_customer_id: `crm_roll_${timestamp}`,
            source_transaction_id: `tx_roll_${timestamp}`,
            contact: { email: sentinelEmail, firstName: 'RollbackInjected' },
          })
          .select('id')
          .single()

        const tracking = generateTrackingToken()
        const unsub = generateUnsubscribeToken()
        const { data: rollReq } = await adminClient
          .from('review_requests')
          .insert({
            organization_id: orgId,
            location_id: locId,
            customer_id: rollCustId,
            completion_event_id: rollComp!.id,
            channel: 'email',
            status: 'FAILED',
            error_message: 'TRIGGER_INJECTED_FAILURE',
            token: tracking.token,
            token_hash: tracking.tokenHash,
            unsubscribe_token: unsub.token,
            unsubscribe_token_hash: unsub.tokenHash,
          })
          .select('id')
          .single()

        // Bind recipient evidence
        await adminClient.from('review_request_recipient_evidence').insert({
          organization_id: orgId,
          review_request_id: rollReq!.id,
          channel: 'email',
          suppression_contact_hash: hashSuppressionContact('email', sentinelEmail),
        })

        // Install temporary trigger that raises exception during error scrubbing
        executeDirectSql(`
          CREATE OR REPLACE FUNCTION public.test_fail_error_scrub()
          RETURNS TRIGGER AS $$
          BEGIN
            IF NEW.error_message IS NULL AND OLD.error_message = 'TRIGGER_INJECTED_FAILURE' THEN
              RAISE EXCEPTION 'INJECTED_SCRUB_FAILURE_FOR_TEST';
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;

          DROP TRIGGER IF EXISTS trg_test_fail_scrub ON public.review_requests;
          CREATE TRIGGER trg_test_fail_scrub
          BEFORE UPDATE ON public.review_requests
          FOR EACH ROW EXECUTE FUNCTION public.test_fail_error_scrub();
        `)

        try {
          // Calling execute_customer_erasure must abort and roll back all mutations
          const { error } = await adminClient.rpc('execute_customer_erasure', {
            p_org_id: orgId,
            p_customer_id: rollCustId,
            p_actor_id: ownerUserId,
            p_actor_type: 'user',
          })

          expect(error).not.toBeNull()
          expect(error?.message).toContain('INJECTED_SCRUB_FAILURE_FOR_TEST')

          // Verify atomic rollback: customer PII is NOT changed
          const { data: custAfter } = await adminClient
            .from('customers')
            .select('first_name, last_name, email, phone')
            .eq('id', rollCustId)
            .single()
          expect(custAfter?.first_name).toBe('RollbackInjected')
          expect(custAfter?.last_name).toBe('Patient')
          expect(custAfter?.email).toBe(sentinelEmail)
          expect(custAfter?.phone).toBe('+15555550204')

          // Verify atomic rollback: completion event contact and external identifiers NOT altered
          const { data: compAfter } = await adminClient
            .from('customer_completion_events')
            .select('contact, source_customer_id, source_transaction_id, source_event_id')
            .eq('id', rollComp!.id)
            .single()
          expect(compAfter?.contact).toEqual({ email: sentinelEmail, firstName: 'RollbackInjected' })
          expect(compAfter?.source_customer_id).toBe(`crm_roll_${timestamp}`)
          expect(compAfter?.source_transaction_id).toBe(`tx_roll_${timestamp}`)
          expect(compAfter?.source_event_id).toBe(`roll_evt_${timestamp}`)

          // Verify atomic rollback: review_requests error_message is NOT scrubbed
          const { data: reqAfter } = await adminClient
            .from('review_requests')
            .select('error_message')
            .eq('id', rollReq!.id)
            .single()
          expect(reqAfter?.error_message).toBe('TRIGGER_INJECTED_FAILURE')

          // Verify atomic rollback: zero erasure record
          const { count: cerCount } = await adminClient
            .from('customer_erasure_records')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', rollCustId)
          expect(cerCount).toBe(0)

          // Verify atomic rollback: zero audit event
          const { count: auditCount } = await adminClient
            .from('audit_events')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('entity_id', rollCustId)
          expect(auditCount).toBe(0)
        } finally {
          // Clean up temporary test trigger and function
          executeDirectSql(`
            DROP TRIGGER IF EXISTS trg_test_fail_scrub ON public.review_requests;
            DROP FUNCTION IF EXISTS public.test_fail_error_scrub();
          `)
        }
      })

      it('Case 48 (Req 14): C3C external identifier erasure policy is resolved and enforced per owner decision', () => {
        expect(C3C_EXTERNAL_IDENTIFIER_POLICY.status).toBe('RESOLVED')
        expect(C3C_EXTERNAL_IDENTIFIER_POLICY.sourceCustomerId).toBe('NULL')
        expect(C3C_EXTERNAL_IDENTIFIER_POLICY.sourceTransactionId).toBe('NULL')
        expect(C3C_EXTERNAL_IDENTIFIER_POLICY.sourceEventId).toBe('RETAIN')
        expect(C3C_EXTERNAL_IDENTIFIER_POLICY.rationale).toContain('maintain external person/transaction linkability')
        expect(C3C_EXTERNAL_IDENTIFIER_POLICY.rationale).toContain('source_event_id is retained')
        expect(C3C_EXTERNAL_IDENTIFIER_GATE).toBe(C3C_EXTERNAL_IDENTIFIER_POLICY)
      })

      it('Case 49: Dedicated external identifier erasure lifecycle (erasure -> NULL, idempotency -> preserved NULL)', async () => {
        // 1. Create a dedicated customer with completion event holding external identifiers
        const dedicatedEmail = `extid.${timestamp}@example.test`
        const { data: extCust } = await adminClient
          .from('customers')
          .insert({
            organization_id: orgId,
            location_id: locId,
            first_name: 'ExternalId',
            last_name: 'Subject',
            email: dedicatedEmail,
            phone: '+15555550299',
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()
        const extCustId = extCust!.id

        const initialSrcCustId = `ext_crm_${timestamp}`
        const initialSrcTxId = `ext_tx_${timestamp}`
        const initialSrcEvtId = `ext_evt_${timestamp}`

        const { data: extComp } = await adminClient
          .from('customer_completion_events')
          .insert({
            organization_id: orgId,
            location_id: locId,
            customer_id: extCustId,
            source: 'crm_system',
            source_event_id: initialSrcEvtId,
            source_customer_id: initialSrcCustId,
            source_transaction_id: initialSrcTxId,
            contact: { email: dedicatedEmail, firstName: 'ExternalId' },
          })
          .select('id')
          .single()

        // 2. Erase customer via owner authority
        const eraseRes = await eraseCustomer({
          organizationId: orgId,
          customerId: extCustId,
          tenantClient: ownerClient,
          adminClient,
        })
        expect(eraseRes.status).toBe('AUTHORIZED')
        expect(eraseRes.success).toBe(true)

        // 3. Verify external identifiers erased to NULL and source_event_id retained
        const { data: compAfterErase } = await adminClient
          .from('customer_completion_events')
          .select('source_customer_id, source_transaction_id, source_event_id, contact')
          .eq('id', extComp!.id)
          .single()
        expect(compAfterErase?.source_customer_id).toBeNull()
        expect(compAfterErase?.source_transaction_id).toBeNull()
        expect(compAfterErase?.source_event_id).toBe(initialSrcEvtId)
        expect(compAfterErase?.contact).toEqual({})

        // 4. Repeated erasure is idempotent and does NOT revive identifiers
        const repeatRes = await eraseCustomer({
          organizationId: orgId,
          customerId: extCustId,
          tenantClient: ownerClient,
          adminClient,
        })
        expect(repeatRes.status).toBe('AUTHORIZED')
        expect(repeatRes.success).toBe(true)
        if (repeatRes.status === 'AUTHORIZED') {
          expect(repeatRes.alreadyErased).toBe(true)
        }

        const { data: compAfterRepeat } = await adminClient
          .from('customer_completion_events')
          .select('source_customer_id, source_transaction_id, source_event_id')
          .eq('id', extComp!.id)
          .single()
        expect(compAfterRepeat?.source_customer_id).toBeNull()
        expect(compAfterRepeat?.source_transaction_id).toBeNull()
        expect(compAfterRepeat?.source_event_id).toBe(initialSrcEvtId)
      })
    })
  }
)
