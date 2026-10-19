import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const enabled = !!serviceKey && serviceKey !== 'dummy_service_role_key'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const opts = {auth:{persistSession:false,autoRefreshToken:false}}
const suffix = randomUUID().replaceAll('-','')
const hash = 'a'.repeat(64)
const price = 'price_mr5i4f' + suffix

type DraftInsert =
  Database['public']['Tables']['billing_synthetic_invoice_evidence_drafts']['Insert']

describe.skipIf(!enabled)('MR-5I4F unverified invoice evidence staging (disposable PostgreSQL)',()=>{
  const admin=createClient<Database>(url,serviceKey!,opts)
  const anon=createClient<Database>(url,anonKey,opts)
  const owner=createClient<Database>(url,anonKey,opts)
  const orgIds:string[]=[]
  const eventIds:string[]=[]
  let orgA='',orgB='',accountA='',accountB='',subA='',subB='',ownerId=''
  let originalEvent=''

  async function org(name:string){
    const {data,error}=await admin.from('organizations').insert({
      name:'MR5I4F synthetic '+name,slug:'mr5i4f-'+name+'-'+suffix,
    }).select('id').single()
    if(error||!data)throw new Error('MR5I4F_ORG_FIXTURE_FAILED')
    orgIds.push(data.id);return data.id
  }

  async function accountAndSubscription(organizationId:string,name:string){
    const {data:a,error:e}=await admin.from('organization_billing_accounts')
      .insert({organization_id:organizationId,provider:'stripe',environment:'TEST',
        provider_customer_id:'cus_mr5i4f'+name+suffix}).select('id').single()
    if(e||!a)throw new Error('MR5I4F_ACCOUNT_FIXTURE_FAILED')
    const {data:s,error:err}=await admin.from('organization_subscriptions')
      .insert({organization_id:organizationId,billing_account_id:a.id,
        provider:'stripe',environment:'TEST',provider_subscription_id:'sub_mr5i4f'+name+suffix,
        provider_price_id:price,provider_status:'active',normalized_status:'ACTIVE',
        current_period_end:'2026-12-01T00:00:00Z'}).select('id').single()
    if(err||!s)throw new Error('MR5I4F_SUB_FIXTURE_FAILED')
    return {account:a.id,sub:s.id}
  }

  async function event(input:{
    organizationId?:string|null;invoiceId?:string;eventType?:string;
    status?:'RECEIVED'|'PROCESSING'|'PROCESSED';hash?:string;
    environment?:'TEST'|'LIVE';
  }={}){
    const seq=eventIds.length+1
    const providerEventId='evt_mr5i4f'+suffix+seq
    const providerInvoiceId=input.invoiceId??'in_mr5i4f'+suffix+seq
    const {data,error}=await admin.from('billing_webhook_events').insert({
      provider:'stripe',environment:input.environment??'TEST',
      organization_id:input.organizationId===undefined?null:input.organizationId,
      provider_event_id:providerEventId,provider_invoice_id:providerInvoiceId,
      event_type:input.eventType??'invoice.paid',
      payload_hash:input.hash??hash,processing_status:input.status??'RECEIVED',
      processed_at:input.status==='PROCESSED'?'2026-10-19T12:00:00Z':null,
    }).select('id').single()
    if(error||!data)throw new Error('MR5I4F_EVENT_FIXTURE_FAILED')
    eventIds.push(data.id)
    return {id:data.id,providerEventId,providerInvoiceId}
  }

  function draft(source:{
    id:string;providerEventId:string;providerInvoiceId:string;
  },overrides:Record<string,unknown>={}):DraftInsert {
    return {
      organization_id:orgA,billing_account_id:accountA,
      subscription_record_id:subA,webhook_event_record_id:source.id,
      provider_invoice_id:source.providerInvoiceId,
      provider_event_id:source.providerEventId,
      source_payload_hash:hash,candidate_price_id:price,
      candidate_amount_minor:150_000,candidate_interval:'month',
      candidate_period_start:'2026-11-01T00:00:00Z',
      candidate_period_end:'2026-12-01T00:00:00Z',
      ...overrides,
    } as DraftInsert
  }
  const insert=(record:DraftInsert)=>admin.from('billing_synthetic_invoice_evidence_drafts')
    .insert(record).select('id, organization_id, provider_invoice_id, source_kind, verification_status, financial_finality, access_authorized').single()

  beforeAll(async()=>{
    if(!['http://127.0.0.1:54331','http://localhost:54331'].includes(url)||
       process.env.ENABLE_LIVE_BILLING==='true')throw new Error('MR5I4F_DISPOSABLE_ONLY')
    orgA=await org('a')
    orgB=await org('b')
    const a=await accountAndSubscription(orgA,'a')
    accountA=a.account;subA=a.sub
    const b=await accountAndSubscription(orgB,'b')
    accountB=b.account;subB=b.sub
    const source=await event()
    originalEvent=source.id
    const {data:user,error}=await admin.auth.admin.createUser({
      email:'mr5i4f-'+suffix+'@example.test',
      password:'SyntheticPass123!',email_confirm:true,
    })
    if(error||!user.user)throw new Error('MR5I4F_OWNER_USER_FAILED')
    ownerId=user.user.id
    const {error:roleError}=await admin.from('organization_users').insert({
      organization_id:orgA,user_id:ownerId,role:'OWNER',
    })
    if(roleError)throw new Error('MR5I4F_ROLE_FAILED')
    const {error:authError}=await owner.auth.signInWithPassword({
      email:'mr5i4f-'+suffix+'@example.test',password:'SyntheticPass123!',
    })
    if(authError)throw new Error('MR5I4F_LOGIN_FAILED')
  },30000)

  afterAll(async()=>{
    for(const id of orgIds) await admin.from('organizations').delete().eq('id',id)
    for(const id of eventIds) await admin.from('billing_webhook_events').delete().eq('id',id)
    if(ownerId)await admin.auth.admin.deleteUser(ownerId)
  })

  it('stages source-linked synthetic terms with hard-false finality and access',async()=>{
    const {data:source,error:readError}=await admin.from('billing_webhook_events')
      .select('id,provider_event_id,provider_invoice_id')
      .eq('id',originalEvent).single()
    expect(readError).toBeNull()
    if(!source?.provider_invoice_id)throw new Error('MR5I4F_EXPECTED_SOURCE')
    const {data,error}=await insert(draft({
      id:source.id,providerEventId:source.provider_event_id,
      providerInvoiceId:source.provider_invoice_id,
    }))
    expect(error).toBeNull()
    expect(data).toMatchObject({organization_id:orgA,
      source_kind:'SYNTHETIC',verification_status:'UNVERIFIED',
      financial_finality:false,access_authorized:false})
  })

  it('rejects a second signed Event ID for the SAME invoice (even different hash)',async()=>{
    const {data:first}=await admin.from('billing_webhook_events')
      .select('provider_invoice_id').eq('id',originalEvent).single()
    if(!first?.provider_invoice_id)throw new Error('MR5I4F_MISSING_INVOICE')
    const second=await event({invoiceId:first.provider_invoice_id,hash:'b'.repeat(64)})
    const {error}=await insert(draft(second,{source_payload_hash:'b'.repeat(64)}))
    expect(error?.code).toBe('23505')
  })

  it('rejects concurrent duplicate invoice stages: exactly one succeeds',async()=>{
    const invoiceId='in_mr5i4frace'+suffix
    const [a,b]=await Promise.all([event({invoiceId}),event({invoiceId})])
    const results=await Promise.all([insert(draft(a)),insert(draft(b))])
    expect(results.filter(r=>r.error===null)).toHaveLength(1)
    expect(results.filter(r=>r.error?.code==='23505')).toHaveLength(1)
  })

  it('rejects cross-tenant account/subscription associations',async()=>{
    const first=await event()
    expect((await insert(draft(first,{billing_account_id:accountB}))).error?.message)
      .toContain('MR5I4F_ACCOUNT_IDENTITY_MISMATCH')
    const second=await event()
    expect((await insert(draft(second,{subscription_record_id:subB}))).error?.message)
      .toContain('MR5I4F_SUBSCRIPTION_IDENTITY_MISMATCH')
    const third=await event({organizationId:orgB})
    expect((await insert(draft(third))).error?.message)
      .toContain('MR5I4F_SOURCE_RECEIPT_MISMATCH')
  })

  it('rejects tampered event ID/hash/invoice and unrelated event types',async()=>{
    const first=await event()
    for(const mutation of [
      {provider_event_id:'evt_fake'}, {source_payload_hash:'b'.repeat(64)},
      {provider_invoice_id:'in_wrong'},
    ]){
      expect((await insert(draft(first,mutation))).error?.message)
        .toContain('MR5I4F_SOURCE_RECEIPT_MISMATCH')
    }
    const failed=await event({eventType:'invoice.payment_failed'})
    expect((await insert(draft(failed))).error?.message)
      .toContain('MR5I4F_SOURCE_RECEIPT_MISMATCH')
    const complete=await event({status:'PROCESSED'})
    expect((await insert(draft(complete))).error?.message)
      .toContain('MR5I4F_SOURCE_RECEIPT_MISMATCH')
    const live=await event({environment:'LIVE'})
    expect((await insert(draft(live))).error).not.toBeNull()
  })

  it('rejects a Price different from its saved TEST subscription projection',async()=>{
    const x=await event()
    expect((await insert(draft(x,{candidate_price_id:'price_foreign'}))).error?.message)
      .toContain('MR5I4F_PRICE_PROJECTION_MISMATCH')
  })

  it('enforces impossible financial authority claims and invalid candidate terms',async()=>{
    for(const mutation of [
      {verification_status:'VERIFIED'},{financial_finality:true},
      {access_authorized:true},{source_kind:'REAL_PROVIDER'},
      {environment:'LIVE'},{candidate_currency:'USD'},
      {candidate_amount_minor:0},{candidate_interval:'week'},
      {candidate_price_id:'invalid'},{candidate_period_end:'2026-10-01T00:00:00Z'},
    ]){
      const x=await event()
      expect((await insert(draft(x,mutation))).error).not.toBeNull()
    }
  })

  it('denies anon and authorized tenant OWNER direct reads/inserts',async()=>{
    const a=await anon.from('billing_synthetic_invoice_evidence_drafts').select('id')
    expect(a.error?.code).toBe('42501')
    const b=await owner.from('billing_synthetic_invoice_evidence_drafts')
      .select('id').eq('organization_id',orgA)
    expect(b.error?.code).toBe('42501')
    const x=await event()
    const c=await owner.from('billing_synthetic_invoice_evidence_drafts')
      .insert(draft(x))
    expect(c.error?.code).toBe('42501')
  })

  it('forbids service-role direct UPDATE/DELETE but permits synthetic SELECT/INSERT',async()=>{
    const change=await admin.from('billing_synthetic_invoice_evidence_drafts')
      .update({financial_finality:false}).eq('organization_id',orgA)
    expect(change.error?.code).toBe('42501')
    const del=await admin.from('billing_synthetic_invoice_evidence_drafts')
      .delete().eq('organization_id',orgA)
    expect(del.error?.code).toBe('42501')
  })

  it('does not process invoice events or modify the 30 Free Review Requests trial',async()=>{
    const {data:source}=await admin.from('billing_webhook_events')
      .select('processing_status,processed_at,organization_id')
      .eq('id',originalEvent).single()
    expect(source).toMatchObject({processing_status:'RECEIVED',
      processed_at:null,organization_id:null})
    const {error}=await admin.rpc('provision_organization_trial',{p_org_id:orgA})
    expect(error).toBeNull()
    const {data:trial}=await admin.from('organization_entitlements')
      .select('allocated_requests,consumed_requests,status')
      .eq('organization_id',orgA).single()
    expect(trial).toMatchObject({
      allocated_requests:30,consumed_requests:0,status:'NOT_STARTED',
    })
  })

  it('supports tenant erasure cascade while preserving original webhook audit erasure policy',async()=>{
    const disposable=await org('erasure')
    const binding=await accountAndSubscription(disposable,'erasure')
    const src=await event({organizationId:disposable})
    const {error:writeError}=await insert(draft(src,{
      organization_id:disposable,billing_account_id:binding.account,
      subscription_record_id:binding.sub,
    }))
    expect(writeError).toBeNull()
    const {error:deleteError}=await admin.from('organizations')
      .delete().eq('id',disposable)
    expect(deleteError).toBeNull()
    const {data:drafts}=await admin.from('billing_synthetic_invoice_evidence_drafts')
      .select('id').eq('organization_id',disposable)
    expect(drafts).toEqual([])
    const {data:webhook}=await admin.from('billing_webhook_events')
      .select('organization_id').eq('id',src.id).single()
    expect(webhook?.organization_id).toBeNull()
  })
})
