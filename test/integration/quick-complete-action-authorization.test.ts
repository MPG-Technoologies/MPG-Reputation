import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => { throw new Error('UNEXPECTED_ADMIN_ACCESS') }),
}))
vi.mock('@/inngest/client', () => ({
  inngest: { send: vi.fn(() => { throw new Error('UNEXPECTED_PROVIDER_SEND') }) },
}))

import { createClient } from '@/lib/supabase/server'
import { submitQuickComplete } from '@/actions/quick-complete'

const organizationId = '11111111-1111-4111-8111-111111111111'
const locationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

type Fixture = {
  user?: { id: string; is_anonymous?: boolean } | null
  authError?: boolean
  membership?: { role: unknown } | null
  membershipError?: boolean
}

function form() {
  const data = new FormData()
  data.set('organizationId', organizationId)
  data.set('locationId', locationId)
  data.set('firstName', 'Synthetic')
  data.set('email', 'synthetic@example.test')
  data.set('permissionEmail', 'unknown')
  data.set('sourceEventId', 'qc_authorization_test')
  return data
}

function fixture(input: Fixture = {}) {
  const filters: { table: string; column: string; value: unknown }[] = []
  const from = vi.fn((table: string) => ({
    select: () => {
      const query = {
        eq(column: string, value: unknown) {
          filters.push({ table, column, value })
          return query
        },
        async maybeSingle() {
          if (table === 'organization_users') {
            return {
              data: input.membership === undefined ? { role: 'OWNER' } : input.membership,
              error: input.membershipError ? { message: 'Synthetic membership outage' } : null,
            }
          }
          if (table === 'locations') return { data: null, error: null }
          throw new Error('UNEXPECTED_TENANT_READ:' + table)
        },
      }
      return query
    },
  }))
  const getUser = vi.fn(async () => ({
    data: { user: input.user === undefined ? { id: userId } : input.user },
    error: input.authError ? { message: 'Synthetic auth outage' } : null,
  }))
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser },
    from,
  } as never)
  return { from, filters, getUser }
}

describe('Quick Complete server action: operational authorization is fail-closed', () => {
  afterEach(() => vi.clearAllMocks())

  it.each([
    { user: null },
    { user: { id: userId, is_anonymous: true } },
    { authError: true },
  ] as Fixture[])('rejects missing, anonymous, or failed authentication before any database read', async input => {
    const db = fixture(input)
    const result = await submitQuickComplete(form())
    expect(result).toEqual({ success: false, error: 'Authentication required' })
    expect(db.from).not.toHaveBeenCalled()
  })

  it.each([
    { membership: null },
    { membershipError: true },
  ] as Fixture[])('rejects absent or unreadable membership before loading locations', async input => {
    const db = fixture(input)
    const result = await submitQuickComplete(form())
    expect(result.success).toBe(false)
    expect(result.error).toContain('not a member')
    expect(db.from).toHaveBeenCalledTimes(1)
    expect(db.filters).toEqual([
      { table: 'organization_users', column: 'organization_id', value: organizationId },
      { table: 'organization_users', column: 'user_id', value: userId },
    ])
  })

  it.each([
    ['VIEWER', 'Viewers have read-only permissions'],
    ['SUPPORT', 'Operational membership required'],
    ['BILLING_ADMIN', 'Operational membership required'],
    ['', 'Operational membership required'],
    [null, 'Operational membership required'],
  ])('rejects a %s role before location or completion mutations', async (role, message) => {
    const db = fixture({ membership: { role } })
    const result = await submitQuickComplete(form())
    expect(result.success).toBe(false)
    expect(result.error).toContain(message)
    expect(db.from).toHaveBeenCalledTimes(1)
  })

  it.each(['OWNER', 'ADMIN', 'OPERATOR'])(
    'permits %s past role authorization but scopes the next location read to its own organization',
    async role => {
      const db = fixture({ membership: { role } })
      const result = await submitQuickComplete(form())
      expect(result).toEqual({
        success: false,
        error: 'Location does not belong to this organization',
      })
      expect(db.from).toHaveBeenCalledTimes(2)
      expect(db.filters).toContainEqual({
        table: 'locations',
        column: 'id',
        value: locationId,
      })
      expect(db.filters).toContainEqual({
        table: 'locations',
        column: 'organization_id',
        value: organizationId,
      })
    },
  )
})
