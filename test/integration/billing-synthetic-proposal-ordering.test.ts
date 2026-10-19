import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAdminClient } from '../../src/lib/supabase/admin'

const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const hasDb = !!key && key !== 'dummy_service_role_key'

describe.skipIf(!hasDb)('MR-5E3C2 ordered synthetic proposal ledger', () => {
  const db = createAdminClient()
  const nonce = Date.now()
  const orgs: string[] = []
  const accountIds = new Map<string,string>()
  const prefix = 'evt_mr5e3c2' + nonce
  let org = ''
  let sequence = 0

  async function createOrganization(suffix: string) {
    const {data,error} = await db.from('organizations')
      .insert({name:'MR5E3C2 test '+suffix+' '+nonce,
        slug:'mr5e3c2-'+suffix+'-'+nonce})
      .select('id').single()
    if(error||!data) throw new Error('ORDER_ORG_SETUP: '+error?.message)
    orgs.push(data.id)
    return data.id
  }
  async function createSubscription(orgId: string) {
    const id=String(++sequence)
    let accountId = accountIds.get(orgId)
    if (!accountId) {
      const {data:account,error:aerr}=await db.from('organization_billing_accounts')
        .insert({organization_id:orgId,provider:'stripe',environment:'TEST',
          provider_customer_id:'cus_mr5e3c2'+id+nonce})
        .select('id').single()
      if(aerr||!account)throw new Error('ORDER_ACCOUNT_SETUP: '+aerr?.message)
      accountId=account.id
      accountIds.set(orgId,accountId)
    }
    const {data:sub,error:serr}=await db.from('organization_subscriptions')
      .insert({organization_id:orgId,billing_account_id:accountId,
        provider:'stripe',environment:'TEST',
        provider_subscription_id:'sub_mr5e3c2'+id+nonce,
        provider_status:'active',normalized_status:'ACTIVE'})
      .select('id').single()
    if(serr||!sub)throw new Error('ORDER_SUB_SETUP: '+serr?.message)
    return sub.id
  }
  async function event(orgId: string, occurredAt: string | null,
    type = 'invoice.paid') {
    const id=String(++sequence)
    const {data,error}=await db.from('billing_webhook_events')
      .insert({
        provider:'stripe',environment:'TEST', organization_id:orgId,
        provider_event_id:prefix+id,event_type:type,
        provider_invoice_id:type==='invoice.paid'?'in_mr5e3c2'+id+nonce:null,
        provider_created_at:occurredAt,
        payload_hash:'c'.repeat(64),processing_status:'PROCESSED',
        processed_at:new Date().toISOString(),
      })
      .select('id,provider_event_id,provider_created_at').single()
    if(error||!data)throw new Error('ORDER_EVENT_SETUP: '+error?.message)
    return data
  }
  async function append(orgId:string, subId:string, evId:string,
    action:'INITIAL_ACTIVATION'|'RENEWAL'|'PAYMENT_DUE'|'ESCALATE_FOR_REVIEW'|'SCHEDULE_CANCELLATION'|'END_AT_PERIOD'='INITIAL_ACTIVATION') {
    const states={
      INITIAL_ACTIVATION:'ACTIVE', RENEWAL:'ACTIVE',
      PAYMENT_DUE:'PAST_DUE',ESCALATE_FOR_REVIEW:'REVIEW_REQUIRED',
      SCHEDULE_CANCELLATION:'CANCEL_AT_PERIOD_END',END_AT_PERIOD:'ENDED',
    } as const
    return db.from('billing_paid_entitlement_proposals').insert({
      organization_id:orgId,subscription_record_id:subId,
      webhook_event_record_id:evId,provider:'stripe',
      environment:'TEST',proposed_action:action,candidate_status:states[action],
      candidate_period_end:'2026-12-20T00:00:00Z',
      source_kind:'SYNTHETIC',verification_status:'UNVERIFIED',
      access_authorized:false,
    }).select('id,source_provider_created_at,access_authorized,verification_status').single()
  }
  async function stored(subId:string) {
    const {data,error}=await db.from('billing_paid_entitlement_proposals')
      .select('source_provider_created_at, candidate_status, access_authorized')
      .eq('subscription_record_id',subId)
      .order('source_provider_created_at',{ascending:true})
    expect(error).toBeNull()
    return data ?? []
  }

  beforeAll(async()=>{
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL
    if(url!=='http://127.0.0.1:54331' && url!=='http://localhost:54331')
      throw new Error('MUST_USE_DISPOSABLE_DATABASE')
    org=await createOrganization('primary')
  })
  afterAll(async()=>{
    for(const id of orgs)await db.from('organizations').delete().eq('id',id)
    await db.from('billing_webhook_events').delete()
      .like('provider_event_id',prefix+'%')
  })

  it('records provider occurrence order, not webhook arrival time',async()=>{
    const sub=await createSubscription(org)
    const older=await event(org,'2026-10-19T01:00:00Z')
    const newer=await event(org,'2026-10-19T02:00:00Z')
    const a=await append(org,sub,older.id)
    const b=await append(org,sub,newer.id,'RENEWAL')
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    expect(b.data?.source_provider_created_at).toContain('2026-10-19T02:00:00')
    expect(await stored(sub)).toMatchObject([
      {access_authorized:false},{access_authorized:false},
    ])
  })

  it('blocks a delayed old payment from overwriting a newer failure',async()=>{
    const sub=await createSubscription(org)
    const newer=await event(org,'2026-10-19T03:00:00Z','invoice.payment_failed')
    const older=await event(org,'2026-10-19T02:00:00Z','invoice.paid')
    const first=await append(org,sub,newer.id,'PAYMENT_DUE')
    expect(first.error).toBeNull()
    const stale=await append(org,sub,older.id)
    expect(stale.error?.message).toContain('BILLING_PROPOSAL_STALE_OR_AMBIGUOUS_EVENT')
    expect(await stored(sub)).toMatchObject([{candidate_status:'PAST_DUE'}])
  })

  it('rejects different events in the same provider-second',async()=>{
    const sub=await createSubscription(org)
    const a=await event(org,'2026-10-19T04:00:00Z')
    const b=await event(org,'2026-10-19T04:00:00Z')
    expect((await append(org,sub,a.id)).error).toBeNull()
    expect((await append(org,sub,b.id,'RENEWAL')).error?.message)
      .toContain('BILLING_PROPOSAL_STALE_OR_AMBIGUOUS_EVENT')
    expect((await stored(sub)).length).toBe(1)
  })

  it('fails closed when provider creation time is missing',async()=>{
    const sub=await createSubscription(org)
    const missing=await event(org,null)
    expect((await append(org,sub,missing.id)).error?.message)
      .toContain('BILLING_PROPOSAL_SOURCE_ORDER_UNKNOWN')
    expect(await stored(sub)).toEqual([])
  })

  it('preserves exact-event idempotency after the ordering trigger',async()=>{
    const sub=await createSubscription(org)
    const e=await event(org,'2026-10-19T05:00:00Z')
    expect((await append(org,sub,e.id)).error).toBeNull()
    const replay=await append(org,sub,e.id)
    expect(replay.error?.code).toBe('23505')
    expect((await stored(sub)).length).toBe(1)
  })

  it('holds later positive proposals after a dispute review',async()=>{
    const sub=await createSubscription(org)
    const paid=await event(org,'2026-10-19T06:00:00Z')
    const dispute=await event(org,'2026-10-19T07:00:00Z','charge.dispute.created')
    const renewal=await event(org,'2026-10-19T08:00:00Z')
    expect((await append(org,sub,paid.id)).error).toBeNull()
    expect((await append(org,sub,dispute.id,'ESCALATE_FOR_REVIEW')).error).toBeNull()
    expect((await append(org,sub,renewal.id,'RENEWAL')).error?.message)
      .toContain('BILLING_PROPOSAL_REVIEW_HOLD')
    expect((await stored(sub)).map(x=>x.candidate_status))
      .toEqual(['ACTIVE','REVIEW_REQUIRED'])
  })

  it('holds later activation after cancellation or termination',async()=>{
    for(const [kind,providerType] of [
      ['SCHEDULE_CANCELLATION','customer.subscription.updated'],
      ['END_AT_PERIOD','customer.subscription.deleted'],
    ] as const) {
      const sub=await createSubscription(org)
      const first=await event(org,'2026-10-19T09:00:00Z',providerType)
      const renewed=await event(org,'2026-10-19T10:00:00Z')
      expect((await append(org,sub,first.id,kind)).error).toBeNull()
      expect((await append(org,sub,renewed.id,'RENEWAL')).error?.message)
        .toContain('BILLING_PROPOSAL_REVIEW_HOLD')
    }
  })

  it('serializes concurrent inserts and leaves newest provider event as head',async()=>{
    const sub=await createSubscription(org)
    const early=await event(org,'2026-10-19T11:00:00Z')
    const late=await event(org,'2026-10-19T12:00:00Z')
    const [a,b]=await Promise.all([
      append(org,sub,early.id),
      append(org,sub,late.id,'RENEWAL'),
    ])
    expect(b.error).toBeNull()
    if(a.error)expect(a.error.message)
      .toContain('BILLING_PROPOSAL_STALE_OR_AMBIGUOUS_EVENT')
    const rows=await stored(sub)
    expect(rows[rows.length-1].source_provider_created_at).toContain('12:00:00')
    expect(rows.every(x=>x.access_authorized===false)).toBe(true)
  })

  it('isolates ordering by subscription even within one tenant',async()=>{
    const a=await createSubscription(org),b=await createSubscription(org)
    const later=await event(org,'2026-10-19T15:00:00Z')
    const earlier=await event(org,'2026-10-19T14:00:00Z')
    const [left,right]=await Promise.all([
      append(org,a,later.id),append(org,b,earlier.id),
    ])
    expect(left.error).toBeNull()
    expect(right.error).toBeNull()
    expect((await stored(a)).length).toBe(1)
    expect((await stored(b)).length).toBe(1)
  })

  it('does not admit a foreign tenant subscription',async()=>{
    const other=await createOrganization('foreign')
    const sub=await createSubscription(org)
    const e=await event(other,'2026-10-19T16:00:00Z')
    const result=await append(other,sub,e.id)
    expect(result.error).not.toBeNull()
    expect(await stored(sub)).toEqual([])
  })
})
