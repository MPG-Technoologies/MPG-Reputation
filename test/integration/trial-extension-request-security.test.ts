import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const options = { auth: { autoRefreshToken: false, persistSession: false } }
const service = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)
const anon = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
const actors: Array<{ id: string, client: typeof anon }> = []
const orgs: string[] = []
let owner: typeof anon
let admin: typeof anon
let viewer: typeof anon
let stranger: typeof anon
let ownerId = ''
let adminId = ''
let viewerId = ''
let orgA = ''
let orgB = ''
const reason = 'We need a little more trial time to evaluate the service with our staff.'

function checked<T extends { data: unknown, error: unknown }>(response: T): T['data'] {
  if (response.error) throw new Error('MR-5I26A disposable fixture setup failed', { cause: response.error })
  return response.data
}

async function newActor() {
  const email = `mr5i26a-${randomUUID()}@example.test`
  const password = randomUUID()
  const result = checked(await service.auth.admin.createUser({ email, password, email_confirm: true }))
  if (!result.user) throw new Error('Synthetic auth fixture missing')
  const client = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
  checked(await client.auth.signInWithPassword({ email, password }))
  actors.push({ id: result.user.id, client })
  return actors[actors.length - 1]
}

beforeAll(async () => {
  // Real RLS verification must never use hosted project or customer records.
  expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
  const o = await newActor(); owner = o.client; ownerId = o.id
  const a = await newActor(); admin = a.client; adminId = a.id
  const v = await newActor(); viewer = v.client; viewerId = v.id
  stranger = (await newActor()).client
}, 30000)

beforeEach(async () => {
  const first = checked(await service.from('organizations').insert({
    name: 'MR5 Trial Request A', slug: `mr5i26a-a-${randomUUID()}`,
  }).select('id').single())
  const second = checked(await service.from('organizations').insert({
    name: 'MR5 Trial Request B', slug: `mr5i26a-b-${randomUUID()}`,
  }).select('id').single())
  orgA = first!.id
  orgB = second!.id
  orgs.push(orgA, orgB)
  checked(await service.from('organization_users').insert([
    { organization_id: orgA, user_id: ownerId, role: 'OWNER' },
    { organization_id: orgA, user_id: adminId, role: 'ADMIN' },
    { organization_id: orgA, user_id: viewerId, role: 'VIEWER' },
    { organization_id: orgB, user_id: adminId, role: 'ADMIN' },
  ]))
})

afterEach(async () => {
  if (orgs.length) checked(await service.from('organizations').delete().in('id', orgs.splice(0)))
})

afterAll(async () => {
  for (const actor of actors) checked(await service.auth.admin.deleteUser(actor.id))
})

describe('MR-5I26A disposable SQL trial extension request and authorization', () => {
  it('accepts owner request, writes minimal actor audit, never modifies entitlement', async () => {
    const before = checked(await service.from('organization_entitlements')
      .select('allocated_requests, consumed_requests, duration_days, status')
      .eq('organization_id', orgA).single())
    expect(before).toMatchObject({ allocated_requests: 30, consumed_requests: 0, duration_days: 30 })

    const { data, error } = await owner.from('trial_extension_requests').insert({
      organization_id: orgA, requested_by: ownerId, reason,
    }).select('id, status, requested_by').single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'OPEN', requested_by: ownerId })

    const audit = checked(await service.from('audit_events')
      .select('actor_type, actor_id, event_type, entity_type, entity_id, metadata')
      .eq('organization_id', orgA)
      .eq('event_type', 'trial.extension_requested')
      .eq('entity_id', data!.id).single())
    expect(audit).toMatchObject({
      actor_type: 'user', actor_id: ownerId, entity_type: 'trial_extension_request',
      metadata: { status: 'OPEN' },
    })
    expect(JSON.stringify(audit)).not.toContain(reason)
    const after = checked(await service.from('organization_entitlements')
      .select('allocated_requests, consumed_requests, duration_days, status')
      .eq('organization_id', orgA).single())
    expect(after).toEqual(before)
  })

  it('denies unauthorized roles, foreign tenants, forged actors and direct edits', async () => {
    const { error: viewerInsert } = await viewer.from('trial_extension_requests').insert({
      organization_id: orgA, requested_by: viewerId, reason,
    })
    expect(viewerInsert?.code).toBe('42501')

    const { error: foreignInsert } = await owner.from('trial_extension_requests').insert({
      organization_id: orgB, requested_by: ownerId, reason,
    })
    expect(foreignInsert?.code).toBe('42501')
    const { error: forged } = await admin.from('trial_extension_requests').insert({
      organization_id: orgA, requested_by: ownerId, reason,
    })
    expect(forged?.code).toBe('42501')
    const { error: anonymous } = await anon.from('trial_extension_requests').insert({
      organization_id: orgA, requested_by: ownerId, reason,
    })
    expect(anonymous?.code).toBe('42501')
    const { error: unrelated } = await stranger.from('trial_extension_requests').insert({
      organization_id: orgA, requested_by: ownerId, reason,
    })
    expect(unrelated?.code).toBe('42501')

    const { data } = checked(await admin.from('trial_extension_requests').insert({
      organization_id: orgA, requested_by: adminId, reason,
    }).select('id').single()) as never
    const { error: update } = await admin.from('trial_extension_requests')
      .update({ status: 'APPROVED', resolved_by: adminId, decision_reason: 'Unverified decision' })
      .eq('id', data!.id)
    expect(update?.code).toBe('42501')
    const { error: deletion } = await admin.from('trial_extension_requests').delete().eq('id', data!.id)
    expect(deletion?.code).toBe('42501')
    const { error: provision } = await owner.rpc('provision_organization_trial', {
      p_org_id: orgA, p_allocated_requests: 99999, p_duration_days: 365,
    })
    expect(provision?.code).toBe('42501')
  })

  it('enforces one OPEN request per tenant, strict input and requester-only reads', async () => {
    const first = checked(await owner.from('trial_extension_requests').insert({
      organization_id: orgA, requested_by: ownerId, reason,
    }).select('id').single())
    const { error: duplicate } = await admin.from('trial_extension_requests').insert({
      organization_id: orgA, requested_by: adminId, reason,
    })
    expect(duplicate?.code).toBe('23505')
    const own = checked(await owner.from('trial_extension_requests').select('id, reason')
      .eq('organization_id', orgA))
    expect(own).toHaveLength(1)
    expect(own![0].id).toBe(first!.id)
    const hidden = checked(await admin.from('trial_extension_requests').select('id')
      .eq('organization_id', orgA))
    expect(hidden).toEqual([])
    const { error: shortReason } = await admin.from('trial_extension_requests').insert({
      organization_id: orgB, requested_by: adminId, reason: 'short',
    })
    expect(shortReason?.code).toBe('23514')
    const { error: fakeApproval } = await admin.from('trial_extension_requests').insert({
      organization_id: orgB, requested_by: adminId, reason, status: 'APPROVED',
      resolved_at: new Date().toISOString(), resolved_by: adminId, decision_reason: 'Not actually approved',
    })
    expect(fakeApproval?.code).toBe('42501')
  })
})
