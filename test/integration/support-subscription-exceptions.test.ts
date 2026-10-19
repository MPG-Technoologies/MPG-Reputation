import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
let currentClient: ReturnType<typeof createClient<Database>>
let privilegedClient: ReturnType<typeof createClient<Database>>
vi.mock('@/lib/supabase/server', () => ({
 createClient: vi.fn(async () => currentClient),
}))
vi.mock('@/lib/supabase/admin', () => ({
 createAdminClient: vi.fn(() => privilegedClient),
}))
import { getSupportSubscriptionExceptionCases } from '../../src/lib/support/subscription-exceptions'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL!
const key=process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const opts={auth:{persistSession:false,autoRefreshToken:false}}
const db=createClient<Database>(url,key,opts)
const anon=createClient<Database>(url,anonKey,opts)
const suffix=randomUUID().replaceAll('-','')
let staff:typeof db,owner:typeof db
let staffId='',ownerId='',orgA='',orgB='',subId='',webhookId='',caseId=''
const vars=[
 'ENABLE_LOCAL_SUBSCRIPTION_EXCEPTION_SUPPORT_VIEW',
 'MPG_SUBSCRIPTION_EXCEPTION_SUPPORT_TARGET','ENABLE_LIVE_BILLING','VERCEL_ENV',
] as const
const original=Object.fromEntries(vars.map(k=>[k,process.env[k]]))
function checked<T extends {data:unknown;error:unknown}>(r:T):NonNullable<T['data']>{
 if(r.error || r.data===null) throw new Error('MR-5E3C3C fixture failed',{cause:r.error})
 return r.data as NonNullable<T['data']>
}
async function makeUser(label:string){
 const email='mr5e3c3c-'+label+'-'+suffix+'@example.test'
 const password=randomUUID()
 const data=checked(await db.auth.admin.createUser({email,password,email_confirm:true}))
 if(!data.user)throw new Error('USER_SETUP_FAILED')
 const client=createClient<Database>(url,anonKey,opts)
 checked(await client.auth.signInWithPassword({email,password}))
 return {id:data.user.id,client}
}
async function grant(){
 checked(await db.from('support_access_grants').upsert({
  organization_id:orgA,user_id:staffId,support_role:'MPG_ADMIN',
  expires_at:new Date(Date.now()+3600000).toISOString(),revoked_at:null,
 },{onConflict:'organization_id,user_id'}).select('id'))
}
function blockAudit(){
 return createClient<Database>(url,key,{...opts,global:{
  fetch:async(input,init)=>{
   const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
   if(target.pathname.includes('/rest/v1/audit_events') &&
      (init?.method??'GET').toUpperCase()==='POST'){
    return Response.json({message:'forced synthetic audit denial'},{status:500})
   }
   return fetch(input,init)
  },
 }})
}

describe('MR-5E3C3C scoped subscription exception inspection (disposable PostgreSQL)',()=>{
 beforeAll(async()=>{
  expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
  expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
  orgA=checked(await db.from('organizations')
   .insert({name:'Subscription Exception Support A',slug:'mr5e3c3c-a-'+suffix})
   .select('id').single()).id
  orgB=checked(await db.from('organizations')
   .insert({name:'Subscription Exception Support B',slug:'mr5e3c3c-b-'+suffix})
   .select('id').single()).id
  const u=await makeUser('staff'),o=await makeUser('owner')
  staff=u.client;staffId=u.id;owner=o.client;ownerId=o.id
  checked(await db.from('organization_users').insert([
   {organization_id:orgA,user_id:staffId,role:'VIEWER'},
   {organization_id:orgA,user_id:ownerId,role:'OWNER'},
   {organization_id:orgB,user_id:staffId,role:'VIEWER'},
  ]).select('id'))
  const account=checked(await db.from('organization_billing_accounts').insert({
   organization_id:orgA,provider:'stripe',environment:'TEST',
   provider_customer_id:'cus_mr5e3c3c'+suffix,
  }).select('id').single())
  subId=checked(await db.from('organization_subscriptions').insert({
   organization_id:orgA,billing_account_id:account.id,
   provider:'stripe',environment:'TEST',
   provider_subscription_id:'sub_mr5e3c3c'+suffix,
   provider_status:'active',normalized_status:'ACTIVE',
  }).select('id').single()).id
  webhookId=checked(await db.from('billing_webhook_events').insert({
   organization_id:orgA,provider:'stripe',environment:'TEST',
   provider_event_id:'evt_mr5e3c3c'+suffix,
   event_type:'invoice.payment_failed',
   payload_hash:'a'.repeat(64),processing_status:'RECEIVED',
  }).select('id').single()).id
  caseId=checked(await db.from('billing_synthetic_subscription_exception_reviews')
   .insert({organization_id:orgA,subscription_record_id:subId,
    webhook_event_record_id:webhookId,review_reason:'REPEATED_PAYMENT_FAILURE',
   }).select('id').single()).id
  process.env.ENABLE_LOCAL_SUBSCRIPTION_EXCEPTION_SUPPORT_VIEW='true'
  process.env.MPG_SUBSCRIPTION_EXCEPTION_SUPPORT_TARGET='LOCAL_SYNTHETIC'
  process.env.ENABLE_LIVE_BILLING='false'
  delete process.env.VERCEL_ENV
 },30000)
 beforeEach(async()=>{
  currentClient=staff;privilegedClient=db;await grant()
 })
 afterAll(async()=>{
  for(const name of vars){
   if(original[name]===undefined)delete process.env[name]
   else process.env[name]=original[name]
  }
  for(const id of [orgA,orgB]){
   if(id){const {error}=await db.from('organizations').delete().eq('id',id)
    if(error)throw error}
  }
  if(webhookId)await db.from('billing_webhook_events').delete().eq('id',webhookId)
  for(const id of [staffId,ownerId]){
   if(id){const {error}=await db.auth.admin.deleteUser(id)
    if(error)throw error}
  }
 })
 it('denies a business OWNER without MPG support grant',async()=>{
  currentClient=owner
  expect(await getSupportSubscriptionExceptionCases(orgA)).toEqual({status:'DENIED'})
 })
 it('denies anonymous, foreign-organization and revoked access',async()=>{
  currentClient=anon
  expect(await getSupportSubscriptionExceptionCases(orgA)).toEqual({status:'DENIED'})
  currentClient=staff
  expect(await getSupportSubscriptionExceptionCases(orgB)).toEqual({status:'DENIED'})
  checked(await db.from('support_access_grants').update({
   revoked_at:new Date().toISOString(),
  }).eq('organization_id',orgA).eq('user_id',staffId).select('id'))
  expect(await getSupportSubscriptionExceptionCases(orgA)).toEqual({status:'DENIED'})
 })
 it('provides only minimal synthetic case fields after persisting the actual actor audit',async()=>{
  const result=await getSupportSubscriptionExceptionCases(orgA)
  expect(result.status).toBe('AVAILABLE')
  if(result.status!=='AVAILABLE')return
  expect(result.cases).toEqual([{
   id:caseId,subscriptionRecordId:subId,
   reason:'REPEATED_PAYMENT_FAILURE',openedAt:expect.any(String),
  }])
  const text=JSON.stringify(result)
  expect(text).not.toContain('cus_')
  expect(text).not.toContain(ownerId)
  expect(text).not.toContain(webhookId)
  const audits=checked(await db.from('audit_events')
   .select('actor_id,organization_id,event_type,entity_type,entity_id,metadata')
   .eq('organization_id',orgA)
   .eq('event_type','support.subscription_exception_inspection'))
  expect(audits).toContainEqual({
   actor_id:staffId,organization_id:orgA,
   event_type:'support.subscription_exception_inspection',
   entity_type:'organization',entity_id:orgA,
   metadata:{outcome:'AVAILABLE'},
  })
 })
 it('refuses to reveal case rows if audit persistence fails',async()=>{
  privilegedClient=blockAudit()
  expect(await getSupportSubscriptionExceptionCases(orgA)).toEqual({status:'UNAVAILABLE'})
 })
 it('rejects direct access for anon and ordinary authenticated users',async()=>{
  for(const client of [anon,owner,staff]){
   const r=await client.from('billing_synthetic_subscription_exception_reviews')
    .select('id').eq('organization_id',orgA)
   expect(r.error).not.toBeNull()
  }
 })
})
