import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createClient } from '../../src/lib/supabase/server'
import { getOrganizationUsageSummary } from '../../src/actions/usage'

const orgId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
type Read = { data: unknown; error: { message: string } | null }
const ok = (data: unknown): Read => ({ data, error: null })
const fail = (): Read => ({ data: null, error: { message: 'sensitive query fault' } })

function fixture(overrides: Record<string, Read> = {}, opts: {
  authenticated?: boolean; anonymous?: boolean; throwOn?: string
} = {}) {
  const reads: Record<string, Read> = {
    organization_users: ok({ role: 'OWNER' }),
    organization_entitlements: ok(null),
    locations: ok([]),
    review_destinations: ok([]),
    usage_ledger: ok([]),
    ...overrides,
  }
  const from = vi.fn((table: string) => {
    if (opts.throwOn === table) throw new Error('sensitive infrastructure error')
    if (!(table in reads)) throw new Error('unexpected table: ' + table)
    const result = reads[table]
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => result,
      order: () => chain,
      limit: async () => result,
      then: (resolve: (value: Read) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    }
    return chain
  })
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({
      data: { user: opts.authenticated === false ? null :
        { id: userId, is_anonymous: opts.anonymous === true } },
      error: null,
    })) },
    from,
  } as never)
  return { from }
}

describe('MR-5 Billing/Usage server-side factual read integrity', () => {
  afterEach(() => vi.clearAllMocks())

  it('preserves genuinely empty usage and does not invent consumed requests', async () => {
    const db = fixture()
    const result = await getOrganizationUsageSummary(orgId)
    expect(result).toMatchObject({
      success: true, data: { organizationId: orgId,
        entitlement: { status: 'NOT_STARTED', remainingRequests: 0 },
        ledgerCounts: { initialRequestsCreated: 0, providerSendAttempts: 0 },
        recentEvents: [],
      },
    })
    expect(db.from).toHaveBeenCalledTimes(5)
  })

  it.each([
    ['membership outage', 'organization_users', fail()],
    ['entitlement outage', 'organization_entitlements', fail()],
    ['entitlement missing result', 'organization_entitlements', ok(undefined)],
    ['location outage', 'locations', fail()],
    ['location missing data', 'locations', ok(undefined)],
    ['destination outage', 'review_destinations', fail()],
    ['destination malformed result', 'review_destinations', ok(null)],
    ['ledger outage', 'usage_ledger', fail()],
    ['ledger missing data', 'usage_ledger', ok(undefined)],
    ['ledger invalid data', 'usage_ledger', ok({ fake: 'zero' })],
  ])('fails closed on %s without returning misleading zero usage', async (_label, table, response) => {
    fixture({ [table]: response })
    const result = await getOrganizationUsageSummary(orgId)
    expect(result.success).toBe(false)
    expect(result.data).toBeUndefined()
    expect(result.error).not.toContain('sensitive')
  })

  it('does not leak raw database errors thrown during a usage read', async () => {
    fixture({}, { throwOn: 'usage_ledger' })
    expect(await getOrganizationUsageSummary(orgId)).toEqual({
      success: false, error: 'Usage details could not be verified',
    })
  })

  it('denies anonymous authenticated sessions before any tenant query', async () => {
    const db = fixture({}, { anonymous: true })
    expect(await getOrganizationUsageSummary(orgId)).toEqual({
      success: false, error: 'Authentication required',
    })
    expect(db.from).not.toHaveBeenCalled()
  })

  it('denies unauthenticated and missing membership without ledger access', async () => {
    const db = fixture({}, { authenticated: false })
    expect((await getOrganizationUsageSummary(orgId)).success).toBe(false)
    expect(db.from).not.toHaveBeenCalled()
    vi.clearAllMocks()
    const missing = fixture({ organization_users: ok(null) })
    expect((await getOrganizationUsageSummary(orgId)).success).toBe(false)
    expect(missing.from).toHaveBeenCalledTimes(1)
  })
})
