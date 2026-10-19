import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../src/types/database'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL!
const adminKey=process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const options={auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient<Database>(url,adminKey,options)
const anon=createClient<Database>(url,anonKey,options)
const member=createClient<Database>(url,anonKey,options)
const suffix=randomUUID().replaceAll('-','')
const orgIds:string[]=[]
let ownerId='',viewerId=''

function checked<T extends {data:unknown;error:unknown}>(x:T):NonNullable<T['data']>{
  if(x.error || x.data===null)throw new Error('MR-5D3D3A synthetic DB operation failed',{cause:x.error})
  return x.data as NonNullable<T['data']>
}
function record(x:Json|null):Record<string,unknown>{
  if(!x||Array.isArray(x)||typeof x!=='object')throw new Error('Invalid review RPC JSON')
  return x as Record<string,unknown>
}
async function org(){
  const id=checked(await admin.from('organizations').insert({
    name:'Synthetic Billing Recovery Review',slug:'mr5d3d3a-'+randomUUID().replaceAll('-',''),
  }).select('id').single()).id
  orgIds.push(id)
  checked(await admin.from('organization_users').insert([
    {organization_id:id,user_id:ownerId,role:'OWNER'},
    {organization_id:id,user_id:viewerId,role:'VIEWER'},
  ]).select('id'))
  return id
}
async function request(id:string,kind:'CUSTOMER_SETUP'|'CHECKOUT'='CHECKOUT',userId=ownerId){
  return record(checked(await admin.rpc('request_stripe_test_billing_recovery_review',{
    p_user_id:userId,p_organization_id:id,p_kind:kind,
  })))
}
async function account(id:string){
  return checked(await admin.from('organization_billing_accounts').insert({
    organization_id:id,provider:'stripe',environment:'TEST',
    provider_customer_id:'cus_Review'+randomUUID().replaceAll('-',''),
  }).select('id,provider_customer_id').single())
}
async function oldCustomer(id:string){
  checked(await admin.from('stripe_test_customer_provisioning').insert({
    organization_id:id,organization_name:'Synthetic Business',state:'PREPARING',
    lease_token:randomUUID(),lease_expires_at:'2020-01-01T00:00:00Z',
    created_at:'2020-01-01T00:00:00Z',
  }).select('id'))
}
async function oldCheckout(id:string){
  const a=await account(id)
  const checkout=checked(await admin.from('stripe_test_checkout_reservations').insert({
    organization_id:id,billing_account_id:a.id,
    provider:'stripe',environment:'TEST',provider_customer_id:a.provider_customer_id,
    provider_price_id:'price_ReviewSynthetic',plan_id:'monthly',
    return_origin:'http://localhost:3000',status:'PREPARING',
    lease_token:randomUUID(),lease_expires_at:'2020-01-01T00:00:00Z',
    session_expires_at:'2020-01-01T00:00:00Z',
    reservation_expires_at:'2020-01-01T00:00:00Z',
    created_at:'2020-01-01T00:00:00Z',
  }).select('id').single())
  return {account:a,checkoutId:checkout.id}
}
describe('MR-5D3D3A append-only and tenant-authorized recovery review (disposable DB)',()=>{
  beforeAll(async()=>{
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    const a=checked(await admin.auth.admin.createUser({
      email:'mr5d3d3a-owner-'+suffix+'@example.test',
      password:randomUUID(),email_confirm:true,
    }))
    const b=checked(await admin.auth.admin.createUser({
      email:'mr5d3d3a-viewer-'+suffix+'@example.test',
      password:randomUUID(),email_confirm:true,
    }))
    if(!a.user||!b.user)throw new Error('Synthetic actors unavailable')
    ownerId=a.user.id;viewerId=b.user.id
  },30000)
  afterAll(async()=>{
    for(const id of orgIds){
      const {error}=await admin.from('organizations').delete().eq('id',id)
      if(error)throw error
    }
    for(const id of [ownerId,viewerId]){
      if(id){const {error}=await admin.auth.admin.deleteUser(id)
        if(error)throw error}
    }
  })
  it('returns NOT_NEEDED without inventing recovery evidence or a case',async()=>{
    const id=await org()
    expect(await request(id)).toEqual({outcome:'NOT_NEEDED'})
    expect(await request(id,'CUSTOMER_SETUP')).toEqual({outcome:'NOT_NEEDED'})
    expect(checked(await admin.from('stripe_test_billing_recovery_reviews')
      .select('id').eq('organization_id',id))).toHaveLength(0)
  })
  it('rejects VIEWER, unknown user and foreign tenant without a review case',async()=>{
    const id=await org()
    await oldCustomer(id)
    expect(await request(id,'CUSTOMER_SETUP',viewerId)).toEqual({outcome:'NOT_AUTHORIZED'})
    expect(await request(id,'CUSTOMER_SETUP',randomUUID())).toEqual({outcome:'NOT_AUTHORIZED'})
    expect(await request(randomUUID(),'CUSTOMER_SETUP')).toEqual({outcome:'NOT_AUTHORIZED'})
    const rows=checked(await admin.from('stripe_test_billing_recovery_reviews')
      .select('id').eq('organization_id',id))
    expect(rows).toHaveLength(0)
  })
  it('records one OPEN aged Customer request using DB-derived reason, not client proof',async()=>{
    const id=await org()
    await oldCustomer(id)
    expect(await request(id,'CUSTOMER_SETUP')).toEqual({outcome:'REQUESTED'})
    expect(await request(id,'CUSTOMER_SETUP')).toEqual({outcome:'ALREADY_REQUESTED'})
    expect(checked(await admin.from('stripe_test_billing_recovery_reviews')
      .select('kind,reason,state,requested_by')
      .eq('organization_id',id))).toEqual([{
        kind:'CUSTOMER_SETUP',reason:'AGED_CUSTOMER_ATTEMPT',state:'OPEN',
        requested_by:ownerId,
      }])
    const preserved=checked(await admin.from('stripe_test_customer_provisioning')
      .select('state,provider_customer_id').eq('organization_id',id).single())
    expect(preserved).toMatchObject({state:'PREPARING',provider_customer_id:null})
  })
  it('serializes twelve concurrent checkout review requests into one immutable case',async()=>{
    const id=await org()
    const initial=await oldCheckout(id)
    const requests=await Promise.all(Array.from({length:12},()=>request(id)))
    expect(requests.filter(x=>x.outcome==='REQUESTED')).toHaveLength(1)
    expect(requests.filter(x=>x.outcome==='ALREADY_REQUESTED')).toHaveLength(11)
    const cases=checked(await admin.from('stripe_test_billing_recovery_reviews')
      .select('kind,reason,state').eq('organization_id',id))
    expect(cases).toEqual([{kind:'CHECKOUT',reason:'EXPIRED_CHECKOUT_RESERVATION',state:'OPEN'}])
    const original=checked(await admin.from('stripe_test_checkout_reservations')
      .select('id,status,stripe_session_id').eq('organization_id',id).single())
    expect(original).toEqual({id:initial.checkoutId,status:'PREPARING',stripe_session_id:null})
  })
  it('saved expired Checkout Session is recognized without making it paid',async()=>{
    const id=await org()
    const initial=await oldCheckout(id)
    checked(await admin.from('stripe_test_checkout_reservations').update({
      status:'READY',lease_token:null,lease_expires_at:null,
      stripe_session_id:'cs_test_ReviewSynthetic',
      stripe_session_url:'https://checkout.stripe.com/c/pay/cs_test_ReviewSynthetic',
    }).eq('id',initial.checkoutId).select('id'))
    expect(await request(id)).toEqual({outcome:'REQUESTED'})
    expect(checked(await admin.from('stripe_test_billing_recovery_reviews')
      .select('reason').eq('organization_id',id))).toEqual([
      {reason:'EXPIRED_CHECKOUT_SESSION'},
    ])
  })
  it('does not open review for an already-recorded non-ended subscription',async()=>{
    const id=await org()
    const initial=await oldCheckout(id)
    checked(await admin.from('organization_subscriptions').insert({
      organization_id:id,billing_account_id:initial.account.id,
      provider:'stripe',environment:'TEST',
      provider_subscription_id:'sub_Review'+randomUUID().replaceAll('-',''),
      provider_status:'active',normalized_status:'ACTIVE',
    }).select('id'))
    expect(await request(id)).toEqual({outcome:'NOT_NEEDED'})
  })
  it('denies browser roles and even service-role UPDATE/DELETE on immutable review rows',async()=>{
    const id=await org()
    await oldCustomer(id)
    await request(id,'CUSTOMER_SETUP')
    for(const client of [anon,member]){
      expect((await client.rpc('request_stripe_test_billing_recovery_review',{
        p_user_id:ownerId,p_organization_id:id,p_kind:'CUSTOMER_SETUP',
      })).error).not.toBeNull()
      expect((await client.from('stripe_test_billing_recovery_reviews')
        .select('id')).error).not.toBeNull()
    }
    expect((await admin.from('stripe_test_billing_recovery_reviews')
      .update({state:'OPEN'}).eq('organization_id',id)).error).not.toBeNull()
    expect((await admin.from('stripe_test_billing_recovery_reviews')
      .delete().eq('organization_id',id)).error).not.toBeNull()
    expect(checked(await admin.from('stripe_test_billing_recovery_reviews')
      .select('id').eq('organization_id',id))).toHaveLength(1)
  })
})
