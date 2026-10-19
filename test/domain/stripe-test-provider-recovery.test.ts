import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
import { verifyStripeTestRecoveryProviderTruth } from '../../src/lib/billing/stripe-test-provider-recovery'
import { createStripeTestReadOnlyRecoveryProvider } from '../../src/lib/billing/stripe-test-provider-recovery-adapter'

const organizationId='11111111-1111-4111-8111-111111111111'
const userId='22222222-2222-4222-8222-222222222222'
const reservationId='33333333-3333-4333-8333-333333333333'
const customerId='cus_RecoveryVerified'
const checkoutId='cs_test_RecoveryVerified'
const priceId='price_RecoveryVerified'
const expires=1792400000
const origin='http://localhost:3000'
const successUrl=origin+'/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}'
const cancelUrl=origin+'/billing/checkout/cancel'
const vars=['ENABLE_STRIPE_TEST_PROVIDER_RECOVERY','MPG_STRIPE_TEST_PROVIDER_RECOVERY_TARGET',
  'NEXT_PUBLIC_SUPABASE_URL','ENABLE_LIVE_BILLING','VERCEL_ENV','STRIPE_SECRET_KEY'] as const
const saved=Object.fromEntries(vars.map(k=>[k,process.env[k]]))
function local(){
  process.env.ENABLE_STRIPE_TEST_PROVIDER_RECOVERY='true'
  process.env.MPG_STRIPE_TEST_PROVIDER_RECOVERY_TARGET='LOCAL_SYNTHETIC'
  process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54331'
  process.env.ENABLE_LIVE_BILLING='false'
  delete process.env.VERCEL_ENV
}
function context(overrides:Record<string,unknown>={}):Record<string,unknown>{
  return {
    outcome:'READY',customer_id:customerId,customer_linked:true,
    customer_local_conflict:false,customer_expected_name:'Synthetic Business',
    checkout_id:checkoutId,checkout_reservation_id:reservationId,
    checkout_customer_id:customerId,checkout_price_id:priceId,
    checkout_status:'READY',checkout_expires_at:expires,
    checkout_origin:origin,has_subscription:false,...overrides,
  }
}
function fixture(opts:{auth?:boolean;role?:boolean;context?:Record<string,unknown>;
  fail?:boolean}={}){
  const user={
    auth:{getUser:vi.fn(async()=>({
      data:{user:opts.auth===false?null:{id:userId}},error:null,
    }))},
    rpc:vi.fn(async()=>({data:opts.role!==false,error:null})),
  }
  const admin={
    rpc:vi.fn(async()=>({
      data:opts.context??context(),
      error:opts.fail?{message:'private DB details'}:null,
    })),
  }
  const provider={
    retrieveCustomer:vi.fn(async()=>({
      id:customerId,livemode:false,deleted:false,name:'Synthetic Business',
    })),
    retrieveCheckout:vi.fn(async()=>({
      id:checkoutId,livemode:false,mode:'subscription',
      customerId,clientReferenceId:reservationId,status:'open',
      expiresAt:expires,currency:'php',successUrl,cancelUrl,
    })),
    listCheckoutLineItems:vi.fn(async()=>({
      hasMore:false,items:[{priceId,quantity:1}],
    })),
  }
  const run=(id:unknown=organizationId)=>verifyStripeTestRecoveryProviderTruth({
    organizationId:id,
    userSupabase:user as unknown as SupabaseClient<Database>,
    trustedBillingSupabase:admin as unknown as SupabaseClient<Database>,
    provider,
  })
  return {user,admin,provider,run}
}
describe('MR-5D3D2 exact-ID Stripe TEST recovery, never paid entitlement',()=>{
  beforeEach(()=>{vi.clearAllMocks();for(const k of vars)delete process.env[k];local()})
  afterEach(()=>{for(const k of vars){const old=saved[k];if(old===undefined)delete process.env[k];else process.env[k]=old}})
  it('refuses unset flags, LIVE, hosted and nonlocal database before auth or provider reads',async()=>{
    for(const patch of [
      {ENABLE_STRIPE_TEST_PROVIDER_RECOVERY:'false'},
      {MPG_STRIPE_TEST_PROVIDER_RECOVERY_TARGET:'HOSTED_TEST'},
      {ENABLE_LIVE_BILLING:'true'},
      {VERCEL_ENV:'preview'},
      {NEXT_PUBLIC_SUPABASE_URL:'https://hosted.supabase.co'},
    ]){
      local();Object.assign(process.env,patch)
      const f=fixture()
      expect(await f.run()).toEqual({outcome:'DISABLED'})
      expect(f.user.auth.getUser).not.toHaveBeenCalled()
      expect(f.provider.retrieveCustomer).not.toHaveBeenCalled()
    }
  })
  it('denies anonymous, VIEWER, invalid organizations and cross-tenant claims before RPC',async()=>{
    const anonymous=fixture({auth:false})
    expect(await anonymous.run()).toEqual({outcome:'DENIED',reason:'NOT_AUTHENTICATED'})
    const viewer=fixture({role:false})
    expect(await viewer.run()).toEqual({outcome:'DENIED',reason:'NOT_AUTHORIZED'})
    const malformed=fixture()
    expect(await malformed.run('different')).toEqual({outcome:'DENIED',reason:'INVALID_ORGANIZATION'})
    for(const f of [anonymous,viewer,malformed]){
      expect(f.admin.rpc).not.toHaveBeenCalled()
      expect(f.provider.retrieveCustomer).not.toHaveBeenCalled()
    }
  })
  it('passes only verified identity to private DB RPC then reads exact stored Stripe IDs',async()=>{
    const f=fixture()
    expect(await f.run()).toEqual({
      outcome:'VERIFIED',customer:'VERIFIED_LINKED',checkout:'MATCHED_OPEN',
    })
    expect(f.user.rpc).toHaveBeenCalledWith('user_has_role',{
      org_id:organizationId,allowed_roles:['OWNER','ADMIN'],
    })
    expect(f.admin.rpc).toHaveBeenCalledWith('read_stripe_test_provider_recovery_context',{
      p_user_id:userId,p_organization_id:organizationId,
    })
    expect(f.provider.retrieveCustomer).toHaveBeenCalledWith(customerId)
    expect(f.provider.retrieveCheckout).toHaveBeenCalledWith(checkoutId)
    expect(f.provider.listCheckoutLineItems).toHaveBeenCalledWith(checkoutId)
  })
  it('treats missing saved IDs as unresolved; never queries or assumes provider absence',async()=>{
    const f=fixture({context:context({
      customer_id:null,customer_linked:false,customer_expected_name:'Synthetic Business',
      checkout_id:null,checkout_status:'PREPARING',
    })})
    expect(await f.run()).toEqual({
      outcome:'VERIFIED',customer:'NO_PROVIDER_ID',checkout:'NO_PROVIDER_ID',
    })
    expect(f.provider.retrieveCustomer).not.toHaveBeenCalled()
    expect(f.provider.retrieveCheckout).not.toHaveBeenCalled()
  })
  it('rejects conflicting local account mapping without calling Stripe',async()=>{
    const f=fixture({context:context({customer_local_conflict:true})})
    expect(await f.run()).toEqual({
      outcome:'VERIFIED',customer:'LOCAL_CONFLICT',checkout:'BLOCKED_CUSTOMER',
    })
    expect(f.provider.retrieveCustomer).not.toHaveBeenCalled()
  })
  it('a matching orphaned Customer is identified but NEVER linked automatically',async()=>{
    const f=fixture({context:context({
      customer_linked:false,checkout_id:null,checkout_status:null,
    })})
    expect(await f.run()).toEqual({
      outcome:'VERIFIED',customer:'VERIFIED_UNLINKED',checkout:'NO_PROVIDER_ID',
    })
    expect(f.admin.rpc).toHaveBeenCalledOnce()
  })
  it('rejects LIVE/deleted/mismatched Customer and blocks Checkout lookup',async()=>{
    for(const patch of [
      {livemode:true},{deleted:true},{id:'cus_Foreign'},
      {name:'Foreign Tenant'},
    ]){
      const f=fixture()
      f.provider.retrieveCustomer.mockResolvedValueOnce({
        id:customerId,livemode:false,deleted:false,name:'Synthetic Business',...patch,
      })
      expect(await f.run()).toEqual({
        outcome:'VERIFIED',customer:'MISMATCH',checkout:'BLOCKED_CUSTOMER',
      })
      expect(f.provider.retrieveCheckout).not.toHaveBeenCalled()
    }
  })
  it('provider Customer outage is unresolved; session not read independently',async()=>{
    const f=fixture()
    f.provider.retrieveCustomer.mockRejectedValueOnce(new Error('private Stripe detail'))
    expect(await f.run()).toEqual({
      outcome:'VERIFIED',customer:'PROVIDER_UNAVAILABLE',checkout:'BLOCKED_CUSTOMER',
    })
  })
  it('rejects wrong Customer, tenant reference, price, quantity or origin',async()=>{
    const failures=[
      {session:{livemode:true}},
      {session:{mode:'payment'}},
      {session:{customerId:'cus_Foreign'}},
      {session:{clientReferenceId:'another'}},
      {session:{currency:'usd'}},
      {session:{successUrl:'https://attacker.example'}},
      {session:{expiresAt:expires+100}},
      {lines:{hasMore:true}},
      {lines:{items:[{priceId:'price_Foreign',quantity:1}]}},
      {lines:{items:[{priceId,quantity:2}]}},
      {lines:{items:[{priceId,quantity:1},{priceId,quantity:1}]}},
    ] as const
    for(const patch of failures){
      const f=fixture()
      if('session' in patch){
        f.provider.retrieveCheckout.mockResolvedValueOnce({
          id:checkoutId,livemode:false,mode:'subscription',
          customerId,clientReferenceId:reservationId,status:'open',
          expiresAt:expires,currency:'php',successUrl,cancelUrl,
          ...patch.session,
        })
      }else if('lines' in patch){
        f.provider.listCheckoutLineItems.mockResolvedValueOnce({
          hasMore:false,items:[{priceId,quantity:1}],...patch.lines,
        })
      }
      expect((await f.run())).toMatchObject({
        outcome:'VERIFIED',customer:'VERIFIED_LINKED',checkout:'MISMATCH',
      })
    }
  })
  it('a completed Session is NEVER treated as a paid subscription',async()=>{
    const f=fixture()
    f.provider.retrieveCheckout.mockResolvedValueOnce({
      id:checkoutId,livemode:false,mode:'subscription',customerId,
      clientReferenceId:reservationId,status:'complete',expiresAt:expires,
      currency:'php',successUrl,cancelUrl,
    })
    expect(await f.run()).toEqual({
      outcome:'VERIFIED',customer:'VERIFIED_LINKED',checkout:'COMPLETED_UNVERIFIED',
    })
  })
  it('only verified expired provider status produces MATCHED_EXPIRED',async()=>{
    const f=fixture()
    f.provider.retrieveCheckout.mockResolvedValueOnce({
      id:checkoutId,livemode:false,mode:'subscription',customerId,
      clientReferenceId:reservationId,status:'expired',expiresAt:expires,
      currency:'php',successUrl,cancelUrl,
    })
    expect((await f.run())).toMatchObject({checkout:'MATCHED_EXPIRED'})
  })
  it('provider Session or line-items outage remains unknown, never released',async()=>{
    for(const target of ['retrieveCheckout','listCheckoutLineItems'] as const){
      const f=fixture()
      f.provider[target].mockRejectedValueOnce(new Error('raw provider failure'))
      expect((await f.run())).toMatchObject({checkout:'PROVIDER_UNAVAILABLE'})
    }
  })
  it('rejects poisoned DB snapshots with raw fields or foreign identifiers',async()=>{
    for(const raw of [
      context({provider_customer_email:'private@example.test'}),
      context({checkout_expires_at:'today'}),
      context({customer_linked:'yes'}),
      context({checkout_id:'cs_live_Foreign'}),
    ]){
      const f=fixture({context:raw})
      if('provider_customer_email' in raw || typeof raw.checkout_expires_at !== 'number' ||
          typeof raw.customer_linked !== 'boolean'){
        await expect(f.run()).rejects.toThrow('BILLING_PROVIDER_CONTEXT_INVALID')
      }else{
        expect((await f.run())).toMatchObject({checkout:'MISMATCH'})
      }
    }
  })
  it('refuses fake authorization response or private database errors',async()=>{
    const f=fixture({context:{outcome:'NOT_AUTHORIZED'}})
    expect(await f.run()).toEqual({outcome:'DENIED',reason:'NOT_AUTHORIZED'})
    const broken=fixture({fail:true})
    await expect(broken.run()).rejects.toThrow('BILLING_PROVIDER_RECOVERY_CONTEXT_FAILED')
  })
  it('requires a TEST Stripe secret; LIVE and publishable keys cannot construct adapter',()=>{
    for(const key of [undefined,'pk_test_Synthetic','sk_live_Synthetic']){
      if(key===undefined)delete process.env.STRIPE_SECRET_KEY
      else process.env.STRIPE_SECRET_KEY=key
      expect(()=>createStripeTestReadOnlyRecoveryProvider())
        .toThrow('BILLING_PROVIDER_RECOVERY_TEST_DISABLED')
    }
  })
})
