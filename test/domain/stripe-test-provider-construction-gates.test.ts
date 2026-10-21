import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { createStripeTestCheckoutSessionCreator } from '../../src/lib/billing/stripe-test-checkout-session'
import { createStripeTestCustomerCreator } from '../../src/lib/billing/stripe-test-customer-provider'
import { createStripeTestPortalProvider } from '../../src/lib/billing/stripe-test-portal-provider'
import { createStripeTestCheckoutPriceRetriever } from '../../src/lib/billing/stripe-test-checkout-price'
import { createStripeTestRecoveryTransport } from '../../src/lib/billing/stripe-test-recovery-transport'

const keys = [
  'NEXT_PUBLIC_SUPABASE_URL','VERCEL_ENV','ENABLE_LIVE_BILLING','STRIPE_SECRET_KEY',
  'ENABLE_STRIPE_TEST_CHECKOUT_CREATE','ENABLE_STRIPE_TEST_CUSTOMER_PROVISIONING',
  'MPG_STRIPE_TEST_PROVISIONING_TARGET','ENABLE_STRIPE_TEST_PORTAL',
  'MPG_STRIPE_TEST_PORTAL_TARGET',
] as const
const saved = Object.fromEntries(keys.map(k=>[k,process.env[k]]))
function safe(){
  process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54331'
  process.env.ENABLE_LIVE_BILLING='false'
  // Avoid embedding credential-shaped test strings in source or CI artifacts.
  process.env.STRIPE_SECRET_KEY=['sk','test','SyntheticConstructorOnly'].join('_')
  process.env.ENABLE_STRIPE_TEST_CHECKOUT_CREATE='true'
  process.env.ENABLE_STRIPE_TEST_CUSTOMER_PROVISIONING='true'
  process.env.MPG_STRIPE_TEST_PROVISIONING_TARGET='LOCAL_SYNTHETIC'
  process.env.ENABLE_STRIPE_TEST_PORTAL='true'
  process.env.MPG_STRIPE_TEST_PORTAL_TARGET='LOCAL_SYNTHETIC'
  delete process.env.VERCEL_ENV
}
function factories() {
  return [
    ['checkout',createStripeTestCheckoutSessionCreator],
    ['customer',createStripeTestCustomerCreator],
    ['portal',createStripeTestPortalProvider],
    ['price',createStripeTestCheckoutPriceRetriever],
    ['recovery',createStripeTestRecoveryTransport],
  ] as const
}
describe('MR-5 TEST provider constructors independently deny hostile environments',()=>{
  beforeEach(()=>{vi.stubEnv('NODE_ENV','test');safe()})
  afterEach(()=>{
    vi.unstubAllEnvs()
    for(const k of keys){
      const previous=saved[k]
      if(previous===undefined)delete process.env[k]
      else process.env[k]=previous
    }
  })
  it.each([
    ['hosted',{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co'}],
    ['wrong local port',{NEXT_PUBLIC_SUPABASE_URL:'http://localhost:54321'}],
    ['preview',{VERCEL_ENV:'preview'}],
    ['LIVE switch',{ENABLE_LIVE_BILLING:'true'}],
  ])('blocks all adapters in %s runtime',(_name,patch)=>{
    Object.assign(process.env,patch)
    for(const [,construct] of factories())expect(construct).toThrow()
  })
  it('blocks all adapters in production, regardless of TEST flags',()=>{
    vi.stubEnv('NODE_ENV','production')
    for(const [,construct] of factories())expect(construct).toThrow()
  })
  it('rejects missing and LIVE Stripe keys without external calls',()=>{
    for(const key of ['', ['sk','live','NoRealCredential'].join('_')]){
      process.env.STRIPE_SECRET_KEY=key
      for(const [,construct] of factories())expect(construct).toThrow()
    }
  })
  it('retains LOCAL_SYNTHETIC TEST-only adapter construction without calling Stripe',()=>{
    for(const [,construct] of factories())expect(construct).not.toThrow()
  })
  it('still requires flags for every mutating provider adapter',()=>{
    delete process.env.ENABLE_STRIPE_TEST_CHECKOUT_CREATE
    expect(createStripeTestCheckoutSessionCreator).toThrow()
    safe()
    process.env.MPG_STRIPE_TEST_PROVISIONING_TARGET='HOSTED'
    expect(createStripeTestCustomerCreator).toThrow()
    safe()
    process.env.MPG_STRIPE_TEST_PORTAL_TARGET='HOSTED'
    expect(createStripeTestPortalProvider).toThrow()
  })
})
