import { randomUUID } from 'node:crypto'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error('SYNTHETIC_REDIRECT:' + path) },
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement('a', { href }, children),
}))
vi.mock('@/components/layout/page-shell', () => ({
  PageShell: ({ children }: { children: ReactNode }) => createElement('main', null, children),
  PageHeader: ({ title, subtitle, actions }: {
    title: ReactNode; subtitle?: ReactNode; actions?: ReactNode
  }) => createElement('header', null, title, subtitle, actions),
}))
vi.mock('@/components/layout/panels', () => ({
  Panel: ({ children }: { children: ReactNode }) => createElement('section', null, children),
}))
let activeClient: ReturnType<typeof createClient<Database>>
let privateClient: ReturnType<typeof createClient<Database>>
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => activeClient),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => privateClient),
}))
import { getSupportBillingRecoveryCases } from '../../src/lib/support/billing-recovery'
import { headers } from 'next/headers'
import SupportBillingRecoveryPage from '../../src/app/admin/organizations/[organizationId]/billing-recovery/page'
import ScopedBillingPage from '../../src/app/workspace/organizations/[organizationId]/billing/page'

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
  it('separates real client-owner billing from audited MPG support recovery pages', async () => {
    // Use the existing disposable PostgreSQL Auth/RLS fixtures to render the
    // actual server pages; no mocked grant decisions or payment adapters.
    const normalHeaders = { has: () => false, get: () => null }
    vi.mocked(headers).mockResolvedValue(normalHeaders as never)
    const renderClientBilling = async () => renderToStaticMarkup(createElement(
      'div', null,
      await ScopedBillingPage({ params: Promise.resolve({ organizationId: orgA }) }),
    ))
    const renderSupportCases = async () => renderToStaticMarkup(createElement(
      'div', null,
      await SupportBillingRecoveryPage({ params: Promise.resolve({ organizationId: orgA }) }),
    ))
    const auditCount = async () => {
      const { count, error } = await admin.from('audit_events')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgA)
        .eq('event_type', 'support.billing_recovery_inspection')
      expect(error).toBeNull()
      return count
    }

    activeClient = owner
    const ownerBilling = await renderClientBilling()
    expect(ownerBilling).toContain('Billing &amp; subscription')
    expect(ownerBilling).toContain('30 Free Review Requests')
    expect(ownerBilling).toContain('Read-only engineering view')
    expect(ownerBilling).not.toContain(caseId)
    const ownerAuditBefore = await auditCount()
    const ownerSupport = await renderSupportCases()
    expect(ownerSupport).toContain('Access unavailable')
    expect(ownerSupport).not.toContain(caseId)
    expect(await auditCount()).toBe(ownerAuditBefore)

    activeClient = staff
    const staffBilling = await renderClientBilling()
    expect(staffBilling).toContain('Owner or administrator access required')
    expect(staffBilling).not.toContain(caseId)
    expect(staffBilling).not.toContain('Recovery Support A')

    // Next.js background prefetch must not access cases or produce audit
    // entries; a deliberate direct visit requires fresh grant + audit.
    vi.mocked(headers).mockResolvedValueOnce({
      has: (name: string) => name === 'next-router-prefetch',
      get: () => null,
    } as never)
    const prefetched = await renderSupportCases()
    expect(prefetched).toContain('Open this page directly')
    expect(prefetched).not.toContain(caseId)
    expect(await auditCount()).toBe(ownerAuditBefore)

    const staffSupport = await renderSupportCases()
    expect(staffSupport).toContain('Billing recovery reviews')
    expect(staffSupport).toContain(caseId)
    expect(staffSupport).toContain('Investigation only')
    expect(staffSupport).toContain('not payment confirmation')
    expect(staffSupport).not.toContain('Approve payment')
    expect(await auditCount()).toBe(ownerAuditBefore + 1)
    const recorded = checked(await admin.from('audit_events')
      .select('actor_id,metadata')
      .eq('organization_id', orgA)
      .eq('event_type', 'support.billing_recovery_inspection')
      .order('created_at', { ascending: false })
      .limit(1))
    expect(recorded).toEqual([{ actor_id: staffId, metadata: { outcome: 'AVAILABLE' } }])

    // A later revoked support grant must stop the same server page from
    // rendering the previously inspected case, even with tenant membership.
    checked(await admin.from('support_access_grants').update({
      revoked_at: new Date().toISOString(),
    }).eq('organization_id', orgA).eq('user_id', staffId).select('id'))
    const afterRevocation = await renderSupportCases()
    expect(afterRevocation).toContain('Access unavailable')
    expect(afterRevocation).not.toContain(caseId)
    expect(await auditCount()).toBe(ownerAuditBefore + 1)
  }, 30000)

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
