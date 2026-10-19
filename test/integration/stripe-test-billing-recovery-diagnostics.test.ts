import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../src/types/database'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const options={auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient<Database>(url,serviceKey,options)
const anonymous=createClient<Database>(url,anonKey,options)
const viewer=createClient<Database>(url,anonKey,options)
const suffix=randomUUID().replaceAll('-','')
let ownerId='',viewerId=''
const orgs:string[]=[]

function checked<T extends {data:unknown;error:unknown}>(value:T):NonNullable<T['data']>{
  if(value.error||value.data===null){
    throw new Error('MR-5D3D1 isolated database operation failed',{cause:value.error})
  }
  return value.data as NonNullable<T['data']>
}
function obj(value:Json|null):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid response')
  return value as Record<string,unknown>
}
async function org(){
  const id=checked(await admin.from('organizations').insert({
    name:'MR5D3D1 Synthetic',slug:'mr5d3d1-'+randomUUID().replaceAll('-',''),
  }).select('id').single()).id
  orgs.push(id)
  checked(await admin.from('organization_users').insert([
    {organization_id:id,user_id:ownerId,role:'OWNER'},
    {organization_id:id,user_id:viewerId,role:'VIEWER'},
  ]).select('id'))
  return id
}
async function account(organizationId:string){
  return checked(await admin.from('organization_billing_accounts').insert({
    organization_id:organizationId,
    provider:'stripe',environment:'TEST',
    provider_customer_id:'cus_Mr5d3d1'+randomUUID().replaceAll('-',''),
  }).select('id,provider_customer_id').single())
}
async function diagnosis(organizationId:string,userId=ownerId){
  return obj(checked(await admin.rpc('inspect_stripe_test_billing_recovery',{
    p_user_id:userId,p_organization_id:organizationId,
  })))
}
const past='2020-01-01T00:00:00Z'
const future='2090-01-01T00:00:00Z'
async function customerPending(organizationId:string){
  return checked(await admin.from('stripe_test_customer_provisioning').insert({
    organization_id:organizationId,organization_name:'MR5D3D1 Synthetic',
    state:'PREPARING',lease_token:randomUUID(),lease_expires_at:future,
  }).select('id').single()).id
}
async function checkoutPending(organizationId:string,accountId:string,customerId:string){
  return checked(await admin.from('stripe_test_checkout_reservations').insert({
    organization_id:organizationId,billing_account_id:accountId,
    provider:'stripe',environment:'TEST',
    provider_customer_id:customerId,provider_price_id:'price_SyntheticMonthly',
    plan_id:'monthly',return_origin:'http://localhost:3000',
    status:'PREPARING',lease_token:randomUUID(),lease_expires_at:future,
    session_expires_at:future,reservation_expires_at:future,
  }).select('id').single()).id
}

describe('MR-5D3D1 read-only tenant-scoped recovery diagnosis (disposable PostgreSQL)',()=>{
  beforeAll(async()=>{
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    const ownerPass=randomUUID(),viewerPass=randomUUID()
    const ownerData=checked(await admin.auth.admin.createUser({
      email:'mr5d3d1-owner-'+suffix+'@example.test',
      password:ownerPass,email_confirm:true,
    }))
    const viewerData=checked(await admin.auth.admin.createUser({
      email:'mr5d3d1-viewer-'+suffix+'@example.test',
      password:viewerPass,email_confirm:true,
    }))
    if(!ownerData.user||!viewerData.user)throw new Error('Failed to create users')
    ownerId=ownerData.user.id;viewerId=viewerData.user.id
    checked(await viewer.auth.signInWithPassword({
      email:'mr5d3d1-viewer-'+suffix+'@example.test',password:viewerPass,
    }))
  },30000)
  afterAll(async()=>{
    for(const id of orgs){
      const {error}=await admin.from('organizations').delete().eq('id',id)
      if(error)throw error
    }
    for(const id of [ownerId,viewerId]){
      if(id){const {error}=await admin.auth.admin.deleteUser(id)
        if(error)throw error}
    }
  })
  it('reports no provisioning or checkout reservations without creating them',async()=>{
    const id=await org()
    expect(await diagnosis(id)).toEqual({
      outcome:'READY',customer:'NOT_STARTED',checkout:'NOT_STARTED',
    })
    expect(checked(await admin.from('stripe_test_customer_provisioning')
      .select('id').eq('organization_id',id))).toHaveLength(0)
    expect(checked(await admin.from('stripe_test_checkout_reservations')
      .select('id').eq('organization_id',id))).toHaveLength(0)
  })
  it('blocks VIEWER and foreign owner with no provider data disclosure',async()=>{
    const id=await org(),other=await org()
    expect(await diagnosis(id,viewerId)).toEqual({outcome:'NOT_AUTHORIZED'})
    expect(await diagnosis(id,randomUUID())).toEqual({outcome:'NOT_AUTHORIZED'})
    // Other member only has Viewer membership; crossing with forged actor is blocked.
    expect(await diagnosis(randomUUID(),ownerId)).toEqual({outcome:'NOT_AUTHORIZED'})
    expect(await diagnosis(other,viewerId)).toEqual({outcome:'NOT_AUTHORIZED'})
  })
  it('classifies in-flight, reusable lease and aged Customer provisioning',async()=>{
    const id=await org()
    await customerPending(id)
    expect((await diagnosis(id)).customer).toBe('IN_FLIGHT')
    checked(await admin.from('stripe_test_customer_provisioning').update({
      lease_expires_at:past,
    }).eq('organization_id',id).select('id'))
    expect((await diagnosis(id)).customer).toBe('RETRY_SAME_RESERVATION')
    checked(await admin.from('stripe_test_customer_provisioning').update({
      created_at:past,
    }).eq('organization_id',id).select('id'))
    expect((await diagnosis(id)).customer).toBe('RECONCILE_PROVIDER')
  })
  it('account linkage takes precedence over an old Customer reservation',async()=>{
    const id=await org()
    await customerPending(id)
    checked(await admin.from('stripe_test_customer_provisioning').update({
      created_at:past,
    }).eq('organization_id',id).select('id'))
    await account(id)
    expect((await diagnosis(id)).customer).toBe('ACCOUNT_LINKED')
  })
  it('classifies in-flight, safe same-key retry and aged Checkout reservation',async()=>{
    const id=await org(),a=await account(id)
    await checkoutPending(id,a.id,a.provider_customer_id)
    expect((await diagnosis(id)).checkout).toBe('IN_FLIGHT')
    checked(await admin.from('stripe_test_checkout_reservations').update({
      lease_expires_at:past,
    }).eq('organization_id',id).select('id'))
    expect((await diagnosis(id)).checkout).toBe('RETRY_SAME_RESERVATION')
    checked(await admin.from('stripe_test_checkout_reservations').update({
      created_at:past,
    }).eq('organization_id',id).select('id'))
    expect((await diagnosis(id)).checkout).toBe('RECONCILE_PROVIDER')
  })
  it('distinguishes saved active session and expired session needing reconciliation',async()=>{
    const id=await org(),a=await account(id)
    await checkoutPending(id,a.id,a.provider_customer_id)
    checked(await admin.from('stripe_test_checkout_reservations').update({
      status:'READY',lease_token:null,lease_expires_at:null,
      stripe_session_id:'cs_test_RecoverySynthetic',
      stripe_session_url:'https://checkout.stripe.com/c/pay/cs_test_RecoverySynthetic',
    }).eq('organization_id',id).select('id'))
    expect((await diagnosis(id)).checkout).toBe('ACTIVE_SESSION')
    checked(await admin.from('stripe_test_checkout_reservations').update({
      session_expires_at:past,
    }).eq('organization_id',id).select('id'))
    expect((await diagnosis(id)).checkout).toBe('RECONCILE_PROVIDER')
  })
  it('subscription projection takes precedence without claiming payment settlement',async()=>{
    const id=await org(),a=await account(id)
    await checkoutPending(id,a.id,a.provider_customer_id)
    checked(await admin.from('organization_subscriptions').insert({
      organization_id:id,billing_account_id:a.id,
      provider:'stripe',environment:'TEST',
      provider_subscription_id:'sub_Recovery'+randomUUID().replaceAll('-',''),
      provider_status:'active',normalized_status:'ACTIVE',
    }).select('id'))
    expect((await diagnosis(id)).checkout).toBe('SUBSCRIPTION_RECORDED')
  })
  it('RPC and underlying private tables cannot be read by unauthenticated or ordinary users',async()=>{
    const id=await org()
    await customerPending(id)
    for(const client of [anonymous,viewer]){
      const rpc=await client.rpc('inspect_stripe_test_billing_recovery',{
        p_user_id:ownerId,p_organization_id:id,
      })
      expect(rpc.error).not.toBeNull()
      expect((await client.from('stripe_test_customer_provisioning')
        .select('id').eq('organization_id',id)).error).not.toBeNull()
      expect((await client.from('stripe_test_checkout_reservations')
        .select('id').eq('organization_id',id)).error).not.toBeNull()
    }
  })
})
