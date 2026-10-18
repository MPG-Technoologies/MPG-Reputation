import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
import { provisionStripeTestCustomer } from '../../src/lib/billing/stripe-test-customer-provisioning'
import { createStripeTestCustomerCreator } from '../../src/lib/billing/stripe-test-customer-provider'

const orgId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const reservationId = '33333333-3333-4333-8333-333333333333'
const lease = '44444444-4444-4444-8444-444444444444'
const name = 'Synthetic Garage'
const keys = [
  'ENABLE_STRIPE_TEST_CUSTOMER_PROVISIONING',
  'MPG_STRIPE_TEST_PROVISIONING_TARGET',
  'NEXT_PUBLIC_SUPABASE_URL',
  'VERCEL_ENV',
  'ENABLE_LIVE_BILLING',
  'STRIPE_SECRET_KEY',
] as const
const original = Object.fromEntries(keys.map(k => [k, process.env[k]]))

function enableLocal() {
  process.env.ENABLE_STRIPE_TEST_CUSTOMER_PROVISIONING = 'true'
  process.env.MPG_STRIPE_TEST_PROVISIONING_TARGET = 'LOCAL_SYNTHETIC'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54331'
  process.env.ENABLE_LIVE_BILLING = 'false'
  delete process.env.VERCEL_ENV
}

function fixture(options: {
  authenticated?: boolean
  allowed?: boolean
  claim?: Record<string, unknown>
  finish?: Record<string, unknown>
  customer?: { id: string; name: string | null; livemode: boolean }
} = {}) {
  const user = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: options.authenticated === false ? null : { id: userId } },
        error: null,
      })),
    },
    rpc: vi.fn(async () => ({ data: options.allowed !== false, error: null })),
  }
  const reserved = {
    outcome: 'RESERVED', reservation_id: reservationId,
    lease_token: lease, organization_name: name,
  }
  const admin = {
    rpc: vi.fn(async (fn: string) => ({
      data: fn === 'reserve_stripe_test_customer'
        ? (options.claim ?? reserved)
        : (options.finish ?? { outcome: 'LINKED' }),
      error: null,
    })),
  }
  const createCustomer = vi.fn(async () => options.customer ?? {
    id: 'cus_Mr5d3b1Synthetic', livemode: false, name,
  })
  return {
    user, admin, createCustomer,
    run: (org: unknown = orgId) => provisionStripeTestCustomer({
      userSupabase: user as unknown as SupabaseClient<Database>,
      trustedBillingSupabase: admin as unknown as SupabaseClient<Database>,
      organizationId: org, createCustomer,
    }),
  }
}

describe('MR-5D3B1 synthetic Customer provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const k of keys) delete process.env[k]
    enableLocal()
  })
  afterEach(() => {
    for (const k of keys) {
      const old = original[k]
      if (old === undefined) delete process.env[k]
      else process.env[k] = old
    }
  })
  it('refuses all calls while unset, in LIVE or hosted environment', async () => {
    const bad = [
      { ENABLE_STRIPE_TEST_CUSTOMER_PROVISIONING: 'false' },
      { MPG_STRIPE_TEST_PROVISIONING_TARGET: 'HOSTED_TEST' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' },
      { VERCEL_ENV: 'preview' },
      { ENABLE_LIVE_BILLING: 'true' },
    ]
    for (const config of bad) {
      enableLocal()
      Object.assign(process.env, config)
      const f = fixture()
      expect(await f.run()).toEqual({ outcome: 'DISABLED' })
      expect(f.user.auth.getUser).not.toHaveBeenCalled()
      expect(f.admin.rpc).not.toHaveBeenCalled()
      expect(f.createCustomer).not.toHaveBeenCalled()
    }
  })
  it('checks session, organization UUID and owner/admin role before privilege', async () => {
    for (const options of [
      { authenticated: false },
      { allowed: false },
    ]) {
      const f = fixture(options)
      expect((await f.run()).outcome).toBe('BLOCKED')
      expect(f.admin.rpc).not.toHaveBeenCalled()
    }
    const f = fixture()
    expect(await f.run('not-a-uuid')).toEqual({
      outcome: 'BLOCKED', reason: 'INVALID_ORGANIZATION',
    })
    expect(f.admin.rpc).not.toHaveBeenCalled()
  })
  it('creates with a frozen trusted name and an immutable idempotency key', async () => {
    const f = fixture()
    expect(await f.run()).toEqual({ outcome: 'READY', alreadyLinked: false })
    expect(f.createCustomer).toHaveBeenCalledExactlyOnceWith({
      name,
      idempotencyKey: 'mpg-reputation-test-customer-' + reservationId,
    })
    expect(f.admin.rpc).toHaveBeenNthCalledWith(1, 'reserve_stripe_test_customer', {
      p_user_id: userId, p_organization_id: orgId,
    })
    expect(f.admin.rpc).toHaveBeenNthCalledWith(2, 'finalize_stripe_test_customer', {
      p_user_id: userId, p_organization_id: orgId,
      p_reservation_id: reservationId, p_lease_token: lease,
      p_provider_customer_id: 'cus_Mr5d3b1Synthetic',
    })
  })
  it('returns existing mapping without creating another Stripe Customer', async () => {
    const f = fixture({ claim: { outcome: 'EXISTING' } })
    expect(await f.run()).toEqual({ outcome: 'READY', alreadyLinked: true })
    expect(f.createCustomer).not.toHaveBeenCalled()
    expect(f.admin.rpc).toHaveBeenCalledOnce()
  })
  it('does not call provider for BUSY, expired or foreign reservation', async () => {
    for (const outcome of ['BUSY', 'MANUAL_REVIEW_REQUIRED', 'NOT_AUTHORIZED', 'ORG_UNAVAILABLE']) {
      const f = fixture({ claim: { outcome } })
      const result = await f.run()
      expect(result.outcome).not.toBe('READY')
      expect(f.createCustomer).not.toHaveBeenCalled()
    }
  })
  it('never resets idempotency after timeout or network error', async () => {
    const f = fixture()
    f.createCustomer.mockRejectedValueOnce(new Error('Sensitive Stripe Error'))
    expect(await f.run()).toEqual({ outcome: 'RETRY_REQUIRED' })
    expect(f.admin.rpc).toHaveBeenCalledOnce()
  })
  it('rejects wrong customer identity, LIVE or unexpected provider name before DB write', async () => {
    for (const customer of [
      { id: 'cus_Synthetic', name, livemode: true },
      { id: 'cus_Synthetic', name: 'Another Business', livemode: false },
      { id: 'cus!unsafe', name, livemode: false },
      { id: 'cus_Synthetic', name: null, livemode: false },
    ]) {
      const f = fixture({ customer })
      expect(await f.run()).toEqual({ outcome: 'MANUAL_REVIEW_REQUIRED' })
      expect(f.admin.rpc).toHaveBeenCalledOnce()
    }
  })
  it('treats revoked finalization as manual review without a second provider call', async () => {
    const f = fixture({ finish: { outcome: 'NOT_LEASE_HOLDER' } })
    expect(await f.run()).toEqual({ outcome: 'MANUAL_REVIEW_REQUIRED' })
    expect(f.createCustomer).toHaveBeenCalledOnce()
  })
  it('rejects malformed reservation response rather than generating a new ID', async () => {
    const f = fixture({ claim: {
      outcome: 'RESERVED', reservation_id: 'new-uuid-not-allowed',
      lease_token: lease, organization_name: name,
    } })
    await expect(f.run()).rejects.toThrow('BILLING_CUSTOMER_RESERVATION_RESPONSE_INVALID')
    expect(f.createCustomer).not.toHaveBeenCalled()
  })
  it('requires an explicit TEST Stripe secret when constructing adapter', () => {
    delete process.env.STRIPE_SECRET_KEY
    expect(() => createStripeTestCustomerCreator())
      .toThrow('BILLING_CUSTOMER_TEST_PROVIDER_DISABLED')
    process.env.STRIPE_SECRET_KEY = ['sk','live','UnusableSyntheticKey'].join('_')
    expect(() => createStripeTestCustomerCreator())
      .toThrow('BILLING_CUSTOMER_TEST_PROVIDER_DISABLED')
    process.env.STRIPE_SECRET_KEY = 'pk_test_PublishableNotSecret'
    expect(() => createStripeTestCustomerCreator())
      .toThrow('BILLING_CUSTOMER_TEST_PROVIDER_DISABLED')
  })
})
