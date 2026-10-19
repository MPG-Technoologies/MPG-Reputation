import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
import { diagnoseStripeTestBillingRecovery } from '../../src/lib/billing/stripe-test-recovery-diagnostics'

const orgId='11111111-1111-4111-8111-111111111111'
const userId='22222222-2222-4222-8222-222222222222'
const keys=[
  'ENABLE_STRIPE_TEST_RECOVERY_DIAGNOSTICS',
  'MPG_STRIPE_TEST_RECOVERY_TARGET',
  'ENABLE_LIVE_BILLING','VERCEL_ENV','NEXT_PUBLIC_SUPABASE_URL',
] as const
const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
function enable(){
  process.env.ENABLE_STRIPE_TEST_RECOVERY_DIAGNOSTICS='true'
  process.env.MPG_STRIPE_TEST_RECOVERY_TARGET='LOCAL_SYNTHETIC'
  process.env.ENABLE_LIVE_BILLING='false'
  process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54331'
  delete process.env.VERCEL_ENV
}
function fixture(options:{
  auth?:boolean;role?:boolean
  result?:Record<string,unknown>;error?:boolean
}={}){
  const userSupabase={
    auth:{getUser:vi.fn(async()=>({
      data:{user:options.auth===false?null:{id:userId}},error:null,
    }))},
    rpc:vi.fn(async()=>({data:options.role!==false,error:null})),
  }
  const trustedBillingSupabase={
    rpc:vi.fn(async()=>({
      data:options.result??{outcome:'READY',customer:'NOT_STARTED',checkout:'NOT_STARTED'},
      error:options.error?{message:'private database details'}:null,
    })),
  }
  const run=(organizationId:unknown=orgId)=>diagnoseStripeTestBillingRecovery({
    userSupabase:userSupabase as unknown as SupabaseClient<Database>,
    trustedBillingSupabase:trustedBillingSupabase as unknown as SupabaseClient<Database>,
    organizationId,
  })
  return {userSupabase,trustedBillingSupabase,run}
}
describe('MR-5D3D1 read-only recovery diagnosis',()=>{
  beforeEach(()=>{vi.clearAllMocks();for(const k of keys)delete process.env[k];enable()})
  afterEach(()=>{for(const k of keys){
    const value=previous[k]
    if(value===undefined)delete process.env[k]
    else process.env[k]=value
  }})
  it('is disabled for hosted, production-target, LIVE or unset flags',async()=>{
    for(const change of [
      {ENABLE_STRIPE_TEST_RECOVERY_DIAGNOSTICS:'false'},
      {MPG_STRIPE_TEST_RECOVERY_TARGET:'HOSTED_TEST'},
      {NEXT_PUBLIC_SUPABASE_URL:'https://hosted.supabase.co'},
      {VERCEL_ENV:'preview'},
      {ENABLE_LIVE_BILLING:'true'},
    ]){
      enable();Object.assign(process.env,change)
      const f=fixture()
      expect(await f.run()).toEqual({outcome:'DISABLED'})
      expect(f.userSupabase.auth.getUser).not.toHaveBeenCalled()
      expect(f.trustedBillingSupabase.rpc).not.toHaveBeenCalled()
    }
  })
  it('requires JWT identity and owner/admin membership before privileged RPC',async()=>{
    const anonymous=fixture({auth:false})
    expect(await anonymous.run()).toEqual({
      outcome:'DENIED',reason:'NOT_AUTHENTICATED',
    })
    expect(anonymous.trustedBillingSupabase.rpc).not.toHaveBeenCalled()
    const viewer=fixture({role:false})
    expect(await viewer.run()).toEqual({
      outcome:'DENIED',reason:'NOT_AUTHORIZED',
    })
    expect(viewer.trustedBillingSupabase.rpc).not.toHaveBeenCalled()
  })
  it('refuses unknown organization without invoking privileged RPC',async()=>{
    const f=fixture()
    expect(await f.run('forged')).toEqual({
      outcome:'DENIED',reason:'INVALID_ORGANIZATION',
    })
    expect(f.trustedBillingSupabase.rpc).not.toHaveBeenCalled()
  })
  it('passes signed-in user identity to narrowly scoped read-only RPC',async()=>{
    const f=fixture()
    expect(await f.run()).toEqual({
      outcome:'READY',customer:'NOT_STARTED',checkout:'NOT_STARTED',
    })
    expect(f.userSupabase.rpc).toHaveBeenCalledWith('user_has_role',{
      org_id:orgId,allowed_roles:['OWNER','ADMIN'],
    })
    expect(f.trustedBillingSupabase.rpc).toHaveBeenCalledWith(
      'inspect_stripe_test_billing_recovery',{
        p_user_id:userId,p_organization_id:orgId,
      })
  })
  it('normalizes the restricted provider-reconciliation states without leaking raw fields',async()=>{
    for(const [customer,checkout] of [
      ['ACCOUNT_LINKED','SUBSCRIPTION_RECORDED'],
      ['IN_FLIGHT','IN_FLIGHT'],
      ['RETRY_SAME_RESERVATION','RETRY_SAME_RESERVATION'],
      ['RECONCILE_PROVIDER','RECONCILE_PROVIDER'],
      ['NOT_STARTED','ACTIVE_SESSION'],
    ]){
      const f=fixture({result:{outcome:'READY',customer,checkout}})
      expect(await f.run()).toEqual({outcome:'READY',customer,checkout})
    }
  })
  it('does not trust customer identifiers, session URLs or unexpected response fields',async()=>{
    for(const result of [
      {outcome:'READY',customer:'ACCOUNT_LINKED',checkout:'ACTIVE_SESSION',
        provider_customer_id:'cus_untrusted'},
      {outcome:'READY',customer:'ACCOUNT_LINKED',checkout:'ACTIVE_SESSION',
        stripe_session_url:'https://checkout.stripe.com/c/pay/private'},
      {outcome:'READY',customer:'FAILED_CHARGE',checkout:'ACTIVE_SESSION'},
      {outcome:'READY',customer:'ACCOUNT_LINKED',checkout:'PAID'},
      {outcome:'READY',customer:null,checkout:'NOT_STARTED'},
    ]){
      const f=fixture({result})
      await expect(f.run()).rejects.toThrow('BILLING_RECOVERY_DIAGNOSIS_INVALID')
    }
  })
  it('does not expose raw database errors or trust spoofed owner status',async()=>{
    const denied=fixture({result:{outcome:'NOT_AUTHORIZED'}})
    expect(await denied.run()).toEqual({outcome:'DENIED',reason:'NOT_AUTHORIZED'})
    const failed=fixture({error:true})
    await expect(failed.run()).rejects.toThrow('BILLING_RECOVERY_DIAGNOSIS_FAILED')
  })
})
