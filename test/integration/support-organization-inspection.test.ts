import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
let activeClient: ReturnType<typeof createClient<Database>>
let auditClient: ReturnType<typeof createClient<Database>>
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => activeClient) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => auditClient) }))
import { getOrganizationInspection } from '../../src/lib/support/organization-inspection'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const options = { auth: { autoRefreshToken: false, persistSession: false } }
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)
let staffClient: typeof admin
let userId: string
let orgA: string
let orgB: string
let emptyOrg: string
const organizations: string[] = []
const requests: Array<{ table: string; method: string; query: URLSearchParams }> = []
let failedTable: string | null = null
let removeGrantAfterDestination = false
let auditFailure: 'returned' | 'thrown' | null = null
const sequence: string[] = []
let locationIds: string[]

function checked<T extends { data: unknown; error: unknown }>(result: T): T['data'] {
  if (result.error) throw new Error('Synthetic inspection fixture operation failed', { cause: result.error })
  return result.data
}

function requestUrl(input: Parameters<typeof fetch>[0]) {
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
}

describe('MR-6A bounded organization inspection, minimization and mandatory audit', () => {
  beforeAll(async () => {
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    for (const name of ['Northstar', 'Acme', 'Empty']) {
      const org = checked(await admin.from('organizations').insert({
        name: `${name} MR6 inspection`, slug: `mr6-inspection-${randomUUID()}`,
      }).select('id').single())!
      organizations.push(org.id)
    }
    ;[orgA, orgB, emptyOrg] = organizations
    const email = `mr6-inspection-${randomUUID()}@example.test`
    const password = randomUUID()
    const { user } = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true }))
    if (!user) throw new Error('Missing synthetic user')
    userId = user.id
    staffClient = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      ...options,
      global: { fetch: async (input, init) => {
        const target = requestUrl(input)
        const table = target.pathname.split('/rest/v1/')[1]
        if (table) {
          requests.push({ table, method: init?.method ?? 'GET', query: target.searchParams })
          sequence.push(`read:${table}`)
          if (table === failedTable) return Response.json({ message: 'private database detail' }, { status: 500 })
        }
        const response = await fetch(input, init)
        if (table === 'review_destinations' && removeGrantAfterDestination) {
          checked(await admin.from('support_access_grants').delete().eq('organization_id', orgA).eq('user_id', userId))
        }
        return response
      } },
    })
    checked(await staffClient.auth.signInWithPassword({ email, password }))
    checked(await admin.from('organization_users').insert([
      { organization_id: orgA, user_id: userId, role: 'VIEWER' },
      { organization_id: emptyOrg, user_id: userId, role: 'VIEWER' },
    ]))
    checked(await admin.from('support_access_grants').insert({
      organization_id: emptyOrg, user_id: userId, support_role: 'MPG_ADMIN',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    }))
    locationIds = Array.from({ length: 51 }, () => randomUUID()).sort()
    checked(await admin.from('locations').insert(locationIds.map((id, i) => ({
      id, organization_id: orgA, name: `Synthetic location ${i}`, status: i === 2 ? 'INACTIVE' : 'ACTIVE',
      address: 'Synthetic private address', review_reply_to_email: 'synthetic-private@example.test',
    }))))
    checked(await admin.from('locations').insert({ organization_id: orgB, name: 'FOREIGN LOCATION MUST NOT APPEAR' }))
    checked(await admin.from('review_destinations').insert(locationIds.slice(0, 3).map((id, i) => ({
      organization_id: orgA, location_id: id, provider: 'google',
      url: 'https://g.page/r/synthetic-support-private/review',
      canonical_url: 'https://g.page/r/synthetic-support-private/review',
      status: (['CONFIRMED', 'PENDING_CONFIRMATION', 'INACTIVE'] as const)[i],
    }))))
    checked(await admin.from('domain_event_outbox').insert({
      organization_id: orgA, event_type: 'synthetic.support.fixture', aggregate_type: 'organization',
      aggregate_id: orgA, payload: { synthetic: true }, status: 'FAILED',
    }))
  }, 30000)

  beforeEach(async () => {
    vi.restoreAllMocks()
    failedTable = null
    removeGrantAfterDestination = false
    auditFailure = null
    activeClient = staffClient
    checked(await admin.from('organization_users').upsert({ organization_id: orgA, user_id: userId, role: 'VIEWER' }, { onConflict: 'organization_id,user_id' }))
    checked(await admin.from('support_access_grants').upsert({
      organization_id: orgA, user_id: userId, support_role: 'MPG_ADMIN',
      expires_at: new Date(Date.now() + 3600000).toISOString(), revoked_at: null,
    }, { onConflict: 'organization_id,user_id' }))
    checked(await admin.from('audit_events').delete().eq('organization_id', orgA))
    requests.length = 0
    sequence.length = 0
    auditClient = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      ...options,
      global: { fetch: async (input, init) => {
        expect(requestUrl(input).pathname).toBe('/rest/v1/audit_events')
        expect(init?.method).toBe('POST')
        sequence.push('audit')
        if (auditFailure === 'returned') return Response.json({ message: 'private audit error' }, { status: 500 })
        if (auditFailure === 'thrown') throw new Error('private audit exception')
        return fetch(input, init)
      } },
    })
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    if (organizations.length) checked(await admin.from('organizations').delete().in('id', organizations))
    if (userId) checked(await admin.auth.admin.deleteUser(userId))
  })

  it('returns exactly the allowlisted DTO, never customer/contact/token/URL/billing/cost fields', async () => {
    const result = await getOrganizationInspection(orgA)
    expect(result.status).toBe('AVAILABLE')
    if (result.status !== 'AVAILABLE') throw new Error('Missing snapshot')
    expect(Object.keys(result)).toEqual(['status', 'snapshot'])
    expect(Object.keys(result.snapshot).sort()).toEqual(['locations', 'organization', 'snapshotAt', 'truncated'])
    expect(Object.keys(result.snapshot.organization).sort()).toEqual(['id', 'name', 'status'])
    for (const location of result.snapshot.locations) {
      expect(Object.keys(location).sort()).toEqual(['destinationState', 'id', 'name', 'status'])
    }
    expect(JSON.stringify(result)).not.toMatch(/email|phone|token|https:|billing|cost|payload|private|FOREIGN/i)
    expect(Number.isFinite(Date.parse(result.snapshot.snapshotAt))).toBe(true)
    expect(result.snapshot.locations.slice(0, 4).map((location) => location.destinationState))
      .toEqual(['CONFIRMED', 'PENDING_CONFIRMATION', 'INACTIVE', 'NOT_CONFIGURED'])
  })

  it('uses only allowlisted authenticated GETs with explicit target scope and no privileged reads', async () => {
    expect((await getOrganizationInspection(orgA)).status).toBe('AVAILABLE')
    const fields: Record<string, string> = {
      organization_users: 'organization_id,user_id,role',
      support_access_grants: 'organization_id,user_id,support_role,expires_at,revoked_at',
      organizations: 'id,name,status', locations: 'id,name,status', review_destinations: 'location_id,status',
    }
    for (const request of requests) {
      expect(request.method).toBe('GET')
      expect(request.query.get('select')).toBe(fields[request.table])
      expect(request.query.get(request.table === 'organizations' ? 'id' : 'organization_id')).toBe(`eq.${orgA}`)
    }
    const destinations = requests.find((r) => r.table === 'review_destinations')!
    expect(destinations.query.get('location_id')).toBe(`in.(${locationIds.slice(0, 50).join(',')})`)
    expect(destinations.query.get('limit')).toBe('50')
  })

  it('returns the first 50 locations in deterministic ID order and truthfully reports truncation', async () => {
    const result = await getOrganizationInspection(orgA)
    if (result.status !== 'AVAILABLE') throw new Error('Missing snapshot')
    expect(result.snapshot.locations.map((location) => location.id)).toEqual(locationIds.slice(0, 50))
    expect(result.snapshot.locations).toHaveLength(50)
    expect(result.snapshot.truncated).toBe(true)
  })

  it('returns exactly 50 without a false truncation claim when exactly 50 exist', async () => {
    checked(await admin.from('locations').delete().eq('id', locationIds[50]))
    try {
      const result = await getOrganizationInspection(orgA)
      if (result.status !== 'AVAILABLE') throw new Error('Missing snapshot')
      expect(result.snapshot.locations).toHaveLength(50)
      expect(result.snapshot.truncated).toBe(false)
    } finally {
      checked(await admin.from('locations').insert({ id: locationIds[50], organization_id: orgA, name: 'Synthetic location 50' }))
    }
  })

  it('returns a truthful empty snapshot without a destination query', async () => {
    const result = await getOrganizationInspection(emptyOrg)
    if (result.status !== 'AVAILABLE') throw new Error('Missing empty snapshot')
    expect(result.snapshot.locations).toEqual([])
    expect(result.snapshot.truncated).toBe(false)
    expect(requests.some((r) => r.table === 'review_destinations')).toBe(false)
  })

  it.each(['organizations', 'locations', 'review_destinations'])('withholds all data on %s query failure, not an empty/healthy snapshot', async (table) => {
    failedTable = table
    expect(await getOrganizationInspection(orgA)).toEqual({ status: 'UNAVAILABLE' })
    const audit = checked(await admin.from('audit_events').select('metadata').eq('organization_id', orgA))!
    expect(audit).toEqual([{ metadata: { outcome: 'UNAVAILABLE' } }])
  })

  it('denies a foreign organization without reading tenant inspection data or auditing', async () => {
    expect(await getOrganizationInspection(orgB)).toEqual({ status: 'DENIED' })
    expect(requests.every((r) => r.table === 'organization_users')).toBe(true)
    expect(sequence).not.toContain('audit')
  })

  it.each(['not-a-uuid', '../other', `${randomUUID()}?actorId=forged`, randomUUID()])('generically denies invalid or nonexistent target %s', async (target) => {
    expect(await getOrganizationInspection(target)).toEqual({ status: 'DENIED' })
    expect(sequence).not.toContain('audit')
  })

  it('persists fixed audit only after reads, with server actor and authorized organization', async () => {
    const result = await getOrganizationInspection(orgA)
    expect(result.status).toBe('AVAILABLE')
    expect(sequence.at(-1)).toBe('audit')
    expect(sequence.indexOf('audit')).toBeGreaterThan(sequence.indexOf('read:review_destinations'))
    const rows = checked(await admin.from('audit_events').select('*').eq('organization_id', orgA))!
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actor_type: 'user', actor_id: userId, organization_id: orgA,
      event_type: 'support.organization_inspection', entity_type: 'organization', entity_id: orgA,
      metadata: { outcome: 'AVAILABLE' },
    })
    expect(Number.isFinite(Date.parse(rows[0].created_at))).toBe(true)
  })

  it.each(['returned', 'thrown'] as const)('withholds snapshot on %s audit failure', async (failure) => {
    auditFailure = failure
    expect(await getOrganizationInspection(orgA)).toEqual({ status: 'UNAVAILABLE' })
    expect(checked(await admin.from('audit_events').select('id').eq('organization_id', orgA))).toEqual([])
  })

  it('does not mutate organization, location, destination, entitlement or outbox state', async () => {
    const readState = async () => Promise.all([
      admin.from('organizations').select('*').eq('id', orgA),
      admin.from('locations').select('*').eq('organization_id', orgA).order('id'),
      admin.from('review_destinations').select('*').eq('organization_id', orgA).order('id'),
      admin.from('organization_entitlements').select('*').eq('organization_id', orgA),
      admin.from('domain_event_outbox').select('*').eq('organization_id', orgA).order('id'),
    ]).then((results) => results.map(checked))
    const before = await readState()
    expect((await getOrganizationInspection(orgA)).status).toBe('AVAILABLE')
    expect(await readState()).toEqual(before)
  })

  it.each(['grant', 'membership'])('immediately denies after %s removal between requests', async (target) => {
    expect((await getOrganizationInspection(orgA)).status).toBe('AVAILABLE')
    checked(await admin.from(target === 'grant' ? 'support_access_grants' : 'organization_users')
      .delete().eq('organization_id', orgA).eq('user_id', userId))
    expect(await getOrganizationInspection(orgA)).toEqual({ status: 'DENIED' })
  })

  it('rechecks access before audit when a grant is removed during inspection', async () => {
    removeGrantAfterDestination = true
    expect(await getOrganizationInspection(orgA)).toEqual({ status: 'DENIED' })
    expect(sequence).not.toContain('audit')
  })
})
