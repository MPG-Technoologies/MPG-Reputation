import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../src/types/database'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const opts = { auth: { autoRefreshToken: false, persistSession: false } }
const admin = createClient<Database>(url, adminKey, opts)
const anon = createClient<Database>(url, anonKey, opts)
const member = createClient<Database>(url, anonKey, opts)
const viewer = createClient<Database>(url, anonKey, opts)
const slug = randomUUID().replaceAll('-', '')
let ownerUserId = ''
let viewerUserId = ''
const orgIds: string[] = []

function checked<T extends { data: unknown; error: unknown }>(x: T): NonNullable<T['data']> {
  if (x.error || x.data === null) throw new Error('Synthetic DB operation failed', { cause: x.error })
  return x.data as NonNullable<T['data']>
}
function object(raw: Json | null): Record<string, unknown> {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('Invalid RPC JSON')
  return raw as Record<string, unknown>
}
async function newOrg() {
  const id = checked(await admin.from('organizations').insert({
    name: 'MR5D3B1 Garage ' + randomUUID(),
    slug: 'mr5d3b1-' + randomUUID().replaceAll('-', ''),
  }).select('id').single()).id
  orgIds.push(id)
  checked(await admin.from('organization_users').insert([
    { organization_id: id, user_id: ownerUserId, role: 'OWNER' },
    { organization_id: id, user_id: viewerUserId, role: 'VIEWER' },
  ]).select('id'))
  return id
}
async function reserve(orgId: string, userId = ownerUserId) {
  return object(checked(await admin.rpc('reserve_stripe_test_customer', {
    p_user_id: userId,
    p_organization_id: orgId,
  })))
}
async function finish(
  orgId: string,
  claim: Record<string, unknown>,
  customer = 'cus_Mr5d3b1' + randomUUID().replaceAll('-', ''),
  userId = ownerUserId
) {
  return object(checked(await admin.rpc('finalize_stripe_test_customer', {
    p_user_id: userId,
    p_organization_id: orgId,
    p_reservation_id: String(claim.reservation_id),
    p_lease_token: String(claim.lease_token),
    p_provider_customer_id: customer,
  })))
}

describe('MR-5D3B1 fenced Customer provisioning in disposable PostgreSQL', () => {
  beforeAll(async () => {
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    const ownerPass = randomUUID()
    const viewerPass = randomUUID()
    const createdOwner = checked(await admin.auth.admin.createUser({
      email: 'mr5d3b1-owner-' + slug + '@example.test',
      password: ownerPass, email_confirm: true,
    }))
    const createdViewer = checked(await admin.auth.admin.createUser({
      email: 'mr5d3b1-viewer-' + slug + '@example.test',
      password: viewerPass, email_confirm: true,
    }))
    if (!createdOwner.user || !createdViewer.user) throw new Error('Users missing')
    ownerUserId = createdOwner.user.id
    viewerUserId = createdViewer.user.id
    checked(await member.auth.signInWithPassword({
      email: 'mr5d3b1-owner-' + slug + '@example.test', password: ownerPass,
    }))
    checked(await viewer.auth.signInWithPassword({
      email: 'mr5d3b1-viewer-' + slug + '@example.test', password: viewerPass,
    }))
  }, 30000)
  afterAll(async () => {
    for (const id of orgIds) {
      const { error } = await admin.from('organizations').delete().eq('id', id)
      if (error) throw error
    }
    for (const id of [ownerUserId, viewerUserId]) {
      if (id) {
        const { error } = await admin.auth.admin.deleteUser(id)
        if (error) throw error
      }
    }
  })
  it('service-only RPCs deny anonymous and ordinary authenticated users', async () => {
    const orgId = await newOrg()
    for (const client of [anon, member, viewer]) {
      expect((await client.rpc('reserve_stripe_test_customer', {
        p_user_id: ownerUserId, p_organization_id: orgId,
      })).error).not.toBeNull()
      expect((await client.rpc('finalize_stripe_test_customer', {
        p_user_id: ownerUserId, p_organization_id: orgId,
        p_reservation_id: randomUUID(), p_lease_token: randomUUID(),
        p_provider_customer_id: 'cus_Mr5d3b1Synthetic',
      })).error).not.toBeNull()
    }
  })
  it('refuses VIEWER, unrelated owner, unknown organization before provisioning', async () => {
    const orgId = await newOrg()
    expect(await reserve(orgId, viewerUserId)).toEqual({ outcome: 'NOT_AUTHORIZED' })
    expect(await reserve(orgId, randomUUID())).toEqual({ outcome: 'NOT_AUTHORIZED' })
    expect(await reserve(randomUUID())).toEqual({ outcome: 'NOT_AUTHORIZED' })
    const rows = checked(await admin.from('stripe_test_customer_provisioning')
      .select('id').eq('organization_id', orgId))
    expect(rows).toHaveLength(0)
  })
  it('serializes concurrent attempts for an organization and freezes its name', async () => {
    const orgId = await newOrg()
    const results = await Promise.all(Array.from({ length: 5 }, () => reserve(orgId)))
    const winner = results.filter(x => x.outcome === 'RESERVED')
    expect(winner).toHaveLength(1)
    expect(results.filter(x => x.outcome === 'BUSY')).toHaveLength(4)
    expect(winner[0].organization_name).toMatch(/^MR5D3B1 Garage /)
    const db = checked(await admin.from('stripe_test_customer_provisioning')
      .select('id,organization_name,state,environment').eq('organization_id', orgId).single())
    expect(db).toMatchObject({
      id: winner[0].reservation_id, state: 'PREPARING', environment: 'TEST',
    })
  })
  it('same reservation ID survives lease expiry; old token never finalizes', async () => {
    const orgId = await newOrg()
    const first = await reserve(orgId)
    checked(await admin.from('stripe_test_customer_provisioning')
      .update({ lease_expires_at: '2020-01-01T00:00:00Z' })
      .eq('organization_id', orgId).select('id'))
    const again = await reserve(orgId)
    expect(again.outcome).toBe('RESERVED')
    expect(again.reservation_id).toBe(first.reservation_id)
    expect(again.lease_token).not.toBe(first.lease_token)
    expect(again.organization_name).toBe(first.organization_name)
    expect(await finish(orgId, first)).toEqual({ outcome: 'NOT_LEASE_HOLDER' })
    expect(await finish(orgId, again)).toEqual({ outcome: 'LINKED' })
    expect(await reserve(orgId)).toEqual({ outcome: 'EXISTING' })
  })
  it('validates customer identity, actor and tenant before writing account mapping', async () => {
    const orgId = await newOrg()
    const reservation = await reserve(orgId)
    expect(await finish(orgId, reservation, 'cus_live?')).toEqual({ outcome: 'INVALID_INPUT' })
    expect(await finish(orgId, reservation, 'cus_Synthetic', viewerUserId))
      .toEqual({ outcome: 'NOT_AUTHORIZED' })
    expect(await finish(randomUUID(), reservation)).toEqual({ outcome: 'NOT_AUTHORIZED' })
    expect(await finish(orgId, reservation, 'cus_Synthetic')).toEqual({ outcome: 'LINKED' })
    const account = checked(await admin.from('organization_billing_accounts')
      .select('organization_id,environment,provider_customer_id')
      .eq('organization_id', orgId).single())
    expect(account).toEqual({
      organization_id: orgId, environment: 'TEST', provider_customer_id: 'cus_Synthetic',
    })
    expect(await finish(orgId, reservation, 'cus_Different'))
      .toEqual({ outcome: 'NOT_LEASE_HOLDER' })
  })
  it('blocks a provider customer from being mapped to a different organization', async () => {
    const firstOrg = await newOrg()
    const secondOrg = await newOrg()
    const a = await reserve(firstOrg)
    const b = await reserve(secondOrg)
    const sharedCustomer = 'cus_Unique' + randomUUID().replaceAll('-', '')
    expect(await finish(firstOrg, a, sharedCustomer)).toEqual({ outcome: 'LINKED' })
    expect(await finish(secondOrg, b, sharedCustomer))
      .toEqual({ outcome: 'CUSTOMER_CONFLICT' })
    const { data, error } = await admin.from('organization_billing_accounts')
      .select('id').eq('organization_id', secondOrg)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })
  it('an existing TEST account cannot be overwritten by a new Customer attempt', async () => {
    const orgId = await newOrg()
    const existing = 'cus_Old' + randomUUID().replaceAll('-', '')
    checked(await admin.from('organization_billing_accounts').insert({
      organization_id: orgId, provider: 'stripe', environment: 'TEST',
      provider_customer_id: existing,
    }).select('id'))
    expect(await reserve(orgId)).toEqual({ outcome: 'EXISTING' })
  })
  it('abandoned attempts older than ten minutes require manual reconciliation', async () => {
    const orgId = await newOrg()
    const first = await reserve(orgId)
    checked(await admin.from('stripe_test_customer_provisioning').update({
      created_at: '2020-01-01T00:00:00Z',
      lease_expires_at: '2020-01-01T00:00:00Z',
    }).eq('organization_id', orgId).select('id'))
    expect(await reserve(orgId)).toEqual({ outcome: 'MANUAL_REVIEW_REQUIRED' })
    expect(await finish(orgId, first)).toEqual({ outcome: 'NOT_LEASE_HOLDER' })
  })
  it('provisioning table remains private under RLS even to tenant OWNER', async () => {
    const orgId = await newOrg()
    await reserve(orgId)
    const [{ data: ownerRows, error: ownerError }, { data: viewerRows, error: viewerError }] =
      await Promise.all([
        member.from('stripe_test_customer_provisioning').select('id').eq('organization_id', orgId),
        viewer.from('stripe_test_customer_provisioning').select('id').eq('organization_id', orgId),
      ])
    expect(ownerError).not.toBeNull()
    expect(viewerError).not.toBeNull()
    expect(ownerRows ?? []).toHaveLength(0)
    expect(viewerRows ?? []).toHaveLength(0)
  })
})
