import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../src/types/database'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL!
const service=process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const opts={auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient<Database>(url,service,opts)
const anon=createClient<Database>(url,anonKey,opts)
const viewer=createClient<Database>(url,anonKey,opts)
const suffix=randomUUID().replaceAll('-','')
let ownerId='',viewerId=''
const orgIds:string[]=[]

function checked<T extends {data:unknown;error:unknown}>(response:T):NonNullable<T['data']>{
  if(response.error || response.data===null)throw new Error('Recovery SQL fixture failed',{cause:response.error})
  return response.data as NonNullable<T['data']>
}
function object(value:Json|null):Record<string,unknown>{
  if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('Invalid database JSON')
  return value as Record<string,unknown>
}
async function setupOrg(){
  const org=checked(await admin.from('organizations').insert({
    name:'Recovery Truth Synthetic',slug:'mr5d3d2-'+randomUUID().replaceAll('-',''),
  }).select('id').single())
  orgIds.push(org.id)
  checked(await admin.from('organization_users').insert([
    {organization_id:org.id,user_id:ownerId,role:'OWNER'},
    {organization_id:org.id,user_id:viewerId,role:'VIEWER'},
  ]).select('id'))
  return org.id
}
async function context(orgId:string,userId=ownerId){
  return object(checked(await admin.rpc('read_stripe_test_provider_recovery_context',{
    p_user_id:userId,p_organization_id:orgId,
  })))
}
describe('MR-5D3D2 service-only provider truth context (disposable PostgreSQL)',()=>{
  beforeAll(async()=>{
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    const ownerData=checked(await admin.auth.admin.createUser({
      email:'mr5d3d2-owner-'+suffix+'@example.test',
      password:randomUUID(),email_confirm:true,
    }))
    const viewerData=checked(await admin.auth.admin.createUser({
      email:'mr5d3d2-viewer-'+suffix+'@example.test',
      password:randomUUID(),email_confirm:true,
    }))
    if(!ownerData.user||!viewerData.user)throw new Error('No synthetic users')
    ownerId=ownerData.user.id;viewerId=viewerData.user.id
  },30000)
  afterAll(async()=>{
    for(const id of orgIds){
      const {error}=await admin.from('organizations').delete().eq('id',id)
      if(error)throw error
    }
    for(const id of [ownerId,viewerId]){
      if(id){const {error}=await admin.auth.admin.deleteUser(id);if(error)throw error}
    }
  })
  it('blocks anon/authenticated RPC calls and foreign/VIEWER identities',async()=>{
    const id=await setupOrg()
    const fake={p_user_id:ownerId,p_organization_id:id}
    expect((await anon.rpc('read_stripe_test_provider_recovery_context',fake)).error).not.toBeNull()
    expect((await viewer.rpc('read_stripe_test_provider_recovery_context',fake)).error).not.toBeNull()
    expect(await context(id,viewerId)).toEqual({outcome:'NOT_AUTHORIZED'})
    expect(await context(id,randomUUID())).toEqual({outcome:'NOT_AUTHORIZED'})
    expect(await context(randomUUID())).toEqual({outcome:'NOT_AUTHORIZED'})
  })
  it('missing Customer and Checkout records are null and not inferred absent at Stripe',async()=>{
    const id=await setupOrg()
    const result=await context(id)
    expect(result).toMatchObject({
      outcome:'READY',customer_id:null,customer_linked:false,
      customer_local_conflict:false,checkout_id:null,
      checkout_reservation_id:null,checkout_customer_id:null,
      checkout_price_id:null,checkout_expires_at:null,
      has_subscription:false,
    })
    expect(Object.keys(result)).toHaveLength(13)
  })
  it('reads exact frozen Customer, mapped TEST account and saved Checkout identity',async()=>{
    const id=await setupOrg(),cust='cus_ReadOnly'+randomUUID().replaceAll('-','')
    checked(await admin.from('stripe_test_customer_provisioning').insert({
      organization_id:id,organization_name:'Frozen Business',
      state:'READY',provider_customer_id:cust,
      lease_token:null,lease_expires_at:null,
    }).select('id'))
    const account=checked(await admin.from('organization_billing_accounts').insert({
      organization_id:id,environment:'TEST',provider:'stripe',
      provider_customer_id:cust,
    }).select('id').single())
    const expires='2026-10-21T12:34:00Z'
    const reserved=checked(await admin.from('stripe_test_checkout_reservations').insert({
      organization_id:id,billing_account_id:account.id,
      provider:'stripe',environment:'TEST',provider_customer_id:cust,
      provider_price_id:'price_ExactPlan',plan_id:'monthly',
      return_origin:'http://localhost:3000',status:'READY',
      stripe_session_id:'cs_test_ExactSaved',
      stripe_session_url:'https://checkout.stripe.com/c/pay/cs_test_ExactSaved',
      session_expires_at:expires,reservation_expires_at:'2026-10-21T13:00:00Z',
    }).select('id').single())
    const snapshot=await context(id)
    expect(snapshot).toMatchObject({
      outcome:'READY',customer_id:cust,customer_linked:true,
      customer_expected_name:'Frozen Business',customer_local_conflict:false,
      checkout_id:'cs_test_ExactSaved',
      checkout_reservation_id:reserved.id,
      checkout_customer_id:cust,checkout_price_id:'price_ExactPlan',
      checkout_status:'READY',
      checkout_origin:'http://localhost:3000',
      checkout_expires_at:Math.floor(Date.parse(expires)/1000),
      has_subscription:false,
    })
  })
  it('detects a conflicting local Customer mapping without mutating it',async()=>{
    const id=await setupOrg()
    checked(await admin.from('stripe_test_customer_provisioning').insert({
      organization_id:id,organization_name:'Original Business',state:'READY',
      provider_customer_id:'cus_Different',
    }).select('id'))
    checked(await admin.from('organization_billing_accounts').insert({
      organization_id:id,environment:'TEST',provider:'stripe',
      provider_customer_id:'cus_TrustedMapping',
    }).select('id'))
    expect(await context(id)).toMatchObject({
      customer_id:'cus_TrustedMapping',customer_local_conflict:true,
    })
    const rows=checked(await admin.from('organization_billing_accounts')
      .select('provider_customer_id').eq('organization_id',id))
    expect(rows).toHaveLength(1)
    expect(rows[0].provider_customer_id).toBe('cus_TrustedMapping')
  })
  it('returns only a boolean for existing non-ended TEST subscription; no payment assertion',async()=>{
    const id=await setupOrg()
    const account=checked(await admin.from('organization_billing_accounts').insert({
      organization_id:id,environment:'TEST',provider:'stripe',
      provider_customer_id:'cus_Existing'+randomUUID().replaceAll('-',''),
    }).select('id').single())
    checked(await admin.from('organization_subscriptions').insert({
      organization_id:id,billing_account_id:account.id,environment:'TEST',
      provider:'stripe',provider_subscription_id:'sub_Existing'+randomUUID().replaceAll('-',''),
      provider_status:'active',normalized_status:'ACTIVE',
    }).select('id'))
    expect(await context(id)).toMatchObject({
      outcome:'READY',has_subscription:true,
    })
  })
})
