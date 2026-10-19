import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '../../src/lib/supabase/server'
import { resolveCurrentServerOrganization } from '../../src/lib/workspace/server-active-organization'

const userId = '99999999-9999-4999-8999-999999999999'
const aId = '11111111-1111-4111-8111-111111111111'
const bId = '22222222-2222-4222-8222-222222222222'
const outsiderId = '33333333-3333-4333-8333-333333333333'
const a = {
  organization_id: aId, role: 'OWNER',
  organizations: { id: aId, name: 'Synthetic Plumbing' },
}
const b = {
  organization_id: bId, role: 'VIEWER',
  organizations: { id: bId, name: 'Synthetic Services' },
}
type Fixture = {
  authenticated?: boolean
  anonymous?: boolean
  authError?: boolean
  rows?: unknown
  membershipError?: boolean
}

function setup(input: Fixture = {}) {
  const {
    authenticated = true,
    anonymous = false,
    authError = false,
    membershipError = false,
  } = input
  // Supplying rows: undefined intentionally simulates a broken DB response.
  const rows = Object.prototype.hasOwnProperty.call(input, 'rows')
    ? input.rows : [a]
  const eq = vi.fn(async (key: string, value: string) => {
    if (key !== 'user_id' || value !== userId) {
      throw new Error('MR5I4L_UNSCOPED_USER_MEMBERSHIP_QUERY')
    }
    return {
      data: rows,
      error: membershipError ? { message: 'Synthetic membership DB failure' } : null,
    }
  })
  const select = vi.fn((columns: string) => {
    if (columns !== 'organization_id, role, organizations(id, name)') {
      throw new Error('MR5I4L_UNEXPECTED_MEMBERSHIP_COLUMNS')
    }
    return { eq }
  })
  const from = vi.fn((table: string) => {
    if (table !== 'organization_users') throw new Error('MR5I4L_UNEXPECTED_TABLE')
    return { select }
  })
  const getUser = vi.fn(async () => ({
    data: { user: authenticated ? { id: userId, is_anonymous: anonymous } : null },
    error: authError ? { message: 'Synthetic auth error' } : null,
  }))
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser }, from } as never)
  return { getUser, from, select, eq }
}

describe('MR-5I4L real server membership read boundary (mocked RLS client)', () => {
  afterEach(() => { vi.resetAllMocks() })

  it('requires user authentication before any database membership lookup', async () => {
    for (const cfg of [
      { authenticated: false }, { anonymous: true }, { authError: true },
    ]) {
      const db = setup(cfg)
      expect(await resolveCurrentServerOrganization(aId))
        .toEqual({ outcome: 'AUTH_REQUIRED' })
      expect(db.getUser).toHaveBeenCalledOnce()
      expect(db.from).not.toHaveBeenCalled()
      vi.clearAllMocks()
    }
  })

  it('reads only current membership rows for the exact auth user, not all tenants', async () => {
    const db = setup()
    expect(await resolveCurrentServerOrganization()).toEqual({
      outcome: 'SELECTED',
      organization: {
        organizationId: aId,
        organizationName: 'Synthetic Plumbing',
        role: 'OWNER',
      },
    })
    expect(db.from).toHaveBeenCalledOnce()
    expect(db.from).toHaveBeenCalledWith('organization_users')
    expect(db.select).toHaveBeenCalledWith('organization_id, role, organizations(id, name)')
    expect(db.eq).toHaveBeenCalledWith('user_id', userId)
  })

  it('never mistakes failed membership query or missing data for no memberships', async () => {
    for (const cfg of [
      { membershipError: true }, { rows: null }, { rows: undefined },
    ]) {
      const db = setup(cfg)
      expect(await resolveCurrentServerOrganization()).toEqual({
        outcome: 'UNAVAILABLE',
      })
      expect(db.eq).toHaveBeenCalledWith('user_id', userId)
      vi.clearAllMocks()
    }
  })

  it('keeps an actually empty account distinct from a failed DB read', async () => {
    setup({ rows: [] })
    expect(await resolveCurrentServerOrganization())
      .toEqual({ outcome: 'NO_MEMBERSHIP' })
  })

  it('requires a choice for multiple member businesses and does not pick first', async () => {
    for (const rows of [[a,b], [b,a]]) {
      setup({ rows })
      expect(await resolveCurrentServerOrganization()).toEqual({
        outcome: 'SELECTION_REQUIRED',
        choices: [
          { organizationId: aId, organizationName: 'Synthetic Plumbing', role: 'OWNER' },
          { organizationId: bId, organizationName: 'Synthetic Services', role: 'VIEWER' },
        ],
      })
      vi.clearAllMocks()
    }
  })

  it('accepts an explicit hint only when that organization is currently in the user membership result', async () => {
    setup({ rows: [a,b] })
    expect(await resolveCurrentServerOrganization(bId)).toEqual({
      outcome: 'SELECTED',
      organization: {
        organizationId: bId, organizationName: 'Synthetic Services', role: 'VIEWER',
      },
    })
  })

  it('does not leak organization choices when a hint is foreign or malformed', async () => {
    for (const hint of [outsiderId, '', 'not-a-uuid', 42, {}, true]) {
      setup({ rows: [a,b] })
      const result = await resolveCurrentServerOrganization(hint)
      expect(result).toEqual({ outcome: 'SELECTION_DENIED' })
      const encoded = JSON.stringify(result)
      expect(encoded).not.toContain(aId)
      expect(encoded).not.toContain(bId)
      expect(encoded).not.toContain('Synthetic')
      vi.clearAllMocks()
    }
  })

  it('rejects null, missing or foreign organization joins even if membership ID is valid', async () => {
    for (const row of [
      { ...a, organizations: null },
      { ...a, organizations: { name: 'Synthetic Plumbing' } },
      { ...a, organizations: { id: outsiderId, name: 'Synthetic Foreign' } },
      { ...a, organizations: { id: 99, name: 'Synthetic Plumbing' } },
    ]) {
      setup({ rows: [row] })
      expect(await resolveCurrentServerOrganization())
        .toEqual({ outcome: 'INVALID_MEMBERSHIPS' })
      vi.clearAllMocks()
    }
  })

  it('does not accept duplicate source membership rows', async () => {
    setup({ rows: [a, { ...a }] })
    expect(await resolveCurrentServerOrganization(aId))
      .toEqual({ outcome: 'INVALID_MEMBERSHIPS' })
  })

  it('a revoked prior membership never authorizes the stored organization hint', async () => {
    setup({ rows: [a,b] })
    expect(await resolveCurrentServerOrganization(bId))
      .toHaveProperty('outcome', 'SELECTED')
    // A second request must authenticate/query again, not reuse a previous list.
    const db = setup({ rows: [a] })
    expect(await resolveCurrentServerOrganization(bId))
      .toEqual({ outcome: 'SELECTION_DENIED' })
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(db.eq).toHaveBeenCalledWith('user_id', userId)
  })

  it('cannot elevate a VIEWER into an owner with the selected organization hint', async () => {
    setup({ rows: [a,b] })
    expect(await resolveCurrentServerOrganization(bId))
      .toHaveProperty('organization.role', 'VIEWER')
  })
})
