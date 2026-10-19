import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  isLocalTestBillingActionEndpointEnabled,
  parseLocalTestBillingAction,
} from '../../src/lib/billing/stripe-test-action-request'

const org='11111111-1111-4111-8111-111111111111'
const keys=[
  'ENABLE_STRIPE_TEST_BILLING_ACTIONS',
  'MPG_STRIPE_TEST_BILLING_ACTION_TARGET',
  'NEXT_PUBLIC_SUPABASE_URL',
  'VERCEL_ENV',
  'ENABLE_LIVE_BILLING',
] as const
const original=Object.fromEntries(keys.map(x=>[x,process.env[x]]))
function enabled(){
  process.env.ENABLE_STRIPE_TEST_BILLING_ACTIONS='true'
  process.env.MPG_STRIPE_TEST_BILLING_ACTION_TARGET='LOCAL_SYNTHETIC'
  process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54331'
  process.env.ENABLE_LIVE_BILLING='false'
  delete process.env.VERCEL_ENV
}
describe('MR-5D3C2 local-only TEST billing HTTP input contract',()=>{
  beforeEach(()=>{for(const k of keys)delete process.env[k];enabled()})
  afterEach(()=>{for(const k of keys){
    if(original[k]===undefined)delete process.env[k]
    else process.env[k]=original[k]
  }})
  it('is enabled only in an explicitly flagged local disposable environment',()=>{
    expect(isLocalTestBillingActionEndpointEnabled()).toBe(true)
    for(const patch of [
      {ENABLE_STRIPE_TEST_BILLING_ACTIONS:'false'},
      {MPG_STRIPE_TEST_BILLING_ACTION_TARGET:'HOSTED_TEST'},
      {NEXT_PUBLIC_SUPABASE_URL:'https://tenant.supabase.co'},
      {VERCEL_ENV:'preview'},
      {ENABLE_LIVE_BILLING:'true'},
    ]){
      enabled()
      Object.assign(process.env,patch)
      expect(isLocalTestBillingActionEndpointEnabled()).toBe(false)
    }
  })
  it('parses only three exact action schemas without extra fields',()=>{
    expect(parseLocalTestBillingAction({
      action:'CUSTOMER_SETUP',organizationId:org,
    })).toEqual({action:'CUSTOMER_SETUP',organizationId:org})
    expect(parseLocalTestBillingAction({
      action:'PORTAL',organizationId:org,
    })).toEqual({action:'PORTAL',organizationId:org})
    expect(parseLocalTestBillingAction({
      action:'CHECKOUT',organizationId:org,planId:'monthly',
    })).toEqual({action:'CHECKOUT',organizationId:org,planId:'monthly'})
    expect(parseLocalTestBillingAction({
      action:'CHECKOUT',organizationId:org,planId:'annual',
    })).toMatchObject({planId:'annual'})
  })
  it('rejects untrusted customer/price/amount/URL/role/user fields',()=>{
    for(const attack of [
      {provider_customer_id:'cus_spoof'},
      {stripeCustomerId:'cus_spoof'},
      {stripePriceId:'price_foreign'},
      {amountMinor:1},
      {successUrl:'https://attacker.example'},
      {returnUrl:'https://attacker.example'},
      {userId:'spoofed'},
      {role:'OWNER'},
      {promotionCode:'FREE'},
      {quantity:20},
      {__proto__:'value'},
    ]){
      const value={action:'CHECKOUT',organizationId:org,planId:'monthly',...attack}
      if(Object.keys(value).length===3)continue // JS object proto isn't own enumerable
      expect(parseLocalTestBillingAction(value)).toBeNull()
    }
  })
  it('rejects invalid organizations, action names and unknown billing plans',()=>{
    for(const value of [
      null,[],{},'not-json',
      {action:'CHECKOUT',organizationId:org,planId:'forever'},
      {action:'PORTAL',organizationId:org,planId:'monthly'},
      {action:'CHECKOUT',organizationId:'not-an-org',planId:'monthly'},
      {action:'DELETE',organizationId:org},
      {action:'CUSTOMER_SETUP',organizationId:org,customerId:'cus_fake'},
      {action:'PORTAL',organizationId:org,redirect:'https://evil.example'},
    ]) expect(parseLocalTestBillingAction(value)).toBeNull()
  })
})
