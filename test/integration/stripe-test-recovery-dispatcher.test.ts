import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../src/types/database'

vi.mock('server-only', () => ({}))
import { dispatchStripeTestRecoveryBatch } from '../../src/lib/billing/stripe-test-recovery-dispatcher'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const opts = { auth: { autoRefreshToken: false, persistSession: false } }
const admin = createClient<Database>(url, adminKey, opts)
const anon = createClient<Database>(url, anonKey, opts)
const signedIn = createClient<Database>(url, anonKey, opts)
const prefix = 'evt_Mr5c3c' + randomUUID().replaceAll('-', '')
const baseline = process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER
let ownerId = ''

function checked<T extends { data: unknown; error: unknown }>(res: T): T['data'] {
  if (res.error) throw new Error('MR-5C3C synthetic database failure', { cause: res.error })
  return res.data
}
function object(value: Json | null): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected JSON object')
  return value as Record<string, unknown>
}
async function insert(type = 'customer.created', env: 'TEST' | 'LIVE' = 'TEST') {
  const providerId = prefix + randomUUID().replaceAll('-', '')
  const row = checked(await admin.from('billing_webhook_events').insert({
    provider: 'stripe', environment: env, provider_event_id: providerId,
    event_type: type, processing_status: 'RECEIVED',
    payload_hash: 'synthetic-recovery-payload-hash',
  }).select('id').single())
  if (!row) throw new Error('Event not inserted')
  return { id: row.id, providerId, type }
}
async function change(id: string, values: Database['public']['Tables']['billing_webhook_events']['Update']) {
  checked(await admin.from('billing_webhook_events').update(values).eq('id', id))
}
async function inspection(limit = 10) {
  return object(checked(await admin.rpc('inspect_stripe_test_webhook_recovery', { p_limit: limit })))
}
async function lease(id: string) {
  return object(checked(await admin.rpc('lease_stripe_webhook_processing', { p_event_id: id })))
}
async function complete(id: string, token: string, status: 'FAILED' | 'IGNORED') {
  return object(checked(await admin.rpc('complete_stripe_webhook_processing', {
    p_event_id: id, p_lease_token: token, p_status: status,
    p_organization_id: null,
    p_error_code: status === 'FAILED' ? 'PROCESSING_FAILED' : null,
  })))
}
async function getEvent(id: string) {
  return checked(await admin.from('billing_webhook_events')
    .select('processing_status,processing_attempts,next_processing_attempt_at,error_code')
    .eq('id', id).single())
}
function retrievers(providerId: string, type: string) {
  const retrieveEvent = vi.fn(async (id: string) => ({
    id: providerId, object: 'event', livemode: false,
    type, data: { object: { id: 'acct_Synthetic', object: 'account' } },
  }))
  const retrieveSubscription = vi.fn(async (_id: string) => {
    throw new Error('Subscription lookup should never occur for unsupported event')
  })
  return { retrieveEvent, retrieveSubscription }
}

describe('MR-5C3C1 TEST recovery queue and controlled batch (disposable database)', () => {
  beforeAll(async () => {
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    expect(adminKey).toBeTruthy()

    const email = 'mr5c3c-' + randomUUID() + '@example.test'
    const password = randomUUID()
    const created = checked(await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    }))
    if (!created?.user) throw new Error('Synthetic user not created')
    ownerId = created.user.id
    checked(await signedIn.auth.signInWithPassword({ email, password }))
  }, 30000)

  afterEach(() => {
    if (baseline === undefined) delete process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER
    else process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER = baseline
    vi.clearAllMocks()
  })

  afterAll(async () => {
    checked(await admin.from('billing_webhook_events')
      .delete().like('provider_event_id', prefix + '%'))
    if (ownerId) {
      const { error } = await admin.auth.admin.deleteUser(ownerId)
      if (error) throw error
    }
  })

  it('denies queue inspection to both anonymous and signed-in users', async () => {
    for (const client of [anon, signedIn]) {
      const response = await client.rpc('inspect_stripe_test_webhook_recovery', { p_limit: 10 })
      expect(response.error).not.toBeNull()
    }
  })

  it('validates batch bounds on the database and dispatcher', async () => {
    expect(await inspection(0)).toEqual({ outcome: 'INVALID_LIMIT' })
    expect(await inspection(11)).toEqual({ outcome: 'INVALID_LIMIT' })
    process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER = 'true'
    const fake = retrievers('evt_Synthetic', 'customer.created')
    await expect(dispatchStripeTestRecoveryBatch({
      supabase: admin, ...fake, maxEvents: 11,
    })).rejects.toThrow('BILLING_RECOVERY_BATCH_LIMIT_INVALID')
  })

  it('enforces first-failure cooldown against direct privileged claims, not only dispatcher selection', async () => {
    const item = await insert()
    const claim = await lease(item.id)
    expect(claim.outcome).toBe('LEASED')
    expect(await complete(item.id, String(claim.lease_token), 'FAILED'))
      .toEqual({ outcome: 'FINALIZED', status: 'FAILED' })
    const state = await getEvent(item.id)
    expect(state?.processing_attempts).toBe(1)
    expect(Date.parse(state!.next_processing_attempt_at!)).toBeGreaterThan(Date.now() + 20000)
    expect(await lease(item.id)).toEqual({ outcome: 'NO_WORK' })
    const inventory = await inspection()
    expect((inventory.event_ids as string[])).not.toContain(item.id)
    await change(item.id, { next_processing_attempt_at: '2020-01-01T00:00:00Z' })
    expect((await inspection()).event_ids).toContain(item.id)
    const retry = await lease(item.id)
    expect(retry).toMatchObject({ outcome: 'LEASED', attempt: 2 })
    expect((await getEvent(item.id))?.next_processing_attempt_at).toBeNull()
    expect(await complete(item.id, String(retry.lease_token), 'IGNORED'))
      .toEqual({ outcome: 'FINALIZED', status: 'IGNORED' })
  })

  it('reports ready, cooling, active, exhausted and aged-out categories without customer data', async () => {
    const ready = await insert()
    const cool = await insert()
    const busy = await insert()
    const exhausted = await insert()
    const aged = await insert()
    await change(cool.id, {
      processing_status: 'FAILED',
      processing_attempts: 1,
      next_processing_attempt_at: '2099-01-01T00:00:00Z',
    })
    const busyLease = await lease(busy.id)
    expect(busyLease.outcome).toBe('LEASED')
    await change(exhausted.id, {
      processing_status: 'FAILED',
      processing_attempts: 5,
    })
    await change(aged.id, { received_at: '2020-01-01T00:00:00Z' })

    const inventory = await inspection()
    expect(inventory.outcome).toBe('READY')
    expect(inventory.event_ids).toContain(ready.id)
    for (const id of [cool.id, busy.id, exhausted.id, aged.id]) {
      expect(inventory.event_ids).not.toContain(id)
    }
    expect(inventory.summary).toMatchObject({
      ready: expect.any(Number),
      cooldown: expect.any(Number),
      in_flight: expect.any(Number),
      exhausted: expect.any(Number),
      aged_out: expect.any(Number),
    })
    const counts = inventory.summary as Record<string, number>
    for (const key of ['ready','cooldown','in_flight','exhausted','aged_out']) {
      expect(counts[key]).toBeGreaterThanOrEqual(1)
    }
    expect(JSON.stringify(inventory)).not.toContain('cus_')
    expect(await lease(aged.id)).toEqual({ outcome: 'NO_WORK' })
    expect(await lease(exhausted.id)).toEqual({ outcome: 'NO_WORK' })
  })

  it('is disabled by default and cannot query or call a provider without an explicit flag', async () => {
    delete process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER
    const fake = retrievers('evt_Missing', 'customer.created')
    const result = await dispatchStripeTestRecoveryBatch({ supabase: admin, ...fake })
    expect(result).toMatchObject({ outcome: 'DISABLED', examined: 0, inventory: null })
    expect(fake.retrieveEvent).not.toHaveBeenCalled()
  })

  it('dispatches a selected TEST Event through existing fenced worker and ignores unsupported type', async () => {
    const item = await insert()
    const fake = retrievers(item.providerId, item.type)
    process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER = 'true'
    const result = await dispatchStripeTestRecoveryBatch({
      supabase: admin, ...fake, maxEvents: 10,
    })
    expect(result.outcome).toBe('COMPLETE')
    expect(result.examined).toBeGreaterThanOrEqual(1)
    expect(result.ignored).toBeGreaterThanOrEqual(1)
    expect(fake.retrieveSubscription).not.toHaveBeenCalled()
    expect((await getEvent(item.id))?.processing_status).toBe('IGNORED')
  })
})
