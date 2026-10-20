import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../src/types/database'

/** Disposable-DB-only regression for financial terminal-state quarantine.
 * No real provider, customer, historical settlement or product access. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const enabled = Boolean(serviceKey && anonKey && serviceKey !== 'dummy_service_role_key')
const options = { auth: { autoRefreshToken: false, persistSession: false } }
const prefix = 'evt_Mr5Stage1Guard' + randomUUID().replaceAll('-','')
let index = 0

function asResult(value: Json | null): Record<string, Json | undefined> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('MR5_STAGE1_RPC_RESPONSE_INVALID')
  }
  return value
}

describe.skipIf(!enabled)('MR-5 Stage 1 invoice success quarantine: generic RPC and SQL UPDATE', () => {
  const db = createClient<Database>(url, serviceKey, options)
  const anon = createClient<Database>(url, anonKey, options)
  async function event(kind: 'invoice.paid' | 'invoice.payment_failed' |
    'customer.subscription.updated') {
    const providerEventId = prefix + String(++index)
    const { data, error } = await db.from('billing_webhook_events').insert({
      provider:'stripe',environment:'TEST',provider_event_id:providerEventId,
      provider_invoice_id:kind.startsWith('invoice.') ? 'in_' + prefix.slice(4) + index : null,
      event_type:kind,processing_status:'RECEIVED',
      payload_hash:'a'.repeat(64),
    }).select('id').single()
    if (error || !data) throw new Error('MR5_STAGE1_EVENT_SETUP_FAILED')
    return { id:data.id, eventId:providerEventId }
  }
  async function row(id:string) {
    const {data,error} = await db.from('billing_webhook_events')
      .select('processing_status,processed_at,organization_id,processing_lease_token,processing_attempt_count,error_code')
      .eq('id',id).single()
    expect(error).toBeNull()
    return data
  }
  beforeAll(() => {
    if (!['http://127.0.0.1:54331','http://localhost:54331'].includes(url) ||
        process.env.ENABLE_LIVE_BILLING === 'true' ||
        process.env.VERCEL_ENV !== undefined) {
      throw new Error('MR5_STAGE1_DISPOSABLE_DATABASE_ONLY')
    }
  })
  afterAll(async () => {
    const {error} = await db.from('billing_webhook_events').delete()
      .like('provider_event_id',prefix + '%')
    if (error) throw new Error('MR5_STAGE1_EVENT_CLEANUP_FAILED')
  })

  it.each(['invoice.paid','invoice.payment_failed'] as const)(
    'blocks the generic lease and all direct success transitions for %s',async kind => {
      const x=await event(kind)
      const generic=await db.rpc('lease_stripe_webhook_processing',{p_event_id:x.id})
      expect(generic.error).toBeNull()
      expect(asResult(generic.data)).toEqual({outcome:'NO_WORK'})
      expect(await row(x.id)).toMatchObject({
        processing_status:'RECEIVED',processed_at:null,processing_attempt_count:0,
      })
      for (const state of ['PROCESSED','IGNORED'] as const) {
        const attempt=await db.from('billing_webhook_events')
          .update({processing_status:state}).eq('id',x.id)
        expect(attempt.error?.code).toBe('23514')
        expect(await row(x.id)).toMatchObject({
          processing_status:'RECEIVED',processed_at:null,organization_id:null,
        })
      }
      const claimed=await db.rpc('claim_stripe_test_invoice_processing',{
        p_provider_event_id:x.eventId,
      })
      expect(claimed.error).toBeNull()
      const claim=asResult(claimed.data)
      expect(claim.outcome).toBe('CLAIMED')
      if (typeof claim.lease_token!=='string') throw new Error('MR5_STAGE1_LEASE_MISSING')
      const attempted=await db.rpc('complete_stripe_webhook_processing',{
        p_event_id:x.id,p_lease_token:claim.lease_token,p_status:'IGNORED',
        p_organization_id:null,p_error_code:null,
      })
      expect(attempted.error).toBeNull()
      expect(asResult(attempted.data)).toEqual({outcome:'NOT_LEASE_HOLDER'})
      expect(await row(x.id)).toMatchObject({
        processing_status:'PROCESSING',processed_at:null,processing_lease_token:claim.lease_token,
      })
      const final=await db.rpc('fail_stripe_test_invoice_processing',{
        p_provider_event_id:x.eventId,p_lease_token:claim.lease_token,
        p_error_code:'EVIDENCE_CONFLICT',
      })
      expect(final.error).toBeNull()
      expect(asResult(final.data)).toEqual({outcome:'FAILED_REQUIRES_REVIEW'})
      expect(await row(x.id)).toMatchObject({processing_status:'FAILED',processed_at:null})
    }
  )

  it('keeps the existing generic noninvoice worker lease and IGNORE finality functional',async()=>{
    const x=await event('customer.subscription.updated')
    const acquired=await db.rpc('lease_stripe_webhook_processing',{p_event_id:x.id})
    expect(acquired.error).toBeNull()
    const lease=asResult(acquired.data)
    expect(lease.outcome).toBe('LEASED')
    const result=await db.rpc('complete_stripe_webhook_processing',{
      p_event_id:x.id,p_lease_token:lease.lease_token,p_status:'IGNORED',
      p_organization_id:null,p_error_code:null,
    })
    expect(result.error).toBeNull()
    expect(asResult(result.data)).toEqual({outcome:'FINALIZED',status:'IGNORED'})
    expect(await row(x.id)).toMatchObject({processing_status:'IGNORED'})
  })
  it('still forbids direct tenant/anonymous service execution',async()=>{
    const x=await event('invoice.paid')
    const attempt=await anon.rpc('claim_stripe_test_invoice_processing',{
      p_provider_event_id:x.eventId,
    })
    expect(['42501','PGRST202']).toContain(attempt.error?.code)
    const generic=await anon.rpc('lease_stripe_webhook_processing',{p_event_id:x.id})
    expect(['42501','PGRST202']).toContain(generic.error?.code)
    expect(await row(x.id)).toMatchObject({processing_status:'RECEIVED',processed_at:null})
  })
})
