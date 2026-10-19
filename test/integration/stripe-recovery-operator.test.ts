import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
import {
  runAuthorizedLocalStripeRecoveryOperation,
} from '../../src/lib/billing/stripe-recovery-operator'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const options = { auth: { autoRefreshToken: false, persistSession: false } }
const admin = createClient<Database>(url, serviceKey, options)
const providerId = 'evt_Mr5c3c2a' + randomUUID().replaceAll('-', '')
const token = 'c'.repeat(64)
let eventId = ''
const names = [
  'ENABLE_STRIPE_TEST_RECOVERY_OPERATOR',
  'ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER',
  'MPG_STRIPE_RECOVERY_TARGET',
  'MPG_STRIPE_RECOVERY_OPERATOR_TOKEN',
  'ENABLE_LIVE_BILLING',
  'VERCEL_ENV',
] as const
const initial = Object.fromEntries(names.map(k => [k, process.env[k]]))

const retrieveEvent = vi.fn(async () => ({
  id: providerId,
  object: 'event',
  livemode: false,
  type: 'customer.created',
  data: { object: { object: 'customer', id: 'cus_synthetic' } },
}))
const retrieveSubscription = vi.fn(async (_id: string) => {
  throw new Error('An ignored customer.created Event must never fetch subscription')
})

describe('MR-5C3C2A local operator against disposable PostgreSQL', () => {
  beforeAll(async () => {
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    const { data, error } = await admin.from('billing_webhook_events').insert({
      provider: 'stripe', environment: 'TEST',
      provider_event_id: providerId,
      event_type: 'customer.created',
      payload_hash: 'synthetic-operator-runbook-proof',
      processing_status: 'RECEIVED',
    }).select('id').single()
    if (error || !data) throw new Error('Synthetic operator event insertion failed')
    eventId = data.id
  })

  afterAll(async () => {
    for (const key of names) {
      const previous = initial[key]
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    }
    if (eventId) {
      const { error } = await admin.from('billing_webhook_events').delete().eq('id', eventId)
      if (error) throw new Error('Synthetic operator event cleanup failed')
    }
  })

  it('denies invalid proof before any DB write/provider call', async () => {
    process.env.ENABLE_STRIPE_TEST_RECOVERY_OPERATOR = 'true'
    process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER = 'true'
    process.env.MPG_STRIPE_RECOVERY_TARGET = 'LOCAL_SYNTHETIC'
    process.env.MPG_STRIPE_RECOVERY_OPERATOR_TOKEN = token
    process.env.ENABLE_LIVE_BILLING = 'false'
    delete process.env.VERCEL_ENV

    expect(await runAuthorizedLocalStripeRecoveryOperation({
      operatorToken: 'd'.repeat(64),
      supabase: admin, retrieveEvent, retrieveSubscription, maxEvents: 10,
    })).toEqual({ outcome: 'DENIED' })
    expect(retrieveEvent).not.toHaveBeenCalled()
    const { data, error } = await admin.from('billing_webhook_events')
      .select('processing_status,processing_attempts').eq('id', eventId).single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ processing_status: 'RECEIVED', processing_attempts: 0 })
  })

  it('allows one explicitly authorized local TEST operation with no subscription mutation', async () => {
    const report = await runAuthorizedLocalStripeRecoveryOperation({
      operatorToken: token, supabase: admin,
      retrieveEvent, retrieveSubscription, maxEvents: 10,
    })
    expect(report.outcome).toBe('COMPLETE')
    if (report.outcome !== 'COMPLETE') return
    expect(report.dispatch.ignored).toBeGreaterThanOrEqual(1)
    expect(report.signal.manualReviewRequired).toBe(false)
    expect(retrieveEvent).toHaveBeenCalledWith(providerId)
    expect(retrieveSubscription).not.toHaveBeenCalled()
    const { data, error } = await admin.from('billing_webhook_events')
      .select('processing_status,processed_at,organization_id').eq('id',eventId).single()
    expect(error).toBeNull()
    expect(data?.processing_status).toBe('IGNORED')
    expect(data?.organization_id).toBeNull()
    expect(data?.processed_at).not.toBeNull()
  })
})
