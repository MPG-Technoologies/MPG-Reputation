import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { requestLocalSyntheticSubscriptionExceptionReview } from '../../src/lib/billing/local-synthetic-exception-review'
import type { SyntheticReconciliationResult } from '../../src/domain/billing/synthetic-exception-reconciliation'
import type { Database } from '../../src/types/database'

const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const hasDisposableDb = !!key && key !== 'dummy_service_role_key'
const priorFlag = process.env.ENABLE_LOCAL_SYNTHETIC_EXCEPTION_REVIEW
const priorTarget = process.env.MPG_SYNTHETIC_EXCEPTION_REVIEW_TARGET
const priorLive = process.env.ENABLE_LIVE_BILLING

describe.skipIf(!hasDisposableDb)('MR-5E3C3B private synthetic exception review intake', () => {
  const db = createAdminClient()
  const nonce = Date.now()
  const prefix = 'evt_mr5e3c3b' + nonce
  const orgIds: string[] = []
  const eventIds: string[] = []
  let orgA = ''
  let orgB = ''
  let subA = ''
  let subB = ''
  let providerSubA = ''
  let providerSubB = ''
  let accountIndex = 0
  let eventIndex = 0

  function localFlags() {
    process.env.ENABLE_LOCAL_SYNTHETIC_EXCEPTION_REVIEW = 'true'
    process.env.MPG_SYNTHETIC_EXCEPTION_REVIEW_TARGET = 'LOCAL_SYNTHETIC'
    delete process.env.ENABLE_LIVE_BILLING
  }

  async function organization(letter: string) {
    const {data,error} = await db.from('organizations')
      .insert({name:'MR5E3C3B synthetic '+letter+' '+nonce,
        slug:'mr5e3c3b-'+letter+'-'+nonce})
      .select('id').single()
    if(error || !data)throw new Error('EXCEPTION_ORG_FIXTURE_FAILED: '+error?.message)
    orgIds.push(data.id)
    return data.id
  }
  async function subscription(orgId: string) {
    const suffix = String(++accountIndex)
    const {data:account,error:aError} = await db.from('organization_billing_accounts')
      .insert({organization_id:orgId,provider:'stripe',environment:'TEST',
        provider_customer_id:'cus_mr5e3c3b'+suffix+nonce})
      .select('id').single()
    if(aError || !account)throw new Error('EXCEPTION_ACCOUNT_SETUP_FAILED: '+aError?.message)
    const providerId='sub_mr5e3c3b'+suffix+nonce
    const {data:sub,error:sError}=await db.from('organization_subscriptions')
      .insert({organization_id:orgId,billing_account_id:account.id,
        provider:'stripe',environment:'TEST',provider_subscription_id:providerId,
        provider_status:'active',normalized_status:'ACTIVE'})
      .select('id').single()
    if(sError || !sub)throw new Error('EXCEPTION_SUB_SETUP_FAILED: '+sError?.message)
    return {id:sub.id,providerId}
  }
  async function webhook(orgId:string) {
    const n=String(++eventIndex)
    const providerEventId=prefix+n
    const {data,error}=await db.from('billing_webhook_events')
      .insert({
        organization_id:orgId,provider:'stripe',environment:'TEST',
        provider_event_id:providerEventId,event_type:'invoice.payment_failed',
        processing_status:'RECEIVED',payload_hash:'e'.repeat(64),
        provider_created_at:'2026-10-19T07:00:00Z',
      })
      .select('id, provider_event_id').single()
    if(error || !data)throw new Error('EXCEPTION_EVENT_SETUP_FAILED: '+error?.message)
    eventIds.push(data.id)
    return data
  }

  function assessment(orgId:string, subscriptionId:string,
    providerSubscriptionId:string, event:{id:string,provider_event_id:string},
    reason='PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW'): SyntheticReconciliationResult {
    return {
      outcome:'REVIEW_REQUIRED',
      audit:{
        organizationId:orgId, subscriptionRecordId:subscriptionId,
        providerSubscriptionId,
        incomingEventId:event.provider_event_id,
        incomingWebhookRecordId:event.id,
        previousEventId:null,
        assessedAt:'2026-10-19T10:00:00Z',
        reason:reason as SyntheticReconciliationResult['audit']['reason'],
        environment:'TEST',sourceKind:'SYNTHETIC',
        evidenceVerified:false,accessAuthorized:false,durableAuditRecorded:false,
      },
    }
  }
  function request(orgId:unknown,subId:unknown,eventId:unknown,
    result:SyntheticReconciliationResult) {
    return requestLocalSyntheticSubscriptionExceptionReview({
      trustedBillingSupabase:db,
      organizationId:orgId,subscriptionRecordId:subId,
      webhookEventRecordId:eventId,assessment:result,
    })
  }

  beforeAll(async()=>{
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL
    if(url!=='http://127.0.0.1:54331' && url!=='http://localhost:54331')
      throw new Error('DISPOSABLE_SUPABASE_REQUIRED')
    localFlags()
    orgA=await organization('a')
    orgB=await organization('b')
    const a=await subscription(orgA),b=await subscription(orgB)
    subA=a.id
    providerSubA=a.providerId
    subB=b.id
    providerSubB=b.providerId
    const {error}=await db.rpc('provision_organization_trial',{p_org_id:orgA})
    if(error)throw new Error('EXCEPTION_TRIAL_SETUP_FAILED: '+error.message)
  })
  beforeEach(localFlags)
  afterAll(async()=>{
    for(const id of orgIds)await db.from('organizations').delete().eq('id',id)
    for(const id of eventIds)await db.from('billing_webhook_events').delete().eq('id',id)
    if(priorFlag===undefined)delete process.env.ENABLE_LOCAL_SYNTHETIC_EXCEPTION_REVIEW
    else process.env.ENABLE_LOCAL_SYNTHETIC_EXCEPTION_REVIEW=priorFlag
    if(priorTarget===undefined)delete process.env.MPG_SYNTHETIC_EXCEPTION_REVIEW_TARGET
    else process.env.MPG_SYNTHETIC_EXCEPTION_REVIEW_TARGET=priorTarget
    if(priorLive===undefined)delete process.env.ENABLE_LIVE_BILLING
    else process.env.ENABLE_LIVE_BILLING=priorLive
  })

  it('records a private OPEN synthetic UNVERIFIED case with hard-false access',async()=>{
    const e=await webhook(orgA)
    const result=await request(orgA,subA,e.id,assessment(orgA,subA,providerSubA,e))
    expect(result.outcome).toBe('CASE_OPENED')
    const {data,error}=await db.from('billing_synthetic_subscription_exception_reviews')
      .select('*').eq('webhook_event_record_id',e.id).single()
    expect(error).toBeNull()
    expect(data).toMatchObject({
      organization_id:orgA,subscription_record_id:subA,
      webhook_event_record_id:e.id,
      review_reason:'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW',review_state:'OPEN',
      source_kind:'SYNTHETIC',verification_status:'UNVERIFIED',
      access_authorized:false,provider:'stripe',environment:'TEST',
    })
  })

  it('deduplicates concurrent identical requests and exact replays',async()=>{
    const e=await webhook(orgA)
    const r=assessment(orgA,subA,providerSubA,e)
    const results=await Promise.all([
      request(orgA,subA,e.id,r),request(orgA,subA,e.id,r),
    ])
    expect(results.map(x=>x.outcome).sort()).toEqual(['ALREADY_OPEN','CASE_OPENED'])
    const third=await request(orgA,subA,e.id,r)
    expect(third.outcome).toBe('ALREADY_OPEN')
    const {count}=await db.from('billing_synthetic_subscription_exception_reviews')
      .select('id',{head:true,count:'exact'}).eq('webhook_event_record_id',e.id)
    expect(count).toBe(1)
  })

  it('rejects same-source conflicting synthetic reason',async()=>{
    const e=await webhook(orgA)
    const original=assessment(orgA,subA,providerSubA,e)
    expect((await request(orgA,subA,e.id,original)).outcome).toBe('CASE_OPENED')
    const changed=assessment(orgA,subA,providerSubA,e,'OLDER_OR_EQUAL_TIME')
    expect(await request(orgA,subA,e.id,changed)).toEqual({outcome:'REVIEW_CONFLICT'})
  })

  it('rejects foreign subscription or webhook tenant',async()=>{
    const a=await webhook(orgA),b=await webhook(orgB)
    const r=assessment(orgA,subA,providerSubA,a)
    expect(await request(orgA,subB,a.id,r)).toEqual({outcome:'SOURCE_MISMATCH'})
    expect(await request(orgA,subA,b.id,r)).toEqual({outcome:'INVALID_INPUT'})
    expect(await request(orgB,subB,a.id,assessment(orgB,subB,providerSubB,a)))
      .toEqual({outcome:'SOURCE_MISMATCH'})
  })

  it('rejects unrecognized review reasons, simulated candidates and forged flags',async()=>{
    const e=await webhook(orgA)
    const r=assessment(orgA,subA,providerSubA,e)
    expect(await request(orgA,subA,e.id,
      {...r,audit:{...r.audit,reason:'SIMULATED_RENEWAL'}}))
      .toEqual({outcome:'INVALID_INPUT'})
    expect(await request(orgA,subA,e.id,
      {...r,audit:{...r.audit,evidenceVerified:true}}))
      .toEqual({outcome:'INVALID_INPUT'})
    expect(await request(orgA,subA,e.id,
      {...r,audit:{...r.audit,accessAuthorized:true}}))
      .toEqual({outcome:'INVALID_INPUT'})
    expect(await request(orgA,subA,e.id,{
      outcome:'SIMULATED_CANDIDATE_ONLY',audit:r.audit,
      candidate:{status:'ACTIVE',periodEnd:'2026-11-19T00:00:00Z'},
    })).toEqual({outcome:'INVALID_INPUT'})
  })

  it('remains disabled without local opt-in, on hosted targets or with LIVE billing',async()=>{
    const e=await webhook(orgA),r=assessment(orgA,subA,providerSubA,e)
    delete process.env.ENABLE_LOCAL_SYNTHETIC_EXCEPTION_REVIEW
    expect(await request(orgA,subA,e.id,r)).toEqual({outcome:'DISABLED'})
    localFlags()
    process.env.MPG_SYNTHETIC_EXCEPTION_REVIEW_TARGET='HOSTED'
    expect(await request(orgA,subA,e.id,r)).toEqual({outcome:'DISABLED'})
    localFlags()
    process.env.ENABLE_LIVE_BILLING='true'
    expect(await request(orgA,subA,e.id,r)).toEqual({outcome:'DISABLED'})
    const {count}=await db.from('billing_synthetic_subscription_exception_reviews')
      .select('id',{count:'exact',head:true}).eq('webhook_event_record_id',e.id)
    expect(count).toBe(0)
  })

  it('denies anon read/write and service-role edit/delete',async()=>{
    const e=await webhook(orgA)
    expect((await request(orgA,subA,e.id,assessment(orgA,subA,providerSubA,e))).outcome)
      .toBe('CASE_OPENED')
    const anon=createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
        auth:{autoRefreshToken:false,persistSession:false},
      })
    const {error:readError}=await anon.from('billing_synthetic_subscription_exception_reviews')
      .select('id').eq('organization_id',orgA)
    expect(readError?.code).toBe('42501')
    const {error:insertError}=await anon.from('billing_synthetic_subscription_exception_reviews')
      .insert({organization_id:orgA,subscription_record_id:subA,
        webhook_event_record_id:e.id,review_reason:'OLDER_OR_EQUAL_TIME'})
    expect(insertError?.code).toBe('42501')
    const {error:updateError}=await db.from('billing_synthetic_subscription_exception_reviews')
      .update({review_state:'OPEN'}).eq('webhook_event_record_id',e.id)
    expect(updateError?.code).toBe('42501')
    const {error:deleteError}=await db.from('billing_synthetic_subscription_exception_reviews')
      .delete().eq('webhook_event_record_id',e.id)
    expect(deleteError?.code).toBe('42501')
  })

  it('database checks reject fabricated verified/approved cases and foreign sources',async()=>{
    const e=await webhook(orgA),foreign=await webhook(orgB)
    const good={organization_id:orgA,subscription_record_id:subA,
      webhook_event_record_id:e.id,
      review_reason:'OLDER_OR_EQUAL_TIME' as const}
    for(const patch of [
      {verification_status:'VERIFIED'},
      {access_authorized:true},
      {source_kind:'REAL'},
      {review_state:'CLOSED'},
      {environment:'LIVE'},
      {review_reason:'SIMULATED_ACTIVATION'},
      {subscription_record_id:subB},
      {webhook_event_record_id:foreign.id},
    ]) {
      const {error}=await db.from('billing_synthetic_subscription_exception_reviews')
        .insert({...good,...patch})
      expect(error).not.toBeNull()
    }
  })

  it('does not change the MR-4 trial or subscription projection',async()=>{
    const e=await webhook(orgA)
    const {data:before}=await db.from('organization_entitlements')
      .select('allocated_requests,consumed_requests,status')
      .eq('organization_id',orgA).single()
    const {data:subscriptionBefore}=await db.from('organization_subscriptions')
      .select('normalized_status,provider_status').eq('id',subA).single()
    expect((await request(orgA,subA,e.id,assessment(orgA,subA,providerSubA,e))).outcome)
      .toBe('CASE_OPENED')
    const {data:after}=await db.from('organization_entitlements')
      .select('allocated_requests,consumed_requests,status').eq('organization_id',orgA).single()
    const {data:subscriptionAfter}=await db.from('organization_subscriptions')
      .select('normalized_status,provider_status').eq('id',subA).single()
    expect(after).toEqual(before)
    expect(after).toMatchObject({allocated_requests:30,consumed_requests:0,status:'NOT_STARTED'})
    expect(subscriptionAfter).toEqual(subscriptionBefore)
  })

  it('allows organization erasure without retaining linked exception cases',async()=>{
    const erasedOrg=await organization('erase')
    const {id,providerId}=await subscription(erasedOrg)
    const e=await webhook(erasedOrg)
    expect((await request(erasedOrg,id,e.id,assessment(erasedOrg,id,providerId,e))).outcome)
      .toBe('CASE_OPENED')
    const {error}=await db.from('organizations').delete().eq('id',erasedOrg)
    expect(error).toBeNull()
    const {data:caseRows}=await db.from('billing_synthetic_subscription_exception_reviews')
      .select('id').eq('organization_id',erasedOrg)
    expect(caseRows).toEqual([])
    const {data:webhookRow}=await db.from('billing_webhook_events')
      .select('organization_id').eq('id',e.id).single()
    expect(webhookRow?.organization_id).toBeNull()
  })
})
