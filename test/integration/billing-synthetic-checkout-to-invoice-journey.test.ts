import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../src/types/database'
import { POST as ingestStripeWebhook } from '../../src/app/api/webhooks/stripe/route'
import { compareSyntheticFrozenInvoiceCandidates } from '../../src/domain/billing/synthetic-frozen-invoice-consistency'
import { inspectSyntheticInvoiceEvidenceChain } from '../../src/domain/billing/synthetic-invoice-evidence-chain'

/**
 * MR-5 integrated, DISPOSABLE-DB-ONLY acceptance: checkout reservation ->
 * historical synthetic quote -> signed local invoice webhook -> fenced claim ->
 * immutable UNVERIFIED evidence -> manual failure, never paid access.
 *
 * No connected Stripe account, actual API request, settlement, financial
 * finalizer or entitlement mutation. The Stripe SDK signs a local fake event
 * only; this exercise cannot approve billing or a mainline merge.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const enabled = !!serviceKey && !!anonKey && serviceKey !== 'dummy_service_role_key'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const run = randomUUID().replaceAll('-', '')
const testPrice = 'price_Mr5Journey' + run
const customerA = 'cus_Mr5JourneyA' + run
const customerB = 'cus_Mr5JourneyB' + run
const subscriptionA = 'sub_Mr5JourneyA' + run
const subscriptionB = 'sub_Mr5JourneyB' + run
const invoiceId = 'in_Mr5Journey' + run
const eventPrefix = 'evt_Mr5Journey' + run
const syntheticEventCreatedAt = Math.floor(Date.now() / 1000)

const oldSecrets = {
  stripeKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  live: process.env.ENABLE_LIVE_BILLING,
}

function json(value: Json | null): Record<string, Json | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SYNTHETIC_JOURNEY_RPC_RESULT_INVALID')
  }
  return value
}

describe.skipIf(!enabled)('MR-5 signed TEST checkout-to-invoice journey without paid entitlement', () => {
  const db = createClient<Database>(url, serviceKey, opts)
  const anonymous = createClient<Database>(url, anonKey, opts)
  // Synthetic review SQL intentionally has no payment-authorizing API.
  const reviewDb = createClient(url, serviceKey, opts)
  const reviewAnon = createClient(url, anonKey, opts)
  const organizations: string[] = []
  let ownerId = ''
  let orgA = ''
  let orgB = ''
  let accountA = ''
  let accountB = ''
  let subscriptionRecordA = ''
  let subscriptionRecordB = ''
  let checkoutReservationId = ''

  async function org(label: string): Promise<string> {
    const { data, error } = await db.from('organizations').insert({
      name: 'MR5 synthetic journey ' + label,
      slug: 'mr5-synthetic-journey-' + label.toLowerCase() + '-' + run,
    }).select('id').single()
    if (error || !data) throw new Error('JOURNEY_ORGANIZATION_SETUP_FAILED')
    organizations.push(data.id)
    return data.id
  }

  async function account(organizationId: string, customerId: string): Promise<string> {
    const { data, error } = await db.from('organization_billing_accounts').insert({
      organization_id: organizationId,
      provider: 'stripe',
      environment: 'TEST',
      provider_customer_id: customerId,
    }).select('id').single()
    if (error || !data) throw new Error('JOURNEY_ACCOUNT_SETUP_FAILED')
    return data.id
  }

  async function subscription(
    organizationId: string, billingAccountId: string,
    providerCustomerSubscriptionId: string,
  ): Promise<string> {
    const { data, error } = await db.from('organization_subscriptions').insert({
      organization_id: organizationId,
      billing_account_id: billingAccountId,
      provider: 'stripe',
      environment: 'TEST',
      provider_subscription_id: providerCustomerSubscriptionId,
      provider_price_id: testPrice,
      provider_status: 'active',
      normalized_status: 'ACTIVE',
      current_period_end: '2026-12-20T00:00:00Z',
    }).select('id').single()
    if (error || !data) throw new Error('JOURNEY_SUBSCRIPTION_SETUP_FAILED')
    return data.id
  }

  async function trial(organizationId: string) {
    const { data, error } = await db.from('organization_entitlements')
      .select('allocated_requests,consumed_requests,status,started_at,expires_at')
      .eq('organization_id', organizationId).single()
    if (error || !data) throw new Error('JOURNEY_TRIAL_READ_FAILED')
    return data
  }

  async function storedEvent(providerEventId: string) {
    const { data, error } = await db.from('billing_webhook_events')
      .select('id,provider_event_id,provider_invoice_id,payload_hash,processing_status,organization_id,processed_at')
      .eq('provider', 'stripe').eq('environment', 'TEST')
      .eq('provider_event_id', providerEventId).single()
    if (error || !data) throw new Error('JOURNEY_EVENT_NOT_STORED')
    return data
  }

  function signedEvent(providerEventId: string): Request {
    const body = JSON.stringify({
      id: providerEventId,
      object: 'event',
      created: syntheticEventCreatedAt,
      livemode: false,
      type: 'invoice.paid',
      data: { object: {
        id: invoiceId,
        object: 'invoice',
        amount_paid: 150000,
        customer: customerA,
      } },
    })
    const secret = process.env.STRIPE_WEBHOOK_SECRET!
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: body, secret,
    })
    return new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body,
    })
  }

  beforeAll(async () => {
    if (!['http://127.0.0.1:54331', 'http://localhost:54331'].includes(url) ||
        process.env.ENABLE_LIVE_BILLING === 'true' ||
        process.env.VERCEL_ENV !== undefined) {
      throw new Error('BILLING_JOURNEY_DISPOSABLE_DATABASE_ONLY')
    }
    // Local cryptographic signature fixture, never a usable provider credential.
    process.env.STRIPE_SECRET_KEY = ['sk', 'test', 'Mr5LocalSignatureOnly'].join('_')
    process.env.STRIPE_WEBHOOK_SECRET = ['whsec', 'Mr5LocalSignatureOnly'].join('_')
    process.env.ENABLE_LIVE_BILLING = 'false'

    const created = await db.auth.admin.createUser({
      email: 'mr5journey-' + run + '@example.test',
      password: 'SyntheticTest-' + run,
      email_confirm: true,
    })
    if (created.error || !created.data.user) throw new Error('JOURNEY_USER_SETUP_FAILED')
    ownerId = created.data.user.id
    orgA = await org('A')
    orgB = await org('B')
    const { error: memberError } = await db.from('organization_users').insert({
      organization_id: orgA, user_id: ownerId, role: 'OWNER',
    })
    if (memberError) throw new Error('JOURNEY_MEMBERSHIP_FAILED')
    accountA = await account(orgA, customerA)
    accountB = await account(orgB, customerB)
    subscriptionRecordB = await subscription(orgB, accountB, subscriptionB)
    for (const organizationId of [orgA, orgB]) {
      const provision = await db.rpc('provision_organization_trial', { p_org_id: organizationId })
      if (provision.error) throw new Error('JOURNEY_TRIAL_PROVISION_FAILED')
    }
  }, 30000)

  afterAll(async () => {
    for (const organizationId of organizations) {
      const { error } = await db.from('organizations').delete().eq('id', organizationId)
      if (error) throw new Error('JOURNEY_ORGANIZATION_TEARDOWN_FAILED')
    }
    const { error: eventsError } = await db.from('billing_webhook_events')
      .delete().like('provider_event_id', eventPrefix + '%')
    if (eventsError) throw new Error('JOURNEY_EVENT_TEARDOWN_FAILED')
    if (ownerId) {
      const { error } = await db.auth.admin.deleteUser(ownerId)
      if (error) throw new Error('JOURNEY_USER_TEARDOWN_FAILED')
    }
    if (oldSecrets.stripeKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = oldSecrets.stripeKey
    if (oldSecrets.webhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = oldSecrets.webhookSecret
    if (oldSecrets.live === undefined) delete process.env.ENABLE_LIVE_BILLING
    else process.env.ENABLE_LIVE_BILLING = oldSecrets.live
  }, 30000)

  it('preserves two tenants and the 30 Free Review Requests trial through a synthetic invoice journey', async () => {
    const initialA = await trial(orgA)
    const initialB = await trial(orgB)
    expect(initialA).toMatchObject({
      allocated_requests: 30, consumed_requests: 0, status: 'NOT_STARTED',
    })
    expect(initialB).toMatchObject({
      allocated_requests: 30, consumed_requests: 0, status: 'NOT_STARTED',
    })

    // Business owner admitted by server-side SQL membership and account binding.
    const { data: reserved, error: reserveError } = await db.rpc(
      'reserve_stripe_test_checkout', {
        p_user_id: ownerId,
        p_organization_id: orgA,
        p_billing_account_id: accountA,
        p_provider_customer_id: customerA,
        p_provider_price_id: testPrice,
        p_plan_id: 'monthly',
        p_return_origin: 'http://localhost:3000',
      },
    )
    expect(reserveError).toBeNull()
    const reservation = json(reserved)
    expect(reservation.outcome).toBe('RESERVED')
    if (typeof reservation.reservation_id !== 'string' ||
        typeof reservation.lease_token !== 'string' ||
        typeof reservation.session_expires_at !== 'string') {
      throw new Error('JOURNEY_INVALID_RESERVATION')
    }
    checkoutReservationId = reservation.reservation_id

    const { data: quote, error: quoteError } = await db
      .from('billing_synthetic_checkout_quote_snapshots')
      .insert({
        organization_id: orgA,
        billing_account_id: accountA,
        checkout_reservation_id: checkoutReservationId,
        plan_id: 'monthly',
        provider_price_id: testPrice,
        candidate_amount_minor: 150000,
        candidate_interval: 'month',
      }).select('approval_status,verification_status,payment_authorized,access_authorized')
      .single()
    expect(quoteError).toBeNull()
    expect(quote).toMatchObject({
      approval_status: 'PROPOSED', verification_status: 'UNVERIFIED',
      payment_authorized: false, access_authorized: false,
    })

    const { data: finalized, error: finalizeError } = await db.rpc(
      'finalize_stripe_test_checkout', {
        p_user_id: ownerId,
        p_reservation_id: checkoutReservationId,
        p_lease_token: reservation.lease_token,
        p_session_id: 'cs_test_Mr5SyntheticJourney' + run,
        p_session_url: 'https://checkout.stripe.com/c/pay/cs_test_Synthetic',
        p_session_expires_at: reservation.session_expires_at,
      },
    )
    expect(finalizeError).toBeNull()
    expect(json(finalized).outcome).toBe('FINALIZED')
    // Neither a valid checkout URL nor an ACTIVE provider projection proves a payment.
    subscriptionRecordA = await subscription(orgA, accountA, subscriptionA)

    const firstId = eventPrefix + 'first'
    const response = await ingestStripeWebhook(signedEvent(firstId))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ received: true, claimed: true })

    // Delivery of identical signed bytes is idempotent.
    // The event already exists, and a second delivery never finalizes it.
    // A fresh signature envelope would change the canonical wire body only
    // if Stripe had actually signed different event contents.
    const replay = await ingestStripeWebhook(signedEvent(firstId))
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ received: true, duplicate: true, final: false })

    const original = await storedEvent(firstId)
    expect(original).toMatchObject({
      provider_invoice_id: invoiceId, processing_status: 'RECEIVED',
      processed_at: null, organization_id: null,
    })

    const { data: leaseRaw, error: leaseError } = await db.rpc(
      'claim_stripe_test_invoice_processing', { p_provider_event_id: firstId },
    )
    expect(leaseError).toBeNull()
    const lease = json(leaseRaw)
    expect(lease.outcome).toBe('CLAIMED')
    if (typeof lease.lease_token !== 'string') throw new Error('JOURNEY_MISSING_LEASE')

    const evidenceDraft = {
      organization_id: orgA,
      billing_account_id: accountA,
      subscription_record_id: subscriptionRecordA,
      webhook_event_record_id: original.id,
      provider_event_id: firstId,
      provider_invoice_id: invoiceId,
      source_payload_hash: original.payload_hash,
      candidate_price_id: testPrice,
      candidate_amount_minor: 150000,
      candidate_interval: 'month' as const,
      candidate_period_start: '2026-11-20T00:00:00Z',
      candidate_period_end: '2026-12-20T00:00:00Z',
    }

    const { data: draft, error: draftError } = await db
      .from('billing_synthetic_invoice_evidence_drafts')
      .insert(evidenceDraft)
      .select('verification_status,financial_finality,access_authorized').single()
    expect(draftError).toBeNull()
    expect(draft).toEqual({
      verification_status: 'UNVERIFIED', financial_finality: false,
      access_authorized: false,
    })

    // Read the ACTUALLY persisted proposed historic quote and invoice draft.
    // Their matching attributes are not provider invoice-to-checkout provenance.
    const [savedQuote, savedInvoice] = await Promise.all([
      db.from('billing_synthetic_checkout_quote_snapshots')
        .select('id,checkout_reservation_id,plan_id,organization_id,billing_account_id,provider,environment,provider_price_id,candidate_currency,candidate_amount_minor,candidate_interval,source_kind,approval_status,verification_status,payment_authorized,access_authorized')
        .eq('checkout_reservation_id', checkoutReservationId).single(),
      db.from('billing_synthetic_invoice_evidence_drafts')
        .select('id,subscription_record_id,webhook_event_record_id,provider_event_id,source_payload_hash,organization_id,billing_account_id,provider,environment,provider_invoice_id,candidate_price_id,candidate_currency,candidate_amount_minor,candidate_interval,source_kind,verification_status,financial_finality,access_authorized')
        .eq('provider_invoice_id', invoiceId).single(),
    ])
    if (savedQuote.error || !savedQuote.data || savedInvoice.error || !savedInvoice.data) {
      throw new Error('SYNTHETIC_FINANCIAL_SNAPSHOT_READ_FAILED')
    }
    expect(compareSyntheticFrozenInvoiceCandidates({
      quote: savedQuote.data, invoice: savedInvoice.data,
    })).toEqual({
      outcome: 'CONSISTENT_SYNTHETIC_ONLY',
      financialFinality: false, accessAuthorized: false,
    })
    expect(compareSyntheticFrozenInvoiceCandidates({
      quote: savedQuote.data,
      invoice: { ...savedInvoice.data, candidate_amount_minor: 100000 },
    })).toEqual({ outcome: 'BLOCKED', reason: 'FROZEN_TERMS_MISMATCH' })
    expect(compareSyntheticFrozenInvoiceCandidates({
      quote: savedQuote.data,
      invoice: { ...savedInvoice.data, organization_id: orgB },
    })).toEqual({ outcome: 'BLOCKED', reason: 'CROSS_TENANT_OR_ACCOUNT' })

    // Six REAL disposable PostgreSQL source records, exact-ID correlated.
    // This is a security review diagnostic, not Stripe-authenticated checkout
    // linkage, settled money, a successful invoice or a paid subscription.
    const [storedReservation, storedAccount, storedSubscription, storedReceipt] =
      await Promise.all([
        db.from('stripe_test_checkout_reservations')
          .select('id,organization_id,billing_account_id,provider,environment,provider_customer_id,provider_price_id,plan_id,status,stripe_session_id')
          .eq('id', checkoutReservationId).single(),
        db.from('organization_billing_accounts')
          .select('id,organization_id,provider,environment,provider_customer_id')
          .eq('id',accountA).single(),
        db.from('organization_subscriptions')
          .select('id,organization_id,billing_account_id,provider,environment,provider_price_id,provider_subscription_id,normalized_status')
          .eq('id',subscriptionRecordA).single(),
        db.from('billing_webhook_events')
          .select('id,provider,environment,provider_event_id,event_type,provider_invoice_id,payload_hash,processing_status,organization_id,processed_at')
          .eq('id',original.id).single(),
      ])
    if (storedReservation.error || !storedReservation.data ||
        storedAccount.error || !storedAccount.data ||
        storedSubscription.error || !storedSubscription.data ||
        storedReceipt.error || !storedReceipt.data) {
      throw new Error('SYNTHETIC_CHAIN_PRIVATE_SOURCE_READ_FAILED')
    }
    const chain = {
      quote:savedQuote.data,invoice:savedInvoice.data,
      reservation:storedReservation.data,account:storedAccount.data,
      subscription:storedSubscription.data,receipt:storedReceipt.data,
    }
    expect(inspectSyntheticInvoiceEvidenceChain(chain)).toEqual({
      outcome:'SYNTHETIC_CHAIN_ONLY',
      unresolved:'INVOICE_TO_CHECKOUT_PROVIDER_PROVENANCE_NOT_ESTABLISHED',
      paymentAuthorized:false,financialFinality:false,accessAuthorized:false,
    })
    expect(inspectSyntheticInvoiceEvidenceChain({
      ...chain,receipt:{...chain.receipt,payload_hash:'b'.repeat(64)},
    })).toEqual({outcome:'REVIEW_REQUIRED',reason:'RECEIPT_MISMATCH'})
    expect(inspectSyntheticInvoiceEvidenceChain({
      ...chain,subscription:{...chain.subscription,billing_account_id:accountB},
    })).toEqual({outcome:'REVIEW_REQUIRED',reason:'SUBSCRIPTION_MISMATCH'})
    expect(inspectSyntheticInvoiceEvidenceChain({
      ...chain,reservation:{...chain.reservation,status:'PREPARING'},
    })).toEqual({outcome:'REVIEW_REQUIRED',reason:'CHECKOUT_NOT_READY'})

    // Atomic synthetic review ONLY: this is not provider-backed settlement.
    const reviewArgs = {
      p_quote_id: savedQuote.data.id,
      p_draft_id: savedInvoice.data.id,
    }
    // A rejected source must roll back entirely.
    const wrong = await reviewDb.rpc('record_mr5_synthetic_invoice_review',{
      ...reviewArgs, p_quote_id: randomUUID(),
    })
    expect(wrong.error?.code).toBe('23514')
    const {count:before} = await reviewDb
      .from('billing_synthetic_invoice_reconciliation_reviews')
      .select('id',{count:'exact',head:true}).eq('provider_invoice_id',invoiceId)
    expect(before).toBe(0)

    // Direct privileged INSERT must not bypass exact signed invoice identity.
    // The trigger must reject a fabricated invoice ID before a review exists.
    const forged = await reviewDb
      .from('billing_synthetic_invoice_reconciliation_reviews')
      .insert({
        organization_id: orgA,
        billing_account_id: accountA,
        checkout_quote_snapshot_id: savedQuote.data.id,
        invoice_evidence_draft_id: savedInvoice.data.id,
        provider_invoice_id: 'in_Forged' + run,
      })
    expect(forged.error?.code).toBe('23514')
    const { count: forgedCount, error: forgedCountError } = await reviewDb
      .from('billing_synthetic_invoice_reconciliation_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('provider_invoice_id', 'in_Forged' + run)
    expect(forgedCountError).toBeNull()
    expect(forgedCount).toBe(0)

    // A privileged caller cannot claim this tenant's signed invoice under
    // another organization's billing account, even by direct table INSERT.
    const crossTenantReview = await reviewDb
      .from('billing_synthetic_invoice_reconciliation_reviews')
      .insert({
        organization_id: orgB,
        billing_account_id: accountB,
        checkout_quote_snapshot_id: savedQuote.data.id,
        invoice_evidence_draft_id: savedInvoice.data.id,
        provider_invoice_id: invoiceId,
      })
    expect(crossTenantReview.error?.code).toBe('23514')
    const { count: crossTenantCount, error: crossTenantCountError } = await reviewDb
      .from('billing_synthetic_invoice_reconciliation_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('provider_invoice_id', invoiceId)
    expect(crossTenantCountError).toBeNull()
    expect(crossTenantCount).toBe(0)

    const [firstReview,secondReview] = await Promise.all([
      reviewDb.rpc('record_mr5_synthetic_invoice_review',reviewArgs),
      reviewDb.rpc('record_mr5_synthetic_invoice_review',reviewArgs),
    ])
    expect(firstReview.error).toBeNull()
    expect(secondReview.error).toBeNull()
    expect([firstReview.data?.outcome,secondReview.data?.outcome].sort())
      .toEqual(['ALREADY_RECORDED','REQUIRES_PROVIDER_ATTESTATION'])
    for (const result of [firstReview.data,secondReview.data]) {
      expect(result).toMatchObject({financial_finality:false,access_authorized:false})
    }
    const {data:rows,count,error:rowsError} =
      await reviewDb.from('billing_synthetic_invoice_reconciliation_reviews')
        .select('organization_id,billing_account_id,review_status,financial_finality,access_authorized',
          {count:'exact'}).eq('provider_invoice_id',invoiceId)
    expect(rowsError).toBeNull()
    expect(count).toBe(1)
    expect(rows).toMatchObject([{
      organization_id:orgA,billing_account_id:accountA,
      review_status:'REQUIRES_PROVIDER_ATTESTATION',
      financial_finality:false,access_authorized:false,
    }])
    expect((await reviewDb.from('billing_synthetic_invoice_reconciliation_reviews')
      .update({financial_finality:true}).eq('provider_invoice_id',invoiceId))
      .error?.code).toBe('42501')
    expect((await reviewDb.from('billing_synthetic_invoice_reconciliation_reviews')
      .delete().eq('provider_invoice_id',invoiceId)).error?.code).toBe('42501')
    expect(['42501','PGRST202']).toContain(
      (await reviewAnon.rpc('record_mr5_synthetic_invoice_review',reviewArgs))
        .error?.code)
    expect((await reviewAnon.from('billing_synthetic_invoice_reconciliation_reviews')
      .select('id')).error?.code).toBe('42501')

    // A replay of the exact source tuple stays idempotent after admission.
    const repeatReview = await reviewDb.rpc('record_mr5_synthetic_invoice_review', reviewArgs)
    expect(repeatReview.error).toBeNull()
    expect(repeatReview.data).toMatchObject({
      outcome: 'ALREADY_RECORDED',
      financial_finality: false,
      access_authorized: false,
    })
    const { count: replayCount, error: replayCountError } = await reviewDb
      .from('billing_synthetic_invoice_reconciliation_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('provider_invoice_id', invoiceId)
    expect(replayCountError).toBeNull()
    expect(replayCount).toBe(1)

    // A foreign organization's account/subscription cannot be substituted.
    const foreign = await db.from('billing_synthetic_invoice_evidence_drafts')
      .insert({
        ...evidenceDraft,
        webhook_event_record_id: original.id,
        billing_account_id: accountB,
        subscription_record_id: subscriptionRecordB,
      })
    expect(foreign.error).not.toBeNull()

    // A second signed event ID referencing the SAME invoice cannot create a
    // second staged invoice ledger entry, even before financial authority exists.
    const secondId = eventPrefix + 'second'
    expect((await ingestStripeWebhook(signedEvent(secondId))).status).toBe(200)
    const next = await storedEvent(secondId)
    const duplicate = await db.from('billing_synthetic_invoice_evidence_drafts')
      .insert({
        ...evidenceDraft,
        webhook_event_record_id: next.id,
        provider_event_id: secondId,
        source_payload_hash: next.payload_hash,
      })
    expect(duplicate.error?.code).toBe('23505')

    // Real payment settlement is NOT implemented: only a fenced failure may
    // close this synthetic invoice claim, requiring manual financial review.
    const { data: failed, error: failureError } = await db.rpc(
      'fail_stripe_test_invoice_processing', {
        p_provider_event_id: firstId,
        p_lease_token: lease.lease_token,
        p_error_code: 'EVIDENCE_CONFLICT',
      },
    )
    expect(failureError).toBeNull()
    expect(json(failed).outcome).toBe('FAILED_REQUIRES_REVIEW')
    const after = await storedEvent(firstId)
    expect(after).toMatchObject({
      processing_status: 'FAILED', processed_at: null, organization_id: null,
    })

    // The signed receipt has now FAILED. Re-reading an existing immutable
    // review must stay idempotent without re-admitting failed source evidence.
    const afterFailureReplay = await reviewDb.rpc(
      'record_mr5_synthetic_invoice_review', reviewArgs,
    )
    expect(afterFailureReplay.error).toBeNull()
    expect(afterFailureReplay.data).toMatchObject({
      outcome: 'ALREADY_RECORDED', financial_finality: false,
      access_authorized: false,
    })

    // A different quote cannot replace the recorded invoice association.
    const conflictingReplay = await reviewDb.rpc(
      'record_mr5_synthetic_invoice_review', {
        ...reviewArgs, p_quote_id: randomUUID(),
      },
    )
    expect(conflictingReplay.error).toBeNull()
    expect(conflictingReplay.data).toMatchObject({ outcome: 'REPLAY_CONFLICT' })

    // Direct inserts must still pass the original source-state trigger.
    const inadmissibleInsert = await reviewDb
      .from('billing_synthetic_invoice_reconciliation_reviews')
      .insert({
        organization_id: orgA,
        billing_account_id: accountA,
        checkout_quote_snapshot_id: savedQuote.data.id,
        invoice_evidence_draft_id: savedInvoice.data.id,
        provider_invoice_id: invoiceId,
      })
    expect(inadmissibleInsert.error?.code).toBe('23514')
    const { data: stableRows, count: stableCount, error: stableError } =
      await reviewDb.from('billing_synthetic_invoice_reconciliation_reviews')
        .select('review_status,financial_finality,access_authorized', { count: 'exact' })
        .eq('provider_invoice_id', invoiceId)
    expect(stableError).toBeNull()
    expect(stableCount).toBe(1)
    expect(stableRows).toMatchObject([{
      review_status: 'REQUIRES_PROVIDER_ATTESTATION',
      financial_finality: false, access_authorized: false,
    }])

    // No tenant OWNER or anonymous session can read synthetic financial tables.
    const privateRead = await anonymous.from('billing_synthetic_invoice_evidence_drafts')
      .select('id')
    expect(privateRead.error?.code).toBe('42501')

    // Unverified billing evidence and a provider-projected ACTIVE subscription
    // cannot consume, activate, refresh or extend either organization's trial.
    expect(await trial(orgA)).toEqual(initialA)
    expect(await trial(orgB)).toEqual(initialB)
  }, 30000)
})
