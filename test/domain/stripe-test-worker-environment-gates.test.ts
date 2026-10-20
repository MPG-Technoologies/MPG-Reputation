import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))

import { dispatchStripeTestRecoveryBatch } from '../../src/lib/billing/stripe-test-recovery-dispatcher'
import { processDurableStripeTestEvent } from '../../src/lib/billing/stripe-test-reconciliation-worker'

const names = [
  'ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER',
  'NEXT_PUBLIC_SUPABASE_URL',
  'ENABLE_LIVE_BILLING',
  'VERCEL_ENV',
] as const
const original = Object.fromEntries(names.map(name => [name, process.env[name]]))

function localTest() {
  process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER = 'true'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54331'
  process.env.ENABLE_LIVE_BILLING = 'false'
  delete process.env.VERCEL_ENV
}

function fixture() {
  const rpc = vi.fn(async () => ({ data: { outcome: 'NO_WORK' }, error: null }))
  const retrieveEvent = vi.fn(async () => {
    throw new Error('TEST provider must not be called by a denied worker')
  })
  const retrieveSubscription = vi.fn(async () => {
    throw new Error('TEST provider subscription must not be called by a denied worker')
  })
  const supabase = { rpc } as unknown as SupabaseClient<Database>
  const dispatch = () => dispatchStripeTestRecoveryBatch({
    supabase, retrieveEvent, retrieveSubscription,
  })
  const process = () => processDurableStripeTestEvent({
    supabase,
    eventRecordId: '11111111-1111-4111-8111-111111111111',
    retrieveEvent,
    retrieveSubscription,
  })
  return { rpc, retrieveEvent, retrieveSubscription, dispatch, process }
}

describe('Standalone TEST billing recovery entry points cannot escape local mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'test')
    localTest()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    for (const name of names) {
      const value = original[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it.each([
    ['hosted database', { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' }],
    ['different local port', { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }],
    ['LIVE billing', { ENABLE_LIVE_BILLING: 'true' }],
    ['preview deployment', { VERCEL_ENV: 'preview' }],
    ['production runtime', { NODE_ENV: 'production' }],
  ])('blocks both direct billing workers with %s', async (_reason, patch) => {
    Object.assign(process.env, patch)
    const f = fixture()
    expect((await f.dispatch()).outcome).toBe('DISABLED')
    expect(await f.process()).toEqual({ outcome: 'DISABLED' })
    expect(f.rpc).not.toHaveBeenCalled()
    expect(f.retrieveEvent).not.toHaveBeenCalled()
    expect(f.retrieveSubscription).not.toHaveBeenCalled()
  })

  it('requires the dispatcher switch, without silently enabling it through worker access', async () => {
    delete process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER
    const f = fixture()
    expect((await f.dispatch()).outcome).toBe('DISABLED')
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it('keeps the approved disposable local worker path functional', async () => {
    const f = fixture()
    expect(await f.process()).toEqual({ outcome: 'NO_WORK' })
    expect(f.rpc).toHaveBeenCalledOnce()
    expect(f.rpc).toHaveBeenCalledWith('lease_stripe_webhook_processing', {
      p_event_id: '11111111-1111-4111-8111-111111111111',
    })
  })
})
