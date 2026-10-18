import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../src/types/database'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const clients = { auth: { autoRefreshToken: false, persistSession: false } }
const admin = createClient<Database>(url, serviceKey, clients)
const anon = createClient<Database>(url, anonKey, clients)
const runId = randomUUID().replaceAll('-', '')
const customer = 'cus_Fenced' + runId
const prefix = 'evt_Fenced' + runId
const start = '2026-10-18T08:00:00.000Z'
const end = '2026-11-18T08:00:00.000Z'

let organizationId = ''
let billingAccountId = ''

function requireData<T extends { data: unknown; error: unknown }>(x: T): NonNullable<T['data']> {
  if (x.error || x.data === null) throw new Error('Fenced synthetic DB operation failed', { cause: x.error })
  return x.data as NonNullable<T['data']>
}

function outcome(data: Json | null): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid RPC response')
  return data as Record<string, unknown>
}

async function newEvent(type='customer.subscription.updated',env:'TEST'|'LIVE'='TEST') {
  return requireData(await admin.from('billing_webhook_events').insert({
    provider: 'stripe', environment: env,
    provider_event_id: prefix + randomUUID().replaceAll('-', ''),
    event_type: type,
    payload_hash: 'synthetic-verified-event-payload-sha256',
    processing_status: 'RECEIVED',
  }).select('id').single()).id
}

async function eventLease(id: string) {
  return outcome(requireData(await admin.rpc('lease_stripe_webhook_processing',{p_event_id:id})))
}

async function subLease(eventId:string,eventToken:string,subscriptionId:string) {
  return outcome(requireData(await admin.rpc('lease_stripe_subscription_reconciliation',{
    p_event_id:eventId,p_event_lease_token:eventToken,p_subscription_id:subscriptionId,
  })))
}

async function subRelease(subId:string,token:string) {
  return outcome(requireData(await admin.rpc('release_stripe_subscription_reconciliation',{
    p_subscription_id:subId,p_lease_token:token,
  })))
}

function params(
  id:string,eventToken:string,subToken:string,subId:string,
  modifications:Record<string, unknown>={}
) {
  return {
    p_event_id:id,
    p_event_lease_token:eventToken,
    p_subscription_lease_token:subToken,
    p_org_id:organizationId,
    p_billing_account_id:billingAccountId,
    p_provider_customer_id:customer,
    p_environment:'TEST' as const,
    p_provider_subscription_id:subId,
    p_provider_price_id:'price_SyntheticFenced',
    p_provider_status:'active',
    p_normalized_status:'ACTIVE',
    p_current_period_start:start,
    p_current_period_end:end,
    p_cancel_at_period_end:false,
    p_canceled_at:null,
    ...modifications,
  }
}

async function commit(payload: ReturnType<typeof params>) {
  return outcome(requireData(await admin.rpc('commit_stripe_subscription_reconciliation',payload)))
}

async function fetchEvent(id:string) {
  return requireData(await admin.from('billing_webhook_events')
    .select('processing_status,organization_id,processing_lease_token,processed_at')
    .eq('id',id).single())
}

async function fetchSubscription(subId:string) {
  const { data, error } = await admin.from('organization_subscriptions')
    .select('normalized_status,provider_status,organization_id,provider_subscription_id')
    .eq('provider_subscription_id',subId).maybeSingle()
  if (error) throw new Error('Synthetic subscription lookup failed', { cause: error })
  // No row is an expected, safe outcome in every rejected-commit test.
  return data
}

describe('MR-5C3B2 fenced TEST subscription reconciliation (disposable DB)',()=>{
  beforeAll(async ()=>{
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    const slug='mr5c3b2-'+runId
    organizationId=requireData(await admin.from('organizations')
      .insert({name:'Fenced Synthetic Org',slug}).select('id').single()).id
    billingAccountId=requireData(await admin.from('organization_billing_accounts')
      .insert({organization_id:organizationId,provider:'stripe',
        environment:'TEST',provider_customer_id:customer})
      .select('id').single()).id
  })
  afterAll(async ()=>{
    requireData(await admin.from('billing_webhook_events')
      .delete().like('provider_event_id',prefix+'%').select('id'))
    if(organizationId) requireData(await admin.from('organizations').delete()
      .eq('id',organizationId).select('id'))
  })

  it('allows one concurrent subscription lease across different events',async()=>{
    const e1=await newEvent(),e2=await newEvent()
    const a=await eventLease(e1),b=await eventLease(e2)
    const subId='sub_Fenced'+randomUUID().replaceAll('-','')
    const got=await Promise.all([
      subLease(e1,String(a.lease_token),subId),
      subLease(e2,String(b.lease_token),subId),
    ])
    expect(got.filter(x=>x.outcome==='LEASED')).toHaveLength(1)
    expect(got.filter(x=>x.outcome==='BUSY')).toHaveLength(1)
    const winner=got.find(x=>x.outcome==='LEASED')!
    const loser=got.find(x=>x.outcome==='BUSY')!
    expect(loser).toEqual({outcome:'BUSY'})
    expect(await subRelease(subId,String(winner.lease_token))).toEqual({outcome:'RELEASED'})
  })

  it('atomically writes trusted subscription and finalizes matching event',async()=>{
    const e=await newEvent()
    const event=await eventLease(e)
    const subId='sub_Fenced'+randomUUID().replaceAll('-','')
    const slot=await subLease(e,String(event.lease_token),subId)
    expect(slot.outcome).toBe('LEASED')
    const saved=await commit(params(e,String(event.lease_token),String(slot.lease_token),subId))
    expect(saved.outcome).toBe('COMMITTED')
    expect(saved.projection_outcome).toBe('CREATED')
    expect(await fetchSubscription(subId)).toMatchObject({
      normalized_status:'ACTIVE',organization_id:organizationId,provider_subscription_id:subId,
    })
    const stored=await fetchEvent(e)
    expect(stored).toMatchObject({
      processing_status:'PROCESSED',organization_id:organizationId,processing_lease_token:null,
    })
    expect(stored.processed_at).not.toBeNull()
    expect(await commit(params(e,String(event.lease_token),String(slot.lease_token),subId)))
      .toEqual({outcome:'NOT_LEASE_HOLDER'})
  })

  it('rejects foreign event tokens and never changes either row',async()=>{
    const e=await newEvent()
    const event=await eventLease(e)
    const subId='sub_Fenced'+randomUUID().replaceAll('-','')
    const slot=await subLease(e,String(event.lease_token),subId)
    expect(await commit(params(e,randomUUID(),String(slot.lease_token),subId)))
      .toEqual({outcome:'NOT_LEASE_HOLDER'})
    expect(await fetchSubscription(subId)).toBeNull()
    expect((await fetchEvent(e)).processing_status).toBe('PROCESSING')
    expect(await subRelease(subId,String(slot.lease_token))).toEqual({outcome:'RELEASED'})
  })

  it('rejects stale/superseded subscription tokens and allows only new holder',async()=>{
    const e=await newEvent(),other=await newEvent()
    const a=await eventLease(e),b=await eventLease(other)
    const subId='sub_Fenced'+randomUUID().replaceAll('-','')
    const first=await subLease(e,String(a.lease_token),subId)
    const oldToken=String(first.lease_token)
    // Synthetic clock expiry: service-side fixture simulates elapsed TTL.
    requireData(await admin.from('stripe_subscription_reconciliation_leases')
      .update({lease_expires_at:'2020-01-01T00:00:00Z'})
      .eq('provider_subscription_id',subId).select('provider_subscription_id'))
    const newer=await subLease(other,String(b.lease_token),subId)
    expect(newer.outcome).toBe('LEASED')
    expect(String(newer.lease_token)).not.toBe(oldToken)
    expect(await commit(params(e,String(a.lease_token),oldToken,subId)))
      .toEqual({outcome:'NOT_LEASE_HOLDER'})
    expect(await fetchSubscription(subId)).toBeNull()
    expect((await fetchEvent(e)).processing_status).toBe('PROCESSING')
    expect(await commit(params(other,String(b.lease_token),String(newer.lease_token),subId)))
      .toMatchObject({outcome:'COMMITTED',projection_outcome:'CREATED'})
    expect((await fetchEvent(other)).processing_status).toBe('PROCESSED')
  })

  it('rejects expired event lease even when subscription lease token remains current',async()=>{
    const e=await newEvent()
    const claim=await eventLease(e)
    const subId='sub_Fenced'+randomUUID().replaceAll('-','')
    const slot=await subLease(e,String(claim.lease_token),subId)
    requireData(await admin.from('billing_webhook_events')
      .update({processing_lease_expires_at:'2020-01-01T00:00:00Z'})
      .eq('id',e).select('id'))
    expect(await commit(params(e,String(claim.lease_token),String(slot.lease_token),subId)))
      .toEqual({outcome:'NOT_LEASE_HOLDER'})
    expect(await fetchSubscription(subId)).toBeNull()
  })

  it('checks customer/tenant identity within the same database transaction',async()=>{
    const e=await newEvent()
    const claim=await eventLease(e)
    const subId='sub_Fenced'+randomUUID().replaceAll('-','')
    const slot=await subLease(e,String(claim.lease_token),subId)
    const rejected=await commit(params(e,String(claim.lease_token),String(slot.lease_token),subId,{
      p_provider_customer_id:'cus_ForeignCustomer',
    }))
    expect(rejected).toMatchObject({outcome:'REJECTED',reason:'BLOCKED'})
    expect(await fetchSubscription(subId)).toBeNull()
    expect((await fetchEvent(e)).processing_status).toBe('PROCESSING')
    expect((await commit(params(e,String(claim.lease_token),String(slot.lease_token),subId))).outcome)
      .toBe('COMMITTED')
  })

  it('rejects forged normalized status and LIVE provider environment',async()=>{
    const e=await newEvent(),claim=await eventLease(e)
    const subId='sub_Fenced'+randomUUID().replaceAll('-','')
    const slot=await subLease(e,String(claim.lease_token),subId)
    for (const override of [
      {p_normalized_status:'GRACE'},
      {p_environment:'LIVE'},
      {p_provider_price_id:'invalid'},
    ]) {
      const r=await commit(params(e,String(claim.lease_token),String(slot.lease_token),subId,override))
      expect(['REJECTED','NOT_LEASE_HOLDER']).toContain(r.outcome)
      expect(await fetchSubscription(subId)).toBeNull()
      expect((await fetchEvent(e)).processing_status).toBe('PROCESSING')
    }
  })

  it('release requires current token; expired worker cannot unlock new holder',async()=>{
    const e=await newEvent(),claim=await eventLease(e)
    const subId='sub_Fenced'+randomUUID().replaceAll('-','')
    const slot=await subLease(e,String(claim.lease_token),subId)
    expect(await subRelease(subId,randomUUID())).toEqual({outcome:'NOT_LEASE_HOLDER'})
    expect(await subRelease(subId,String(slot.lease_token))).toEqual({outcome:'RELEASED'})
    expect(await subRelease(subId,String(slot.lease_token))).toEqual({outcome:'NOT_LEASE_HOLDER'})
  })

  it('no authenticated/anonymous role can invoke any fenced processing RPC',async()=>{
    const e=await newEvent(),claim=await eventLease(e)
    const subId='sub_Fenced'+randomUUID().replaceAll('-','')
    const slot=await subLease(e,String(claim.lease_token),subId)
    const inputs=[
      anon.rpc('lease_stripe_subscription_reconciliation',{
        p_event_id:e,p_event_lease_token:String(claim.lease_token),p_subscription_id:subId,
      }),
      anon.rpc('release_stripe_subscription_reconciliation',{
        p_subscription_id:subId,p_lease_token:String(slot.lease_token),
      }),
      anon.rpc('commit_stripe_subscription_reconciliation',
        params(e,String(claim.lease_token),String(slot.lease_token),subId)),
    ]
    for(const response of await Promise.all(inputs)) expect(response.error).not.toBeNull()
    expect(await fetchSubscription(subId)).toBeNull()
  })
})
