import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../src/types/database'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const options = { auth: { autoRefreshToken: false, persistSession: false } }

const admin = createClient<Database>(url, serviceKey, options)
const anon = createClient<Database>(url, anonKey, options)
const owner = createClient<Database>(url, anonKey, options)

let organizationId = ''
let ownerUserId = ''
const prefix = 'evt_Mr5c3a' + randomUUID().replaceAll('-', '')

function checked<T extends { data: unknown; error: unknown }>(result: T): NonNullable<T['data']> {
  if (result.error || result.data === null) {
    throw new Error('Synthetic MR-5C3A local database verification failed', { cause: result.error })
  }
  return result.data as NonNullable<T['data']>
}

function result(value: Json): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected JSON RPC result object')
  }
  return value as Record<string, unknown>
}

async function newEvent(options?: { live?: boolean; type?: string }) {
  const record = checked(await admin.from('billing_webhook_events').insert({
    provider: 'stripe',
    environment: options?.live ? 'LIVE' : 'TEST',
    provider_event_id: prefix + randomUUID().replaceAll('-', ''),
    event_type: options?.type ?? 'customer.subscription.updated',
    processing_status: 'RECEIVED',
    payload_hash: 'synthetic-verified-signature-payload-sha256-hash',
  }).select('id').single())
  return record.id
}

async function lease(id: string) {
  return result(checked(await admin.rpc('lease_stripe_webhook_processing', { p_event_id: id })))
}

async function complete(
  id: string, token: string, status: 'PROCESSED' | 'IGNORED' | 'FAILED',
  organization: string | null = null, code: string | null = null
) {
  return result(checked(await admin.rpc('complete_stripe_webhook_processing', {
    p_event_id: id,
    p_lease_token: token,
    p_status: status,
    p_organization_id: organization,
    p_error_code: code,
  })))
}

async function row(id: string) {
  return checked(await admin.from('billing_webhook_events')
    .select('provider_event_id,environment,processing_status,processing_attempts,processing_lease_token,processing_lease_expires_at,processed_at,error_code,organization_id')
    .eq('id', id).single())
}

describe('MR-5C3A atomic TEST-only webhook claim/lease/finalization', () => {
  beforeAll(async () => {
    // Under NO circumstances may this test touch hosted or customer data.
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    expect(serviceKey).toBeTruthy()

    const slug = 'mr5c3a-' + randomUUID()
    organizationId = checked(await admin.from('organizations')
      .insert({ name: 'MR5C3A synthetic billing org', slug })
      .select('id').single()).id

    const email = 'mr5c3a-' + randomUUID() + '@example.test'
    const password = randomUUID()
    const userData = checked(await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    }))
    if (!userData.user) throw new Error('Synthetic owner user not created')
    ownerUserId = userData.user.id
    checked(await admin.from('organization_users').insert({
      organization_id: organizationId,
      user_id: ownerUserId,
      role: 'OWNER',
    }))
    checked(await owner.auth.signInWithPassword({ email, password }))
  }, 30000)

  afterAll(async () => {
    checked(await admin.from('billing_webhook_events')
      .delete().like('provider_event_id', prefix + '%').select('id'))
    if (organizationId) {
      checked(await admin.from('organizations').delete()
        .eq('id', organizationId).select('id'))
    }
    if (ownerUserId) {
      const deleted = await admin.auth.admin.deleteUser(ownerUserId)
      if (deleted.error) throw deleted.error
    }
  })

  it('grants a lease only to one of five concurrent claims', async () => {
    const id = await newEvent()
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => lease(id)))
    const winners = outcomes.filter(x => x.outcome === 'LEASED')
    expect(winners).toHaveLength(1)
    expect(outcomes.filter(x => x.outcome === 'NO_WORK')).toHaveLength(4)
    const winner = winners[0]
    expect(winner.environment).toBe('TEST')
    expect(winner.attempt).toBe(1)
    expect(winner.event_type).toBe('customer.subscription.updated')
    expect(winner.provider_event_id).toBe((await row(id)).provider_event_id)
    expect(await row(id)).toMatchObject({
      processing_status: 'PROCESSING',
      processing_attempts: 1,
      processing_lease_token: winner.lease_token,
    })
  })

  it('finishes processed events with a matching current token and tenant', async () => {
    const id = await newEvent()
    const ownerLease = await lease(id)
    expect(ownerLease.outcome).toBe('LEASED')
    const token = String(ownerLease.lease_token)
    expect(await complete(id, token, 'PROCESSED', organizationId)).toEqual({
      outcome: 'FINALIZED', status: 'PROCESSED',
    })
    const stored = await row(id)
    expect(stored).toMatchObject({
      processing_status: 'PROCESSED',
      processing_attempts: 1,
      processing_lease_token: null,
      processing_lease_expires_at: null,
      error_code: null,
      organization_id: organizationId,
    })
    expect(stored.processed_at).not.toBeNull()
    expect(await complete(id, token, 'PROCESSED', organizationId)).toEqual({
      outcome: 'NOT_LEASE_HOLDER',
    })
    expect(await lease(id)).toEqual({ outcome: 'NO_WORK' })
  })

  it('handles ignored unsupported-event types without inventing organization linkage', async () => {
    const id = await newEvent({ type: 'unhandled.event' })
    const ownerLease = await lease(id)
    expect(await complete(id, String(ownerLease.lease_token), 'IGNORED')).toEqual({
      outcome: 'FINALIZED', status: 'IGNORED',
    })
    expect(await row(id)).toMatchObject({
      processing_status: 'IGNORED', organization_id: null, error_code: null,
    })
    expect(await lease(id)).toEqual({ outcome: 'NO_WORK' })
  })

  it('records only a bounded sanitized failure code; can retry same durable event', async () => {
    const id = await newEvent()
    const first = await lease(id)
    expect(await complete(id, String(first.lease_token), 'FAILED', null, 'PROVIDER_UNAVAILABLE'))
      .toEqual({ outcome: 'FINALIZED', status: 'FAILED' })
    expect(await row(id)).toMatchObject({
      processing_status: 'FAILED', error_code: 'PROVIDER_UNAVAILABLE', processed_at: null,
    })
    const retry = await lease(id)
    expect(retry.outcome).toBe('LEASED')
    expect(retry.attempt).toBe(2)
    expect((await row(id)).error_code).toBeNull()
    expect(await complete(id, String(retry.lease_token), 'IGNORED'))
      .toEqual({ outcome: 'FINALIZED', status: 'IGNORED' })
  })

  it('prevents expired/superseded workers from finalizing after another claim', async () => {
    const id = await newEvent()
    const first = await lease(id)
    const staleToken = String(first.lease_token)
    checked(await admin.from('billing_webhook_events')
      .update({ processing_lease_expires_at: '2020-01-01T00:00:00Z' })
      .eq('id', id).select('id'))
    const current = await lease(id)
    expect(current.outcome).toBe('LEASED')
    expect(current.lease_token).not.toBe(staleToken)
    expect(current.attempt).toBe(2)
    expect(await complete(id, staleToken, 'PROCESSED', organizationId)).toEqual({
      outcome: 'NOT_LEASE_HOLDER',
    })
    expect((await row(id)).processing_status).toBe('PROCESSING')
    expect(await complete(id, String(current.lease_token), 'PROCESSED', organizationId))
      .toEqual({ outcome: 'FINALIZED', status: 'PROCESSED' })
  })

  it('prevents completion after an expired lease even before it is reclaimed', async () => {
    const id = await newEvent()
    const first = await lease(id)
    checked(await admin.from('billing_webhook_events')
      .update({ processing_lease_expires_at: '2020-01-01T00:00:00Z' })
      .eq('id', id).select('id'))
    expect(await complete(id, String(first.lease_token), 'PROCESSED', organizationId))
      .toEqual({ outcome: 'NOT_LEASE_HOLDER' })
  })

  it('stops automatic retries after five leases', async () => {
    const id = await newEvent()
    for (let attempt = 1; attempt <= 5; attempt++) {
      const acquired = await lease(id)
      expect(acquired.outcome).toBe('LEASED')
      expect(acquired.attempt).toBe(attempt)
      expect(await complete(id, String(acquired.lease_token), 'FAILED', null, 'PROCESSING_FAILED'))
        .toEqual({ outcome: 'FINALIZED', status: 'FAILED' })
    }
    expect(await lease(id)).toEqual({ outcome: 'NO_WORK' })
    expect(await row(id)).toMatchObject({
      processing_status: 'FAILED', processing_attempts: 5,
    })
  })

  it('rejects a random lease token without changing event state', async () => {
    const id = await newEvent()
    const acquired = await lease(id)
    expect(await complete(id, randomUUID(), 'PROCESSED', organizationId)).toEqual({
      outcome: 'NOT_LEASE_HOLDER',
    })
    expect(await row(id)).toMatchObject({
      processing_lease_token: acquired.lease_token, processing_status: 'PROCESSING',
    })
  })

  it('rejects caller-supplied raw provider errors or contradictory finalization', async () => {
    const id = await newEvent()
    const acquired = await lease(id)
    const token = String(acquired.lease_token)
    for (const [status, org, code] of [
      ['FAILED', null, 'private card details from provider'],
      ['PROCESSED', null, null],
      ['PROCESSED', organizationId, 'PROCESSING_FAILED'],
      ['IGNORED', organizationId, null],
    ] as const) {
      expect(await complete(id, token, status, org, code)).toEqual({
        outcome: 'INVALID_RESULT',
      })
    }
    expect((await row(id)).processing_status).toBe('PROCESSING')
  })

  it('never processes LIVE events, even with privileged service-role credentials', async () => {
    const id = await newEvent({ live: true })
    expect(await lease(id)).toEqual({ outcome: 'NO_WORK' })
    expect(await row(id)).toMatchObject({
      environment: 'LIVE', processing_status: 'RECEIVED', processing_attempts: 0,
    })
  })

  it('rejects all webhook processing RPCs from anonymous and signed-in business OWNER', async () => {
    const id = await newEvent()
    const uuid = randomUUID()
    for (const client of [anon, owner]) {
      const claim = await client.rpc('lease_stripe_webhook_processing', { p_event_id: id })
      expect(claim.error).not.toBeNull()
      const finish = await client.rpc('complete_stripe_webhook_processing', {
        p_event_id: id,
        p_lease_token: uuid,
        p_status: 'PROCESSED',
        p_organization_id: organizationId,
        p_error_code: null,
      })
      expect(finish.error).not.toBeNull()
    }
    expect(await row(id)).toMatchObject({
      processing_status: 'RECEIVED', processing_attempts: 0,
    })
  })
})
