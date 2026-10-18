import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
import { admitStripeTestBillingAction } from '../../src/lib/billing/stripe-test-billing-action-admission'

const orgId='11111111-1111-4111-8111-111111111111'
const userId='22222222-2222-4222-8222-222222222222'
const keys=[
  'ENABLE_STRIPE_TEST_BILLING_ACTIONS','MPG_STRIPE_TEST_BILLING_ACTION_TARGET',
  'ENABLE_LIVE_BILLING','VERCEL_ENV','NEXT_PUBLIC_SUPABASE_URL',
  'MPG_BILLING_CHECKOUT_RETURN_ORIGIN',
] as const
const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
function enable(){
  process.env.ENABLE_STRIPE_TEST_BILLING_ACTIONS='true'
  process.env.MPG_STRIPE_TEST_BILLING_ACTION_TARGET='LOCAL_SYNTHETIC'
  process.env.ENABLE_LIVE_BILLING='false'
  process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54331'
  process.env.MPG_BILLING_CHECKOUT_RETURN_ORIGIN='http://localhost:3000'
  delete process.env.VERCEL_ENV
}
const goodRequest={
  method:'POST',origin:'http://localhost:3000',
  fetchSite:'same-origin',fetchMode:'cors',
  contentType:'application/json',actionHeader:'1',
}
function fixtures(opts:{auth?:boolean;role?:boolean;reply?:Record<string,unknown>;error?:boolean}={}){
  const user={
    auth:{getUser:vi.fn(async()=>({
      data:{user:opts.auth===false?null:{id:userId}},error:null,
    }))},
    rpc:vi.fn(async()=>({data:opts.role!==false,error:null})),
  }
  const admin={
    rpc:vi.fn(async()=>({
      data:opts.reply??{outcome:'ALLOWED',remaining:4},
      error:opts.error?{message:'database private details'}:null,
    })),
  }
  const run=(overrides:Partial<{
    organizationId:unknown;action:unknown;
    request:typeof goodRequest
  }>={})=>admitStripeTestBillingAction({
    userSupabase:user as unknown as SupabaseClient<Database>,
    trustedBillingSupabase:admin as unknown as SupabaseClient<Database>,
    organizationId:overrides.organizationId??orgId,
    action:overrides.action??'CHECKOUT',
    request:overrides.request??goodRequest,
  })
  return {user,admin,run}
}
describe('MR-5D3C1 local billing mutation request admission',()=>{
  beforeEach(()=>{vi.clearAllMocks();for(const k of keys)delete process.env[k];enable()})
  afterEach(()=>{for(const k of keys){
    const v=saved[k];if(v===undefined)delete process.env[k]
    else process.env[k]=v
  }})
  it('stays disabled on hosted, live, wrong database or absent feature flag',async()=>{
    for(const patch of [
      {ENABLE_STRIPE_TEST_BILLING_ACTIONS:'false'},
      {MPG_STRIPE_TEST_BILLING_ACTION_TARGET:'HOSTED_TEST'},
      {ENABLE_LIVE_BILLING:'true'},
      {VERCEL_ENV:'preview'},
      {NEXT_PUBLIC_SUPABASE_URL:'https://some-hosted.supabase.co'},
    ]){
      enable();Object.assign(process.env,patch)
      const f=fixtures()
      expect(await f.run()).toEqual({outcome:'DISABLED'})
      expect(f.user.auth.getUser).not.toHaveBeenCalled()
      expect(f.admin.rpc).not.toHaveBeenCalled()
    }
  })
  it('requires strict same-origin JSON POST, fetch metadata and custom header',async()=>{
    for(const patch of [
      {method:'GET'},
      {origin:'https://attacker.example'},
      {origin:null},
      {fetchSite:'cross-site'},
      {fetchSite:'same-site'},
      {fetchSite:null},
      {fetchMode:'navigate'},
      {contentType:'application/x-www-form-urlencoded'},
      {contentType:'text/plain'},
      {actionHeader:null},
      {actionHeader:'wrong'},
    ]){
      const f=fixtures()
      expect(await f.run({request:{...goodRequest,...patch} as typeof goodRequest}))
        .toEqual({outcome:'DENIED',reason:'INVALID_REQUEST'})
      expect(f.user.auth.getUser).not.toHaveBeenCalled()
      expect(f.admin.rpc).not.toHaveBeenCalled()
    }
  })
  it('returns DISABLED on a non-local return origin',async()=>{
    process.env.MPG_BILLING_CHECKOUT_RETURN_ORIGIN='https://remote.example'
    const f=fixtures()
    expect(await f.run()).toEqual({outcome:'DISABLED'})
    expect(f.admin.rpc).not.toHaveBeenCalled()
  })
  it('rejects invalid organization IDs and action names before authentication',async()=>{
    const f=fixtures()
    expect(await f.run({organizationId:'not-an-id'}))
      .toEqual({outcome:'DENIED',reason:'INVALID_ORGANIZATION'})
    expect(await f.run({action:'DELETE_ALL'}))
      .toEqual({outcome:'DENIED',reason:'INVALID_REQUEST'})
    expect(f.user.auth.getUser).not.toHaveBeenCalled()
  })
  it('never authorizes anonymous users or cross-tenant role failures',async()=>{
    const anonymous=fixtures({auth:false})
    expect(await anonymous.run())
      .toEqual({outcome:'DENIED',reason:'NOT_AUTHENTICATED'})
    expect(anonymous.admin.rpc).not.toHaveBeenCalled()
    const viewer=fixtures({role:false})
    expect(await viewer.run()).toEqual({outcome:'DENIED',reason:'NOT_AUTHORIZED'})
    expect(viewer.admin.rpc).not.toHaveBeenCalled()
  })
  it('uses signed-in identity and fixed shared rate budget',async()=>{
    const f=fixtures()
    expect(await f.run()).toEqual({outcome:'ALLOWED',remaining:4})
    expect(f.user.rpc).toHaveBeenCalledWith('user_has_role',{
      org_id:orgId,allowed_roles:['OWNER','ADMIN'],
    })
    expect(f.admin.rpc).toHaveBeenCalledWith(
      'claim_stripe_test_billing_action',{
        p_user_id:userId,p_organization_id:orgId,p_action:'CHECKOUT',
      }
    )
  })
  it('applies limit to customer setup, checkout and portal actions',async()=>{
    for(const action of ['CUSTOMER_SETUP','CHECKOUT','PORTAL'] as const){
      const f=fixtures()
      expect((await f.run({action})).outcome).toBe('ALLOWED')
      expect(f.admin.rpc).toHaveBeenCalledWith(
        'claim_stripe_test_billing_action',{
          p_user_id:userId,p_organization_id:orgId,p_action:action,
        }
      )
    }
  })
  it('denies an exhausted database window without triggering provider actions',async()=>{
    const f=fixtures({reply:{outcome:'RATE_LIMITED'}})
    expect(await f.run()).toEqual({outcome:'DENIED',reason:'RATE_LIMITED'})
  })
  it('fails closed on an invalid rate-limit RPC reply or service error',async()=>{
    for(const reply of [
      {outcome:'ALLOWED',remaining:-1},
      {outcome:'ALLOWED',remaining:12},
      {outcome:'ALLOWED',remaining:'2'},
    ]){
      const f=fixtures({reply})
      await expect(f.run()).rejects.toThrow('BILLING_ACTION_ADMISSION_RESPONSE_INVALID')
    }
    const broken=fixtures({error:true})
    await expect(broken.run()).rejects.toThrow('BILLING_ACTION_RATE_CLAIM_FAILED')
  })
})
