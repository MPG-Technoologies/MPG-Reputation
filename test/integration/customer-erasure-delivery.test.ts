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
  handleCustomerErasureExecution,
} from '../../src/domain/privacy/erasure-delivery'
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
    let locA: string
    let orgB: string
    let locB: string

    let ownerId: string
    let adminId: string
    let operatorId: string
    let viewerId: string

    let ownerClient: SupabaseClient<Database>
    let adminUserClient: SupabaseClient<Database>
    let operatorClient: SupabaseClient<Database>
    let viewerClient: SupabaseClient<Database>
    let anonClient: SupabaseClient<Database>

    let customerA: string
    let customerAFirstName: string
    let customerAEmail: string
    let customerB: string

    async function checked<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
      const res = await promise
      if (res.error) {
        throw new Error(`DB Error: ${JSON.stringify(res.error)}`)
      }
      return res.data
    }

    async function createUser(emailPrefix: string) {
      const email = `${emailPrefix}.${randomUUID().slice(0, 8)}@example.test`
      const password = 'Password123!'
      const userRes = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (userRes.error || !userRes.data.user) {
        throw new Error(`Failed to create auth user: ${JSON.stringify(userRes.error)}`)
      }
      const userId = userRes.data.user.id
      userIds.push(userId)

      const client = createClient<Database>(url, anonKey, options)
      const signinRes = await client.auth.signInWithPassword({ email, password })
      if (signinRes.error) {
        throw new Error(`Failed to sign in: ${JSON.stringify(signinRes.error)}`)
      }

      return {
        id: userId,
        email,
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

      // Anonymous client (unauthenticated)
      anonClient = createClient<Database>(url, anonKey, options)

      // Seed customer in Org A
      customerAFirstName = 'John'
      customerAEmail = `john.${randomUUID().slice(0, 8)}@example.test`
      const custA = await checked(
        admin
          .from('customers')
          .insert({
            organization_id: orgA,
            location_id: locA,
            first_name: customerAFirstName,
            last_name: 'Doe',
            email: customerAEmail,
            phone: '+15555550301',
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
    // 1. Authorization Matrix: Preflight & Execution
    // =========================================================================
    describe('Authorization & Role Matrix Enforcement', () => {
      it('1. OWNER can access preflight and receives ELIGIBLE status', async () => {
        activeClient = ownerClient
        const res = await checkCustomerErasurePreflightAction(orgA, customerA)
        expect(res.status).toBe('ELIGIBLE')
        expect(res.eligible).toBe(true)
        expect(res.message).toBe('Eligible for erasure.')
      })

      it('2. ADMIN is denied preflight access (DENIED Not authorized)', async () => {
        activeClient = adminUserClient
        const res = await checkCustomerErasurePreflightAction(orgA, customerA)
        expect(res.status).toBe('DENIED')
        expect(res.eligible).toBe(false)
        expect(res.message).toBe('Not authorized')
      })

      it('3. ADMIN is denied erasure execution (DENIED Not authorized)', async () => {
        activeClient = adminUserClient
        const res = await executeCustomerErasureAction(orgA, customerA, 'ERASE')
        expect(res.status).toBe('DENIED')
        expect(res.success).toBe(false)
        expect(res.error).toBe('Not authorized')
      })

      it('4. OPERATOR is denied preflight access (DENIED Not authorized)', async () => {
        activeClient = operatorClient
        const res = await checkCustomerErasurePreflightAction(orgA, customerA)
        expect(res.status).toBe('DENIED')
        expect(res.eligible).toBe(false)
        expect(res.message).toBe('Not authorized')
      })

      it('5. OPERATOR is denied erasure execution (DENIED Not authorized)', async () => {
        activeClient = operatorClient
        const res = await executeCustomerErasureAction(orgA, customerA, 'ERASE')
        expect(res.status).toBe('DENIED')
        expect(res.success).toBe(false)
        expect(res.error).toBe('Not authorized')
      })

      it('6. VIEWER is denied preflight access (DENIED Not authorized)', async () => {
        activeClient = viewerClient
        const res = await checkCustomerErasurePreflightAction(orgA, customerA)
        expect(res.status).toBe('DENIED')
        expect(res.eligible).toBe(false)
        expect(res.message).toBe('Not authorized')
      })

      it('7. VIEWER is denied erasure execution (DENIED Not authorized)', async () => {
        activeClient = viewerClient
        const res = await executeCustomerErasureAction(orgA, customerA, 'ERASE')
        expect(res.status).toBe('DENIED')
        expect(res.success).toBe(false)
        expect(res.error).toBe('Not authorized')
      })

      it('8. Anonymous is denied preflight access (DENIED Not authorized)', async () => {
        activeClient = anonClient
        const res = await checkCustomerErasurePreflightAction(orgA, customerA)
        expect(res.status).toBe('DENIED')
        expect(res.eligible).toBe(false)
        expect(res.message).toBe('Not authorized')
      })

      it('9. Anonymous is denied erasure execution (DENIED Not authorized)', async () => {
        activeClient = anonClient
        const res = await executeCustomerErasureAction(orgA, customerA, 'ERASE')
        expect(res.status).toBe('DENIED')
        expect(res.success).toBe(false)
        expect(res.error).toBe('Not authorized')
      })
    })

    // =========================================================================
    // 2. Tenant Scoping & Zero-Existence Leakage
    // =========================================================================
    describe('Tenant Scoping & Existence Leakage Protection', () => {
      it('10. Foreign-tenant customer cannot be preflighted or erased by Org A OWNER (DENIED Not authorized)', async () => {
        activeClient = ownerClient
        // customerB belongs to Org B
        const preflightRes = await checkCustomerErasurePreflightAction(orgA, customerB)
        expect(preflightRes.status).toBe('DENIED')
        expect(preflightRes.eligible).toBe(false)
        expect(preflightRes.message).toBe('Not authorized')

        const execRes = await executeCustomerErasureAction(orgA, customerB, 'ERASE')
        expect(execRes.status).toBe('DENIED')
        expect(execRes.success).toBe(false)
        expect(execRes.error).toBe('Not authorized')
      })

      it('11. Nonexistent customer does not leak existence (returns identical DENIED Not authorized)', async () => {
        activeClient = ownerClient
        const nonExistentId = randomUUID()

        const preflightRes = await checkCustomerErasurePreflightAction(orgA, nonExistentId)
        expect(preflightRes.status).toBe('DENIED')
        expect(preflightRes.eligible).toBe(false)
        expect(preflightRes.message).toBe('Not authorized')

        const execRes = await executeCustomerErasureAction(orgA, nonExistentId, 'ERASE')
        expect(execRes.status).toBe('DENIED')
        expect(execRes.success).toBe(false)
        expect(execRes.error).toBe('Not authorized')
      })

      it('12. Malformed UUIDs fail closed immediately with DENIED Not authorized', async () => {
        activeClient = ownerClient
        const preflightRes = await checkCustomerErasurePreflightAction('invalid-org', 'invalid-cust')
        expect(preflightRes.status).toBe('DENIED')
        expect(preflightRes.eligible).toBe(false)

        const execRes = await executeCustomerErasureAction('invalid-org', 'invalid-cust', 'ERASE')
        expect(execRes.status).toBe('DENIED')
        expect(execRes.success).toBe(false)
      })
    })

    // =========================================================================
    // 3. Confirmation Requirement & Preflight Blocking
    // =========================================================================
    describe('Confirmation Requirement & Preflight Guarding', () => {
      it('13. Action without confirmation returns CONFIRMATION_REQUIRED without mutating database', async () => {
        activeClient = ownerClient
        const res = await executeCustomerErasureAction(orgA, customerA, '')
        expect(res.status).toBe('CONFIRMATION_REQUIRED')
        expect(res.success).toBe(false)
        expect(res.error).toContain('type ERASE to confirm')

        // Verify customer row remains untouched
        const { data: cust } = await admin
          .from('customers')
          .select('first_name, email')
          .eq('id', customerA)
          .single()
        expect(cust?.first_name).toBe(customerAFirstName)
        expect(cust?.email).toBe(customerAEmail)
      })

      it('14. Action with incorrect confirmation string returns CONFIRMATION_REQUIRED', async () => {
        activeClient = ownerClient
        for (const wrongText of ['erase', 'DELETE', 'YES', 'erase me']) {
          const res = await executeCustomerErasureAction(orgA, customerA, wrongText)
          expect(res.status).toBe('CONFIRMATION_REQUIRED')
          expect(res.success).toBe(false)
          expect(res.error).toContain('type ERASE to confirm')
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
        const preflightRes = await checkCustomerErasurePreflightAction(orgA, blockedCustId)
        expect(preflightRes.status).toBe('BLOCKED')
        expect(preflightRes.eligible).toBe(false)
        expect(preflightRes.message).toContain('historical delivery evidence cannot be safely resolved')

        // Attempt execution on blocked customer: must be rejected with BLOCKED
        const execRes = await executeCustomerErasureAction(orgA, blockedCustId, 'ERASE')
        expect(execRes.status).toBe('BLOCKED')
        expect(execRes.success).toBe(false)
        expect(execRes.error).toContain('historical delivery evidence cannot be safely resolved')

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

      it('16. Successful OWNER execution erases customer, scrubs PII, zeroes external IDs, and returns safe non-PII output WITHOUT customerId', async () => {
        activeClient = ownerClient
        const res = await executeCustomerErasureAction(orgA, targetCustId, 'ERASE')
        expect(res.status).toBe('ERASED')
        expect(res.success).toBe(true)
        expect(res.erasedAt).toBeDefined()
        expect(res.alreadyErased).toBe(false)

        // Strict Requirement: customerId must NOT be returned in response payload
        expect(res).not.toHaveProperty('customerId')
        expect(JSON.stringify(res)).not.toContain(targetCustId)
        expect(JSON.stringify(res)).not.toContain(targetEmail)
        expect(JSON.stringify(res)).not.toContain(targetSrcCustId)
        expect(JSON.stringify(res)).not.toContain(targetSrcTxId)

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

      it('17. Repeated execution is idempotent, returns alreadyErased: true, and omits customerId', async () => {
        activeClient = ownerClient
        const repeatRes = await executeCustomerErasureAction(orgA, targetCustId, 'ERASE')
        expect(repeatRes.status).toBe('ERASED')
        expect(repeatRes.success).toBe(true)
        expect(repeatRes.alreadyErased).toBe(true)
        expect(repeatRes).not.toHaveProperty('customerId')

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
        expect(execResult.status).toBe('ERASED')
        expect(execResult.success).toBe(true)
        expect(execResult).not.toHaveProperty('customerId')

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
      it('19. Browser client files do NOT reference service_role credentials or raw execute_customer_erasure RPC, and no erase HTTP route exists', async () => {
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

        // Verify the redundant HTTP route file has been eliminated to reduce attack surface
        const eraseRoutePath = path.resolve(
          'src/app/api/organizations/[organizationId]/customers/[customerId]/erase/route.ts'
        )
        expect(fs.existsSync(eraseRoutePath)).toBe(false)
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

      it('21. Unexpected database/internal error in delivery handler masks raw SQL details with safe UNAVAILABLE', async () => {
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
        expect(res.status).toBe('UNAVAILABLE')
        expect(res.success).toBe(false)
        expect(res.error).toBe('Temporarily unavailable')
        // Ensure zero raw SQL text or stack trace leaks
        expect(JSON.stringify(res)).not.toContain('postgresql')
        expect(JSON.stringify(res)).not.toContain('socket')
        expect(JSON.stringify(res)).not.toContain('FATAL')
      })
    })
  }
)
