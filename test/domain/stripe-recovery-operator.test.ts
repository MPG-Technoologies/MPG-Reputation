import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import type { StripeTestRecoveryDispatchReport } from '../../src/lib/billing/stripe-test-recovery-dispatcher'

vi.mock('server-only', () => ({}))
vi.mock('../../src/lib/billing/stripe-test-recovery-dispatcher', () => ({
  dispatchStripeTestRecoveryBatch: vi.fn(),
}))
import {
  runAuthorizedLocalStripeRecoveryOperation,
  deriveStripeRecoveryOperatorSignal,
} from '../../src/lib/billing/stripe-recovery-operator'
import {
  dispatchStripeTestRecoveryBatch,
} from '../../src/lib/billing/stripe-test-recovery-dispatcher'

const token = 'a'.repeat(64)
const mockDispatch = vi.mocked(dispatchStripeTestRecoveryBatch)
const envKeys = [
  'ENABLE_STRIPE_TEST_RECOVERY_OPERATOR',
  'ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER',
  'MPG_STRIPE_RECOVERY_TARGET',
  'MPG_STRIPE_RECOVERY_OPERATOR_TOKEN',
  'NEXT_PUBLIC_SUPABASE_URL',
  'ENABLE_LIVE_BILLING',
  'VERCEL_ENV',
] as const
const initial = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
const supabase = {} as SupabaseClient<Database>
const retrieveEvent = vi.fn(async () => { throw new Error('Should never contact provider') })
const retrieveSubscription = vi.fn(async () => { throw new Error('Should never contact provider') })

function enableLocalTest() {
  process.env.ENABLE_STRIPE_TEST_RECOVERY_OPERATOR = 'true'
  process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER = 'true'
  process.env.MPG_STRIPE_RECOVERY_TARGET = 'LOCAL_SYNTHETIC'
  process.env.MPG_STRIPE_RECOVERY_OPERATOR_TOKEN = token
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54331'
  process.env.ENABLE_LIVE_BILLING = 'false'
  delete process.env.VERCEL_ENV
}

function report(overrides: Partial<StripeTestRecoveryDispatchReport> = {}): StripeTestRecoveryDispatchReport {
  return {
    outcome: 'COMPLETE',
    examined: 1,
    committed: 0,
    ignored: 1,
    failed: 0,
    deferred: 0,
    lostLease: 0,
    errors: 0,
    inventory: { ready: 1, cooldown: 0, in_flight: 0, exhausted: 0, aged_out: 0 },
    ...overrides,
  }
}
async function run(proof = token) {
  return runAuthorizedLocalStripeRecoveryOperation({
    operatorToken: proof,
    supabase,
    retrieveEvent,
    retrieveSubscription,
    maxEvents: 5,
  })
}

describe('MR-5C3C2A sealed TEST recovery operator', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    for (const key of envKeys) delete process.env[key]
  })
  afterEach(() => {
    for (const key of envKeys) {
      const v = initial[key]
      if (v === undefined) delete process.env[key]
      else process.env[key] = v
    }
  })

  it('does not invoke dispatcher or providers by default', async () => {
    expect(await run()).toEqual({ outcome: 'DISABLED' })
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(retrieveEvent).not.toHaveBeenCalled()
  })

  it('denies incorrect credentials without touching privileged data', async () => {
    enableLocalTest()
    expect(await run('b'.repeat(64))).toEqual({ outcome: 'DENIED' })
    expect(await run('not-a-proof')).toEqual({ outcome: 'DENIED' })
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(retrieveSubscription).not.toHaveBeenCalled()
  })

  it('refuses weak or missing configured operator secret', async () => {
    enableLocalTest()
    process.env.MPG_STRIPE_RECOVERY_OPERATOR_TOKEN = 'short'
    expect(await run()).toEqual({ outcome: 'DISABLED' })
    delete process.env.MPG_STRIPE_RECOVERY_OPERATOR_TOKEN
    expect(await run()).toEqual({ outcome: 'DISABLED' })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('blocks hosted URL, production deployment, live flag and wrong target', async () => {
    enableLocalTest()
    const forbidden = [
      { NEXT_PUBLIC_SUPABASE_URL: 'https://some-remote-project.supabase.co' },
      { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' },
      { VERCEL_ENV: 'production' },
      { VERCEL_ENV: 'preview' },
      { MPG_STRIPE_RECOVERY_TARGET: 'HOSTED_TEST' },
      { ENABLE_LIVE_BILLING: 'true' },
      { ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER: 'false' },
    ]
    for (const variant of forbidden) {
      enableLocalTest()
      Object.assign(process.env, variant)
      expect(await run()).toEqual({ outcome: 'DISABLED' })
    }
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('allows a bounded explicitly authorized synthetic-only call', async () => {
    enableLocalTest()
    mockDispatch.mockResolvedValue(report())
    expect(await run()).toEqual({
      outcome: 'COMPLETE',
      dispatch: report(),
      signal: { status: 'HEALTHY', manualReviewRequired: false, reasons: [] },
    })
    expect(mockDispatch).toHaveBeenCalledExactlyOnceWith({
      supabase,
      retrieveEvent,
      retrieveSubscription,
      maxEvents: 5,
    })
  })

  it('treats exhausted and aged-out events as human-review actions', () => {
    const result = deriveStripeRecoveryOperatorSignal(report({
      inventory: { ready: 1, cooldown: 1, in_flight: 0, exhausted: 2, aged_out: 1 },
    }))
    expect(result).toEqual({
      status: 'MANUAL_REVIEW_REQUIRED',
      manualReviewRequired: true,
      reasons: ['EXHAUSTED_EVENTS', 'AGED_OUT_EVENTS', 'RETRY_BACKLOG'],
    })
  })

  it('distinguishes provider retry backlog from serious processing errors', () => {
    expect(deriveStripeRecoveryOperatorSignal(report({
      failed: 1,
      inventory: { ready: 5, cooldown: 2, in_flight: 0, exhausted: 0, aged_out: 0 },
    }))).toEqual({
      status: 'ATTENTION',
      manualReviewRequired: false,
      reasons: ['FAILED_EVENTS', 'RETRY_BACKLOG'],
    })

    expect(deriveStripeRecoveryOperatorSignal(report({ errors: 2 }))).toEqual({
      status: 'MANUAL_REVIEW_REQUIRED',
      manualReviewRequired: true,
      reasons: ['PROCESSING_ERRORS'],
    })
  })

  it('never pretends a disabled underlying dispatcher ran', async () => {
    enableLocalTest()
    mockDispatch.mockResolvedValue(report({ outcome: 'DISABLED', inventory: null }))
    expect(await run()).toEqual({ outcome: 'DISABLED' })
  })

  it('propagates sanitized worker failure without exposing credentials', async () => {
    enableLocalTest()
    mockDispatch.mockRejectedValue(new Error('BILLING_RECOVERY_INVENTORY_READ_FAILED'))
    await expect(run()).rejects.toThrow('BILLING_RECOVERY_INVENTORY_READ_FAILED')
    expect(mockDispatch).toHaveBeenCalledOnce()
  })
})
