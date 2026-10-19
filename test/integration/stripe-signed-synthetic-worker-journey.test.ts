import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../src/app/api/webhooks/stripe/route'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { createStripeClient } from '../../src/lib/billing/stripe'
import { processDurableStripeTestEvent } from '../../src/lib/billing/stripe-test-reconciliation-worker'

const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const hasDisposableDb = !!serviceRole && serviceRole !== 'dummy_service_role_key'
const testStripeKey = 'sk_test_mr5i2_synthetic_fixture'
const testSigningKey = 'whsec_mr5i2_synthetic_fixture'
const original = {
  stripe: process.env.STRIPE_SECRET_KEY,
  webhook: process.env.STRIPE_WEBHOOK_SECRET,
  live: process.env.ENABLE_LIVE_BILLING,
}
function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

describe.skipIf(!hasDisposableDb)('MR-5I2 signed TEST webhook through durable fenced worker', () => {
  const db = createAdminClient()
  const nonce = randomUUID().replaceAll('-', '')
  const prefix = 'evt_Mr5i2' + nonce
  const customerId = 'cus_Mr5i2' + nonce
  const providerSubscriptionId = 'sub_Mr5i2' + nonce
  const priceId = 'price_Mr5i2' + nonce
  let organizationId = ''
  let billingAccountId = ''
  let eventSeq = 0

  function setSyntheticOnly() {
    process.env.STRIPE_SECRET_KEY = testStripeKey
    process.env.STRIPE_WEBHOOK_SECRET = testSigningKey
    delete process.env.ENABLE_LIVE_BILLING
  }
  function nextEventId() {
    return prefix + String(++eventSeq)
  }

  function wireEvent(args: {
    id: string
    marker?: string
    livemode?: boolean
    type?: string
    subscriptionId?: string
  }) {
    return JSON.stringify({
      id: args.id,
      object: 'event',
      api_version: null,
      created: Math.floor(Date.now() / 1000),
      livemode: args.livemode ?? false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: args.type ?? 'customer.subscription.updated',
      data: { object: {
        id: args.subscriptionId ?? providerSubscriptionId,
        object: 'subscription',
        // Provider-event metadata is NOT tenant authority.
        metadata: { organization_id: '00000000-0000-4000-8000-000000000000',
          marker: args.marker ?? 'original' },
      } },
    })
  }

  function signedRequest(rawBody: string, signatureBody = rawBody) {
    const signature = createStripeClient().webhooks.generateTestHeaderString({
      payload: signatureBody, secret: testSigningKey,
    })
    return new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      body: rawBody,
    })
  }

  async function storedEvent(providerEventId: string) {
    const { data, error } = await db.from('billing_webhook_events')
      .select('id,organization_id,provider_event_id,event_type,environment,processing_status,processing_attempts,payload_hash,processed_at,provider_created_at')
      .eq('provider', 'stripe')
      .eq('environment', 'TEST')
      .eq('provider_event_id', providerEventId).single()
    if (error || !data) throw new Error('MR5I2_EVENT_LOOKUP_FAILED')
    return data
  }

  function stubProvider(eventId: string, status: 'active' | 'past_due' = 'active',
    overrideCustomer?: string) {
    const retrieveEvent = vi.fn(async (requestedId: string) => {
      expect(requestedId).toBe(eventId)
      return {
        id: eventId, object: 'event', livemode: false,
        type: 'customer.subscription.updated',
        data: { object: {
          id: providerSubscriptionId, object: 'subscription',
          customer: 'cus_ForgedEventOnly',
          metadata: { organization_id: '00000000-0000-4000-8000-000000000000' },
        } },
      }
    })
    const retrieveSubscription = vi.fn(async (requestedId: string) => {
      expect(requestedId).toBe(providerSubscriptionId)
      return {
        id: providerSubscriptionId, livemode: false,
        customer: overrideCustomer ?? customerId, status,
        cancel_at_period_end: false, canceled_at: null,
        items: { has_more: false, data: [{
          price: { id: priceId },
          current_period_start: 1792300000,
          current_period_end: 1794892000,
        }] },
      }
    })
    return { retrieveEvent, retrieveSubscription }
  }

  async function assertTrialUnchanged() {
    const { data, error } = await db.from('organization_entitlements')
      .select('allocated_requests,consumed_requests,status')
      .eq('organization_id', organizationId).single()
    expect(error).toBeNull()
    expect(data).toMatchObject({
      allocated_requests: 30, consumed_requests: 0, status: 'NOT_STARTED',
    })
    const { count, error: caseError } = await db.from('billing_paid_entitlement_proposals')
      .select('id', { head: true, count: 'exact' })
      .eq('organization_id', organizationId)
    expect(caseError).toBeNull()
    expect(count).toBe(0)
  }

  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (url !== 'http://127.0.0.1:54331' && url !== 'http://localhost:54331') {
      throw new Error('MR5I2_DISPOSABLE_SUPABASE_REQUIRED')
    }
    setSyntheticOnly()
    const { data: org, error: orgError } = await db.from('organizations')
      .insert({ name: 'MR5I2 signed synthetic webhook fixture', slug: 'mr5i2-' + nonce })
      .select('id').single()
    if (orgError || !org) throw new Error('MR5I2_ORG_SETUP_FAILED')
    organizationId = org.id
    const { data: account, error: accountError } = await db.from('organization_billing_accounts')
      .insert({ organization_id: organizationId, provider: 'stripe', environment: 'TEST',
        provider_customer_id: customerId })
      .select('id').single()
    if (accountError || !account) throw new Error('MR5I2_ACCOUNT_SETUP_FAILED')
    billingAccountId = account.id
    const { error: trialError } = await db.rpc('provision_organization_trial', {
      p_org_id: organizationId,
    })
    if (trialError) throw new Error('MR5I2_TRIAL_SETUP_FAILED')
  })
  beforeEach(setSyntheticOnly)
  afterAll(async () => {
    await db.from('billing_webhook_events').delete().like('provider_event_id', prefix + '%')
    if (organizationId) await db.from('organizations').delete().eq('id', organizationId)
    restore('STRIPE_SECRET_KEY', original.stripe)
    restore('STRIPE_WEBHOOK_SECRET', original.webhook)
    restore('ENABLE_LIVE_BILLING', original.live)
  })

  it('takes an actual signed route event through a durable lease and atomic TEST projection', async () => {
    const eventId = nextEventId()
    const rawBody = wireEvent({ id: eventId })
    const ingress = await POST(signedRequest(rawBody))
    expect(ingress.status).toBe(200)
    expect(await ingress.json()).toEqual({ received: true, claimed: true })
    const stored = await storedEvent(eventId)
    expect(stored).toMatchObject({
      environment: 'TEST', processing_status: 'RECEIVED', organization_id: null,
      provider_event_id: eventId, event_type: 'customer.subscription.updated',
    })
    expect(stored.provider_created_at).not.toBeNull()
    expect(stored.payload_hash).toMatch(/^[a-f0-9]{64}$/)

    const fake = stubProvider(eventId)
    const processed = await processDurableStripeTestEvent({
      supabase: db, eventRecordId: stored.id, ...fake,
    })
    expect(processed).toEqual({ outcome: 'COMMITTED', projectionOutcome: 'CREATED' })
    expect(fake.retrieveEvent).toHaveBeenCalledOnce()
    expect(fake.retrieveSubscription).toHaveBeenCalledOnce()
    const final = await storedEvent(eventId)
    expect(final).toMatchObject({
      organization_id: organizationId, processing_status: 'PROCESSED',
      processing_attempts: 1,
    })
    expect(final.processed_at).not.toBeNull()
    const { data: subscription, error } = await db.from('organization_subscriptions')
      .select('organization_id,billing_account_id,environment,provider_status,normalized_status,provider_subscription_id')
      .eq('provider_subscription_id', providerSubscriptionId).single()
    expect(error).toBeNull()
    expect(subscription).toMatchObject({
      organization_id: organizationId, billing_account_id: billingAccountId,
      environment: 'TEST', provider_subscription_id: providerSubscriptionId,
      provider_status: 'active', normalized_status: 'ACTIVE',
    })

    // A successful subscription projection is NOT proof of invoice settlement.
    await assertTrialUnchanged()
    const replay = await POST(signedRequest(rawBody))
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({ received: true, duplicate: true, final: true })
    expect(await processDurableStripeTestEvent({
      supabase: db, eventRecordId: stored.id, ...fake,
    })).toEqual({ outcome: 'NO_WORK' })
    expect(fake.retrieveSubscription).toHaveBeenCalledOnce()
    await assertTrialUnchanged()
  })

  it('rejects a signed duplicate with a conflicting body and never rewrites the original', async () => {
    const eventId = nextEventId()
    const first = wireEvent({ id: eventId })
    const altered = wireEvent({ id: eventId, marker: 'different' })
    expect((await POST(signedRequest(first))).status).toBe(200)
    const originalEvent = await storedEvent(eventId)
    const response = await POST(signedRequest(altered))
    expect(response.status).toBe(409)
    const final = await storedEvent(eventId)
    expect(final.payload_hash).toBe(originalEvent.payload_hash)
    expect(final.processing_status).toBe('RECEIVED')
    await assertTrialUnchanged()
  })

  it('reconciles delayed events against fresh provider truth rather than old event snapshots', async () => {
    const eventId = nextEventId()
    const rawBody = wireEvent({ id: eventId, marker: 'late-delivered-old' })
    expect((await POST(signedRequest(rawBody))).status).toBe(200)
    const pending = await storedEvent(eventId)
    const latest = stubProvider(eventId, 'past_due')
    const result = await processDurableStripeTestEvent({
      supabase: db, eventRecordId: pending.id, ...latest,
    })
    expect(result).toEqual({ outcome: 'COMMITTED', projectionOutcome: 'UPDATED' })
    const { data: subscription, error } = await db.from('organization_subscriptions')
      .select('provider_status,normalized_status')
      .eq('provider_subscription_id', providerSubscriptionId).single()
    expect(error).toBeNull()
    expect(subscription).toMatchObject({ provider_status: 'past_due', normalized_status: 'SUSPENDED' })
    await assertTrialUnchanged()
  })

  it('fails a tenant-unresolved provider lookup without projecting a foreign business', async () => {
    const eventId = nextEventId()
    const rawBody = wireEvent({ id: eventId })
    expect((await POST(signedRequest(rawBody))).status).toBe(200)
    const pending = await storedEvent(eventId)
    const forged = stubProvider(eventId, 'active', 'cus_UnrecognizedFixture')
    const result = await processDurableStripeTestEvent({
      supabase: db, eventRecordId: pending.id, ...forged,
    })
    expect(result).toEqual({ outcome: 'FAILED', errorCode: 'UNRESOLVED_CUSTOMER' })
    expect(await storedEvent(eventId)).toMatchObject({
      processing_status: 'FAILED', organization_id: null,
    })
    await assertTrialUnchanged()
  })

  it('rejects bad signatures and LIVE delivery without a durable TEST projection', async () => {
    const badId = nextEventId()
    const rawBody = wireEvent({ id: badId })
    const tampered = await POST(signedRequest(rawBody.replace('original', 'tampered'), rawBody))
    expect(tampered.status).toBe(400)
    const liveId = nextEventId()
    const live = await POST(signedRequest(wireEvent({ id: liveId, livemode: true })))
    expect(live.status).toBe(503)
    const { count, error } = await db.from('billing_webhook_events')
      .select('id', { count: 'exact', head: true })
      .in('provider_event_id', [badId, liveId])
    expect(error).toBeNull()
    expect(count).toBe(0)
    await assertTrialUnchanged()
  })
})
