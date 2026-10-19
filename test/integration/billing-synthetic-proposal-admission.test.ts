import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  proposeSubscriptionLifecycle,
  type SubscriptionLifecycleProposal,
} from '../../src/domain/billing/subscription-lifecycle-proposals'
import { recordLocalSyntheticLifecycleProposal } from '../../src/lib/billing/local-synthetic-proposal-admission'

const roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const hasDisposableDb = !!roleKey && roleKey !== 'dummy_service_role_key'
const oldFlag = process.env.ENABLE_LOCAL_SYNTHETIC_PROPOSAL_ADMISSION
const oldTarget = process.env.MPG_PROPOSAL_ADMISSION_TARGET
const oldLive = process.env.ENABLE_LIVE_BILLING

describe.skipIf(!hasDisposableDb)('MR-5E3C1 disposable synthetic proposal admission', () => {
  const db = createAdminClient()
  const nonce = Date.now()
  const orgIds: string[] = []
  const eventPrefix = 'evt_mr5e3c1' + nonce
  let orgA = ''
  let orgB = ''
  let subA = ''
  let subB = ''
  let eventCounter = 0

  function allowLocal() {
    process.env.ENABLE_LOCAL_SYNTHETIC_PROPOSAL_ADMISSION = 'true'
    process.env.MPG_PROPOSAL_ADMISSION_TARGET = 'LOCAL_SYNTHETIC'
    delete process.env.ENABLE_LIVE_BILLING
  }
  function periodEnd() {
    return new Date(Date.now() + 30 * 86400000).toISOString()
  }

  async function organization(name: string) {
    const { data, error } = await db.from('organizations')
      .insert({ name: 'MR5E3C1 fixture ' + name + ' ' + nonce,
        slug: 'mr5e3c1-' + name.toLowerCase() + '-' + nonce })
      .select('id').single()
    if (error || !data) throw new Error('ORG_FIXTURE_FAILED: ' + error?.message)
    orgIds.push(data.id)
    return data.id
  }

  async function subscription(orgId: string, suffix: string) {
    const { data: account, error: aerr } = await db.from('organization_billing_accounts')
      .insert({ organization_id: orgId, provider: 'stripe', environment: 'TEST',
        provider_customer_id: 'cus_mr5e3c1' + suffix + nonce })
      .select('id').single()
    if (aerr || !account) throw new Error('ACCOUNT_FIXTURE_FAILED: ' + aerr?.message)
    const { data, error } = await db.from('organization_subscriptions')
      .insert({ organization_id: orgId, billing_account_id: account.id,
        provider:'stripe',environment:'TEST',
        provider_subscription_id:'sub_mr5e3c1' + suffix + nonce,
        provider_status:'active',normalized_status:'ACTIVE' })
      .select('id').single()
    if (error || !data) throw new Error('SUB_FIXTURE_FAILED: ' + error?.message)
    return data.id
  }

  async function sourceEvent(orgId: string, options: {
    status?: 'PROCESSED' | 'RECEIVED'
    type?: string
  } = {}) {
    const suffix = String(++eventCounter)
    const providerEventId = eventPrefix + suffix
    const eventType = options.type ?? 'invoice.paid'
    const status = options.status ?? 'PROCESSED'
    const providerCreatedAt = new Date(Date.now() - 3_600_000 + eventCounter * 1000).toISOString()
    const {data,error} = await db.from('billing_webhook_events')
      .insert({
        provider:'stripe', environment:'TEST', organization_id:orgId,
        provider_event_id:providerEventId, event_type:eventType,
        provider_invoice_id:eventType==='invoice.paid'?'in_mr5e3c1'+suffix+nonce:null,
        payload_hash:'e'.repeat(64),processing_status:status,
        processed_at:status==='PROCESSED'?new Date().toISOString():null,
        provider_created_at:providerCreatedAt,
      })
      .select('id,provider_created_at,provider_event_id,payload_hash').single()
    if (error || !data) throw new Error('EVENT_FIXTURE_FAILED: '+error?.message)
    return data
  }

  function syntheticProposal(event: {
    provider_event_id: string; provider_created_at: string | null; payload_hash: string
  }, orgId = orgA, subId = 'sub_mr5e3c1a'+nonce, end = periodEnd()) {
    const proposal = proposeSubscriptionLifecycle({
      current: null,
      now: new Date(Date.now() + 5000).toISOString(),
      event: {
        eventId:event.provider_event_id,fingerprint:event.payload_hash,
        kind:'INVOICE_SETTLED',organizationId:orgId,
        subscriptionId:subId,environment:'TEST',
        occurredAt:new Date(event.provider_created_at!).toISOString(),periodEnd:end,
      },
      proof: {
        // These are deliberately synthetic markers, NEVER provider proof.
        durableEventStatus:'PROCESSED',
        providerInvoiceAssessment:{outcome:'EVIDENCE_ONLY'},
        statusChangeVerified:true,
      },
    })
    if (proposal.outcome !== 'PROPOSAL_ONLY') {
      throw new Error('SYNTHETIC_POLICY_PROPOSAL_MISSING: '+JSON.stringify(proposal))
    }
    return proposal
  }

  function admit(orgId: unknown, subId: unknown, eventId: unknown,
    proposal: SubscriptionLifecycleProposal) {
    return recordLocalSyntheticLifecycleProposal({
      trustedBillingSupabase:db,
      organizationId:orgId,subscriptionRecordId:subId,
      webhookEventRecordId:eventId,proposal,
    })
  }

  beforeAll(async () => {
    const target = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (target !== 'http://127.0.0.1:54331' && target !== 'http://localhost:54331') {
      throw new Error('DISPOSABLE_DATABASE_REQUIRED')
    }
    allowLocal()
    orgA = await organization('a')
    orgB = await organization('b')
    subA = await subscription(orgA,'a')
    subB = await subscription(orgB,'b')
    const {error}=await db.rpc('provision_organization_trial',{p_org_id:orgA})
    if(error) throw new Error('TRIAL_PROVISION_FAILED: '+error.message)
  })
  beforeEach(allowLocal)
  afterAll(async () => {
    for (const orgId of orgIds) {
      await db.from('organizations').delete().eq('id',orgId)
    }
    // Orphaned immutable webhook events use ON DELETE SET NULL, so remove
    // only fixture-owned event IDs after synthetic organization erasure.
    await db.from('billing_webhook_events').delete()
      .like('provider_event_id',eventPrefix+'%')
    if (oldFlag===undefined) delete process.env.ENABLE_LOCAL_SYNTHETIC_PROPOSAL_ADMISSION
    else process.env.ENABLE_LOCAL_SYNTHETIC_PROPOSAL_ADMISSION=oldFlag
    if (oldTarget===undefined) delete process.env.MPG_PROPOSAL_ADMISSION_TARGET
    else process.env.MPG_PROPOSAL_ADMISSION_TARGET=oldTarget
    if (oldLive===undefined) delete process.env.ENABLE_LIVE_BILLING
    else process.env.ENABLE_LIVE_BILLING=oldLive
  })

  it('appends a nonauthorizing synthetic record with correct source/tenant mapping', async () => {
    const event=await sourceEvent(orgA)
    const output=await admit(orgA,subA,event.id,syntheticProposal(event))
    expect(output.outcome).toBe('RECORDED_PROPOSAL_ONLY')
    const {data,error}=await db.from('billing_paid_entitlement_proposals')
      .select('*').eq('webhook_event_record_id',event.id).single()
    expect(error).toBeNull()
    expect(data).toMatchObject({
      organization_id:orgA,subscription_record_id:subA,
      proposed_action:'INITIAL_ACTIVATION',candidate_status:'ACTIVE',
      source_kind:'SYNTHETIC',verification_status:'UNVERIFIED',
      access_authorized:false,
    })
  })

  it('treats an identical event replay as idempotent without a second write',async()=>{
    const event=await sourceEvent(orgA)
    const proposal=syntheticProposal(event)
    const first=await admit(orgA,subA,event.id,proposal)
    const second=await admit(orgA,subA,event.id,proposal)
    expect(first.outcome).toBe('RECORDED_PROPOSAL_ONLY')
    expect(second).toEqual({
      outcome:'ALREADY_RECORDED',
      recordId: first.outcome==='RECORDED_PROPOSAL_ONLY'?first.recordId:'',
    })
    const {count,error}=await db.from('billing_paid_entitlement_proposals')
      .select('id',{count:'exact',head:true}).eq('webhook_event_record_id',event.id)
    expect(error).toBeNull()
    expect(count).toBe(1)
  })

  it('deduplicates concurrent identical event attempts at the DB uniqueness gate',async()=>{
    const event=await sourceEvent(orgA)
    const proposal=syntheticProposal(event)
    const [a,b]=await Promise.all([
      admit(orgA,subA,event.id,proposal),
      admit(orgA,subA,event.id,proposal),
    ])
    expect([a.outcome,b.outcome].sort())
      .toEqual(['ALREADY_RECORDED','RECORDED_PROPOSAL_ONLY'])
  })

  it('rejects a conflicting replay of the same source event',async()=>{
    const event=await sourceEvent(orgA)
    const proposal=syntheticProposal(event)
    expect((await admit(orgA,subA,event.id,proposal)).outcome)
      .toBe('RECORDED_PROPOSAL_ONLY')
    const conflicting=syntheticProposal(event,orgA,
      'sub_mr5e3c1a'+nonce,new Date(Date.now()+45*86400000).toISOString())
    expect(await admit(orgA,subA,event.id,conflicting))
      .toEqual({outcome:'REPLAY_CONFLICT'})
  })

  it('rejects a foreign subscription and mismatched tenant or event',async()=>{
    const event=await sourceEvent(orgA)
    const proposal=syntheticProposal(event)
    expect(await admit(orgA,subB,event.id,proposal))
      .toEqual({outcome:'SOURCE_MISMATCH'})
    expect(await admit(orgB,subB,event.id,proposal))
      .toEqual({outcome:'INVALID_INPUT'})
    const foreign=await sourceEvent(orgB)
    expect(await admit(orgA,subA,foreign.id,proposal))
      .toEqual({outcome:'SOURCE_MISMATCH'})
  })

  it('requires a durable PROCESSED invoice and exact source hash/time',async()=>{
    const event=await sourceEvent(orgA,{status:'RECEIVED'})
    const proposal=syntheticProposal(event)
    expect(await admit(orgA,subA,event.id,proposal))
      .toEqual({outcome:'SOURCE_MISMATCH'})
    const unrelated=await sourceEvent(orgA,{type:'customer.subscription.updated'})
    expect(await admit(orgA,subA,unrelated.id,syntheticProposal(unrelated)))
      .toEqual({outcome:'SOURCE_MISMATCH'})
    const verified=await sourceEvent(orgA)
    const p=syntheticProposal(verified)
    const forged={...p,candidate:{...p.candidate,lastEventFingerprint:'f'.repeat(64)}}
    expect(await admit(orgA,subA,verified.id,forged))
      .toEqual({outcome:'SOURCE_MISMATCH'})
    const shifted={...p,candidate:{...p.candidate,
      lastEventAt:new Date(Date.parse(p.candidate.lastEventAt)+60_000).toISOString()}}
    expect(await admit(orgA,subA,verified.id,shifted))
      .toEqual({outcome:'SOURCE_MISMATCH'})
  })

  it('rejects blocked policy proposals and unsupported candidate tampering',async()=>{
    const event=await sourceEvent(orgA)
    expect(await admit(orgA,subA,event.id,
      {outcome:'BLOCKED',reason:'UNPROCESSED_EVENT'}))
      .toEqual({outcome:'INVALID_INPUT'})
    const p=syntheticProposal(event)
    expect(await admit(orgA,subA,event.id,
      {...p,candidate:{...p.candidate,status:'ENDED'}}))
      .toEqual({outcome:'INVALID_INPUT'})
    expect(await admit('wrong-org',subA,event.id,p))
      .toEqual({outcome:'INVALID_INPUT'})
  })

  it('is disabled without local test flag, with hosted target, or with live billing',async()=>{
    const event=await sourceEvent(orgA)
    const p=syntheticProposal(event)
    delete process.env.ENABLE_LOCAL_SYNTHETIC_PROPOSAL_ADMISSION
    expect(await admit(orgA,subA,event.id,p)).toEqual({outcome:'DISABLED'})
    allowLocal()
    process.env.MPG_PROPOSAL_ADMISSION_TARGET='HOSTED'
    expect(await admit(orgA,subA,event.id,p)).toEqual({outcome:'DISABLED'})
    allowLocal()
    process.env.ENABLE_LIVE_BILLING='true'
    expect(await admit(orgA,subA,event.id,p)).toEqual({outcome:'DISABLED'})
    const {count}=await db.from('billing_paid_entitlement_proposals')
      .select('id',{count:'exact',head:true}).eq('webhook_event_record_id',event.id)
    expect(count).toBe(0)
  })

  it('never changes MR-4 free trial or billing subscription projection',async()=>{
    const event=await sourceEvent(orgA)
    const {data:prior}=await db.from('organization_entitlements')
      .select('status,allocated_requests,consumed_requests').eq('organization_id',orgA).single()
    const {data:subPrior}=await db.from('organization_subscriptions')
      .select('normalized_status,provider_status,current_period_end')
      .eq('id',subA).single()
    expect((await admit(orgA,subA,event.id,syntheticProposal(event))).outcome)
      .toBe('RECORDED_PROPOSAL_ONLY')
    const {data:after}=await db.from('organization_entitlements')
      .select('status,allocated_requests,consumed_requests').eq('organization_id',orgA).single()
    const {data:subAfter}=await db.from('organization_subscriptions')
      .select('normalized_status,provider_status,current_period_end')
      .eq('id',subA).single()
    expect(after).toEqual(prior)
    expect(after).toMatchObject({status:'NOT_STARTED',allocated_requests:30,consumed_requests:0})
    expect(subAfter).toEqual(subPrior)
  })
})
