import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
let activeClient: ReturnType<typeof createClient<Database>>
let privateClient: ReturnType<typeof createClient<Database>>
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => activeClient),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => privateClient),
}))
import { getSupportBillingRecoveryCases } from '../../src/lib/support/billing-recovery'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL!
const options={auth:{persistSession:false,autoRefreshToken:false}}
const key=process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const admin=createClient<Database>(url,key,options)
const anonymous=createClient<Database>(url,anonKey,options)
const suffix=randomUUID().replaceAll('-','')
let staff:typeof admin,owner:typeof admin
let staffId='',ownerId='',orgA='',orgB='',caseId=''
const vars=['ENABLE_STRIPE_TEST_RECOVERY_SUPPORT_VIEW',
  'MPG_STRIPE_TEST_RECOVERY_SUPPORT_TARGET','ENABLE_LIVE_BILLING','VERCEL_ENV'] as const
const saved=Object.fromEntries(vars.map(k=>[k,process.env[k]]))
function checked<T extends {data:unknown;error:unknown}>(r:T):NonNullable<T['data']>{
  if(r.error||r.data===null)throw new Error('MR-5D3D3B disposable DB setup failed',{cause:r.error})
  return r.data as NonNullable<T['data']>
}
async function makeUser(label:string){
  const email='mr5d3d3b-'+label+'-'+suffix+'@example.test'
  const password=randomUUID()
  const created=checked(await admin.auth.admin.createUser({email,password,email_confirm:true}))
  if(!created.user)throw new Error('Missing synthetic user')
  const client=createClient<Database>(url,anonKey,options)
  checked(await client.auth.signInWithPassword({email,password}))
  return {id:created.user.id,client}
}
async function grant(){
  checked(await admin.from('support_access_grants').upsert({
    organization_id:orgA,user_id:staffId,support_role:'MPG_ADMIN',
    expires_at:new Date(Date.now()+3600000).toISOString(),revoked_at:null,
  },{onConflict:'organization_id,user_id'}).select('id'))
}
function interceptAudit(){
  return createClient<Database>(url,key,{
    ...options,
    global:{fetch:async(input,init)=>{
      const target=new URL(typeof input==='string'?input:
        input instanceof URL?input.href:input.url)
      if(target.pathname.includes('/rest/v1/audit_events') &&
         (init?.method??'GET').toUpperCase()==='POST'){
        return Response.json({message:'synthetic audit failure'},{status:500})
      }
      return fetch(input,init)
    }},
  })
}

describe('MR-5D3D3B scoped MPG billing recovery inspection (disposable PostgreSQL)',()=>{
  beforeAll(async()=>{
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    orgA=checked(await admin.from('organizations').insert({
      name:'Recovery Support A',slug:'mr5d3d3b-a-'+suffix,
    }).select('id').single()).id
    orgB=checked(await admin.from('organizations').insert({
      name:'Recovery Support B',slug:'mr5d3d3b-b-'+suffix,
    }).select('id').single()).id
    const u=await makeUser('staff')
    const o=await makeUser('owner')
    staff=u.client;staffId=u.id;owner=o.client;ownerId=o.id
    checked(await admin.from('organization_users').insert([
      {organization_id:orgA,user_id:staffId,role:'VIEWER'},
      {organization_id:orgA,user_id:ownerId,role:'OWNER'},
      {organization_id:orgB,user_id:staffId,role:'VIEWER'},
    ]).select('id'))
    caseId=checked(await admin.from('stripe_test_billing_recovery_reviews').insert({
      organization_id:orgA,kind:'CHECKOUT',
      reason:'EXPIRED_CHECKOUT_SESSION',requested_by:ownerId,
    }).select('id').single()).id
    process.env.ENABLE_STRIPE_TEST_RECOVERY_SUPPORT_VIEW='true'
    process.env.MPG_STRIPE_TEST_RECOVERY_SUPPORT_TARGET='LOCAL_SYNTHETIC'
    process.env.ENABLE_LIVE_BILLING='false'
    delete process.env.VERCEL_ENV
  },30000)
  beforeEach(async()=>{
    activeClient=staff
    privateClient=admin
    await grant()
  })
  afterAll(async()=>{
    for(const k of vars){
      if(saved[k]===undefined)delete process.env[k]
      else process.env[k]=saved[k]
    }
    for(const id of [orgA,orgB]){
      if(id){const {error}=await admin.from('organizations').delete().eq('id',id)
        if(error)throw error}
    }
    for(const id of [staffId,ownerId]){
      if(id){const {error}=await admin.auth.admin.deleteUser(id)
        if(error)throw error}
    }
  })
  it('business OWNER without MPG_ADMIN grant cannot inspect a case',async()=>{
    activeClient=owner
    expect(await getSupportBillingRecoveryCases(orgA)).toEqual({status:'DENIED'})
  })
  it('denies anonymous users and a grantless foreign organization',async()=>{
    activeClient=anonymous
    expect(await getSupportBillingRecoveryCases(orgA)).toEqual({status:'DENIED'})
    activeClient=staff
    expect(await getSupportBillingRecoveryCases(orgB)).toEqual({status:'DENIED'})
  })
  it('uses actual scoped MPG_ADMIN grant, minimal fields and mandatory actor audit',async()=>{
    const result=await getSupportBillingRecoveryCases(orgA)
    expect(result.status).toBe('AVAILABLE')
    if(result.status!=='AVAILABLE')return
    expect(result.truncated).toBe(false)
    expect(result.cases).toEqual([{
      id:caseId,kind:'CHECKOUT',reason:'EXPIRED_CHECKOUT_SESSION',
      state:'OPEN',requestedAt:expect.any(String),
    }])
    expect(JSON.stringify(result)).not.toContain(ownerId)
    expect(JSON.stringify(result)).not.toContain('cus_')
    const audits=checked(await admin.from('audit_events').select(
      'actor_id,organization_id,event_type,entity_type,entity_id,metadata'
    ).eq('organization_id',orgA)
      .eq('event_type','support.billing_recovery_inspection'))
    expect(audits).toContainEqual({
      actor_id:staffId,organization_id:orgA,
      event_type:'support.billing_recovery_inspection',
      entity_type:'organization',entity_id:orgA,
      metadata:{outcome:'AVAILABLE'},
    })
  })
  it('revoked support grant fails closed even when the user is still a tenant member',async()=>{
    checked(await admin.from('support_access_grants').update({
      revoked_at:new Date().toISOString(),
    }).eq('organization_id',orgA).eq('user_id',staffId).select('id'))
    expect(await getSupportBillingRecoveryCases(orgA)).toEqual({status:'DENIED'})
  })
  it('returns UNAVAILABLE if mandatory audit persistence fails; never exposes rows',async()=>{
    privateClient=interceptAudit()
    expect(await getSupportBillingRecoveryCases(orgA)).toEqual({status:'UNAVAILABLE'})
  })
  it('ordinary authenticated and anon clients have no access to private cases',async()=>{
    for(const client of [anonymous,owner,staff]){
      expect((await client.from('stripe_test_billing_recovery_reviews')
        .select('id').eq('organization_id',orgA)).error).not.toBeNull()
    }
  })
})
