import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import { POST } from '../../src/app/api/webhooks/stripe/route'
import { createStripeClient } from '../../src/lib/billing/stripe'
import { runAuthorizedLocalStripeRecoveryOperation } from '../../src/lib/billing/stripe-recovery-operator'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient<Database>(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const suffix = randomUUID().replaceAll('-', '')
const prefix = 'evt_Mr5i3' + suffix
const customerId = 'cus_Mr5i3' + suffix
const subscriptionId = 'sub_Mr5i3' + suffix
const priceId = 'price_Mr5i3' + suffix
const signingKey = 'whsec_mr5i3_disposable_fixture'
const stripeKey = 'sk_test_mr5i3_disposable_fixture'
const token = 'b'.repeat(64)
const flags = [
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'ENABLE_STRIPE_TEST_RECOVERY_OPERATOR',
  'ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER',
  'MPG_STRIPE_RECOVERY_TARGET',
  'MPG_STRIPE_RECOVERY_OPERATOR_TOKEN',
  'ENABLE_LIVE_BILLING', 'VERCEL_ENV',
] as const
const initial = Object.fromEntries(flags.map(k => [k, process.env[k]]))
let organizationId = ''
let billingAccountId = ''
let seq = 0

function prepareLocal({ enable = true }: { enable?: boolean } = {}) {
  process.env.STRIPE_SECRET_KEY = stripeKey
  process.env.STRIPE_WEBHOOK_SECRET = signingKey
  process.env.ENABLE_STRIPE_TEST_RECOVERY_OPERATOR = enable ? 'true' : 'false'
  process.env.ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER = enable ? 'true' : 'false'
  process.env.MPG_STRIPE_RECOVERY_TARGET = 'LOCAL_SYNTHETIC'
  process.env.MPG_STRIPE_RECOVERY_OPERATOR_TOKEN = token
  process.env.ENABLE_LIVE_BILLING = 'false'
  delete process.env.VERCEL_ENV
}

function signedRequest(eventId: string) {
  const body = JSON.stringify({
    id: eventId, object: 'event', api_version: null,
    created: Math.floor(Date.now() / 1000), livemode: false,
    type: 'customer.subscription.updated', pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object: {
      id: subscriptionId, object: 'subscription',
      customer: 'cus_ForgedEventCustomer',
      metadata: { organization_id: '00000000-0000-4000-8000-000000000000' },
    } },
  })
  const signature = createStripeClient().webhooks.generateTestHeaderString({
    payload: body, secret: signingKey,
  })
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body,
  })
}

async function claimSigned() {
  const providerId = prefix + String(++seq)
  const response = await POST(signedRequest(providerId))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ received: true, claimed: true })
  const { data, error } = await db.from('billing_webhook_events')
    .select('id,provider_event_id,processing_status,organization_id')
    .eq('provider', 'stripe').eq('environment', 'TEST')
    .eq('provider_event_id', providerId).single()
  expect(error).toBeNull()
  expect(data).toMatchObject({ provider_event_id: providerId,
    processing_status: 'RECEIVED', organization_id: null })
  return { eventId: providerId, recordId: data!.id }
}

function fakeProvider(eventId: string, opts: {
  status?: 'active' | 'past_due'
  customer?: string
  unavailable?: boolean
} = {}) {
  const retrieveEvent = vi.fn(async (id: string) => {
    expect(id).toBe(eventId)
    return {
      id: eventId, object: 'event', livemode: false,
      type: 'customer.subscription.updated',
      data: { object: {
        id: subscriptionId, object: 'subscription',
        customer: 'cus_ForgedUntrustedEvent',
        metadata: { organization_id: '00000000-0000-4000-8000-000000000000' },
      } },
    }
  })
  const retrieveSubscription = vi.fn(async (id: string) => {
    expect(id).toBe(subscriptionId)
    if (opts.unavailable) throw new Error('Synthetic provider unavailable')
    return {
      id: subscriptionId, livemode: false,
      customer: opts.customer ?? customerId, status: opts.status ?? 'active',
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

async function operate(
  provider: ReturnType<typeof fakeProvider>,
  operatorToken = token,
) {
  return runAuthorizedLocalStripeRecoveryOperation({
    operatorToken, supabase: db, ...provider, maxEvents: 1,
  })
}

async function eventRecord(recordId: string) {
  const { data, error } = await db.from('billing_webhook_events')
    .select('processing_status,processing_attempts,organization_id,processed_at,next_processing_attempt_at,error_code')
    .eq('id', recordId).single()
  expect(error).toBeNull()
  return data!
}

async function assertUnpaid() {
  const { data: trial, error } = await db.from('organization_entitlements')
    .select('allocated_requests,consumed_requests,status')
    .eq('organization_id', organizationId).single()
  expect(error).toBeNull()
  expect(trial).toMatchObject({
    allocated_requests: 30, consumed_requests: 0, status: 'NOT_STARTED',
  })
  const { count, error: proposalsError } = await db
    .from('billing_paid_entitlement_proposals')
    .select('id', { head: true, count: 'exact' })
    .eq('organization_id', organizationId)
  expect(proposalsError).toBeNull()
  expect(count).toBe(0)
}

describe('MR-5I3 signed TEST webhook via sealed local operator and existing recovery dispatcher', () => {
  beforeAll(async () => {
    if (url !== 'http://127.0.0.1:54331' && url !== 'http://localhost:54331') {
      throw new Error('MR5I3_DISPOSABLE_SUPABASE_REQUIRED')
    }
    if (process.env.NODE_ENV === 'production') throw new Error('MR5I3_PRODUCTION_MODE_FORBIDDEN')
    prepareLocal()
    const { data: org, error } = await db.from('organizations')
      .insert({ name: 'MR5I3 sealed synthetic journey', slug: 'mr5i3-' + suffix })
      .select('id').single()
    if (error || !org) throw new Error('MR5I3_ORGANIZATION_FIXTURE_FAILED')
    organizationId = org.id
    const { data: account, error: accountError } = await db
      .from('organization_billing_accounts')
      .insert({ organization_id: organizationId, provider: 'stripe',
        environment: 'TEST', provider_customer_id: customerId })
      .select('id').single()
    if (accountError || !account) throw new Error('MR5I3_BILLING_ACCOUNT_FIXTURE_FAILED')
    billingAccountId = account.id
    const { error: trialError } = await db.rpc('provision_organization_trial', {
      p_org_id: organizationId,
    })
    if (trialError) throw new Error('MR5I3_TRIAL_FIXTURE_FAILED')
  })
  beforeEach(() => prepareLocal())
  afterAll(async () => {
    await db.from('billing_webhook_events').delete().like('provider_event_id', prefix + '%')
    if (organizationId) await db.from('organizations').delete().eq('id', organizationId)
    for (const name of flags) {
      const previous = initial[name]
      if (previous === undefined) delete process.env[name]
      else process.env[name] = previous
    }
  })

  it('requires explicit local enablement and correct operator proof before selecting a signed event', async () => {
    const pending = await claimSigned()
    const provider = fakeProvider(pending.eventId)
    prepareLocal({ enable: false })
    expect(await operate(provider)).toEqual({ outcome: 'DISABLED' })
    prepareLocal()
    expect(await operate(provider, 'c'.repeat(64))).toEqual({ outcome: 'DENIED' })
    expect(provider.retrieveEvent).not.toHaveBeenCalled()
    expect(provider.retrieveSubscription).not.toHaveBeenCalled()
    expect(await eventRecord(pending.recordId)).toMatchObject({
      processing_status: 'RECEIVED', processing_attempts: 0,
      organization_id: null,
    })
    await assertUnpaid()

    const result = await operate(provider)
    expect(result.outcome).toBe('COMPLETE')
    if (result.outcome !== 'COMPLETE') return
    expect(result.dispatch.committed).toBe(1)
    expect(result.dispatch.examined).toBe(1)
    expect(result.dispatch.errors).toBe(0)
    expect(provider.retrieveEvent).toHaveBeenCalledWith(pending.eventId)
    expect(provider.retrieveSubscription).toHaveBeenCalledWith(subscriptionId)
    expect(await eventRecord(pending.recordId)).toMatchObject({
      processing_status: 'PROCESSED', processing_attempts: 1,
      organization_id: organizationId,
    })
    const { data: sub, error } = await db.from('organization_subscriptions')
      .select('billing_account_id,organization_id,provider_status,normalized_status')
      .eq('provider_subscription_id', subscriptionId).single()
    expect(error).toBeNull()
    expect(sub).toMatchObject({
      billing_account_id: billingAccountId, organization_id: organizationId,
      provider_status: 'active', normalized_status: 'ACTIVE',
    })
    const second = await operate(provider)
    expect(second.outcome).toBe('COMPLETE')
    if (second.outcome === 'COMPLETE') expect(second.dispatch.committed).toBe(0)
    expect(provider.retrieveSubscription).toHaveBeenCalledOnce()
    await assertUnpaid()
  })

  it('retries failed provider reads only after DB cooldown and uses current subscription truth', async () => {
    const item = await claimSigned()
    const unavailable = fakeProvider(item.eventId, { unavailable: true })
    const failed = await operate(unavailable)
    expect(failed.outcome).toBe('COMPLETE')
    if (failed.outcome !== 'COMPLETE') return
    expect(failed.dispatch.failed).toBe(1)
    expect(await eventRecord(item.recordId)).toMatchObject({
      processing_status: 'FAILED', processing_attempts: 1,
      error_code: 'PROVIDER_UNAVAILABLE', organization_id: null,
    })
    const blocked = await operate(unavailable)
    expect(blocked.outcome).toBe('COMPLETE')
    if (blocked.outcome === 'COMPLETE') expect(blocked.dispatch.examined).toBe(0)
    expect(unavailable.retrieveSubscription).toHaveBeenCalledOnce()
    const { error } = await db.from('billing_webhook_events')
      .update({ next_processing_attempt_at: '2020-01-01T00:00:00Z' })
      .eq('id', item.recordId)
    expect(error).toBeNull()
    const recovered = fakeProvider(item.eventId, { status: 'past_due' })
    const retry = await operate(recovered)
    expect(retry.outcome).toBe('COMPLETE')
    if (retry.outcome === 'COMPLETE') expect(retry.dispatch.committed).toBe(1)
    expect(await eventRecord(item.recordId)).toMatchObject({
      processing_status: 'PROCESSED', processing_attempts: 2,
      organization_id: organizationId,
    })
    const { data: sub, error: readError } = await db.from('organization_subscriptions')
      .select('provider_status,normalized_status')
      .eq('provider_subscription_id', subscriptionId).single()
    expect(readError).toBeNull()
    expect(sub).toMatchObject({
      provider_status: 'past_due', normalized_status: 'SUSPENDED',
    })
    await assertUnpaid()
  })

  it('serializes concurrent operator attempts for one durably signed event', async () => {
    const item = await claimSigned()
    const provider = fakeProvider(item.eventId)
    const [a, b] = await Promise.all([operate(provider), operate(provider)])
    expect(a.outcome).toBe('COMPLETE')
    expect(b.outcome).toBe('COMPLETE')
    if (a.outcome === 'COMPLETE' && b.outcome === 'COMPLETE') {
      expect(a.dispatch.committed + b.dispatch.committed).toBe(1)
      expect(a.dispatch.errors + b.dispatch.errors).toBe(0)
    }
    expect(await eventRecord(item.recordId)).toMatchObject({
      processing_status: 'PROCESSED', processing_attempts: 1,
    })
    expect(provider.retrieveSubscription).toHaveBeenCalledOnce()
    await assertUnpaid()
  })

  it('does not project a foreign customer from untrusted event metadata', async () => {
    const item = await claimSigned()
    const provider = fakeProvider(item.eventId, { customer: 'cus_ForeignNoMapping' })
    const result = await operate(provider)
    expect(result.outcome).toBe('COMPLETE')
    if (result.outcome === 'COMPLETE') expect(result.dispatch.failed).toBe(1)
    expect(await eventRecord(item.recordId)).toMatchObject({
      processing_status: 'FAILED', error_code: 'UNRESOLVED_CUSTOMER',
      organization_id: null,
    })
    await assertUnpaid()
  })
})
