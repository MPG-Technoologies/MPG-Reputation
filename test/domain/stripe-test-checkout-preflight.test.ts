import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))

import { prepareStripeTestCheckout } from '../../src/lib/billing/stripe-test-checkout-preflight'
import { createStripeTestCheckoutPriceRetriever } from '../../src/lib/billing/stripe-test-checkout-price'

const org = '11111111-1111-4111-8111-111111111111'
const otherOrg = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const monthlyPriceId = 'price_Mr5dMonthly'
const yearlyPriceId = 'price_Mr5dAnnual'
const envNames = [
  'MPG_BILLING_MONTHLY_PRICE_PHP',
  'MPG_BILLING_ANNUAL_PRICE_PHP',
  'STRIPE_TEST_MONTHLY_PRICE_ID',
  'STRIPE_TEST_ANNUAL_PRICE_ID',
  'STRIPE_SECRET_KEY',
] as const
const original = Object.fromEntries(envNames.map(k => [k, process.env[k]]))

function db(opts: {
  authenticated?: boolean
  allowed?: boolean
  account?: { id: string; provider_customer_id: string } | null
  existing?: { id: string } | null
  accountError?: boolean
  existingError?: boolean
} = {}) {
  const tables: string[] = []
  const selectors: Array<[string, unknown]> = []
  const queries = {
    auth: { getUser: vi.fn(async () => ({
      data: { user: opts.authenticated === false ? null : { id: userId } },
      error: null,
    })) },
    rpc: vi.fn(async () => ({ data: opts.allowed !== false, error: null })),
    from: vi.fn((table: string) => {
      tables.push(table)
      return {
        select() { return this },
        eq(key: string, value: unknown) { selectors.push([key, value]); return this },
        neq(key: string, value: unknown) { selectors.push([key, value]); return this },
        limit() { return this },
        async maybeSingle() {
          if (table === 'organization_billing_accounts') return {
            data: opts.account === undefined
              ? { id: '44444444-4444-4444-8444-444444444444', provider_customer_id: 'cus_Mr5dTrusted' }
              : opts.account,
            error: opts.accountError ? { message: 'private DB query' } : null,
          }
          if (table === 'organization_subscriptions') return {
            data: opts.existing ?? null,
            error: opts.existingError ? { message: 'private DB query' } : null,
          }
          throw new Error('Unexpected DB table read')
        },
      }
    }),
  }
  return {
    client: queries as unknown as SupabaseClient<Database>,
    ...queries, tables, selectors,
  }
}
function price(
  id: string = monthlyPriceId, changes: Partial<{
    id: string; currency: string; unitAmountMinor: number | null;
    interval: string | null; intervalCount: number | null;
    active: boolean; liveMode: boolean
  }> = {}
) {
  return {
    id, currency: 'php', unitAmountMinor: id === yearlyPriceId ? 100_000 : 150_000,
    interval: id === yearlyPriceId ? 'year' : 'month',
    intervalCount: 1, active: true, liveMode: false, ...changes,
  }
}
function scenario(opts: Parameters<typeof db>[0] = {}, planId: unknown = 'monthly') {
  const state = db(opts)
  const retrievePrice = vi.fn(async (id: string) => price(id))
  return {
    ...state, retrievePrice,
    run: (organizationId: unknown = org, selected: unknown = planId) =>
      prepareStripeTestCheckout({
        supabase: state.client, organizationId, planId: selected, retrievePrice,
      }),
  }
}

describe('MR-5D1 Stripe TEST checkout preflight', () => {
  beforeEach(() => {
    process.env.STRIPE_TEST_MONTHLY_PRICE_ID = monthlyPriceId
    process.env.STRIPE_TEST_ANNUAL_PRICE_ID = yearlyPriceId
    delete process.env.MPG_BILLING_MONTHLY_PRICE_PHP
    delete process.env.MPG_BILLING_ANNUAL_PRICE_PHP
  })
  afterEach(() => {
    for (const name of envNames) {
      const value = original[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('prepares the authenticated owner monthly plan from trusted TEST account and Stripe Price', async () => {
    const s = scenario()
    expect(await s.run()).toEqual({
      outcome: 'READY',
      intent: {
        organizationId: org,
        billingAccountId: '44444444-4444-4444-8444-444444444444',
        stripeCustomerId: 'cus_Mr5dTrusted',
        stripePriceId: monthlyPriceId,
        planId: 'monthly',
        amountMinor: 150_000,
        currency: 'PHP',
        interval: 'month',
      },
    })
    expect(s.rpc).toHaveBeenCalledWith('user_has_role', {
      org_id: org, allowed_roles: ['OWNER', 'ADMIN'],
    })
    expect(s.tables).toEqual(['organization_billing_accounts', 'organization_subscriptions'])
    expect(s.selectors).toContainEqual(['environment', 'TEST'])
    expect(s.retrievePrice).toHaveBeenCalledWith(monthlyPriceId)
  })

  it('preserves ₱1,000 TOTAL per year, not ₱1,000/month billed annually', async () => {
    const s = scenario({}, 'annual')
    const result = await s.run()
    expect(result.outcome).toBe('READY')
    if (result.outcome === 'READY') expect(result.intent).toMatchObject({
      amountMinor: 100_000, interval: 'year', planId: 'annual', stripePriceId: yearlyPriceId,
    })
  })

  it('requires a validated user session before any tenant or provider lookup', async () => {
    const s = scenario({ authenticated: false })
    expect(await s.run()).toEqual({ outcome: 'BLOCKED', reason: 'NOT_AUTHENTICATED' })
    expect(s.rpc).not.toHaveBeenCalled()
    expect(s.from).not.toHaveBeenCalled()
    expect(s.retrievePrice).not.toHaveBeenCalled()
  })

  it('blocks cross-organization members, operators or viewers', async () => {
    const s = scenario({ allowed: false })
    expect(await s.run(otherOrg)).toEqual({ outcome: 'BLOCKED', reason: 'NOT_AUTHORIZED' })
    expect(s.from).not.toHaveBeenCalled()
    expect(s.retrievePrice).not.toHaveBeenCalled()
  })

  it('rejects malformed organization IDs and arbitrary plan names before DB writes', async () => {
    const s = scenario()
    expect(await s.run('foreign-org')).toEqual({
      outcome: 'BLOCKED', reason: 'INVALID_ORGANIZATION',
    })
    expect(await s.run(org, 'enterprise')).toEqual({
      outcome: 'BLOCKED', reason: 'INVALID_PLAN',
    })
    expect(s.rpc).not.toHaveBeenCalled()
    expect(s.retrievePrice).not.toHaveBeenCalled()
  })

  it('requires an existing matched TEST billing account, never creates Stripe Customers automatically', async () => {
    for (const account of [null, { id: 'ignored', provider_customer_id: 'invalid' }]) {
      const s = scenario({ account })
      expect(await s.run()).toEqual({
        outcome: 'BLOCKED', reason: 'ACCOUNT_SETUP_REQUIRED',
      })
      expect(s.retrievePrice).not.toHaveBeenCalled()
    }
  })

  it('prevents duplicate checkout while an existing subscription is pending or active', async () => {
    const s = scenario({ existing: { id: 'current-subscription' } })
    expect(await s.run()).toEqual({ outcome: 'BLOCKED', reason: 'SUBSCRIPTION_EXISTS' })
    expect(s.selectors).toContainEqual(['normalized_status', 'ENDED'])
    expect(s.retrievePrice).not.toHaveBeenCalled()
  })

  it('rejects missing Stripe Price binding even for authorized owner', async () => {
    delete process.env.STRIPE_TEST_MONTHLY_PRICE_ID
    const s = scenario()
    expect(await s.run()).toEqual({ outcome: 'BLOCKED', reason: 'PRICE_NOT_CONFIGURED' })
    expect(s.retrievePrice).not.toHaveBeenCalled()
  })

  it('rejects mismatched amount, wrong billing interval, wrong currency, inactive or LIVE prices', async () => {
    for (const override of [
      { unitAmountMinor: 2_000_000 },
      { interval: 'year' },
      { currency: 'usd' },
      { active: false },
      { liveMode: true },
      { id: 'price_Untrusted' },
    ]) {
      const state = db()
      const retrievePrice = vi.fn(async () => price(monthlyPriceId, override))
      expect(await prepareStripeTestCheckout({
        supabase: state.client, organizationId: org, planId: 'monthly', retrievePrice,
      })).toEqual({ outcome: 'BLOCKED', reason: 'PRICE_MISMATCH' })
    }
  })

  it('respects configured PHP amounts without trusting the client price', async () => {
    process.env.MPG_BILLING_MONTHLY_PRICE_PHP = '1800.25'
    const s = scenario()
    expect(await s.run()).toEqual({ outcome: 'BLOCKED', reason: 'PRICE_MISMATCH' })
    expect(s.retrievePrice).toHaveBeenCalledWith(monthlyPriceId)
    process.env.MPG_BILLING_MONTHLY_PRICE_PHP = '1500'
    expect((await s.run()).outcome).toBe('READY')
  })

  it('fails closed on provider outages without exposing raw Stripe errors', async () => {
    const state = db()
    const retrievePrice = vi.fn(async () => { throw new Error('Sensitive provider error') })
    expect(await prepareStripeTestCheckout({
      supabase: state.client, organizationId: org, planId: 'monthly', retrievePrice,
    })).toEqual({ outcome: 'BLOCKED', reason: 'PROVIDER_UNAVAILABLE' })
  })

  it('throws sanitized database errors rather than pretending checkout is authorized', async () => {
    const s1 = scenario({ accountError: true })
    await expect(s1.run()).rejects.toThrow('BILLING_CHECKOUT_ACCOUNT_LOOKUP_FAILED')
    const s2 = scenario({ existingError: true })
    await expect(s2.run()).rejects.toThrow('BILLING_CHECKOUT_SUBSCRIPTION_LOOKUP_FAILED')
  })

  it('does not allow use of live Stripe secret key in read-only test price adapter', async () => {
    delete process.env.STRIPE_SECRET_KEY
    expect(() => createStripeTestCheckoutPriceRetriever())
      .toThrow('BILLING_CHECKOUT_TEST_KEY_REQUIRED')
    process.env.STRIPE_SECRET_KEY = ['sk','live','SyntheticNeverReal'].join('_')
    expect(() => createStripeTestCheckoutPriceRetriever())
      .toThrow('BILLING_CHECKOUT_TEST_KEY_REQUIRED')
  })
})
