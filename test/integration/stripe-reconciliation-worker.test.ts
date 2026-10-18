import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))

import { processDurableStripeTestEvent } from '../../src/lib/billing/stripe-test-reconciliation-worker'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const options = { auth: { autoRefreshToken: false, persistSession: false } }
const admin = createClient<Database>(url,serviceKey,options)
const run = randomUUID().replaceAll('-','')
const prefix='evt_Worker'+run
const customer='cus_Worker'+run
const subId='sub_Worker'+run
let org=''
let account=''

function data<T extends { data:unknown; error:unknown }>(x:T):NonNullable<T['data']> {
  if(x.error||x.data===null) throw new Error('Synthetic worker fixture failed',{cause:x.error})
  return x.data as NonNullable<T['data']>
}

async function insertEvent(type='customer.subscription.updated',environment:'TEST'|'LIVE'='TEST'){
  const eventId=prefix+randomUUID().replaceAll('-','')
  const id=data(await admin.from('billing_webhook_events').insert({
    provider:'stripe',environment,provider_event_id:eventId,
    event_type:type,processing_status:'RECEIVED',payload_hash:'synthetic-worker-hash',
  }).select('id').single()).id
  return {id,eventId,type}
}
function transport(
  item:{eventId:string,type:string},args?:{
    subscriptionStatus?:string,
    customer?:string,
    eventMode?:boolean,
    eventId?:string,
    throwEvent?:boolean,
    throwSubscription?:boolean,
    wrongPrice?:boolean,
  }
) {
  const retrieveEvent=vi.fn(async()=>{
    if(args?.throwEvent)throw new Error('sensitive event transport failure')
    return {
      id:args?.eventId??item.eventId,object:'event',livemode:args?.eventMode??false,
      type:item.type,data:{object:{id:subId,object:'subscription',
        customer:'cus_SpoofedEventMetadata',metadata:{organization_id:'foreign'}}},
    }
  })
  const retrieveSubscription=vi.fn(async()=>{
    if(args?.throwSubscription)throw new Error('sensitive subscription API failure')
    return {
      id:subId,livemode:false,customer:args?.customer??customer,
      status:args?.subscriptionStatus??'active',
      cancel_at_period_end:false,canceled_at:null,
      items:{has_more:false,data:[{price:{id:args?.wrongPrice?'bad':'price_WorkerSynthetic'},
        current_period_start:1792300000,current_period_end:1794892000}]},
    }
  })
  return {retrieveEvent,retrieveSubscription}
}

async function stored(id:string) {
  return data(await admin.from('billing_webhook_events')
    .select('processing_status,organization_id,processing_attempts,error_code,processed_at')
    .eq('id',id).single())
}

async function subscription() {
  return data(await admin.from('organization_subscriptions')
    .select('provider_subscription_id,normalized_status,organization_id,provider_status')
    .eq('provider_subscription_id',subId).maybeSingle())
}

describe('MR-5C3B2 TEST worker integration, fake provider / real disposable PostgreSQL',()=>{
  beforeAll(async()=>{
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    org=data(await admin.from('organizations').insert({
      name:'MR5C3B2 synthetic worker',slug:'mr5c3b2-worker-'+run,
    }).select('id').single()).id
    account=data(await admin.from('organization_billing_accounts').insert({
      organization_id:org,provider:'stripe',environment:'TEST',provider_customer_id:customer,
    }).select('id').single()).id
  })
  afterAll(async()=>{
    await admin.from('billing_webhook_events').delete().like('provider_event_id',prefix+'%')
    if(org) await admin.from('organizations').delete().eq('id',org)
  })

  it('retrieves current provider truth after obtaining mutex then atomically commits and processes event',async()=>{
    const item=await insertEvent()
    const fake=transport(item)
    const result=await processDurableStripeTestEvent({
      supabase:admin,eventRecordId:item.id,...fake,
    })
    expect(result).toEqual({outcome:'COMMITTED',projectionOutcome:'CREATED'})
    expect(fake.retrieveEvent).toHaveBeenCalledWith(item.eventId)
    expect(fake.retrieveSubscription).toHaveBeenCalledWith(subId)
    expect(await subscription()).toMatchObject({
      provider_subscription_id:subId,normalized_status:'ACTIVE',organization_id:org,
    })
    expect(await stored(item.id)).toMatchObject({
      processing_status:'PROCESSED',organization_id:org,processing_attempts:1,
    })
    expect(await processDurableStripeTestEvent({
      supabase:admin,eventRecordId:item.id,...fake,
    })).toEqual({outcome:'NO_WORK'})
  })

  it('repeated events for the same subscription reconcile its current state idempotently',async()=>{
    const item=await insertEvent()
    const fake=transport(item,{subscriptionStatus:'past_due'})
    expect(await processDurableStripeTestEvent({supabase:admin,eventRecordId:item.id,...fake}))
      .toEqual({outcome:'COMMITTED',projectionOutcome:'UPDATED'})
    expect(await subscription()).toMatchObject({normalized_status:'SUSPENDED',provider_status:'past_due'})
    const next=await insertEvent()
    const retry=transport(next,{subscriptionStatus:'past_due'})
    expect(await processDurableStripeTestEvent({supabase:admin,eventRecordId:next.id,...retry}))
      .toEqual({outcome:'COMMITTED',projectionOutcome:'UNCHANGED'})
  })

  it('ignores an unsupported verified TEST Event type without subscription calls',async()=>{
    const item=await insertEvent('customer.created')
    const fake=transport(item)
    expect(await processDurableStripeTestEvent({supabase:admin,eventRecordId:item.id,...fake}))
      .toEqual({outcome:'IGNORED'})
    expect(fake.retrieveSubscription).not.toHaveBeenCalled()
    expect(await stored(item.id)).toMatchObject({processing_status:'IGNORED',organization_id:null})
  })

  it('sanitizes failed Stripe provider lookups and retries without raw provider payload',async()=>{
    const item=await insertEvent()
    const broken=transport(item,{throwSubscription:true})
    expect(await processDurableStripeTestEvent({supabase:admin,eventRecordId:item.id,...broken}))
      .toEqual({outcome:'FAILED',errorCode:'PROVIDER_UNAVAILABLE'})
    expect(await stored(item.id)).toMatchObject({
      processing_status:'FAILED',error_code:'PROVIDER_UNAVAILABLE',processing_attempts:1,
    })
    // Synthetic clock advances after the SQL-enforced first-failure cooldown.
    data(await admin.from('billing_webhook_events')
      .update({ next_processing_attempt_at: '2020-01-01T00:00:00Z' })
      .eq('id', item.id).select('id'))
    const fixed=transport(item,{subscriptionStatus:'active'})
    expect((await processDurableStripeTestEvent({
      supabase:admin,eventRecordId:item.id,...fixed,
    })).outcome).toBe('COMMITTED')
    expect(await stored(item.id)).toMatchObject({processing_status:'PROCESSED',processing_attempts:2})
  })

  it('unresolved Stripe Customer never produces a payment projection',async()=>{
    const item=await insertEvent()
    const fake=transport(item,{customer:'cus_Unrecognized'})
    expect(await processDurableStripeTestEvent({supabase:admin,eventRecordId:item.id,...fake}))
      .toEqual({outcome:'FAILED',errorCode:'UNRESOLVED_CUSTOMER'})
    expect(await stored(item.id)).toMatchObject({processing_status:'FAILED',organization_id:null})
  })

  it('rejects mismatched, LIVE, or malformed Stripe provider events',async()=>{
    for(const variant of [
      {eventId:'evt_Foreign'},
      {eventMode:true},
      {wrongPrice:true},
    ]) {
      const item=await insertEvent()
      const fake=transport(item,variant)
      const result=await processDurableStripeTestEvent({supabase:admin,eventRecordId:item.id,...fake})
      expect(result).toEqual({outcome:'FAILED',errorCode:'INVALID_PROVIDER_DATA'})
      expect((await stored(item.id)).processing_status).toBe('FAILED')
    }
  })

  it('does not claim a LIVE durable event or invoke Stripe retrieval',async()=>{
    const item=await insertEvent('customer.subscription.updated','LIVE')
    const fake=transport(item)
    expect(await processDurableStripeTestEvent({supabase:admin,eventRecordId:item.id,...fake}))
      .toEqual({outcome:'NO_WORK'})
    expect(fake.retrieveEvent).not.toHaveBeenCalled()
    expect(fake.retrieveSubscription).not.toHaveBeenCalled()
  })

  it('a BUSY subscription mutex prevents any overlapping current-provider read',async()=>{
    const item=await insertEvent()
    const claim= data(await admin.rpc('lease_stripe_webhook_processing',{p_event_id:item.id}))
    if(!claim||typeof claim!=='object'||Array.isArray(claim)||!('lease_token' in claim))
      throw new Error('Synthetic event lease missing')
    const owner=data(await admin.rpc('lease_stripe_subscription_reconciliation',{
      p_event_id:item.id,p_event_lease_token:String(claim.lease_token),p_subscription_id:subId,
    }))
    if(!owner||typeof owner!=='object'||Array.isArray(owner)||!('lease_token' in owner))
      throw new Error('Synthetic subscription lock missing')

    const other=await insertEvent()
    const fake=transport(other)
    const result=await processDurableStripeTestEvent({supabase:admin,eventRecordId:other.id,...fake})
    expect(result).toEqual({outcome:'RETRY_REQUIRED'})
    expect(fake.retrieveEvent).toHaveBeenCalledOnce()
    expect(fake.retrieveSubscription).not.toHaveBeenCalled()
    expect(await stored(other.id)).toMatchObject({
      processing_status:'FAILED',error_code:'PROCESSING_FAILED',
    })
    await admin.rpc('release_stripe_subscription_reconciliation',{
      p_subscription_id:subId,p_lease_token:String(owner.lease_token),
    })
  })
})
