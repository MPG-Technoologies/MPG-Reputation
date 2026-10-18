import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
vi.mock('../../src/lib/billing/stripe-test-checkout-preflight', () => ({
  prepareStripeTestCheckout: vi.fn(),
}))
import { prepareStripeTestCheckout } from '../../src/lib/billing/stripe-test-checkout-preflight'
import {
  getStripeTestCheckoutReturnOrigin,
  startStripeTestCheckout,
} from '../../src/lib/billing/stripe-test-checkout-start'
import { createStripeTestCheckoutSessionCreator } from '../../src/lib/billing/stripe-test-checkout-session'

const reservationId = '11111111-1111-4111-8111-111111111111'
const leaseToken = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const accountId = '44444444-4444-4444-8444-444444444444'
const userId = '55555555-5555-4555-8555-555555555555'
const expiry = '2026-10-18T20:00:00.000Z'
const expiryUnix = Math.floor(Date.parse(expiry) / 1000)
const stripeUrl = 'https://checkout.stripe.com/c/pay/cs_test_SyntheticABC'
const knownVars = ['ENABLE_STRIPE_TEST_CHECKOUT_CREATE','ENABLE_LIVE_BILLING',
  'MPG_BILLING_CHECKOUT_RETURN_ORIGIN','STRIPE_SECRET_KEY'] as const
const original = Object.fromEntries(knownVars.map(k => [k, process.env[k]]))
const mockPreflight = vi.mocked(prepareStripeTestCheckout)

function fixtures() {
  const userSupabase = {
    auth: { getUser: vi.fn(async () => ({
      data: { user: { id: userId } }, error: null,
    })) },
  } as unknown as SupabaseClient<Database>
  const claims: Record<string, unknown>[] = []
  const trustedBillingSupabase = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      claims.push({name,...args})
      if (name === 'reserve_stripe_test_checkout') return {
        data: {outcome:'RESERVED',reservation_id:reservationId,
          lease_token:leaseToken,session_expires_at:expiry},error:null,
      }
      if (name === 'finalize_stripe_test_checkout') {
        return {data:{outcome:'FINALIZED'},error:null}
      }
      throw new Error('Unexpected RPC')
    }),
  } as unknown as SupabaseClient<Database>
  const createSession = vi.fn(async () => ({
    id:'cs_test_SyntheticABC',
    url:stripeUrl,
    livemode:false,
    mode:'subscription',
    customerId:'cus_Mr5dTrusted',
    expiresAt:expiryUnix,
    status:'open',
  }))
  const retrievePrice = vi.fn(async () => ({
    id:'price_Mr5dMonthly',currency:'php',unitAmountMinor:150_000,
    interval:'month',intervalCount:1,active:true,liveMode:false,
  }))
  const run = () => startStripeTestCheckout({
    userSupabase,trustedBillingSupabase,
    organizationId,planId:'monthly',retrievePrice,createSession,
  })
  return { userSupabase,trustedBillingSupabase,
    createSession,retrievePrice,claims,run }
}

describe('MR-5D2 synthetic TEST checkout idempotency and provider validation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    for (const k of knownVars) delete process.env[k]
    process.env.ENABLE_STRIPE_TEST_CHECKOUT_CREATE='true'
    process.env.ENABLE_LIVE_BILLING='false'
    process.env.MPG_BILLING_CHECKOUT_RETURN_ORIGIN='http://localhost:3000'
    mockPreflight.mockResolvedValue({
      outcome:'READY',
      intent:{
        organizationId,billingAccountId:accountId,
        stripeCustomerId:'cus_Mr5dTrusted',stripePriceId:'price_Mr5dMonthly',
        planId:'monthly',amountMinor:150_000,currency:'PHP',interval:'month',
      },
    })
  })
  afterEach(() => {
    for(const k of knownVars) {
      const old=original[k]
      if(old===undefined)delete process.env[k]
      else process.env[k]=old
    }
  })

  it('does not reserve, fetch Stripe or create a session without explicit enablement', async () => {
    delete process.env.ENABLE_STRIPE_TEST_CHECKOUT_CREATE
    const s=fixtures()
    expect(await s.run()).toEqual({outcome:'DISABLED'})
    expect(mockPreflight).not.toHaveBeenCalled()
    expect(s.createSession).not.toHaveBeenCalled()
  })
  it('hard-stops in a live billing environment even with TEST flag enabled',async()=>{
    process.env.ENABLE_LIVE_BILLING='true'
    const s=fixtures()
    expect(await s.run()).toEqual({outcome:'DISABLED'})
  })
  it('returns preflight denial without opening checkout reservation',async()=>{
    mockPreflight.mockResolvedValue({outcome:'BLOCKED',reason:'NOT_AUTHORIZED'})
    const s=fixtures()
    expect(await s.run()).toEqual({outcome:'BLOCKED',reason:'NOT_AUTHORIZED'})
    expect(s.trustedBillingSupabase.rpc).not.toHaveBeenCalled()
  })
  it('uses trusted IDs, fixed return URLs and stable Stripe idempotency',async()=>{
    const s=fixtures()
    expect(await s.run()).toEqual({outcome:'READY',sessionUrl:stripeUrl,reused:false})
    expect(s.claims[0]).toMatchObject({
      name:'reserve_stripe_test_checkout',
      p_organization_id:organizationId,
      p_user_id:userId,p_billing_account_id:accountId,
      p_provider_customer_id:'cus_Mr5dTrusted',p_provider_price_id:'price_Mr5dMonthly',
      p_plan_id:'monthly',p_return_origin:'http://localhost:3000',
    })
    expect(s.createSession).toHaveBeenCalledWith({
      customerId:'cus_Mr5dTrusted',priceId:'price_Mr5dMonthly',
      reservationId,expiresAt:expiryUnix,
      idempotencyKey:'mpg-reputation-test-checkout-'+reservationId,
      successUrl:'http://localhost:3000/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl:'http://localhost:3000/billing/checkout/cancel',
    })
    expect(s.claims[1]).toMatchObject({
      name:'finalize_stripe_test_checkout',p_user_id:userId,
      p_lease_token:leaseToken,p_session_id:'cs_test_SyntheticABC',
      p_session_expires_at:expiry,
    })
  })
  it('reuses a previously persisted READY checkout without new provider session',async()=>{
    const s=fixtures()
    vi.mocked(s.trustedBillingSupabase.rpc).mockResolvedValueOnce({
      data:{outcome:'EXISTING_READY',session_url:stripeUrl,session_id:'cs_test_SyntheticABC'},
      error:null,count:null,status:200,statusText:'OK',
    })
    expect(await s.run()).toEqual({outcome:'READY',sessionUrl:stripeUrl,reused:true})
    expect(s.createSession).not.toHaveBeenCalled()
  })
  it('returns BUSY as retry-required and different/expired intent as blocked',async()=>{
    for(const [outcome,expected] of [
      ['BUSY',{outcome:'RETRY_REQUIRED'}],
      ['DIFFERENT_INTENT',{outcome:'BLOCKED',reason:'DIFFERENT_INTENT'}],
      ['MANUAL_REVIEW_REQUIRED',{outcome:'MANUAL_REVIEW_REQUIRED'}],
    ] as const){
      const s=fixtures()
      vi.mocked(s.trustedBillingSupabase.rpc).mockResolvedValueOnce({
        data:{outcome},error:null,count:null,status:200,statusText:'OK',
      })
      expect(await s.run()).toEqual(expected)
      expect(s.createSession).not.toHaveBeenCalled()
    }
  })
  it('does not reset reservation after provider timeout or unknown outcome',async()=>{
    const s=fixtures()
    s.createSession.mockRejectedValueOnce(new Error('private Stripe failure'))
    expect(await s.run()).toEqual({outcome:'RETRY_REQUIRED'})
    expect(s.claims).toHaveLength(1)
  })
  it('does not finalize or redirect to an invalid, LIVE or foreign-customer session',async()=>{
    for(const invalid of [
      {livemode:true},
      {id:'cs_live_Another'},
      {customerId:'cus_Foreign'},
      {mode:'payment'},
      {expiresAt:expiryUnix+90},
      {status:'complete'},
      {url:'https://attacker.example/c/pay/steal'},
      {url:'http://checkout.stripe.com/c/pay/insecure'},
    ]){
      const s=fixtures()
      s.createSession.mockResolvedValueOnce({
        id:'cs_test_SyntheticABC',url:stripeUrl,
        livemode:false,mode:'subscription',customerId:'cus_Mr5dTrusted',
        expiresAt:expiryUnix,status:'open',...invalid,
      })
      expect(await s.run()).toEqual({outcome:'MANUAL_REVIEW_REQUIRED'})
      expect(s.claims).toHaveLength(1)
    }
  })
  it('does not redirect when server database finalization refuses a changed lease',async()=>{
    const s=fixtures()
    vi.mocked(s.trustedBillingSupabase.rpc).mockImplementation(async name => ({
      data:name==='reserve_stripe_test_checkout'
        ? {outcome:'RESERVED',reservation_id:reservationId,
          lease_token:leaseToken,session_expires_at:expiry}
        : {outcome:'NOT_LEASE_HOLDER'},
      error:null,count:null,status:200,statusText:'OK',
    }))
    expect(await s.run()).toEqual({outcome:'MANUAL_REVIEW_REQUIRED'})
  })
  it('rejects spoofed return URLs or production callback injection from environment',()=>{
    for(const invalid of [
      'https://example.com/evil','https://example.com?next=attacker',
      'https://user:pass@example.com','javascript:alert(1)',
      'http://example.com','https://example.com/#fragment',
      'https://example.com:443','https://example.com/',
    ]){
      process.env.MPG_BILLING_CHECKOUT_RETURN_ORIGIN=invalid
      expect(()=>getStripeTestCheckoutReturnOrigin())
        .toThrow('BILLING_CHECKOUT_RETURN_ORIGIN_INVALID')
    }
  })
  it('requires a TEST Stripe key to construct provider creator',()=>{
    delete process.env.STRIPE_SECRET_KEY
    expect(()=>createStripeTestCheckoutSessionCreator())
      .toThrow('BILLING_CHECKOUT_TEST_PROVIDER_DISABLED')
    process.env.STRIPE_SECRET_KEY=['sk','live','Synthetic'].join('_')
    expect(()=>createStripeTestCheckoutSessionCreator())
      .toThrow('BILLING_CHECKOUT_TEST_PROVIDER_DISABLED')
  })
})
