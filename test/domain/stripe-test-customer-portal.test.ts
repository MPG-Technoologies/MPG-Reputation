import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))

import {
  isSafeStripeTestPortalUrl,
  prepareStripeTestPortalSession,
  type StripeTestPortalConfiguration,
} from '../../src/lib/billing/stripe-test-customer-portal'
import { createStripeTestPortalProvider } from '../../src/lib/billing/stripe-test-portal-provider'

const orgId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const customerId = 'cus_TrustedTestOrg'
const configurationId = 'bpc_ReviewedTest'
const portalUrl = 'https://billing.stripe.com/p/session/test_SyntheticPortal'
const names = [
  'ENABLE_STRIPE_TEST_PORTAL',
  'MPG_STRIPE_TEST_PORTAL_TARGET',
  'ENABLE_LIVE_BILLING',
  'VERCEL_ENV',
  'NEXT_PUBLIC_SUPABASE_URL',
  'MPG_BILLING_CHECKOUT_RETURN_ORIGIN',
  'STRIPE_TEST_PORTAL_CONFIGURATION_ID',
  'STRIPE_SECRET_KEY',
] as const
const old = Object.fromEntries(names.map(name => [name, process.env[name]]))

function enableTest() {
  process.env.ENABLE_STRIPE_TEST_PORTAL = 'true'
  process.env.MPG_STRIPE_TEST_PORTAL_TARGET = 'LOCAL_SYNTHETIC'
  process.env.ENABLE_LIVE_BILLING = 'false'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54331'
  process.env.MPG_BILLING_CHECKOUT_RETURN_ORIGIN = 'http://localhost:3000'
  process.env.STRIPE_TEST_PORTAL_CONFIGURATION_ID = configurationId
  delete process.env.VERCEL_ENV
}

function configuration(overrides: Partial<StripeTestPortalConfiguration> = {}):
  StripeTestPortalConfiguration {
  return {
    id: configurationId, livemode: false, active: true,
    loginPageEnabled: false,
    features: {
      invoiceHistoryEnabled: true,
      paymentMethodUpdateEnabled: true,
      subscriptionUpdateEnabled: false,
      subscriptionCancelEnabled: false,
      customerUpdateEnabled: false,
    },
    ...overrides,
  }
}
function fixture(opts: {
  authenticated?: boolean
  role?: boolean
  account?: { provider_customer_id: string } | null
  dbError?: boolean
} = {}) {
  const queries: Array<[string, unknown]> = []
  const userSupabase = {
    auth: { getUser: vi.fn(async () => ({
      data: { user: opts.authenticated === false ? null : { id: userId } },
      error: null,
    })) },
    rpc: vi.fn(async () => ({ data: opts.role !== false, error: null })),
    from: vi.fn((_table: string) => ({
      select() { return this },
      eq(name: string, value: unknown) { queries.push([name,value]); return this },
      async maybeSingle() {
        return {
          data: opts.account === undefined ? { provider_customer_id: customerId } : opts.account,
          error: opts.dbError ? { message: 'internal read failure' } : null,
        }
      },
    })),
  }
  const retrieveConfiguration = vi.fn(async () => configuration())
  const createSession = vi.fn(async () => ({
    id: 'bps_SyntheticTEST',
    livemode: false, customer: customerId,
    configuration: configurationId, returnUrl: 'http://localhost:3000/app/settings/billing',
    url: portalUrl,
  }))
  const run = (organizationId: unknown = orgId) => prepareStripeTestPortalSession({
    userSupabase: userSupabase as unknown as SupabaseClient<Database>,
    organizationId, retrieveConfiguration, createSession,
  })
  return { userSupabase, retrieveConfiguration, createSession, queries, run }
}

describe('MR-5D3B2 safe TEST Customer Portal preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const name of names) delete process.env[name]
    enableTest()
  })
  afterEach(() => {
    for (const name of names) {
      if (old[name] === undefined) delete process.env[name]
      else process.env[name] = old[name]
    }
  })
  it('is disabled by default or whenever environment is hosted or LIVE', async () => {
    for (const values of [
      { ENABLE_STRIPE_TEST_PORTAL: 'false' },
      { MPG_STRIPE_TEST_PORTAL_TARGET: 'HOSTED_TEST' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' },
      { VERCEL_ENV: 'preview' },
      { ENABLE_LIVE_BILLING: 'true' },
    ]) {
      enableTest()
      Object.assign(process.env, values)
      const f = fixture()
      expect(await f.run()).toEqual({ outcome: 'DISABLED' })
      expect(f.userSupabase.auth.getUser).not.toHaveBeenCalled()
      expect(f.createSession).not.toHaveBeenCalled()
    }
  })
  it('authenticates before any privileged provider call or account lookup', async () => {
    const f = fixture({ authenticated: false })
    expect(await f.run()).toEqual({ outcome: 'BLOCKED', reason: 'NOT_AUTHENTICATED' })
    expect(f.userSupabase.from).not.toHaveBeenCalled()
    expect(f.retrieveConfiguration).not.toHaveBeenCalled()
  })
  it('rejects a signed-in Supabase anonymous identity before portal/account lookup', async () => {
    const f=fixture()
    vi.mocked(f.userSupabase.auth.getUser).mockResolvedValueOnce({
      data:{user:{id:userId,is_anonymous:true}},error:null,
    } as never)
    expect(await f.run()).toEqual({outcome:'BLOCKED',reason:'NOT_AUTHENTICATED'})
    expect(f.userSupabase.rpc).not.toHaveBeenCalled()
    expect(f.userSupabase.from).not.toHaveBeenCalled()
    expect(f.retrieveConfiguration).not.toHaveBeenCalled()
    expect(f.createSession).not.toHaveBeenCalled()
  })
  it('rejects malformed organization and non-owner access before account read', async () => {
    const f = fixture({ role: false })
    expect(await f.run()).toEqual({ outcome: 'BLOCKED', reason: 'NOT_AUTHORIZED' })
    expect(f.userSupabase.from).not.toHaveBeenCalled()
    const another = fixture()
    expect(await another.run('untrusted')).toEqual({
      outcome: 'BLOCKED', reason: 'INVALID_ORGANIZATION',
    })
    expect(another.retrieveConfiguration).not.toHaveBeenCalled()
  })
  it('takes TEST Customer ID only from RLS account mapping', async () => {
    const f = fixture()
    expect(await f.run()).toEqual({ outcome: 'READY', portalUrl })
    expect(f.userSupabase.rpc).toHaveBeenCalledWith('user_has_role', {
      org_id: orgId, allowed_roles: ['OWNER', 'ADMIN'],
    })
    expect(f.queries).toContainEqual(['organization_id',orgId])
    expect(f.queries).toContainEqual(['provider','stripe'])
    expect(f.queries).toContainEqual(['environment','TEST'])
    expect(f.createSession).toHaveBeenCalledWith({
      customerId, configurationId,
      returnUrl:'http://localhost:3000/app/settings/billing',
    })
  })
  it('requires an existing valid TEST account', async () => {
    for (const account of [null,{provider_customer_id:'cus_live!invalid'}]) {
      const f = fixture({ account })
      expect(await f.run()).toEqual({ outcome: 'BLOCKED', reason: 'ACCOUNT_SETUP_REQUIRED' })
      expect(f.retrieveConfiguration).not.toHaveBeenCalled()
    }
  })
  it('does not turn a failed scoped account query into a missing account', async () => {
    const f = fixture({ dbError: true })
    await expect(f.run()).rejects.toThrow('BILLING_PORTAL_ACCOUNT_LOOKUP_FAILED')
    expect(f.createSession).not.toHaveBeenCalled()
  })
  it('requires an explicitly configured TEST portal, never Stripe default', async () => {
    delete process.env.STRIPE_TEST_PORTAL_CONFIGURATION_ID
    const f = fixture()
    expect(await f.run()).toEqual({ outcome: 'BLOCKED', reason: 'PORTAL_NOT_CONFIGURED' })
    expect(f.retrieveConfiguration).not.toHaveBeenCalled()
  })
  it('rejects LIVE, inactive, wrong or unsafe portal configuration', async () => {
    for (const patch of [
      { livemode: true },{ active: false },{ id:'bpc_Different' },
      { loginPageEnabled: true },
      { features:{ ...configuration().features, subscriptionCancelEnabled:true } },
      { features:{ ...configuration().features, subscriptionUpdateEnabled:true } },
      { features:{ ...configuration().features, customerUpdateEnabled:true } },
      { features:{ ...configuration().features, invoiceHistoryEnabled:false } },
      { features:{ ...configuration().features, paymentMethodUpdateEnabled:false } },
    ]) {
      const f = fixture()
      f.retrieveConfiguration.mockResolvedValueOnce(configuration(patch))
      expect(await f.run()).toEqual({
        outcome: 'BLOCKED', reason: 'PORTAL_CONFIGURATION_UNSAFE',
      })
      expect(f.createSession).not.toHaveBeenCalled()
    }
  })
  it('fails closed on a provider outage without provider error contents', async () => {
    const f = fixture()
    f.retrieveConfiguration.mockRejectedValueOnce(new Error('raw provider detail'))
    expect(await f.run()).toEqual({ outcome:'BLOCKED',reason:'PROVIDER_UNAVAILABLE' })
    expect(f.createSession).not.toHaveBeenCalled()
  })
  it('requires the returned portal session to match our customer, configuration, return path and TEST mode', async () => {
    const invalid = [
      { id:'bps!wrong' },{ livemode:true },{ customer:'cus_Foreign' },
      { configuration:'bpc_Unsafe' },
      { returnUrl:'https://attacker.example' },
      { url:'https://billing.stripe.com.evil/p/session/test_Attacker' },
      { url:'https://billing.stripe.com/p/session/live_Attacker' },
      { url:'http://billing.stripe.com/p/session/test_Attacker' },
    ]
    for (const patch of invalid) {
      const f = fixture()
      f.createSession.mockResolvedValueOnce({
        id:'bps_SyntheticTEST',livemode:false,customer:customerId,
        configuration:configurationId,
        returnUrl:'http://localhost:3000/app/settings/billing',
        url:portalUrl,...patch,
      })
      expect(await f.run()).toEqual({outcome:'BLOCKED',reason:'SESSION_INVALID'})
    }
  })
  it('rejects a provider-created session on error without returning a URL', async () => {
    const f=fixture()
    f.createSession.mockRejectedValueOnce(new Error('internal Stripe details'))
    expect(await f.run()).toEqual({ outcome:'BLOCKED',reason:'PROVIDER_UNAVAILABLE' })
  })
  it('strictly validates portal hostname, session path and no query/fragment', () => {
    for (const bad of [
      'https://billing.stripe.com.evil/p/session/test_A',
      'https://billing.stripe.com/p/session/live_1',
      'https://billing.stripe.com/p/session/test_A#redirect',
      'https://billing.stripe.com/p/session/test_A?next=evil',
      'https://billing.stripe.com:444/p/session/test_A',
      'https://username:password@billing.stripe.com/p/session/test_A',
    ]) expect(isSafeStripeTestPortalUrl(bad)).toBe(false)
    expect(isSafeStripeTestPortalUrl(portalUrl)).toBe(true)
  })
  it('rejects LIVE or publishable Stripe keys at adapter construction', () => {
    delete process.env.STRIPE_SECRET_KEY
    expect(() => createStripeTestPortalProvider()).toThrow('BILLING_PORTAL_TEST_PROVIDER_DISABLED')
    process.env.STRIPE_SECRET_KEY = 'pk_test_ThisIsNotSecret'
    expect(() => createStripeTestPortalProvider()).toThrow('BILLING_PORTAL_TEST_PROVIDER_DISABLED')
    process.env.STRIPE_SECRET_KEY = ['sk','live','SyntheticNeverReal'].join('_')
    expect(() => createStripeTestPortalProvider()).toThrow('BILLING_PORTAL_TEST_PROVIDER_DISABLED')
  })
})
