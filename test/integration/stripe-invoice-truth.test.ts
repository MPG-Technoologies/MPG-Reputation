import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  resolveStripeInvoiceOrganization,
  type StripeInvoiceIdentityTruth,
} from '../../src/lib/billing/stripe-invoice-truth'

const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const hasDisposableDb = !!key && key !== 'dummy_service_role_key'
const originalLive = process.env.ENABLE_LIVE_BILLING

describe.skipIf(!hasDisposableDb)('MR-5E2B invoice identity / tenant resolution', () => {
  const supabase = createAdminClient()
  const nonce = Date.now()
  const ids = {
    invoice: 'in_synthetic' + nonce,
    subscriptionA: 'sub_syntheticA' + nonce,
    subscriptionB: 'sub_syntheticB' + nonce,
    customerA: 'cus_syntheticA' + nonce,
    customerB: 'cus_syntheticB' + nonce,
  }
  let orgA: string
  let orgB: string
  let accountA: string
  let subscriptionA: string

  function event(type = 'invoice.paid', livemode = false, id = ids.invoice) {
    return { type, livemode, data: { object: { id, object: 'invoice' } } }
  }
  function provider(overrides: Partial<StripeInvoiceIdentityTruth> = {}): StripeInvoiceIdentityTruth {
    return {
      id: ids.invoice, livemode: false,
      customer: ids.customerA, subscriptionId: ids.subscriptionA,
      ...overrides,
    }
  }
  async function resolve(
    providerTruth: StripeInvoiceIdentityTruth = provider(),
    evt = event()
  ) {
    const retrieveInvoice = vi.fn(async () => providerTruth)
    const result = await resolveStripeInvoiceOrganization({
      supabase, event: evt, retrieveInvoice,
    })
    return { result, retrieveInvoice }
  }

  beforeAll(async () => {
    delete process.env.ENABLE_LIVE_BILLING
    const { data: a, error: ae } = await supabase.from('organizations')
      .insert({name: 'MR5E2B Invoice A ' + nonce, slug: 'mr5e2b-a-' + nonce})
      .select('id').single()
    if (ae || !a) throw new Error('MR5E2B_ORG_A_SETUP_FAILED')
    orgA = a.id
    const { data: b, error: be } = await supabase.from('organizations')
      .insert({name: 'MR5E2B Invoice B ' + nonce, slug: 'mr5e2b-b-' + nonce})
      .select('id').single()
    if (be || !b) throw new Error('MR5E2B_ORG_B_SETUP_FAILED')
    orgB = b.id

    const { data: ba, error: bae } = await supabase.from('organization_billing_accounts')
      .insert({organization_id: orgA, provider: 'stripe', environment: 'TEST',
        provider_customer_id: ids.customerA})
      .select('id').single()
    if (bae || !ba) throw new Error('MR5E2B_ACCOUNT_A_SETUP_FAILED')
    accountA = ba.id
    const { data: bb, error: bbe } = await supabase.from('organization_billing_accounts')
      .insert({organization_id: orgB, provider: 'stripe', environment: 'TEST',
        provider_customer_id: ids.customerB})
      .select('id').single()
    if (bbe || !bb) throw new Error('MR5E2B_ACCOUNT_B_SETUP_FAILED')

    const { data: sa, error: sae } = await supabase.from('organization_subscriptions')
      .insert({organization_id: orgA, billing_account_id: accountA,
        provider: 'stripe', environment: 'TEST', provider_subscription_id: ids.subscriptionA,
        provider_status: 'active', normalized_status: 'ACTIVE'})
      .select('id').single()
    if (sae || !sa) throw new Error('MR5E2B_SUBSCRIPTION_A_SETUP_FAILED')
    subscriptionA = sa.id
    const { error: sbe } = await supabase.from('organization_subscriptions')
      .insert({organization_id: orgB, billing_account_id: bb.id,
        provider: 'stripe', environment: 'TEST', provider_subscription_id: ids.subscriptionB,
        provider_status: 'active', normalized_status: 'ACTIVE'})
    if (sbe) throw new Error('MR5E2B_SUBSCRIPTION_B_SETUP_FAILED')
  })
  afterAll(async () => {
    if (orgA || orgB) {
      await supabase.from('organizations').delete().in('id', [orgA, orgB].filter(Boolean))
    }
    if (originalLive === undefined) delete process.env.ENABLE_LIVE_BILLING
    else process.env.ENABLE_LIVE_BILLING = originalLive
  })

  it('resolves the exact provider Invoice through Customer and Subscription linkage', async () => {
    const { result, retrieveInvoice } = await resolve()
    expect(retrieveInvoice).toHaveBeenCalledTimes(1)
    expect(retrieveInvoice).toHaveBeenCalledWith(ids.invoice)
    expect(result).toEqual({
      outcome: 'RESOLVED_IDENTITY_ONLY', environment: 'TEST',
      organizationId: orgA, billingAccountId: accountA,
      subscriptionRecordId: subscriptionA,
    })
  })
  it('does not retrieve an unsupported event', async () => {
    const retrieveInvoice = vi.fn(async () => provider())
    const result = await resolveStripeInvoiceOrganization({
      supabase, event: event('customer.subscription.updated'), retrieveInvoice,
    })
    expect(result).toEqual({outcome: 'UNSUPPORTED_EVENT'})
    expect(retrieveInvoice).not.toHaveBeenCalled()
  })
  it('fails closed on malformed event invoice identity', async () => {
    await expect(resolve(provider(), event('invoice.paid', false, 'not_invoice')))
      .rejects.toThrow('BILLING_INVOICE_EVENT_ID_INVALID')
  })
  it('rejects mismatched or LIVE provider invoices', async () => {
    for (const mismatch of [{id: 'in_wrong'}, {livemode: true}]) {
      await expect(resolve(provider(mismatch))).rejects
        .toThrow('BILLING_INVOICE_PROVIDER_IDENTITY_MISMATCH')
    }
  })
  it('does not resolve a foreign Customer even when subscription ID matches', async () => {
    const {result} = await resolve(provider({ customer: ids.customerB }))
    expect(result).toEqual({outcome: 'UNRESOLVED_SUBSCRIPTION'})
  })
  it('rejects a foreign Subscription even when customer is correct', async () => {
    const {result} = await resolve(provider({ subscriptionId: ids.subscriptionB }))
    expect(result).toEqual({outcome: 'UNRESOLVED_SUBSCRIPTION'})
  })
  it('rejects unlinked and malformed customer/subscription IDs', async () => {
    expect((await resolve(provider({customer: 'cus_unmapped'}))).result)
      .toEqual({outcome: 'UNRESOLVED_CUSTOMER'})
    expect((await resolve(provider({customer: null}))).result)
      .toEqual({outcome: 'UNRESOLVED_CUSTOMER'})
    expect((await resolve(provider({subscriptionId: null}))).result)
      .toEqual({outcome: 'UNRESOLVED_SUBSCRIPTION'})
  })
  it('blocks LIVE invoice events while live billing disabled', async () => {
    await expect(resolve(provider(), event('invoice.paid', true)))
      .rejects.toThrow('Live Stripe billing is disabled.')
  })
  it('treats failed provider retrieval as unavailable, never as absence', async () => {
    await expect(resolveStripeInvoiceOrganization({
      supabase, event: event(),
      retrieveInvoice: async () => { throw new Error('network disconnected') },
    })).rejects.toThrow('BILLING_INVOICE_PROVIDER_UNAVAILABLE')
  })
  it('refuses to resolve identity for an inactive organization', async () => {
    const { error: deactivateError } = await supabase.from('organizations')
      .update({status: 'INACTIVE'}).eq('id', orgA)
    expect(deactivateError).toBeNull()
    try {
      expect((await resolve()).result).toEqual({outcome:'INACTIVE_ORGANIZATION'})
    } finally {
      const { error: restoreError } = await supabase.from('organizations')
        .update({status: 'ACTIVE'}).eq('id', orgA)
      expect(restoreError).toBeNull()
    }
  })
  it('never alters the existing subscription projection', async () => {
    await resolve()
    const { data } = await supabase.from('organization_subscriptions')
      .select('provider_status, normalized_status')
      .eq('id', subscriptionA).single()
    expect(data).toMatchObject({provider_status: 'active', normalized_status: 'ACTIVE'})
  })
})
