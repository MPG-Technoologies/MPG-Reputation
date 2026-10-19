import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { inspectStripeTestInvoiceInbox } from '../../src/lib/billing/stripe-test-invoice-inbox'
import type { StripeInvoiceIdentityTruth } from '../../src/lib/billing/stripe-invoice-truth'

const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const hasDisposableDb = !!key && key !== 'dummy_service_role_key'
const prevEnabled = process.env.ENABLE_STRIPE_TEST_INVOICE_PREFLIGHT
const prevTarget = process.env.MPG_STRIPE_TEST_INVOICE_PREFLIGHT_TARGET
const prevLive = process.env.ENABLE_LIVE_BILLING

describe.skipIf(!hasDisposableDb)('MR-5E2D1 durable invoice inbox preflight', () => {
  const db = createAdminClient()
  const nonce = Date.now()
  const customer = 'cus_inbox' + nonce
  const subscriptionId = 'sub_inbox' + nonce
  const invoiceId = 'in_inbox' + nonce
  const eventPrefix = 'evt_mr5e2d1' + nonce
  let orgId: string
  let accountId: string
  let eventIndex = 0
  const providerInvoice: StripeInvoiceIdentityTruth = {
    id: invoiceId, livemode: false, customer, subscriptionId,
  }

  function localFlags() {
    process.env.ENABLE_STRIPE_TEST_INVOICE_PREFLIGHT = 'true'
    process.env.MPG_STRIPE_TEST_INVOICE_PREFLIGHT_TARGET = 'LOCAL_SYNTHETIC'
    delete process.env.ENABLE_LIVE_BILLING
  }

  async function addEvent(overrides: {
    event_type?: string
    provider_invoice_id?: string | null
    processing_status?: 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED'
    payload_hash?: string
    organization_id?: string | null
  } = {}) {
    const providerEventId = eventPrefix + String(++eventIndex)
    const { error } = await db.from('billing_webhook_events').insert({
      provider: 'stripe', environment: 'TEST',
      provider_event_id: providerEventId, event_type: 'invoice.paid',
      provider_invoice_id: invoiceId, processing_status: 'RECEIVED',
      payload_hash: 'a'.repeat(64), ...overrides,
    })
    if (error) throw new Error('MR5E2D1_EVENT_SETUP_FAILED: ' + error.message)
    return providerEventId
  }

  function inspect(id: unknown, invoice: StripeInvoiceIdentityTruth = providerInvoice) {
    const retrieveInvoice = vi.fn(async () => invoice)
    return { retrieveInvoice, response: inspectStripeTestInvoiceInbox({
      trustedBillingSupabase: db,
      providerEventId: id,
      retrieveInvoice,
    }) }
  }

  beforeAll(async () => {
    localFlags()
    const { data: org, error: orgError } = await db.from('organizations')
      .insert({ name: 'MR5E2D1 synthetic org ' + nonce, slug: 'mr5e2d1-' + nonce })
      .select('id').single()
    if (orgError || !org) throw new Error('MR5E2D1_ORG_SETUP_FAILED')
    orgId = org.id
    const { data: account, error: accountError } = await db.from('organization_billing_accounts')
      .insert({ organization_id: orgId, provider: 'stripe', environment: 'TEST',
        provider_customer_id: customer }).select('id').single()
    if (accountError || !account) throw new Error('MR5E2D1_ACCOUNT_SETUP_FAILED')
    accountId = account.id
    const { error: subError } = await db.from('organization_subscriptions')
      .insert({ organization_id: orgId, billing_account_id: accountId,
        provider: 'stripe', environment: 'TEST', provider_subscription_id: subscriptionId,
        provider_status: 'active', normalized_status: 'ACTIVE' })
    if (subError) throw new Error('MR5E2D1_SUB_SETUP_FAILED')
  })
  beforeEach(localFlags)
  afterAll(async () => {
    await db.from('billing_webhook_events').delete()
      .like('provider_event_id', eventPrefix + '%')
    if (orgId) await db.from('organizations').delete().eq('id', orgId)
    if (prevEnabled === undefined) delete process.env.ENABLE_STRIPE_TEST_INVOICE_PREFLIGHT
    else process.env.ENABLE_STRIPE_TEST_INVOICE_PREFLIGHT = prevEnabled
    if (prevTarget === undefined) delete process.env.MPG_STRIPE_TEST_INVOICE_PREFLIGHT_TARGET
    else process.env.MPG_STRIPE_TEST_INVOICE_PREFLIGHT_TARGET = prevTarget
    if (prevLive === undefined) delete process.env.ENABLE_LIVE_BILLING
    else process.env.ENABLE_LIVE_BILLING = prevLive
  })

  it('matches exact durable event, invoice, customer, subscription and organization without processing', async () => {
    const id = await addEvent()
    const { response, retrieveInvoice } = inspect(id)
    expect(await response).toEqual({ outcome: 'MATCHED_IDENTITY_ONLY', organizationId: orgId })
    expect(retrieveInvoice).toHaveBeenCalledTimes(1)
    expect(retrieveInvoice).toHaveBeenCalledWith(invoiceId)
    const { data } = await db.from('billing_webhook_events')
      .select('processing_status, processed_at, organization_id')
      .eq('provider_event_id', id).single()
    expect(data).toMatchObject({
      processing_status: 'RECEIVED', processed_at: null, organization_id: null,
    })
  })
  it('does not make a provider call for invalid and missing event IDs', async () => {
    const invalid = inspect('bad-id')
    expect(await invalid.response).toEqual({ outcome: 'INVALID_EVENT_ID' })
    expect(invalid.retrieveInvoice).not.toHaveBeenCalled()
    const missing = inspect('evt_missing' + nonce)
    expect(await missing.response).toEqual({ outcome: 'NOT_READY', reason: 'MISSING' })
    expect(missing.retrieveInvoice).not.toHaveBeenCalled()
  })
  it('denies missing invoice references, unsupported events and already processing rows', async () => {
    const missing = inspect(await addEvent({provider_invoice_id: null}))
    expect(await missing.response).toEqual({outcome:'NOT_READY',reason:'INCOMPLETE_REFERENCE'})
    const unrelated = inspect(await addEvent({event_type:'customer.subscription.updated',provider_invoice_id:null}))
    expect(await unrelated.response).toEqual({outcome:'NOT_READY',reason:'UNSUPPORTED'})
    const processing = inspect(await addEvent({processing_status:'PROCESSING'}))
    expect(await processing.response).toEqual({outcome:'NOT_READY',reason:'NOT_UNPROCESSED'})
    expect(missing.retrieveInvoice).not.toHaveBeenCalled()
    expect(unrelated.retrieveInvoice).not.toHaveBeenCalled()
    expect(processing.retrieveInvoice).not.toHaveBeenCalled()
  })
  it('rejects provider invoice ID/environment and foreign tenant mapping', async () => {
    const id = await addEvent()
    await expect(inspect(id, {...providerInvoice,id:'in_other'}).response)
      .rejects.toThrow('BILLING_INVOICE_PROVIDER_IDENTITY_MISMATCH')
    await expect(inspect(id, {...providerInvoice,livemode:true}).response)
      .rejects.toThrow('BILLING_INVOICE_PROVIDER_IDENTITY_MISMATCH')
    expect(await inspect(id, {...providerInvoice,customer:'cus_foreign'}).response)
      .toEqual({outcome:'UNRESOLVED_IDENTITY'})
  })
  it('treats unavailable provider truth as error, never as no invoice', async () => {
    const id = await addEvent()
    await expect(inspectStripeTestInvoiceInbox({
      trustedBillingSupabase: db, providerEventId: id,
      retrieveInvoice: async () => { throw new Error('unavailable') },
    })).rejects.toThrow('BILLING_INVOICE_PROVIDER_UNAVAILABLE')
  })
  it('detects a concurrent change in durable event status after provider lookup', async () => {
    const id = await addEvent()
    const result = await inspectStripeTestInvoiceInbox({
      trustedBillingSupabase: db,
      providerEventId: id,
      retrieveInvoice: async () => {
        const { error } = await db.from('billing_webhook_events')
          .update({ processing_status: 'PROCESSING' })
          .eq('provider_event_id', id)
        expect(error).toBeNull()
        return providerInvoice
      },
    })
    expect(result).toEqual({outcome:'NOT_READY',reason:'CHANGED_DURING_READ'})
  })
  it('is disabled by default, on hosted targets and with live billing set', async () => {
    const id = await addEvent()
    delete process.env.ENABLE_STRIPE_TEST_INVOICE_PREFLIGHT
    expect(await inspect(id).response).toEqual({outcome:'DISABLED'})
    localFlags()
    process.env.MPG_STRIPE_TEST_INVOICE_PREFLIGHT_TARGET = 'HOSTED'
    expect(await inspect(id).response).toEqual({outcome:'DISABLED'})
    localFlags()
    process.env.ENABLE_LIVE_BILLING = 'true'
    expect(await inspect(id).response).toEqual({outcome:'DISABLED'})
  })
})
