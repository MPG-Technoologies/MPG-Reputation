import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { POST } from '../../src/app/api/webhooks/stripe/route'
import { createStripeClient } from '../../src/lib/billing/stripe'
import { createAdminClient } from '../../src/lib/supabase/admin'

const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const hasDb = !!key && key !== 'dummy_service_role_key'
const fixtureKey = 'sk_test_mr5e2c_synthetic_fixture'
const fixtureSecret = 'whsec_mr5e2c_synthetic_fixture'
const originalKey = process.env.STRIPE_SECRET_KEY
const originalSecret = process.env.STRIPE_WEBHOOK_SECRET
const originalLive = process.env.ENABLE_LIVE_BILLING

describe.skipIf(!hasDb)('MR-5E2C signed invoice reference intake', () => {
  const db = createAdminClient()
  const prefix = 'evt_mr5e2c' + Date.now()
  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = fixtureKey
    process.env.STRIPE_WEBHOOK_SECRET = fixtureSecret
    delete process.env.ENABLE_LIVE_BILLING
  })
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = fixtureKey
    process.env.STRIPE_WEBHOOK_SECRET = fixtureSecret
    delete process.env.ENABLE_LIVE_BILLING
  })
  afterAll(async () => {
    await db.from('billing_webhook_events').delete()
      .like('provider_event_id', prefix + '%')
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = originalKey
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret
    if (originalLive === undefined) delete process.env.ENABLE_LIVE_BILLING
    else process.env.ENABLE_LIVE_BILLING = originalLive
  })

  function raw(id: string, type: string, object: Record<string, unknown>) {
    return JSON.stringify({
      id, object: 'event', created: Math.floor(Date.now() / 1000),
      livemode: false, type,
      data: { object }, pending_webhooks: 1,
    })
  }
  function signed(body: string): Request {
    const signature = createStripeClient().webhooks.generateTestHeaderString({
      payload: body, secret: fixtureSecret,
    })
    return new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST', headers: { 'stripe-signature': signature }, body,
    })
  }
  async function record(id: string) {
    const {data, error} = await db.from('billing_webhook_events')
      .select('provider_invoice_id, event_type, processing_status, organization_id')
      .eq('provider','stripe').eq('environment','TEST')
      .eq('provider_event_id', id).maybeSingle()
    expect(error).toBeNull()
    return data
  }

  it('persists only the verified invoice reference, never marks it processed', async () => {
    const id = prefix + 'paid'
    const invoiceId = 'in_mr5e2c' + Date.now()
    const response = await POST(signed(raw(id, 'invoice.paid',
      { id: invoiceId, object: 'invoice', amount_paid: 500000, customer_email: 'synthetic@example.test' })))
    expect(response.status).toBe(200)
    expect(await record(id)).toEqual({
      provider_invoice_id: invoiceId, event_type: 'invoice.paid',
      processing_status: 'RECEIVED', organization_id: null,
    })
  })
  it('persists the invoice reference for a payment failure without granting access', async () => {
    const id = prefix + 'failure'
    const invoiceId = 'in_failure' + Date.now()
    expect((await POST(signed(raw(id, 'invoice.payment_failed',
      {id: invoiceId, object: 'invoice'})))).status).toBe(200)
    expect(await record(id)).toMatchObject({
      provider_invoice_id: invoiceId, processing_status: 'RECEIVED',
    })
  })
  it('does not persist an invoice ID from an unrelated event', async () => {
    const id = prefix + 'subscription'
    expect((await POST(signed(raw(id, 'customer.subscription.updated',
      {id:'sub_fixture', object:'subscription', provider_invoice_id:'in_bad'})))).status)
      .toBe(200)
    expect(await record(id)).toMatchObject({provider_invoice_id: null})
  })
  it('rejects a malformed signed invoice event without inserting it', async () => {
    const id = prefix + 'invalid'
    const response = await POST(signed(raw(id, 'invoice.paid',
      {id: 'sub_not_an_invoice', object: 'subscription'})))
    expect(response.status).toBe(500)
    expect(await record(id)).toBeNull()
  })
  it('rejects tampering and never persists the changed invoice ID', async () => {
    const id = prefix + 'tampered'
    const body = raw(id, 'invoice.paid', {id:'in_correct',object:'invoice'})
    const signature = createStripeClient().webhooks.generateTestHeaderString({
      payload: body, secret: fixtureSecret,
    })
    const response = await POST(new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST', headers: {'stripe-signature': signature},
      body: body.replace('in_correct','in_changed'),
    }))
    expect(response.status).toBe(400)
    expect(await record(id)).toBeNull()
  })
  it('keeps exact webhook replay idempotent', async () => {
    const id = prefix + 'replay'
    const body = raw(id, 'invoice.paid', {id:'in_replayed',object:'invoice'})
    expect((await POST(signed(body))).status).toBe(200)
    const second = await POST(signed(body))
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({
      received:true, duplicate:true, final:false,
    })
    expect(await record(id)).toMatchObject({provider_invoice_id:'in_replayed'})
  })
})
