import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '../../src/lib/supabase/admin'
import type { Database } from '../../src/types/database'
import {
  claimStripeTestInvoiceLease,
  failStripeTestInvoiceLease,
} from '../../src/lib/billing/stripe-test-invoice-processing'

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const hasDb = !!serviceKey && serviceKey !== 'dummy_service_role_key'
const originalFlag = process.env.ENABLE_STRIPE_TEST_INVOICE_PROCESSING
const originalTarget = process.env.MPG_STRIPE_TEST_INVOICE_PROCESSING_TARGET
const originalLive = process.env.ENABLE_LIVE_BILLING
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

describe.skipIf(!hasDb)('MR-5E2D2 fenced invoice event claims', () => {
  const db = createAdminClient()
  const prefix = 'evt_mr5e2d2' + Date.now()
  let seq = 0

  function flags() {
    process.env.ENABLE_STRIPE_TEST_INVOICE_PROCESSING = 'true'
    process.env.MPG_STRIPE_TEST_INVOICE_PROCESSING_TARGET = 'LOCAL_SYNTHETIC'
    delete process.env.ENABLE_LIVE_BILLING
  }

  async function fixture(options: {
    eventType?: string
    invoiceId?: string | null
    environment?: 'TEST' | 'LIVE'
    status?: 'RECEIVED' | 'PROCESSING' | 'PROCESSED'
  } = {}): Promise<string> {
    const id = prefix + String(++seq)
    const type = options.eventType ?? 'invoice.paid'
    const {error} = await db.from('billing_webhook_events').insert({
      provider: 'stripe',
      environment: options.environment ?? 'TEST',
      provider_event_id: id,
      event_type: type,
      provider_invoice_id: options.invoiceId === undefined
        ? (type === 'invoice.paid' || type === 'invoice.payment_failed' ? 'in_fixture' : null)
        : options.invoiceId,
      processing_status: options.status ?? 'RECEIVED',
      payload_hash: 'b'.repeat(64),
    })
    if (error) throw new Error('MR5E2D2_FIXTURE_FAILED: ' + error.message)
    return id
  }

  async function claim(providerEventId: unknown) {
    return claimStripeTestInvoiceLease({
      trustedBillingSupabase: db, providerEventId,
    })
  }
  async function fail(providerEventId: unknown, leaseToken: unknown, errorCode: unknown = 'PROVIDER_UNAVAILABLE') {
    return failStripeTestInvoiceLease({
      trustedBillingSupabase: db, providerEventId, leaseToken, errorCode,
    })
  }
  async function row(id: string) {
    const {data, error} = await db.from('billing_webhook_events')
      .select('processing_status, processing_lease_token, processing_lease_expires_at, processing_attempt_count, error_code, processed_at')
      .eq('provider_event_id',id).single()
    expect(error).toBeNull()
    return data
  }

  beforeAll(flags)
  beforeEach(flags)
  afterAll(async () => {
    await db.from('billing_webhook_events').delete()
      .like('provider_event_id',prefix + '%')
    if (originalFlag === undefined) delete process.env.ENABLE_STRIPE_TEST_INVOICE_PROCESSING
    else process.env.ENABLE_STRIPE_TEST_INVOICE_PROCESSING = originalFlag
    if (originalTarget === undefined) delete process.env.MPG_STRIPE_TEST_INVOICE_PROCESSING_TARGET
    else process.env.MPG_STRIPE_TEST_INVOICE_PROCESSING_TARGET = originalTarget
    if (originalLive === undefined) delete process.env.ENABLE_LIVE_BILLING
    else process.env.ENABLE_LIVE_BILLING = originalLive
  })

  it('accepts only one concurrent claim, with durable token and attempt count', async () => {
    const id = await fixture()
    const [a,b] = await Promise.all([claim(id),claim(id)])
    const outcomes = [a.outcome,b.outcome].sort()
    expect(outcomes).toEqual(['CLAIMED','IN_FLIGHT'])
    expect(await row(id)).toMatchObject({
      processing_status:'PROCESSING', processing_attempt_count:1,
      processed_at:null,
    })
  })
  it('fences stale worker after lease expiry and takeover', async () => {
    const id = await fixture()
    const first = await claim(id)
    expect(first.outcome).toBe('CLAIMED')
    if (first.outcome !== 'CLAIMED') throw new Error('SETUP_CLAIM_FAILED')
    const {error} = await db.from('billing_webhook_events')
      .update({processing_lease_expires_at:'2020-01-01T00:00:00Z'})
      .eq('provider_event_id',id)
    expect(error).toBeNull()
    const second = await claim(id)
    expect(second.outcome).toBe('CLAIMED')
    if (second.outcome !== 'CLAIMED') throw new Error('TAKEOVER_CLAIM_FAILED')
    expect(second.attempts).toBe(2)
    expect(second.leaseToken).not.toBe(first.leaseToken)
    expect(await fail(id,first.leaseToken)).toEqual({
      outcome:'STALE_OR_NOT_CLAIMED',
    })
    expect(await row(id)).toMatchObject({
      processing_status:'PROCESSING',processing_attempt_count:2,
    })
    expect(await fail(id,second.leaseToken)).toEqual({
      outcome:'FAILED_REQUIRES_REVIEW',
    })
    expect(await row(id)).toMatchObject({
      processing_status:'FAILED',processing_lease_token:null,
      processing_lease_expires_at:null,processed_at:null,
      error_code:'PROVIDER_UNAVAILABLE',
    })
    expect(await claim(id)).toEqual({outcome:'MANUAL_REVIEW'})
  })
  it('refuses to finalize a lease that has expired before takeover', async () => {
    const id = await fixture()
    const leased = await claim(id)
    expect(leased.outcome).toBe('CLAIMED')
    if (leased.outcome !== 'CLAIMED') throw new Error('SETUP_CLAIM_FAILED')
    const {error} = await db.from('billing_webhook_events')
      .update({processing_lease_expires_at:'2020-01-01T00:00:00Z'})
      .eq('provider_event_id',id)
    expect(error).toBeNull()
    expect(await fail(id,leased.leaseToken)).toEqual({outcome:'STALE_OR_NOT_CLAIMED'})
    expect(await row(id)).toMatchObject({processing_status:'PROCESSING',processing_attempt_count:1})
    const replacement = await claim(id)
    expect(replacement.outcome).toBe('CLAIMED')
    if (replacement.outcome !== 'CLAIMED') throw new Error('REPLACEMENT_CLAIM_FAILED')
    expect(replacement.attempts).toBe(2)
    expect(await fail(id,replacement.leaseToken)).toEqual({outcome:'FAILED_REQUIRES_REVIEW'})
  })
  it('blocks further claims after third crashed/expired attempt', async () => {
    const id = await fixture()
    for (let i=1;i<=3;i++) {
      const next = await claim(id)
      expect(next.outcome).toBe('CLAIMED')
      if (next.outcome !== 'CLAIMED') throw new Error('SETUP_CLAIM_FAILED')
      expect(next.attempts).toBe(i)
      const {error} = await db.from('billing_webhook_events')
        .update({processing_lease_expires_at:'2020-01-01T00:00:00Z'})
        .eq('provider_event_id',id)
      expect(error).toBeNull()
    }
    expect(await claim(id)).toEqual({outcome:'MANUAL_REVIEW'})
    expect(await row(id)).toMatchObject({
      processing_status:'PROCESSING',processing_attempt_count:3,
    })
  })
  it('denies missing, LIVE, unsupported, legacy and already processed events', async () => {
    expect(await claim('evt_nonexistent')).toEqual({outcome:'NOT_FOUND'})
    expect(await claim('invalid-id')).toEqual({outcome:'INVALID_INPUT'})
    const live = await fixture({environment:'LIVE'})
    const unsupported = await fixture({eventType:'customer.subscription.updated'})
    const noInvoice = await fixture({invoiceId:null})
    const legacy = await fixture({status:'PROCESSING'})
    // Historical noninvoice terminal event remains a valid fixture.
    // An unlinked invoice cannot be inserted already PROCESSED.
    const processed = await fixture({
      status:'PROCESSED',eventType:'customer.subscription.updated',
    })
    for(const id of [live,unsupported,noInvoice,processed]) {
      expect(await claim(id)).toEqual({outcome: id===live?'NOT_FOUND':'NOT_ELIGIBLE'})
    }
    expect(await claim(legacy)).toEqual({outcome:'IN_FLIGHT'})
  })
  it('rejects non-fenced error updates and keeps provider payment untouched', async () => {
    const id = await fixture({eventType:'invoice.payment_failed'})
    expect(await fail(id,'00000000-0000-0000-0000-000000000000'))
      .toEqual({outcome:'STALE_OR_NOT_CLAIMED'})
    const a = await claim(id)
    expect(a.outcome).toBe('CLAIMED')
    if(a.outcome !== 'CLAIMED') throw new Error('CLAIM_FAILED')
    expect(await fail(id,a.leaseToken,'ARBITRARY_CODE'))
      .toEqual({outcome:'INVALID_INPUT'})
    expect(await fail(id,a.leaseToken,'EVIDENCE_CONFLICT'))
      .toEqual({outcome:'FAILED_REQUIRES_REVIEW'})
    expect(await row(id)).toMatchObject({processing_status:'FAILED',error_code:'EVIDENCE_CONFLICT'})
  })
  it('is disabled by default and with unsafe environment flags', async () => {
    const id = await fixture()
    delete process.env.ENABLE_STRIPE_TEST_INVOICE_PROCESSING
    expect(await claim(id)).toEqual({outcome:'DISABLED'})
    flags()
    process.env.MPG_STRIPE_TEST_INVOICE_PROCESSING_TARGET='HOSTED'
    expect(await claim(id)).toEqual({outcome:'DISABLED'})
    flags()
    process.env.ENABLE_LIVE_BILLING='true'
    expect(await claim(id)).toEqual({outcome:'DISABLED'})
    flags()
    expect((await row(id))?.processing_status).toBe('RECEIVED')
  })
  it('does not give anonymous clients execution rights', async () => {
    if (!anonKey) throw new Error('MISSING_DISPOSABLE_ANON_KEY')
    const anon = createClient<Database>(url,anonKey, {
      auth:{autoRefreshToken:false,persistSession:false},
    })
    const {error} = await anon.rpc('claim_stripe_test_invoice_processing',{
      p_provider_event_id:'evt_notallowed',
    })
    expect(error).not.toBeNull()
  })
})
