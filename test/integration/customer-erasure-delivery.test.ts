import { randomUUID } from 'node:crypto'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

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
  GET,
  POST,
} from '../../src/app/api/organizations/[organizationId]/customers/[customerId]/erase/route'
import { handleCustomerErasureExecution } from '../../src/domain/privacy/erasure-delivery'
import {
  checkCustomerErasurePreflightAction,
  executeCustomerErasureAction,
} from '../../src/actions/customer-erasure'
import { generateTrackingToken } from '../../src/domain/tracking'
import { generateUnsubscribeToken } from '../../src/domain/unsubscribe'

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'http://127.0.0.1:54331'

const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'dummy_anon_key'

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'dummy_service_role_key'

const options = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
}

const isLocalDatabase =
  serviceRoleKey !== 'dummy_service_role_key' &&
  /^(127\.0\.0\.1|localhost)$/.test(
    new URL(url).hostname
  )

type Role =
  | 'OWNER'
  | 'ADMIN'
  | 'OPERATOR'
  | 'VIEWER'

describe.skipIf(!isLocalDatabase)(
  'MR-7C.3C Controlled Customer Erasure Delivery Surface Suite',
  { timeout: 30000 },
  () => {
    const admin = createClient<Database>(url, serviceRoleKey, options)

    const orgIds: string[] = []
    const userIds: string[] = []

    let orgA: string
    let orgB: string
    let locA: string
    let locB: string

    let ownerId: string
    let adminId: string
    let operatorId: string
    let viewerId: string
    let ownerBId: string

    let ownerClient: SupabaseClient<Database>
    let adminUserClient: SupabaseClient<Database>
    let operatorClient: SupabaseClient<Database>
    let viewerClient: SupabaseClient<Database>
    let anonClient: SupabaseClient<Database>

    let customerA: string
    let customerB: string
    const customerAEmail = 'alex.erasure.test@example.test'
    const customerAPhone = '+15555550301'
    const customerAFirstName = 'Alex'
    const customerALastName = 'ErasureTarget'

    async function checked<T>(
      result:
        | PromiseLike<{ data: T; error: unknown }>
        | { data: T; error: unknown }
    ): Promise<T> {
      const resolved = await result
      if (resolved.error) {
        throw new Error('Synthetic fixture failed', {
          cause: resolved.error,
        })
      }
      return resolved.data
    }

    async function createUser(prefix: string) {
      const password = randomUUID()
      const email = `${prefix}-${randomUUID()}@example.test`

      const result = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (result.error || !result.data.user) {
        throw new Error(`Failed to create ${prefix} user`)
      }

      userIds.push(result.data.user.id)

      const client = createClient<Database>(url, anonKey, options)

      const signIn = await client.auth.signInWithPassword({
        email,
        password,
      })

      if (signIn.error) {
        throw new Error(`Failed to authenticate ${prefix} user`)
      }

      return {
        id: result.data.user.id,
        client,
      }
    }

    async function createOrg(slug: string) {
      const org = await checked(
        admin
          .from('organizations')
          .insert({
            name: `MR-7C.3C ${slug}`,
            slug: `mr7c3c-${slug}-${randomUUID().slice(0, 8)}`,
          })
          .select('id')
          .single()
      )

      if (!org) throw new Error('Failed to create org')
      orgIds.push(org.id)

      const loc = await checked(
        admin
          .from('locations')
          .insert({
            organization_id: org.id,
            name: `${slug} HQ`,
            address: '123 Delivery St',
          })
          .select('id')
          .single()
      )

      if (!loc) throw new Error('Failed to create loc')
      return {
        orgId: org.id,
        locId: loc.id,
      }
    }

    async function addMember(orgId: string, userId: string, role: Role) {
      await checked(
        admin.from('organization_users').insert({
          organization_id: orgId,
          user_id: userId,
          role,
        })
      )
    }

    beforeAll(async () => {
      privilegedClient = admin

      const orgAResult = await createOrg('OrgA')
      orgA = orgAResult.orgId
      locA = orgAResult.locId

      const orgBResult = await createOrg('OrgB')
      orgB = orgBResult.orgId
      locB = orgBResult.locId

      const ownerUser = await createUser('owner')
      ownerId = ownerUser.id
      ownerClient = ownerUser.client
      await addMember(orgA, ownerId, 'OWNER')

      const adminUser = await createUser('admin')
      adminId = adminUser.id
      adminUserClient = adminUser.client
      await addMember(orgA, adminId, 'ADMIN')

      const operatorUser = await createUser('operator')
      operatorId = operatorUser.id
      operatorClient = operatorUser.client
      await addMember(orgA, operatorId, 'OPERATOR')

      const viewerUser = await createUser('viewer')
      viewerId = viewerUser.id
      viewerClient = viewerUser.client
      await addMember(orgA, viewerId, 'VIEWER')

      const ownerBUser = await createUser('owner-b')
      ownerBId = ownerBUser.id
      await addMember(orgB, ownerBId, 'OWNER')

      anonClient = createClient<Database>(url, anonKey, options)

      // Seed customer in Org A
      const custA = await checked(
        admin
          .from('customers')
          .insert({
            organization_id: orgA,
            location_id: locA,
            first_name: customerAFirstName,
            last_name: customerALastName,
            email: customerAEmail,
            phone: customerAPhone,
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()
      )
      customerA = custA!.id

      // Seed customer in Org B (foreign customer)
      const custB = await checked(
        admin
          .from('customers')
          .insert({
            organization_id: orgB,
            location_id: locB,
            first_name: 'Foreign',
            last_name: 'Customer',
            email: 'foreign.cust@example.test',
            phone: '+15555550302',
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()
      )
      customerB = custB!.id
    })

    afterAll(async () => {
      for (const orgId of orgIds) {
        await admin.from('audit_events').delete().eq('organization_id', orgId)
        await admin
          .from('customer_erasure_records')
          .delete()
          .eq('organization_id', orgId)
        await admin
          .from('review_request_recipient_evidence')
          .delete()
          .eq('organization_id', orgId)
        await admin.from('message_events').delete().eq('organization_id', orgId)
        await admin.from('review_requests').delete().eq('organization_id', orgId)
        await admin
          .from('customer_completion_events')
          .delete()
          .eq('organization_id', orgId)
        await admin.from('customers').delete().eq('organization_id', orgId)
        await admin
          .from('organization_users')
          .delete()
          .eq('organization_id', orgId)
        await admin.from('locations').delete().eq('organization_id', orgId)
        await admin.from('organizations').delete().eq('id', orgId)
      }

      for (const userId of userIds) {
        await admin.auth.admin.deleteUser(userId)
      }
    }, 30000)

    beforeEach(() => {
      activeClient = ownerClient
      privilegedClient = admin
    })

    // =========================================================================
    // 1. Authorization Matrix: Preflight (GET) & Execution (POST)
    // =========================================================================
    describe('Authorization & Role Matrix Enforcement', () => {
      it('1. OWNER can access preflight and receives ELIGIBLE status', async () => {
        activeClient = ownerClient
        const res = await GET(new Request('http://localhost'), {
          params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
        })
        expect(res.status).toBe(200)
        expect(res.headers.get('Cache-Control')).toBe('no-store')

        const body = await res.json()
        expect(body.status).toBe('ELIGIBLE')
        expect(body.eligible).toBe(true)
        expect(body.message).toBe('Eligible for erasure.')
      })

      it('2. ADMIN is denied preflight access (403 Not authorized)', async () => {
        activeClient = adminUserClient
        const res = await GET(new Request('http://localhost'), {
          params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
        })
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.status).toBe('DENIED')
        expect(body.eligible).toBe(false)
        expect(body.message).toBe('Not authorized')
      })

      it('3. ADMIN is denied erasure execution (403 Not authorized)', async () => {
        activeClient = adminUserClient
        const res = await POST(
          new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ confirmation: 'ERASE' }),
          }),
          {
            params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
          }
        )
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.status).toBe('DENIED')
        expect(body.success).toBe(false)
        expect(body.error).toBe('Not authorized')
      })

      it('4. OPERATOR is denied preflight access (403 Not authorized)', async () => {
        activeClient = operatorClient
        const res = await GET(new Request('http://localhost'), {
          params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
        })
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.status).toBe('DENIED')
        expect(body.eligible).toBe(false)
      })

      it('5. OPERATOR is denied erasure execution (403 Not authorized)', async () => {
        activeClient = operatorClient
        const res = await POST(
          new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ confirmation: 'ERASE' }),
          }),
          {
            params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
          }
        )
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.status).toBe('DENIED')
        expect(body.success).toBe(false)
      })

      it('6. VIEWER is denied preflight access (403 Not authorized)', async () => {
        activeClient = viewerClient
        const res = await GET(new Request('http://localhost'), {
          params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
        })
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.status).toBe('DENIED')
      })

      it('7. VIEWER is denied erasure execution (403 Not authorized)', async () => {
        activeClient = viewerClient
        const res = await POST(
          new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ confirmation: 'ERASE' }),
          }),
          {
            params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
          }
        )
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.status).toBe('DENIED')
      })

      it('8. Anonymous is denied preflight access (403 Not authorized)', async () => {
        activeClient = anonClient
        const res = await GET(new Request('http://localhost'), {
          params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
        })
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.status).toBe('DENIED')
      })

      it('9. Anonymous is denied erasure execution (403 Not authorized)', async () => {
        activeClient = anonClient
        const res = await POST(
          new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ confirmation: 'ERASE' }),
          }),
          {
            params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
          }
        )
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.status).toBe('DENIED')
      })
    })

    // =========================================================================
    // 2. Tenant Scoping & Zero-Existence Leakage
    // =========================================================================
    describe('Tenant Scoping & Existence Leakage Protection', () => {
      it('10. Foreign-tenant customer cannot be preflighted or erased by Org A OWNER (403 Not authorized)', async () => {
        activeClient = ownerClient
        // customerB belongs to Org B
        const preflightRes = await GET(new Request('http://localhost'), {
          params: Promise.resolve({ organizationId: orgA, customerId: customerB }),
        })
        expect(preflightRes.status).toBe(403)
        const preflightBody = await preflightRes.json()
        expect(preflightBody.status).toBe('DENIED')
        expect(preflightBody.message).toBe('Not authorized')

        const execRes = await POST(
          new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ confirmation: 'ERASE' }),
          }),
          {
            params: Promise.resolve({ organizationId: orgA, customerId: customerB }),
          }
        )
        expect(execRes.status).toBe(403)
        const execBody = await execRes.json()
        expect(execBody.status).toBe('DENIED')
        expect(execBody.error).toBe('Not authorized')
      })

      it('11. Nonexistent customer does not leak existence (returns identical 403 Not authorized)', async () => {
        activeClient = ownerClient
        const nonExistentId = randomUUID()

        const preflightRes = await GET(new Request('http://localhost'), {
          params: Promise.resolve({ organizationId: orgA, customerId: nonExistentId }),
        })
        expect(preflightRes.status).toBe(403)
        const preflightBody = await preflightRes.json()
        expect(preflightBody.status).toBe('DENIED')

        const execRes = await POST(
          new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ confirmation: 'ERASE' }),
          }),
          {
            params: Promise.resolve({ organizationId: orgA, customerId: nonExistentId }),
          }
        )
        expect(execRes.status).toBe(403)
        const execBody = await execRes.json()
        expect(execBody.status).toBe('DENIED')
      })

      it('12. Malformed UUIDs fail closed immediately with 403 Not authorized', async () => {
        activeClient = ownerClient
        const res = await GET(new Request('http://localhost'), {
          params: Promise.resolve({ organizationId: 'invalid-org', customerId: 'invalid-cust' }),
        })
        expect(res.status).toBe(403)

        const postRes = await POST(
          new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ confirmation: 'ERASE' }),
          }),
          {
            params: Promise.resolve({ organizationId: 'invalid-org', customerId: 'invalid-cust' }),
          }
        )
        expect(postRes.status).toBe(403)
      })
    })

    // =========================================================================
    // 3. Confirmation Requirement & Preflight Blocking
    // =========================================================================
    describe('Confirmation Requirement & Preflight Guarding', () => {
      it('13. POST without confirmation returns 400 CONFIRMATION_REQUIRED without mutating database', async () => {
        activeClient = ownerClient
        const res = await POST(
          new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({}),
          }),
          {
            params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
          }
        )
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.status).toBe('CONFIRMATION_REQUIRED')
        expect(body.error).toContain('type ERASE to confirm')

        // Verify customer row remains untouched
        const { data: cust } = await admin
          .from('customers')
          .select('first_name, email')
          .eq('id', customerA)
          .single()
        expect(cust?.first_name).toBe(customerAFirstName)
        expect(cust?.email).toBe(customerAEmail)
      })

      it('14. POST with incorrect confirmation string (e.g. "erase", "DELETE") returns 400 CONFIRMATION_REQUIRED', async () => {
        activeClient = ownerClient
        for (const wrongText of ['erase', 'DELETE', 'YES', 'erase me', '']) {
          const res = await POST(
            new Request('http://localhost', {
              method: 'POST',
              body: JSON.stringify({ confirmation: wrongText }),
            }),
            {
              params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
            }
          )
          expect(res.status).toBe(400)
          const body = await res.json()
          expect(body.status).toBe('CONFIRMATION_REQUIRED')
        }
      })

      it('15. Preflight blocks erasure if historical delivery evidence cannot be safely resolved', async () => {
        activeClient = ownerClient
        // Create a customer with a legacy request lacking recipient evidence in SENT status
        const legacyEmail = `legacy.${randomUUID().slice(0, 8)}@example.test`
        const { data: blockedCust } = await admin
          .from('customers')
          .insert({
            organization_id: orgA,
            location_id: locA,
            first_name: 'Blocked',
            last_name: 'LegacySubject',
            email: legacyEmail,
            phone: '+15555550309',
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()
        const blockedCustId = blockedCust!.id

        // Create legacy completion event and review request lacking evidence in SENT status
        const { data: blockedComp } = await admin
          .from('customer_completion_events')
          .insert({
            organization_id: orgA,
            location_id: locA,
            customer_id: blockedCustId,
            source: 'legacy_pos',
            source_event_id: `legacy_evt_${Date.now()}`,
            contact: { email: legacyEmail, firstName: 'Blocked' },
          })
          .select('id')
          .single()

        const tracking = generateTrackingToken()
        const unsub = generateUnsubscribeToken()

        await checked(
          admin.from('review_requests').insert({
            organization_id: orgA,
            location_id: locA,
            customer_id: blockedCustId,
            completion_event_id: blockedComp!.id,
            channel: 'email',
            status: 'SENT',
            sent_at: new Date().toISOString(),
            token: tracking.token,
            token_hash: tracking.tokenHash,
            unsubscribe_token: unsub.token,
            unsubscribe_token_hash: unsub.tokenHash,
          })
        )

        // Check preflight
        const preflightRes = await GET(new Request('http://localhost'), {
          params: Promise.resolve({ organizationId: orgA, customerId: blockedCustId }),
        })
        expect(preflightRes.status).toBe(200)
        const preflightBody = await preflightRes.json()
        expect(preflightBody.status).toBe('BLOCKED')
        expect(preflightBody.eligible).toBe(false)
        expect(preflightBody.message).toContain('historical delivery evidence cannot be safely resolved')

        // Attempt POST erasure on blocked customer: must be rejected with 409 BLOCKED
        const execRes = await POST(
          new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ confirmation: 'ERASE' }),
          }),
          {
            params: Promise.resolve({ organizationId: orgA, customerId: blockedCustId }),
          }
        )
        expect(execRes.status).toBe(409)
        const execBody = await execRes.json()
        expect(execBody.status).toBe('BLOCKED')
        expect(execBody.error).toContain('historical delivery evidence cannot be safely resolved')

        // Verify customer was NOT erased
        const { data: custAfter } = await admin
          .from('customers')
          .select('first_name, email')
          .eq('id', blockedCustId)
          .single()
        expect(custAfter?.first_name).toBe('Blocked')
        expect(custAfter?.email).toBe(legacyEmail)
      })
    })

    // =========================================================================
    // 4. Successful OWNER Erasure Execution & Verified Engine State
    // =========================================================================
    describe('Successful Controlled Erasure Execution', () => {
      let targetCustId: string
      const targetEmail = `target.${randomUUID().slice(0, 8)}@example.test`
      const targetSrcCustId = `crm_target_${Date.now()}`
      const targetSrcTxId = `tx_target_${Date.now()}`
      const targetSrcEvtId = `evt_target_${Date.now()}`

      beforeAll(async () => {
        // Create an eligible customer with completion event
        const { data: cust } = await admin
          .from('customers')
          .insert({
            organization_id: orgA,
            location_id: locA,
            first_name: 'Target',
            last_name: 'ForErasure',
            email: targetEmail,
            phone: '+15555550388',
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()
        targetCustId = cust!.id

        await admin.from('customer_completion_events').insert({
          organization_id: orgA,
          location_id: locA,
          customer_id: targetCustId,
          source: 'test_crm',
          source_event_id: targetSrcEvtId,
          source_customer_id: targetSrcCustId,
          source_transaction_id: targetSrcTxId,
          contact: { email: targetEmail, firstName: 'Target' },
        })
      })

      it('16. Successful OWNER POST erases customer, scrubs PII, zeroes external IDs, and returns safe non-PII output', async () => {
        activeClient = ownerClient
        const res = await POST(
          new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ confirmation: 'ERASE' }),
          }),
          {
            params: Promise.resolve({ organizationId: orgA, customerId: targetCustId }),
          }
        )
        expect(res.status).toBe(200)
        expect(res.headers.get('Cache-Control')).toBe('no-store')

        const body = await res.json()
        expect(body.status).toBe('SUCCESS')
        expect(body.success).toBe(true)
        expect(body.customerId).toBe(targetCustId)
        expect(body.erasedAt).toBeDefined()
        expect(body.alreadyErased).toBe(false)
        // Verify response contains NO PII, no error details, no database schema details
        expect(JSON.stringify(body)).not.toContain(targetEmail)
        expect(JSON.stringify(body)).not.toContain(targetSrcCustId)
        expect(JSON.stringify(body)).not.toContain(targetSrcTxId)

        // Verify customer record in database is tombstoned
        const { data: custInDb } = await admin
          .from('customers')
          .select('first_name, last_name, email, phone')
          .eq('id', targetCustId)
          .single()
        expect(custInDb?.first_name).toBe('[Deleted Customer]')
        expect(custInDb?.last_name).toBeNull()
        expect(custInDb?.email).toBeNull()
        expect(custInDb?.phone).toBeNull()

        // Verify completion event contact is empty and external identifiers are erased to NULL
        const { data: compInDb } = await admin
          .from('customer_completion_events')
          .select('contact, source_customer_id, source_transaction_id, source_event_id')
          .eq('customer_id', targetCustId)
          .single()
        expect(compInDb?.contact).toEqual({})
        expect(compInDb?.source_customer_id).toBeNull()
        expect(compInDb?.source_transaction_id).toBeNull()
        expect(compInDb?.source_event_id).toBe(targetSrcEvtId)

        // Verify customer_erasure_records contains durable evidence
        const { data: erasureRecord } = await admin
          .from('customer_erasure_records')
          .select('organization_id, customer_id, actor_id')
          .eq('customer_id', targetCustId)
          .single()
        expect(erasureRecord?.organization_id).toBe(orgA)
        expect(erasureRecord?.customer_id).toBe(targetCustId)
        expect(erasureRecord?.actor_id).toBe(ownerId)
      })

      it('17. Repeated execution is idempotent, does not fail or revive identifiers, and returns alreadyErased: true', async () => {
        activeClient = ownerClient
        const repeatRes = await POST(
          new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ confirmation: 'ERASE' }),
          }),
          {
            params: Promise.resolve({ organizationId: orgA, customerId: targetCustId }),
          }
        )
        expect(repeatRes.status).toBe(200)
        const repeatBody = await repeatRes.json()
        expect(repeatBody.status).toBe('SUCCESS')
        expect(repeatBody.success).toBe(true)
        expect(repeatBody.alreadyErased).toBe(true)

        // Verify database state remains tombstoned and NULL
        const { data: compCheck } = await admin
          .from('customer_completion_events')
          .select('source_customer_id, source_transaction_id, source_event_id')
          .eq('customer_id', targetCustId)
          .single()
        expect(compCheck?.source_customer_id).toBeNull()
        expect(compCheck?.source_transaction_id).toBeNull()
        expect(compCheck?.source_event_id).toBe(targetSrcEvtId)
      })
    })

    // =========================================================================
    // 5. Server Actions Integration
    // =========================================================================
    describe('Server Actions Parity & Revalidation', () => {
      it('18. checkCustomerErasurePreflightAction and executeCustomerErasureAction behave safely and symmetrically', async () => {
        activeClient = ownerClient
        // Create an eligible customer for server action test
        const actionEmail = `action.${randomUUID().slice(0, 8)}@example.test`
        const { data: actionCust } = await admin
          .from('customers')
          .insert({
            organization_id: orgA,
            location_id: locA,
            first_name: 'ActionSubject',
            last_name: 'Doe',
            email: actionEmail,
            phone: '+15555550377',
            permission_email: 'allowed',
            permission_source: 'test',
          })
          .select('id')
          .single()
        const actionCustId = actionCust!.id

        // Preflight Action
        const preflightResult = await checkCustomerErasurePreflightAction(
          orgA,
          actionCustId
        )
        expect(preflightResult.status).toBe('ELIGIBLE')
        expect(preflightResult.eligible).toBe(true)

        // Missing confirmation returns CONFIRMATION_REQUIRED
        const badConfirmResult = await executeCustomerErasureAction(
          orgA,
          actionCustId,
          'wrong'
        )
        expect(badConfirmResult.status).toBe('CONFIRMATION_REQUIRED')
        expect(badConfirmResult.success).toBe(false)

        // Correct confirmation executes erasure
        const execResult = await executeCustomerErasureAction(
          orgA,
          actionCustId,
          'ERASE'
        )
        expect(execResult.status).toBe('SUCCESS')
        expect(execResult.success).toBe(true)
        expect(execResult.customerId).toBe(actionCustId)

        // Customer in database is erased
        const { data: custInDb } = await admin
          .from('customers')
          .select('first_name, email')
          .eq('id', actionCustId)
          .single()
        expect(custInDb?.first_name).toBe('[Deleted Customer]')
        expect(custInDb?.email).toBeNull()
      })
    })

    // =========================================================================
    // 6. Security Boundaries & Zero Secret Exposure
    // =========================================================================
    describe('Security Boundaries & Client Code Leakage Prevention', () => {
      it('19. Browser client files do NOT reference service_role credentials or raw execute_customer_erasure RPC', async () => {
        // Read client component source files
        const fs = await import('node:fs')
        const path = await import('node:path')

        const clientFiles = [
          path.resolve('src/app/app/customers/customer-actions.tsx'),
          path.resolve('src/app/app/customers/page.tsx'),
        ]

        for (const filePath of clientFiles) {
          const content = fs.readFileSync(filePath, 'utf-8')
          // Client code must never contain service_role key or raw RPC
          expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
          expect(content).not.toContain('execute_customer_erasure')
          expect(content).not.toContain('customer_erasure_records')
        }
      })

      it('20. CustomersPage statically and contractually gates CustomerErasureButton strictly to userRole === OWNER', async () => {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const pageContent = fs.readFileSync(path.resolve('src/app/app/customers/page.tsx'), 'utf-8')

        // Verify OWNER check
        expect(pageContent).toContain("const isOwner = userRole === 'OWNER'")
        expect(pageContent).toContain('isOwner && (')
        expect(pageContent).toContain('<CustomerErasureButton')
        // Verify non-OWNER roles cannot trigger erasure button
        expect(pageContent).not.toContain("isOwner = userRole === 'ADMIN'")
        expect(pageContent).not.toContain("isOwner = userRole === 'OPERATOR'")
        expect(pageContent).not.toContain("isOwner = userRole === 'VIEWER'")
      })

      it('21. Unexpected database/internal error in delivery handler masks raw SQL details with safe 503 UNAVAILABLE', async () => {
        activeClient = ownerClient
        // Create a synthetic mock client that throws a raw database exception
        const brokenClient = {
          auth: {
            getUser: async () => ({
              data: { user: { id: ownerId, is_anonymous: false } },
              error: null,
            }),
          },
          from: () => {
            throw new Error('FATAL: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: raw SQL detail leak')
          },
        } as unknown as SupabaseClient<Database>

        const res = await handleCustomerErasureExecution(orgA, customerA, 'ERASE', {
          tenantClient: brokenClient,
        })
        expect(res.status).toBe(503)
        const body = await res.json()
        expect(body.status).toBe('UNAVAILABLE')
        expect(body.error).toBe('Temporarily unavailable')
        // Ensure zero raw SQL text or stack trace leaks
        expect(JSON.stringify(body)).not.toContain('postgresql')
        expect(JSON.stringify(body)).not.toContain('socket')
        expect(JSON.stringify(body)).not.toContain('FATAL')
      })
    })
  }
)
