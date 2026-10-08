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
import { hashSuppressionContact } from '../../src/domain/suppression'

vi.mock('server-only', () => ({}))

let activeClient: SupabaseClient<Database>
let privilegedClient: SupabaseClient<Database>

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => activeClient),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => privilegedClient),
}))

import { GET } from '../../src/app/api/organizations/[organizationId]/customers/[customerId]/export/route'
import { handleCustomerPrivacyExportDelivery } from '../../src/domain/privacy/export-delivery'
import * as customerExportModule from '../../src/domain/privacy/customer-export'

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

function tableFromRequest(
  input: Parameters<typeof fetch>[0]
): string | null {
  const requestUrl = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  )

  const marker = '/rest/v1/'
  const index =
    requestUrl.pathname.indexOf(marker)

  if (index < 0) return null

  return requestUrl.pathname.slice(
    index + marker.length
  )
}

describe.skipIf(
  !isLocalDatabase
)(
  'MR-7C.2B customer privacy export delivery surface',
  () => {
    const admin =
      createClient<Database>(
        url,
        serviceRoleKey,
        options
      )

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
    const customerAEmail = 'alex.doe@example.test'
    const customerAPhone = '+15555550123'
    const customerAFirstName = 'Alex'
    const customerALastName = 'Doe'

    let failedReadTable: string | null = null
    let failAudit = false

    async function checked<T>(
      result:
        | PromiseLike<{
            data: T
            error: unknown
          }>
        | {
            data: T
            error: unknown
          }
    ): Promise<T> {
      const resolved = await result
      if (resolved.error) {
        throw new Error(
          'Synthetic privacy-export fixture failed',
          { cause: resolved.error }
        )
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

      const client = createClient<Database>(
        url,
        anonKey,
        {
          ...options,
          global: {
            fetch: async (input, init) => {
              const table = tableFromRequest(input)
              const method = init?.method ?? 'GET'

              if (
                table &&
                failedReadTable === table &&
                method === 'GET'
              ) {
                return Response.json(
                  { message: 'synthetic read failure' },
                  { status: 500 }
                )
              }

              return fetch(input, init)
            },
          },
        }
      )

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
            name: `MR-7C.2B ${slug}`,
            slug: `mr7c2b-${slug}-${randomUUID().slice(0, 8)}`,
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
            address: '123 Market St',
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

    async function addMember(
      orgId: string,
      userId: string,
      role: Role
    ) {
      await checked(
        admin.from('organization_users').insert({
          organization_id: orgId,
          user_id: userId,
          role,
        })
      )
    }

    beforeAll(async () => {
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
            permission_sms: 'allowed',
            permission_source: 'in_store_pos',
          })
          .select('id')
          .single()
      )
      if (!custA) throw new Error('Failed to create custA')
      customerA = custA.id

      // Seed customer in Org B
      const custB = await checked(
        admin
          .from('customers')
          .insert({
            organization_id: orgB,
            location_id: locB,
            first_name: 'Foreign',
            last_name: 'Customer',
            email: 'foreign.cust@example.test',
            phone: '+15555559999',
            permission_email: 'allowed',
            permission_sms: 'unknown',
            permission_source: 'manual',
          })
          .select('id')
          .single()
      )
      if (!custB) throw new Error('Failed to create custB')
      customerB = custB.id

      // Seed completion event for Customer A
      const eventA = await checked(
        admin
          .from('customer_completion_events')
          .insert({
            organization_id: orgA,
            location_id: locA,
            customer_id: customerA,
            source: 'square',
            source_event_id: `evt-${randomUUID()}`,
            contact: {
              email: customerAEmail,
              phone: customerAPhone,
            },
            permission: {
              email: 'allowed',
            },
          })
          .select('id')
          .single()
      )
      if (!eventA) throw new Error('Failed to create eventA')

      // Seed review request for Customer A
      await checked(
        admin
          .from('review_requests')
          .insert({
            organization_id: orgA,
            location_id: locA,
            customer_id: customerA,
            completion_event_id: eventA.id,
            channel: 'email',
            status: 'SENT',
            token: `tok-${randomUUID()}`,
            token_hash: `hash-${randomUUID()}`,
          })
          .select('id')
          .single()
      )

      // Seed suppression for Customer A
      await checked(
        admin
          .from('suppressions')
          .insert({
            organization_id: orgA,
            channel: 'email',
            contact_hash: hashSuppressionContact('email', customerAEmail),
            reason: 'MANUAL',
          })
          .select('id')
          .single()
      )
    })

    afterAll(async () => {
      for (const orgId of orgIds) {
        await admin.from('organizations').delete().eq('id', orgId)
      }
      for (const userId of userIds) {
        await admin.auth.admin.deleteUser(userId)
      }
    })

    beforeEach(() => {
      failedReadTable = null
      failAudit = false
      activeClient = ownerClient

      privilegedClient = createClient<Database>(
        url,
        serviceRoleKey,
        {
          ...options,
          global: {
            fetch: async (input, init) => {
              const table = tableFromRequest(input)
              const method = init?.method ?? 'GET'

              if (table === 'audit_events' && method === 'POST' && failAudit) {
                return Response.json(
                  { message: 'synthetic audit insert failure' },
                  { status: 500 }
                )
              }

              return fetch(input, init)
            },
          },
        }
      )
    })

    function makeExportRequest(oId: string, cId: string) {
      return new Request(
        `http://localhost:3000/api/organizations/${oId}/customers/${cId}/export`
      )
    }

    it('1. OWNER succeeds', async () => {
      activeClient = ownerClient

      const req = makeExportRequest(orgA, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(res.headers.get('content-disposition')).toBe(
        `attachment; filename="mpg-customer-privacy-export-${customerA}.json"`
      )
      expect(res.headers.get('cache-control')).toBe('no-store')

      const parsed = await res.json()
      expect(parsed.schemaVersion).toBe('1.0')
      expect(parsed.customer.id).toBe(customerA)
    })

    it('2. ADMIN succeeds', async () => {
      activeClient = adminUserClient

      const req = makeExportRequest(orgA, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(res.headers.get('content-disposition')).toBe(
        `attachment; filename="mpg-customer-privacy-export-${customerA}.json"`
      )
      expect(res.headers.get('cache-control')).toBe('no-store')

      const parsed = await res.json()
      expect(parsed.schemaVersion).toBe('1.0')
      expect(parsed.customer.id).toBe(customerA)
    })

    it('3. OPERATOR denied', async () => {
      activeClient = operatorClient

      const req = makeExportRequest(orgA, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
      })

      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('no-store')

      const parsed = await res.json()
      expect(parsed.status).toBe('DENIED')
      expect(parsed.error).toBe('Not authorized')
      expect(parsed).not.toHaveProperty('export')
      expect(parsed).not.toHaveProperty('customer')
    })

    it('4. VIEWER denied', async () => {
      activeClient = viewerClient

      const req = makeExportRequest(orgA, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
      })

      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('no-store')

      const parsed = await res.json()
      expect(parsed.status).toBe('DENIED')
      expect(parsed.error).toBe('Not authorized')
      expect(parsed).not.toHaveProperty('export')
      expect(parsed).not.toHaveProperty('customer')
    })

    it('5. anonymous denied', async () => {
      activeClient = anonClient

      const req = makeExportRequest(orgA, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
      })

      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('no-store')

      const parsed = await res.json()
      expect(parsed.status).toBe('DENIED')
      expect(parsed.error).toBe('Not authorized')
      expect(parsed).not.toHaveProperty('export')
      expect(parsed).not.toHaveProperty('customer')
    })

    it('6. forged/foreign organizationId denied', async () => {
      activeClient = ownerClient // Owner of Org A only, not Org B

      // Target Org B with forged input
      const req = makeExportRequest(orgB, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgB, customerId: customerA }),
      })

      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('no-store')

      const parsed = await res.json()
      expect(parsed.status).toBe('DENIED')
      expect(parsed.error).toBe('Not authorized')
      expect(parsed).not.toHaveProperty('export')
      expect(parsed).not.toHaveProperty('customer')
    })

    it('7. foreign customer denied without existence disclosure', async () => {
      activeClient = ownerClient // Owner of Org A

      // Target customerB (which belongs to Org B) within Org A request
      const foreignReq = makeExportRequest(orgA, customerB)
      const foreignRes = await GET(foreignReq, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerB }),
      })

      expect(foreignRes.status).toBe(403)
      expect(foreignRes.headers.get('cache-control')).toBe('no-store')
      const foreignBody = await foreignRes.json()

      expect(foreignBody).toEqual({
        status: 'DENIED',
        error: 'Not authorized',
      })
    })

    it('8. nonexistent customer denied identically', async () => {
      activeClient = ownerClient

      // Target foreign customer in Org A
      const foreignReq = makeExportRequest(orgA, customerB)
      const foreignRes = await GET(foreignReq, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerB }),
      })
      const foreignBody = await foreignRes.json()

      // Target completely nonexistent random customer UUID in Org A
      const randomCustId = randomUUID()
      const nonExistentReq = makeExportRequest(orgA, randomCustId)
      const nonExistentRes = await GET(nonExistentReq, {
        params: Promise.resolve({ organizationId: orgA, customerId: randomCustId }),
      })

      expect(nonExistentRes.status).toBe(403)
      expect(nonExistentRes.headers.get('cache-control')).toBe('no-store')
      const nonExistentBody = await nonExistentRes.json()

      // Responses must be completely identical: zero existence disclosure
      expect(nonExistentBody).toEqual(foreignBody)
      expect(nonExistentBody).toEqual({
        status: 'DENIED',
        error: 'Not authorized',
      })
    })

    it('9. malformed organizationId denied', async () => {
      activeClient = ownerClient

      const req = makeExportRequest('not-a-uuid', customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: 'not-a-uuid', customerId: customerA }),
      })

      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const parsed = await res.json()
      expect(parsed).toEqual({
        status: 'DENIED',
        error: 'Not authorized',
      })
    })

    it('10. malformed customerId denied', async () => {
      activeClient = ownerClient

      const req = makeExportRequest(orgA, 'not-a-uuid')
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: 'not-a-uuid' }),
      })

      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const parsed = await res.json()
      expect(parsed).toEqual({
        status: 'DENIED',
        error: 'Not authorized',
      })
    })

    it('11. valid JSON attachment', async () => {
      activeClient = ownerClient

      const req = makeExportRequest(orgA, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
      })

      expect(res.status).toBe(200)
      const text = await res.text()
      expect(() => JSON.parse(text)).not.toThrow()
    })

    it('12. safe Content-Disposition', async () => {
      activeClient = ownerClient

      const req = makeExportRequest(orgA, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
      })

      expect(res.status).toBe(200)
      const disposition = res.headers.get('content-disposition')
      expect(disposition).toBeDefined()
      expect(disposition).toMatch(
        /^attachment;\s*filename="mpg-customer-privacy-export-[0-9a-f-]+\.json"$/i
      )
    })

    it('13. no-store', async () => {
      activeClient = ownerClient

      const req = makeExportRequest(orgA, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it('14. no customer PII in filename', async () => {
      activeClient = ownerClient

      const req = makeExportRequest(orgA, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
      })

      expect(res.status).toBe(200)
      const disposition = res.headers.get('content-disposition') || ''

      // Filename must contain only customerId, never email, phone, or name
      expect(disposition).toContain(customerA)
      expect(disposition).not.toContain(customerAEmail)
      expect(disposition).not.toContain(customerAPhone)
      expect(disposition).not.toContain(customerAFirstName)
      expect(disposition).not.toContain(customerALastName)
    })

    it('15. UNAVAILABLE returns no partial export', async () => {
      activeClient = ownerClient
      // Simulate synthetic audit failure
      failAudit = true

      const req = makeExportRequest(orgA, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
      })

      expect(res.status).toBe(503)
      expect(res.headers.get('cache-control')).toBe('no-store')

      const parsed = await res.json()
      expect(parsed).toEqual({
        status: 'UNAVAILABLE',
        error: 'Temporarily unavailable',
      })
      expect(parsed).not.toHaveProperty('export')
      expect(parsed).not.toHaveProperty('customer')
    })

    it('16. mandatory privacy.customer_export audit remains C2A-owned', async () => {
      activeClient = ownerClient

      await admin
        .from('audit_events')
        .delete()
        .eq('organization_id', orgA)
        .eq('event_type', 'privacy.customer_export')
        .eq('entity_id', customerA)

      const req = makeExportRequest(orgA, customerA)
      const res = await GET(req, {
        params: Promise.resolve({ organizationId: orgA, customerId: customerA }),
      })
      expect(res.status).toBe(200)

      const auditRows = await checked(
        admin
          .from('audit_events')
          .select('actor_type, actor_id, event_type, entity_type, entity_id, metadata')
          .eq('organization_id', orgA)
          .eq('event_type', 'privacy.customer_export')
          .eq('entity_id', customerA)
      )

      if (!auditRows || auditRows.length === 0) {
        throw new Error('Missing audit row')
      }

      expect(auditRows.length).toBe(1)
      expect(auditRows[0].actor_type).toBe('user')
      expect(auditRows[0].actor_id).toBe(ownerId)
      expect(auditRows[0].event_type).toBe('privacy.customer_export')
      expect(auditRows[0].entity_type).toBe('customer')
      expect(auditRows[0].entity_id).toBe(customerA)

      // Audit metadata must NOT contain customer PII
      const metadataStr = JSON.stringify(auditRows[0].metadata)
      expect(metadataStr).not.toContain(customerAEmail)
      expect(metadataStr).not.toContain(customerAPhone)
      expect(metadataStr).not.toContain(customerAFirstName)
      expect(metadataStr).not.toContain(customerALastName)
    })

    it('17. handler does not introduce a second authorization implementation', async () => {
      activeClient = ownerClient

      const spy = vi.spyOn(customerExportModule, 'getCustomerPrivacyExport')

      const res = await handleCustomerPrivacyExportDelivery(orgA, customerA)
      expect(res.status).toBe(200)

      // Directly delegates to C2A domain function with exact target parameters
      expect(spy).toHaveBeenCalledWith(orgA, customerA)

      spy.mockRestore()
    })
  }
)
