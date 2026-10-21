import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
import { requestStripeTestRecoveryReview } from '../../src/lib/billing/stripe-test-recovery-review'

const org='11111111-1111-4111-8111-111111111111'
const user='22222222-2222-4222-8222-222222222222'
const keys=['ENABLE_STRIPE_TEST_RECOVERY_REVIEW','MPG_STRIPE_TEST_RECOVERY_REVIEW_TARGET',
  'ENABLE_LIVE_BILLING','VERCEL_ENV','NEXT_PUBLIC_SUPABASE_URL'] as const
const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
function enable(){
  process.env.ENABLE_STRIPE_TEST_RECOVERY_REVIEW='true'
  process.env.MPG_STRIPE_TEST_RECOVERY_REVIEW_TARGET='LOCAL_SYNTHETIC'
  process.env.ENABLE_LIVE_BILLING='false'
  process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54331'
  delete process.env.VERCEL_ENV
}
function fixture(opts:{authenticated?:boolean;anonymous?:boolean;role?:boolean;reply?:Record<string,unknown>;
    failure?:boolean}={}){
  const account={
    auth:{getUser:vi.fn(async()=>({
      data:{user:opts.authenticated===false?null:{id:user,is_anonymous:opts.anonymous===true}},error:null,
    }))},
    rpc:vi.fn(async()=>({data:opts.role!==false,error:null})),
  }
  const privileged={rpc:vi.fn(async()=>({
    data:opts.reply??{outcome:'REQUESTED'},
    error:opts.failure?{message:'provider or database secret'}:null,
  }))}
  const run=(organizationId:unknown=org,kind:unknown='CHECKOUT')=>
    requestStripeTestRecoveryReview({
      userSupabase:account as unknown as SupabaseClient<Database>,
      trustedBillingSupabase:privileged as unknown as SupabaseClient<Database>,
      organizationId,kind,
    })
  return {account,privileged,run}
}
describe('MR-5D3D3A TEST recovery review is an inert, minimal request',()=>{
  beforeEach(()=>{vi.clearAllMocks();for(const k of keys)delete process.env[k];enable()})
  afterEach(()=>{for(const k of keys){
    if(saved[k]===undefined)delete process.env[k]
    else process.env[k]=saved[k]
  }})
  it('never touches identity or DB unless local synthetic flags are all enabled',async()=>{
    for(const patch of [
      {ENABLE_STRIPE_TEST_RECOVERY_REVIEW:'false'},
      {MPG_STRIPE_TEST_RECOVERY_REVIEW_TARGET:'HOSTED_TEST'},
      {ENABLE_LIVE_BILLING:'true'},
      {VERCEL_ENV:'preview'},
      {NEXT_PUBLIC_SUPABASE_URL:'https://hosted.supabase.co'},
    ]){
      enable();Object.assign(process.env,patch)
      const f=fixture()
      expect(await f.run()).toEqual({outcome:'DISABLED'})
      expect(f.account.auth.getUser).not.toHaveBeenCalled()
      expect(f.privileged.rpc).not.toHaveBeenCalled()
    }
  })
  it('refuses unauthenticated, forged organization or invalid kind before elevated RPC',async()=>{
    for(const [options,id,kind,reason] of [
      [{authenticated:false},org,'CHECKOUT','NOT_AUTHENTICATED'],
      [{},'forged','CHECKOUT','INVALID_ORGANIZATION'],
      [{},org,'DELETE_RESERVATION','INVALID_KIND'],
      [{role:false},org,'CUSTOMER_SETUP','NOT_AUTHORIZED'],
    ] as const){
      const f=fixture(options)
      expect(await f.run(id,kind)).toEqual({outcome:'DENIED',reason})
      expect(f.privileged.rpc).not.toHaveBeenCalled()
    }
  })
  it('rejects a signed-in Supabase anonymous-authenticated identity before role or elevated writes', async () => {
    const f=fixture({anonymous:true})
    expect(await f.run()).toEqual({outcome:'DENIED',reason:'NOT_AUTHENTICATED'})
    expect(f.account.auth.getUser).toHaveBeenCalledTimes(1)
    expect(f.account.rpc).not.toHaveBeenCalled()
    expect(f.privileged.rpc).not.toHaveBeenCalled()
  })
  it('never accepts reason/status/provider identity and passes verified JWT identity',async()=>{
    const f=fixture()
    expect(await f.run()).toEqual({outcome:'REQUESTED'})
    expect(f.account.rpc).toHaveBeenCalledWith('user_has_role',{
      org_id:org,allowed_roles:['OWNER','ADMIN'],
    })
    expect(f.privileged.rpc).toHaveBeenCalledWith(
      'request_stripe_test_billing_recovery_review',{
        p_user_id:user,p_organization_id:org,p_kind:'CHECKOUT',
      }
    )
  })
  it('supports request deduplication and absence of review need',async()=>{
    for(const outcome of ['ALREADY_REQUESTED','NOT_NEEDED'] as const){
      const f=fixture({reply:{outcome}})
      expect(await f.run(org,'CUSTOMER_SETUP')).toEqual({outcome})
    }
  })
  it('denies a foreign tenant from the privileged RPC with no existence disclosure',async()=>{
    const f=fixture({reply:{outcome:'NOT_AUTHORIZED'}})
    expect(await f.run()).toEqual({outcome:'DENIED',reason:'NOT_AUTHORIZED'})
  })
  it('rejects any extra response field, case ID, Stripe key or unrecognized command',async()=>{
    for(const reply of [
      {outcome:'REQUESTED',provider_customer_id:'cus_Private'},
      {outcome:'REQUESTED',id:'internal'},
      {outcome:'CASE_APPROVED'},
      {outcome:'APPROVE_PAYMENT'},
    ]){
      const f=fixture({reply})
      await expect(f.run()).rejects.toThrow('BILLING_RECOVERY_REVIEW_RESPONSE_INVALID')
    }
    const failed=fixture({failure:true})
    await expect(failed.run()).rejects.toThrow('BILLING_RECOVERY_REVIEW_INTAKE_FAILED')
  })
})
