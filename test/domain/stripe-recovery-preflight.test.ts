import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))

import {
  prepareRecoveredStripeSubscription,
  type RetrievedStripeRecoveryEvent,
} from '../../src/lib/billing/stripe-recovery-preflight'
import {
  createStripeTestRecoveryTransport,
} from '../../src/lib/billing/stripe-test-recovery-transport'
import type {
  StripeSubscriptionProjectionTruth,
} from '../../src/lib/billing/stripe-subscription-candidate'

const recordId = '11111111-1111-4111-8111-111111111111'
const leaseToken = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const accountId = '44444444-4444-4444-8444-444444444444'
const now = new Date('2026-10-18T08:00:00.000Z')
const originalKey = process.env.STRIPE_SECRET_KEY

interface TestRow {
  provider: 'stripe'
  environment: 'TEST' | 'LIVE'
  provider_event_id: string
  event_type: string
  processing_status: 'RECEIVED' | 'PROCESSING' | 'FAILED' | 'PROCESSED'
  processing_lease_token: string | null
  processing_lease_expires_at: string | null
}

function row(changes: Partial<TestRow> = {}): TestRow {
  return {
    provider: 'stripe',
    environment: 'TEST',
    provider_event_id: 'evt_SyntheticOne',
    event_type: 'customer.subscription.updated',
    processing_status: 'PROCESSING',
    processing_lease_token: leaseToken,
    processing_lease_expires_at: '2026-10-18T08:03:00.000Z',
    ...changes,
  }
}

function event(changes: Partial<RetrievedStripeRecoveryEvent> = {}): RetrievedStripeRecoveryEvent {
  return {
    id: 'evt_SyntheticOne',
    object: 'event',
    type: 'customer.subscription.updated',
    livemode: false,
    data: {
      object: {
        object: 'subscription',
        id: 'sub_SyntheticOne',
        customer: 'cus_metadata_spoofed',
        metadata: { organization_id: 'spoofed' },
      },
    },
    ...changes,
  }
}

function subscription(changes: Partial<StripeSubscriptionProjectionTruth> = {}): StripeSubscriptionProjectionTruth {
  return {
    id: 'sub_SyntheticOne',
    customer: 'cus_Trusted',
    livemode: false,
    status: 'active',
    cancel_at_period_end: false,
    canceled_at: null,
    items: {
      has_more: false,
      data: [{
        price: { id: 'price_One' },
        current_period_start: 1792300000,
        current_period_end: 1794892000,
      }],
    },
    ...changes,
  }
}

function mockDb(args?: {
  stored?: TestRow | null
  nextStored?: TestRow | null
  account?: { id: string; organization_id: string } | null
  lookupError?: boolean
  correlationError?: boolean
}) {
  let eventReads = 0
  const defaultRow = row()
  const queries: string[] = []
  const supabase = {
    from(table: string) {
      queries.push(table)
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          if (table === 'billing_webhook_events') {
            eventReads += 1
            return {
              data: eventReads === 1
                ? args?.stored === undefined ? defaultRow : args.stored
                : args?.nextStored === undefined ? (args?.stored ?? defaultRow) : args.nextStored,
              error: args?.lookupError ? { message: 'Sensitive SQL error' } : null,
            }
          }
          if (table === 'organization_billing_accounts') {
            return {
              data: args?.account === undefined
                ? { id: accountId, organization_id: organizationId }
                : args.account,
              error: args?.correlationError ? { message: 'Sensitive lookup' } : null,
            }
          }
          throw new Error('Unexpected data access')
        },
      }
    },
  } as unknown as SupabaseClient<Database>
  return { supabase, queries, get eventReads() { return eventReads } }
}

function scenario(args?: {
  stored?: TestRow | null
  nextStored?: TestRow | null
  account?: { id: string; organization_id: string } | null
  event?: RetrievedStripeRecoveryEvent
  subscription?: StripeSubscriptionProjectionTruth
  eventError?: boolean
  subscriptionError?: boolean
  lookupError?: boolean
  correlationError?: boolean
  inputLeaseToken?: string
  inputRecordId?: string
}) {
  const db = mockDb(args)
  const retrieveEvent = vi.fn(async () => {
    if (args?.eventError) throw new Error('Private provider error with raw details')
    return args?.event ?? event()
  })
  const retrieveSubscription = vi.fn(async () => {
    if (args?.subscriptionError) throw new Error('Private provider error with card details')
    return args?.subscription ?? subscription()
  })
  return {
    db,
    retrieveEvent,
    retrieveSubscription,
    run: () => prepareRecoveredStripeSubscription({
      supabase: db.supabase,
      eventRecordId: args?.inputRecordId ?? recordId,
      leaseToken: args?.inputLeaseToken ?? leaseToken,
      retrieveEvent,
      retrieveSubscription,
      now: () => now,
    }),
  }
}

describe('MR-5C3B1 Stripe recovery preflight (synthetic read-only provider)', () => {
  afterEach(() => {
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = originalKey
    vi.restoreAllMocks()
  })

  it('reads the durable event, retrieves exactly one event and current subscription, and correlates the trusted account', async () => {
    const s = scenario()
    const result = await s.run()
    expect(s.retrieveEvent).toHaveBeenCalledOnce()
    expect(s.retrieveEvent).toHaveBeenCalledWith('evt_SyntheticOne')
    expect(s.retrieveSubscription).toHaveBeenCalledOnce()
    expect(s.retrieveSubscription).toHaveBeenCalledWith('sub_SyntheticOne')
    expect(s.db.eventReads).toBe(2)
    expect(s.db.queries).toEqual([
      'billing_webhook_events',
      'organization_billing_accounts',
      'billing_webhook_events',
    ])
    expect(result.outcome).toBe('READY')
    if (result.outcome === 'READY') {
      expect(result.providerCustomerId).toBe('cus_Trusted')
      expect(result.candidate).toMatchObject({
        provider: 'stripe',
        environment: 'TEST',
        organizationId,
        billingAccountId: accountId,
        providerSubscriptionId: 'sub_SyntheticOne',
        providerPriceId: 'price_One',
        normalizedStatus: 'ACTIVE',
        providerStateUpdatedAt: null,
      })
      expect(JSON.stringify(result)).not.toContain('cus_metadata_spoofed')
      expect(JSON.stringify(result)).not.toContain('spoofed')
    }
  })

  it('rejects any absent, expired, finished or incorrect lease without contacting Stripe', async () => {
    for (const changes of [
      { stored: null },
      { stored: row({ environment: 'LIVE' }) },
      { stored: row({ processing_status: 'RECEIVED' }) },
      { stored: row({ processing_status: 'PROCESSED' }) },
      { stored: row({ processing_lease_token: null }) },
      { stored: row({ processing_lease_expires_at: '2026-10-18T07:59:59Z' }) },
    ]) {
      const s = scenario(changes)
      expect(await s.run()).toEqual({ outcome: 'NOT_LEASE_HOLDER' })
      expect(s.retrieveEvent).not.toHaveBeenCalled()
      expect(s.retrieveSubscription).not.toHaveBeenCalled()
    }
    const wrong = scenario({ inputLeaseToken: '55555555-5555-4555-8555-555555555555' })
    expect(await wrong.run()).toEqual({ outcome: 'NOT_LEASE_HOLDER' })
    const malformed = scenario({ inputRecordId: 'not-an-id' })
    expect(await malformed.run()).toEqual({ outcome: 'NOT_LEASE_HOLDER' })
  })

  it('never accepts a malformed durable provider event ID', async () => {
    const s = scenario({ stored: row({ provider_event_id: 'not-an-event' }) })
    expect(await s.run()).toEqual({ outcome: 'NOT_LEASE_HOLDER' })
    expect(s.retrieveEvent).not.toHaveBeenCalled()
  })

  it('requires fetched Stripe Event identity, type and TEST environment to match the durably verified claim', async () => {
    for (const invalid of [
      event({ id: 'evt_Foreign' }),
      event({ object: 'charge' }),
      event({ type: 'customer.subscription.deleted' }),
      event({ livemode: true }),
      event({ data: { object: { id: 'sub_SyntheticOne', object: 'not-a-subscription' } } }),
    ]) {
      const s = scenario({ event: invalid })
      const out = await s.run()
      expect(out).toEqual({ outcome: 'FAILED', errorCode: 'INVALID_PROVIDER_DATA' })
      expect(s.retrieveSubscription).not.toHaveBeenCalled()
    }
  })

  it('ignores unsupported events only after verifying retrieved event identity; without a subscription call', async () => {
    const s = scenario({
      stored: row({ event_type: 'account.updated' }),
      event: event({ type: 'account.updated', data: { object: { id: 'acct_One', object: 'account' } } }),
    })
    expect(await s.run()).toEqual({ outcome: 'IGNORED' })
    expect(s.retrieveSubscription).not.toHaveBeenCalled()
    expect(s.db.eventReads).toBe(2)
  })

  it('does not trust an event data object with an invalid subscription ID', async () => {
    const s = scenario({ event: event({ data: { object: { id: 'cus_NotSub', object: 'subscription' } } }) })
    expect(await s.run()).toEqual({ outcome: 'FAILED', errorCode: 'INVALID_PROVIDER_DATA' })
    expect(s.retrieveSubscription).not.toHaveBeenCalled()
  })

  it('sanitizes provider Event retrieval or expiry errors with a bounded failure result', async () => {
    const s = scenario({ eventError: true })
    expect(await s.run()).toEqual({ outcome: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE' })
    expect(s.retrieveSubscription).not.toHaveBeenCalled()
  })

  it('sanitizes provider subscription retrieval failures', async () => {
    const s = scenario({ subscriptionError: true })
    expect(await s.run()).toEqual({ outcome: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE' })
  })

  it('rejects stale/mismatched or LIVE provider subscription truth', async () => {
    for (const value of [
      subscription({ id: 'sub_Another' }),
      subscription({ livemode: true }),
    ]) {
      const s = scenario({ subscription: value })
      expect(await s.run()).toEqual({ outcome: 'FAILED', errorCode: 'INVALID_PROVIDER_DATA' })
    }
  })

  it('flags an unrecognized Stripe Customer instead of trusting metadata or guessing tenant', async () => {
    const s = scenario({ account: null })
    expect(await s.run()).toEqual({ outcome: 'FAILED', errorCode: 'UNRESOLVED_CUSTOMER' })
  })

  it('fails closed and sanitizes errors when persisted customer correlation fails', async () => {
    const s = scenario({ correlationError: true })
    expect(await s.run()).toEqual({ outcome: 'FAILED', errorCode: 'CORRELATION_FAILED' })
  })

  it('blocks ambiguous prices, unknown status, or invalid periods before write', async () => {
    for (const value of [
      subscription({ status: 'unknown' }),
      subscription({ items: { has_more: false, data: [] } }),
      subscription({ items: { has_more: false, data: [{
        price: { id: 'price_One' }, current_period_start: 1794892000, current_period_end: 1792300000,
      }] } }),
    ]) {
      const s = scenario({ subscription: value })
      expect(await s.run()).toEqual({ outcome: 'FAILED', errorCode: 'INVALID_PROVIDER_DATA' })
    }
  })

  it('recognizes past_due as SUSPENDED with no grace or paid-access side effects', async () => {
    const s = scenario({ subscription: subscription({ status: 'past_due' }) })
    const value = await s.run()
    expect(value.outcome).toBe('READY')
    if (value.outcome === 'READY') expect(value.candidate.normalizedStatus).toBe('SUSPENDED')
  })

  it('detects a processing lease that expires or is superseded during external API reads', async () => {
    const s = scenario({
      nextStored: row({ processing_lease_token: '55555555-5555-4555-8555-555555555555' }),
    })
    expect(await s.run()).toEqual({ outcome: 'NOT_LEASE_HOLDER' })
    const expired = scenario({
      nextStored: row({ processing_lease_expires_at: '2026-10-18T07:59:59Z' }),
    })
    expect(await expired.run()).toEqual({ outcome: 'NOT_LEASE_HOLDER' })
  })

  it('throws only a sanitized database lookup error', async () => {
    const s = scenario({ lookupError: true })
    await expect(s.run()).rejects.toThrow('BILLING_RECOVERY_CLAIM_LOOKUP_FAILED')
  })

  it('refuses missing or LIVE Stripe API keys in the test-only provider adapter', () => {
    delete process.env.STRIPE_SECRET_KEY
    expect(() => createStripeTestRecoveryTransport()).toThrow(
      'BILLING_STRIPE_TEST_RECOVERY_KEY_REQUIRED'
    )
    process.env.STRIPE_SECRET_KEY = ['sk', 'live', 'SyntheticNotReal'].join('_')
    expect(() => createStripeTestRecoveryTransport()).toThrow(
      'BILLING_STRIPE_TEST_RECOVERY_KEY_REQUIRED'
    )
    process.env.STRIPE_SECRET_KEY = 'pk_test_SyntheticNotSecret'
    expect(() => createStripeTestRecoveryTransport()).toThrow(
      'BILLING_STRIPE_TEST_RECOVERY_KEY_REQUIRED'
    )
  })
})
