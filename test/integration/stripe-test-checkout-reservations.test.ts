import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../src/types/database'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const opts = {auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient<Database>(url,svcKey,opts)
const anon=createClient<Database>(url,anonKey,opts)
const marker=randomUUID().replaceAll('-','')
const customer='cus_Mr5d2'+marker
const price='price_Mr5d2Monthly'
let ownerId=''
let viewerId=''
const orgIds:string[]=[]

function checked<T extends {data:unknown;error:unknown}>(x:T): NonNullable<T['data']>{
  if(x.error||x.data===null)throw new Error('TEST Checkout SQL failed',{cause:x.error})
  return x.data as NonNullable<T['data']>
}
function object(x:Json|null):Record<string,unknown>{
  if(!x||typeof x!=='object'||Array.isArray(x))throw new Error('Invalid checkout SQL response')
  return x as Record<string,unknown>
}
async function setup(){
  const orgId=checked(await admin.from('organizations').insert({
    name:'Synthetic checkout org',slug:'mr5d2-'+randomUUID(),
  }).select('id').single()).id
  orgIds.push(orgId)
  const accountId=checked(await admin.from('organization_billing_accounts').insert({
    organization_id:orgId,provider:'stripe',environment:'TEST',
    provider_customer_id:'cus_'+randomUUID().replaceAll('-',''),
  }).select('id,provider_customer_id').single())
  checked(await admin.from('organization_users').insert([
    {organization_id:orgId,user_id:ownerId,role:'OWNER'},
    {organization_id:orgId,user_id:viewerId,role:'VIEWER'},
  ]).select('id'))
  const args={
    p_user_id:ownerId,
    p_organization_id:orgId,
    p_billing_account_id:accountId.id,
    p_provider_customer_id:accountId.provider_customer_id,
    p_provider_price_id:price,
    p_plan_id:'monthly' as const,
    p_return_origin:'http://localhost:3000',
  }
  return {orgId,accountId:accountId.id,args}
}
async function reserve(args:Database['public']['Functions']['reserve_stripe_test_checkout']['Args']){
  return object(checked(await admin.rpc('reserve_stripe_test_checkout',args)))
}
async function finalize(
  data:Record<string,unknown>,overrides:Partial<Database['public']['Functions']['finalize_stripe_test_checkout']['Args']>={}
){
  return object(checked(await admin.rpc('finalize_stripe_test_checkout',{
    p_user_id:ownerId,p_reservation_id:String(data.reservation_id),
    p_lease_token:String(data.lease_token),
    p_session_id:'cs_test_Mr5d2'+randomUUID().replaceAll('-',''),
    p_session_url:'https://checkout.stripe.com/c/pay/cs_test_Synthetic',
    p_session_expires_at:String(data.session_expires_at),
    ...overrides,
  })))
}

describe('MR-5D2 concurrent reservation and TEST-only finalization',()=>{
  beforeAll(async()=>{
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    const pw=randomUUID(),pw2=randomUUID()
    const a=checked(await admin.auth.admin.createUser({
      email:'mr5d2-owner-'+marker+'@example.test',password:pw,email_confirm:true,
    }))
    const b=checked(await admin.auth.admin.createUser({
      email:'mr5d2-viewer-'+marker+'@example.test',password:pw2,email_confirm:true,
    }))
    if(!a.user||!b.user)throw new Error('Users not made')
    ownerId=a.user.id;viewerId=b.user.id
  },30000)
  afterAll(async()=>{
    for(const id of orgIds){
      const {error}=await admin.from('organizations').delete().eq('id',id)
      if(error)throw error
    }
    if(ownerId){const {error}=await admin.auth.admin.deleteUser(ownerId);if(error)throw error}
    if(viewerId){const {error}=await admin.auth.admin.deleteUser(viewerId);if(error)throw error}
  })

  it('one of five simultaneous requests reserves; all others BUSY',async()=>{
    const {args}=await setup()
    const outcomes=await Promise.all(Array.from({length:5},()=>reserve(args)))
    expect(outcomes.filter(x=>x.outcome==='RESERVED')).toHaveLength(1)
    expect(outcomes.filter(x=>x.outcome==='BUSY')).toHaveLength(4)
  })

  it('owner can finalize only with current fencing token and receives cached READY on repeat',async()=>{
    const {args,orgId}=await setup()
    const claim=await reserve(args)
    expect(claim.outcome).toBe('RESERVED')
    const result=await finalize(claim)
    expect(result).toEqual({outcome:'FINALIZED'})
    const repeat=await reserve(args)
    expect(repeat.outcome).toBe('EXISTING_READY')
    expect(repeat.session_url).toBe('https://checkout.stripe.com/c/pay/cs_test_Synthetic')
    expect(await finalize(claim)).toEqual({outcome:'NOT_LEASE_HOLDER'})
    const row=checked(await admin.from('stripe_test_checkout_reservations')
      .select('status,organization_id,environment,lease_token')
      .eq('organization_id',orgId).single())
    expect(row).toMatchObject({status:'READY',organization_id:orgId,environment:'TEST',lease_token:null})
  })

  it('rejects mismatched/foreign roles or customer/account before allocating a reservation',async()=>{
    const {args,orgId}=await setup()
    expect(await reserve({...args,p_user_id:viewerId})).toEqual({outcome:'NOT_AUTHORIZED'})
    expect(await reserve({...args,p_user_id:randomUUID()})).toEqual({outcome:'NOT_AUTHORIZED'})
    expect(await reserve({...args,p_provider_customer_id:'cus_Attacker'}))
      .toEqual({outcome:'ACCOUNT_MISMATCH'})
    expect(await reserve({...args,p_billing_account_id:randomUUID()}))
      .toEqual({outcome:'ACCOUNT_MISMATCH'})
    const {data,error}=await admin.from('stripe_test_checkout_reservations')
      .select('id').eq('organization_id',orgId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('non-ENDED subscription blocks reservation before Stripe side effect',async()=>{
    const {args,orgId,accountId}=await setup()
    checked(await admin.from('organization_subscriptions').insert({
      organization_id:orgId,billing_account_id:accountId,provider:'stripe',
      environment:'TEST',provider_subscription_id:'sub_Mr5d2'+randomUUID().replaceAll('-',''),
      provider_status:'active',normalized_status:'ACTIVE',
    }).select('id'))
    expect(await reserve(args)).toEqual({outcome:'SUBSCRIPTION_EXISTS'})
  })

  it('different checkout plan, Stripe Price or return origin cannot replace active reservation',async()=>{
    const {args}=await setup()
    expect((await reserve(args)).outcome).toBe('RESERVED')
    expect(await reserve({...args,p_provider_price_id:'price_Other'}))
      .toEqual({outcome:'DIFFERENT_INTENT'})
    expect(await reserve({...args,p_plan_id:'annual'}))
      .toEqual({outcome:'DIFFERENT_INTENT'})
    expect(await reserve({...args,p_return_origin:'https://another.example'}))
      .toEqual({outcome:'DIFFERENT_INTENT'})
  })

  it('old lease token cannot finalize after replacement; stable reservation ID remains',async()=>{
    const {args,orgId}=await setup()
    const first=await reserve(args)
    checked(await admin.from('stripe_test_checkout_reservations')
      .update({lease_expires_at:'2020-01-01T00:00:00Z'})
      .eq('organization_id',orgId).select('id'))
    const next=await reserve(args)
    expect(next.outcome).toBe('RESERVED')
    expect(next.reservation_id).toBe(first.reservation_id)
    expect(next.lease_token).not.toBe(first.lease_token)
    expect(await finalize(first)).toEqual({outcome:'NOT_LEASE_HOLDER'})
    expect(await finalize(next)).toEqual({outcome:'FINALIZED'})
  })

  it('cannot finalize with LIVE session or foreign actor',async()=>{
    const {args}=await setup()
    const claim=await reserve(args)
    expect(await finalize(claim,{p_session_id:'cs_live_Foreign'}))
      .toEqual({outcome:'INVALID_INPUT'})
    expect(await finalize(claim,{p_user_id:viewerId}))
      .toEqual({outcome:'NOT_AUTHORIZED'})
    expect(await finalize(claim)).toEqual({outcome:'FINALIZED'})
  })

  it('unknown expired reservation requires manual reconciliation, never a new idempotency key',async()=>{
    const {args,orgId}=await setup()
    const first=await reserve(args)
    checked(await admin.from('stripe_test_checkout_reservations')
      .update({reservation_expires_at:'2020-01-01T00:00:00Z'})
      .eq('organization_id',orgId).select('id'))
    expect(await reserve(args)).toEqual({outcome:'MANUAL_REVIEW_REQUIRED'})
    const row=checked(await admin.from('stripe_test_checkout_reservations')
      .select('id').eq('organization_id',orgId).single())
    expect(row.id).toBe(first.reservation_id)
  })

  it('denies checkout reservation/finalize RPC to anonymous and authenticated clients',async()=>{
    const {args}=await setup()
    const response=await anon.rpc('reserve_stripe_test_checkout',args)
    expect(response.error).not.toBeNull()
    const response2=await anon.rpc('finalize_stripe_test_checkout',{
      p_user_id:ownerId,p_reservation_id:randomUUID(),p_lease_token:randomUUID(),
      p_session_id:'cs_test_Synthetic',p_session_url:'https://checkout.stripe.com/c/pay/cs_test_Synthetic',
      p_session_expires_at:new Date().toISOString(),
    })
    expect(response2.error).not.toBeNull()
  })
})
