import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
let activeClient: ReturnType<typeof createClient<Database>>
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => activeClient) }))
import { authorizeSupportAccess } from '../../src/lib/support/access'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const options = { auth: { autoRefreshToken: false, persistSession: false } }
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)
const anonymous = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
type TestUser = { id: string; client: typeof anonymous }
type Role = Database['public']['Tables']['organization_users']['Row']['role']
const users: TestUser[] = []
const organizations: string[] = []
const roles: Role[] = ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']
const ordinaryUsers = new Map<Role, TestUser>()
let staff: TestUser
let foreignStaff: TestUser
let orgA: string
let orgB: string

function checked<T extends { data: unknown; error: unknown }>(result: T): T['data'] {
  if (result.error) throw new Error('Synthetic support fixture operation failed', { cause: result.error })
  return result.data
}

async function newUser(): Promise<TestUser> {
  const email = `mr6-access-${randomUUID()}@example.test`
  const password = randomUUID()
  const { user } = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true }))
  if (!user) throw new Error('Missing synthetic user')
  const client = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
  const result = { id: user.id, client }
  users.push(result)
  checked(await client.auth.signInWithPassword({ email, password }))
  return result
}

describe('MR-6A support authorization and real Data API RLS', () => {
  beforeAll(async () => {
    // Fail rather than accidentally target a hosted database or skip this security suite.
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    for (const name of ['Northstar', 'Acme']) {
      const org = checked(await admin.from('organizations').insert({
        name: `${name} MR6 access`, slug: `mr6-access-${randomUUID()}`,
      }).select('id').single())!
      organizations.push(org.id)
    }
    ;[orgA, orgB] = organizations
    staff = await newUser()
    foreignStaff = await newUser()
    for (const role of roles) ordinaryUsers.set(role, await newUser())
    checked(await admin.from('organization_users').insert([
      { organization_id: orgA, user_id: staff.id, role: 'VIEWER' },
      { organization_id: orgB, user_id: foreignStaff.id, role: 'VIEWER' },
      ...roles.map((role) => ({ organization_id: orgA, user_id: ordinaryUsers.get(role)!.id, role })),
    ]))
    checked(await admin.from('support_access_grants').insert({
      organization_id: orgB, user_id: foreignStaff.id, support_role: 'MPG_ADMIN',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    }))
  }, 30000)

  beforeEach(async () => {
    activeClient = staff.client
    checked(await admin.from('organization_users').upsert({
      organization_id: orgA, user_id: staff.id, role: 'VIEWER',
    }, { onConflict: 'organization_id,user_id' }))
    checked(await admin.from('support_access_grants').upsert({
      organization_id: orgA, user_id: staff.id, support_role: 'MPG_ADMIN',
      expires_at: new Date(Date.now() + 3600000).toISOString(), revoked_at: null,
    }, { onConflict: 'organization_id,user_id' }))
  })

  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    if (organizations.length) checked(await admin.from('organizations').delete().in('id', organizations))
    for (const user of users) checked(await admin.auth.admin.deleteUser(user.id))
  })

  it('authorizes a current member with an explicit current grant using the session actor', async () => {
    const access = await authorizeSupportAccess(orgA)
    expect(access?.actorId).toBe(staff.id)
    expect(access?.organizationId).toBe(orgA)
    expect(access?.supabase).toBe(staff.client)
  })

  it.each(roles)('denies ordinary %s without a support grant', async (role) => {
    activeClient = ordinaryUsers.get(role)!.client
    expect(await authorizeSupportAccess(orgA)).toBeNull()
  })

  it('denies a foreign tenant even with a valid grant elsewhere', async () => {
    expect(await authorizeSupportAccess(orgB)).toBeNull()
    activeClient = foreignStaff.client
    expect(await authorizeSupportAccess(orgA)).toBeNull()
  })

  it('requires a grant for the same organization even when both memberships exist', async () => {
    checked(await admin.from('organization_users').insert({ organization_id: orgB, user_id: staff.id, role: 'VIEWER' }))
    try { expect(await authorizeSupportAccess(orgB)).toBeNull() }
    finally { checked(await admin.from('organization_users').delete().eq('organization_id', orgB).eq('user_id', staff.id)) }
  })

  it.each(['expired', 'revoked'])('denies %s grants in both the loader and RLS', async (state) => {
    checked(await admin.from('support_access_grants').update(state === 'expired'
      ? { expires_at: new Date(Date.now() - 1000).toISOString() }
      : { revoked_at: new Date().toISOString() }
    ).eq('organization_id', orgA).eq('user_id', staff.id))
    expect(await authorizeSupportAccess(orgA)).toBeNull()
    expect(checked(await staff.client.from('support_access_grants').select('*'))).toEqual([])
  })

  it('denies unauthenticated inspection and anonymous table access', async () => {
    activeClient = anonymous
    expect(await authorizeSupportAccess(orgA)).toBeNull()
    const result = await anonymous.from('support_access_grants').select('*')
    expect(result.error?.code).toBe('42501')
    expect(result.data).toBeNull()
  })

  it('ignores editable user metadata claiming MPG_ADMIN and a different actor', async () => {
    const ordinary = ordinaryUsers.get('OWNER')!
    checked(await ordinary.client.auth.updateUser({ data: { role: 'MPG_ADMIN', user_id: staff.id, organization_id: orgA } }))
    activeClient = ordinary.client
    expect(await authorizeSupportAccess(orgA)).toBeNull()
  })

  it('denies authenticated self-grant INSERT', async () => {
    const ordinary = ordinaryUsers.get('OWNER')!
    const result = await ordinary.client.from('support_access_grants').insert({
      organization_id: orgA, user_id: ordinary.id, support_role: 'MPG_ADMIN',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })
    expect(result.error?.code).toBe('42501')
  })

  it('denies authenticated UPDATE of an owned grant', async () => {
    const result = await staff.client.from('support_access_grants')
      .update({ expires_at: new Date(Date.now() + 7200000).toISOString() }).eq('user_id', staff.id)
    expect(result.error?.code).toBe('42501')
  })

  it('denies authenticated DELETE of an owned grant', async () => {
    const result = await staff.client.from('support_access_grants').delete().eq('user_id', staff.id)
    expect(result.error?.code).toBe('42501')
  })

  it('cannot read another user grant even if it shares tenant membership', async () => {
    checked(await admin.from('organization_users').insert({ organization_id: orgA, user_id: foreignStaff.id, role: 'VIEWER' }))
    checked(await admin.from('support_access_grants').insert({ organization_id: orgA, user_id: foreignStaff.id,
      support_role: 'MPG_ADMIN', expires_at: new Date(Date.now() + 3600000).toISOString() }))
    const grants = checked(await staff.client.from('support_access_grants').select('*'))!
    expect(grants).toHaveLength(1)
    expect(grants[0].user_id).toBe(staff.id)
    expect(checked(await staff.client.from('support_access_grants').select('*').eq('user_id', foreignStaff.id))).toEqual([])
  })

  it('membership deletion cascades the grant and recreating membership does not restore authorization', async () => {
    expect(await authorizeSupportAccess(orgA)).not.toBeNull()
    checked(await admin.from('organization_users').delete().eq('organization_id', orgA).eq('user_id', staff.id))
    expect(await authorizeSupportAccess(orgA)).toBeNull()
    expect(checked(await admin.from('support_access_grants').select('*').eq('organization_id', orgA).eq('user_id', staff.id))).toEqual([])
    checked(await admin.from('organization_users').insert({ organization_id: orgA, user_id: staff.id, role: 'VIEWER' }))
    expect(await authorizeSupportAccess(orgA)).toBeNull()
  })

  it('requires membership even for privileged grant provisioning', async () => {
    const result = await admin.from('support_access_grants').insert({
      organization_id: orgA, user_id: randomUUID(), support_role: 'MPG_ADMIN',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })
    expect(result.error?.code).toBe('23503')
  })

  it('enforces a unique grant identity per membership', async () => {
    const result = await admin.from('support_access_grants').insert({
      organization_id: orgA, user_id: staff.id, support_role: 'MPG_ADMIN',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })
    expect(result.error?.code).toBe('23505')
  })

  it.each(['', 'not-a-uuid', '../organizations', `${randomUUID()}?actorId=other`, randomUUID()])('generically denies invalid or unknown target %s', async (target) => {
    expect(await authorizeSupportAccess(target)).toBeNull()
  })

  it('fails closed on a database lookup exception without exposing it', async () => {
    vi.spyOn(staff.client, 'from').mockImplementationOnce(() => { throw new Error('private database detail') })
    expect(await authorizeSupportAccess(orgA)).toBeNull()
  })
})
