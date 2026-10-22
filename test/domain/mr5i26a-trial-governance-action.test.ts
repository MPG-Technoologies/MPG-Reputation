import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => {
  throw new Error('Do not construct privileged client for trial requests')
}) }))

import {
  provisionOrganizationTrialAction,
  requestTrialExtensionAction,
} from '../../src/actions/usage'
import { createClient } from '../../src/lib/supabase/server'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

const org = '11111111-1111-4111-8111-111111111111'
const foreign = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333'
const reason = 'We need more time to evaluate review requests across our locations.'

function setup(input: {
  authenticated?: boolean
  anonymous?: boolean
  role?: string | null
  membershipError?: boolean
  insertError?: string | null
} = {}) {
  const insert = vi.fn(async () => ({
    error: input.insertError ? { code: input.insertError } : null,
  }))
  const from = vi.fn((table: string) => {
    if (table === 'organization_users') {
      const eq = vi.fn(() => query)
      const query = {
        eq,
        maybeSingle: vi.fn(async () => ({
          data: input.role === null ? null : {
            organization_id: org, user_id: actor, role: input.role ?? 'OWNER',
          },
          error: input.membershipError ? { code: 'RLS_ERROR' } : null,
        })),
      }
      return { select: () => query }
    }
    if (table === 'trial_extension_requests') return { insert }
    throw new Error('Unexpected table read: ' + table)
  })
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({
      data: { user: input.authenticated === false ? null :
        { id: actor, is_anonymous: Boolean(input.anonymous) } },
      error: null,
    }) },
    from,
  } as never)
  return { from, insert }
}

describe('MR-5I26A trial governance server-action boundary', () => {
  afterEach(() => vi.clearAllMocks())

  it('permanently denies stale tenant allowance edit without any privileged DB call', async () => {
    expect(await provisionOrganizationTrialAction(org, 99999, 365))
      .toMatchObject({ success: false })
    expect(createClient).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it.each(['OWNER', 'ADMIN'])('accepts a %s request only as a client-scoped INSERT', async role => {
    const { from, insert } = setup({ role })
    const result = await requestTrialExtensionAction(org.toUpperCase(), `  ${reason}  `)
    expect(result).toEqual({ success: true })
    expect(insert).toHaveBeenCalledWith({
      organization_id: org, requested_by: actor, reason,
    })
    expect(from.mock.calls.map(x => x[0])).toEqual([
      'organization_users', 'trial_extension_requests',
    ])
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/app/settings/usage')
  })

  it.each(['VIEWER', 'OPERATOR', null])('rejects role %s without any request mutation', async role => {
    const { insert } = setup({ role })
    expect((await requestTrialExtensionAction(org, reason)).success).toBe(false)
    expect(insert).not.toHaveBeenCalled()
  })

  it('denies unauthenticated and anonymous sessions before any DB access', async () => {
    for (const flag of [{ authenticated: false }, { anonymous: true }]) {
      const { from } = setup(flag)
      expect((await requestTrialExtensionAction(org, reason)).success).toBe(false)
      expect(from).not.toHaveBeenCalled()
    }
  })

  it('denies foreign, malformed or insufficient input before privileged action', async () => {
    const { insert } = setup()
    for (const [target, text] of [[foreign, reason], ['invalid', reason],
      [org, 'too short'], [org, 'x'.repeat(501)]]) {
      const result = await requestTrialExtensionAction(target, text)
      if (target === foreign) expect(result.success).toBe(false)
      else expect(result.success).toBe(false)
    }
    expect(insert).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('does not disclose DB details or create entitlement on replay/other failure', async () => {
    for (const code of ['23505', '42501']) {
      setup({ insertError: code })
      const result = await requestTrialExtensionAction(org, reason)
      expect(result.success).toBe(false)
      expect(JSON.stringify(result)).not.toContain('42501')
      expect(createAdminClient).not.toHaveBeenCalled()
    }
  })

  it('fails closed when membership verification fails', async () => {
    const { insert } = setup({ membershipError: true })
    expect((await requestTrialExtensionAction(org, reason)).success).toBe(false)
    expect(insert).not.toHaveBeenCalled()
  })
})
