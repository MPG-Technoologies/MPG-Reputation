import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))

import {
  prepareStripeSubscriptionProjection,
} from '../../src/lib/billing/stripe-subscription-candidate'
import {
  persistVerifiedStripeSubscriptionCandidate,
} from '../../src/lib/billing/stripe-subscription-projection-store'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const options = { auth: { autoRefreshToken: false, persistSession: false } }
const admin = createClient<Database>(url, serviceKey, options)
const anonymous = createClient<Database>(url, anonKey, options)
const owner = createClient<Database>(url, anonKey, options)

const customerA = 'cus_Mr5c2SyntheticA'
const customerB = 'cus_Mr5c2SyntheticB'
const start = 1792300000
const end = 1794892000

let orgA = ''
let orgB = ''
let accountA = ''
let accountB = ''
let ownerId = ''

function checked<T extends { data: unknown; error: unknown }>(result: T): T['data'] {
  if (result.error) throw new Error('Synthetic MR-5C2 database setup/assertion failed', { cause: result.error })
  return result.data
}

function projection(overrides: {
  organizationId?: string
  billingAccountId?: string
  customerId?: string
  subscriptionId?: string
  providerStatus?: string
  normalizedStatus?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ENDED' | 'GRACE'
  priceId?: string
} = {}) {
  const providerSubscriptionId = overrides.subscriptionId ?? `sub_Mr5c2${randomUUID().replaceAll('-', '')}`
  const customerId = overrides.customerId ?? customerA
  const resolved = {
    outcome: 'RESOLVED' as const,
    environment: 'TEST' as const,
    providerSubscriptionId,
    providerCustomerId: customerId,
    providerStatus: overrides.providerStatus ?? 'active',
    organizationId: overrides.organizationId ?? orgA,
    billingAccountId: overrides.billingAccountId ?? accountA,
  }
  const result = prepareStripeSubscriptionProjection({
    resolved,
    subscription: {
      id: providerSubscriptionId,
      customer: customerId,
      livemode: false,
      status: overrides.providerStatus ?? 'active',
      cancel_at_period_end: false,
      canceled_at: null,
      items: { has_more: false, data: [{
        price: { id: overrides.priceId ?? 'price_Mr5c2Synthetic' },
        current_period_start: start, current_period_end: end,
      }] },
    },
  })
  if (result.outcome !== 'READY') throw new Error('Synthetic provider truth rejected')
  return {
    ...result.candidate,
    ...(overrides.normalizedStatus && { normalizedStatus: overrides.normalizedStatus }),
  }
}

function save(candidate: ReturnType<typeof projection>, providerCustomerId = customerA) {
  return persistVerifiedStripeSubscriptionCandidate({ supabase: admin, candidate, providerCustomerId })
}

describe('MR-5C2 atomic subscription projection (disposable PostgreSQL only)', () => {
  beforeAll(async () => {
    // Refuse hosted test/production databases and real provider credentials.
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(serviceKey).toBeTruthy()
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')

    const orgName = `mr5c2-a-${randomUUID()}`
    const secondName = `mr5c2-b-${randomUUID()}`
    orgA = checked(await admin.from('organizations')
      .insert({ name: orgName, slug: orgName }).select('id').single())!.id
    orgB = checked(await admin.from('organizations')
      .insert({ name: secondName, slug: secondName }).select('id').single())!.id

    accountA = checked(await admin.from('organization_billing_accounts').insert({
      organization_id: orgA, provider: 'stripe', environment: 'TEST',
      provider_customer_id: customerA,
    }).select('id').single())!.id
    accountB = checked(await admin.from('organization_billing_accounts').insert({
      organization_id: orgB, provider: 'stripe', environment: 'TEST',
      provider_customer_id: customerB,
    }).select('id').single())!.id

    const email = `mr5c2-${randomUUID()}@example.test`
    const password = randomUUID()
    const created = checked(await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    }))!
    if (!created.user) throw new Error('Synthetic owner unavailable')
    ownerId = created.user.id
    checked(await admin.from('organization_users').insert({
      organization_id: orgA, user_id: ownerId, role: 'OWNER',
    }))
    checked(await owner.auth.signInWithPassword({ email, password }))
  }, 30000)

  afterAll(async () => {
    if (orgA) checked(await admin.from('organizations').delete().eq('id', orgA))
    if (orgB) checked(await admin.from('organizations').delete().eq('id', orgB))
    if (ownerId) {
      const result = await admin.auth.admin.deleteUser(ownerId)
      if (result.error) throw result.error
    }
  })

  it('atomically inserts a TEST provider-state projection without granting entitlement', async () => {
    const candidate = projection()
    const result = await save(candidate)
    expect(result.outcome).toBe('CREATED')
    if (result.outcome !== 'CREATED') return

    const subscription = checked(await admin.from('organization_subscriptions')
      .select('*').eq('id', result.subscriptionId).single())!
    expect(subscription).toMatchObject({
      provider: 'stripe',
      environment: 'TEST',
      organization_id: orgA,
      billing_account_id: accountA,
      provider_subscription_id: candidate.providerSubscriptionId,
      provider_price_id: candidate.providerPriceId,
      provider_status: 'active',
      normalized_status: 'ACTIVE',
      provider_state_updated_at: null,
    })
    expect(new Date(subscription.current_period_start!).getTime())
      .toBe(new Date(candidate.currentPeriodStart!).getTime())
    expect(new Date(subscription.current_period_end!).getTime())
      .toBe(new Date(candidate.currentPeriodEnd!).getTime())
  })

  it('is idempotent: duplicates do not modify the same row or its updated_at', async () => {
    const candidate = projection()
    const first = await save(candidate)
    const second = await save(candidate)
    expect(first.outcome).toBe('CREATED')
    expect(second).toEqual({
      outcome: 'UNCHANGED', subscriptionId: first.outcome === 'CREATED' ? first.subscriptionId : '',
    })
    const rows = checked(await admin.from('organization_subscriptions')
      .select('id,updated_at').eq('provider_subscription_id', candidate.providerSubscriptionId))!
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(first.outcome === 'CREATED' ? first.subscriptionId : '')
  })

  it('updates known provider states without granting GRACE or paid entitlements', async () => {
    const candidate = projection()
    expect((await save(candidate)).outcome).toBe('CREATED')
    const pastDue = { ...candidate, providerStatus: 'past_due', normalizedStatus: 'SUSPENDED' as const }
    expect((await save(pastDue)).outcome).toBe('UPDATED')
    const ended = { ...candidate, providerStatus: 'canceled', normalizedStatus: 'ENDED' as const }
    expect((await save(ended)).outcome).toBe('UPDATED')
    const final = checked(await admin.from('organization_subscriptions')
      .select('normalized_status,provider_status,provider_state_updated_at')
      .eq('provider_subscription_id', candidate.providerSubscriptionId).single())!
    expect(final).toMatchObject({
      provider_status: 'canceled',
      normalized_status: 'ENDED',
      provider_state_updated_at: null,
    })
  })

  it('fails closed for a mismatched customer mapping', async () => {
    const candidate = projection()
    expect(await save(candidate, customerB)).toEqual({
      outcome: 'BLOCKED', reason: 'ACCOUNT_MISMATCH',
    })
    const rows = checked(await admin.from('organization_subscriptions')
      .select('id').eq('provider_subscription_id', candidate.providerSubscriptionId))!
    expect(rows).toHaveLength(0)
  })

  it('rejects forged cross-tenant or cross-account identity', async () => {
    const candidate = projection({ organizationId: orgB, billingAccountId: accountA })
    expect(await save(candidate)).toEqual({
      outcome: 'BLOCKED', reason: 'ACCOUNT_MISMATCH',
    })
  })

  it('refuses reassignment of an existing Stripe subscription to a foreign organization', async () => {
    const candidate = projection()
    const first = await save(candidate)
    expect(first.outcome).toBe('CREATED')
    const forged = {
      ...candidate,
      organizationId: orgB,
      billingAccountId: accountB,
    }
    expect(await save(forged, customerB)).toEqual({ outcome: 'CONFLICT' })
    const row = checked(await admin.from('organization_subscriptions')
      .select('organization_id,billing_account_id').eq('provider_subscription_id',
        candidate.providerSubscriptionId).single())!
    expect(row.organization_id).toBe(orgA)
    expect(row.billing_account_id).toBe(accountA)
  })

  it('rejects forged normalization, invalid prices and inconsistent period values', async () => {
    const initial = projection()
    for (const candidate of [
      { ...initial, normalizedStatus: 'GRACE' as const },
      { ...initial, providerPriceId: 'not-a-price' },
      { ...initial, currentPeriodEnd: initial.currentPeriodStart },
    ]) {
      const result = await save(candidate)
      expect(result.outcome).toBe('BLOCKED')
    }
    const rows = checked(await admin.from('organization_subscriptions')
      .select('id').eq('provider_subscription_id', initial.providerSubscriptionId))!
    expect(rows).toHaveLength(0)
  })

  it('rejects LIVE through the database even for service_role', async () => {
    const candidate = projection()
    const result = checked(await admin.rpc('reconcile_stripe_subscription_projection', {
      p_org_id: orgA,
      p_billing_account_id: accountA,
      p_provider_customer_id: customerA,
      p_environment: 'LIVE',
      p_provider_subscription_id: candidate.providerSubscriptionId,
      p_provider_price_id: candidate.providerPriceId,
      p_provider_status: candidate.providerStatus,
      p_normalized_status: candidate.normalizedStatus,
      p_current_period_start: candidate.currentPeriodStart,
      p_current_period_end: candidate.currentPeriodEnd,
      p_cancel_at_period_end: candidate.cancelAtPeriodEnd,
      p_canceled_at: candidate.canceledAt,
    }))
    expect(result).toEqual({ outcome: 'BLOCKED', reason: 'ENVIRONMENT_DISABLED' })
  })

  it('denies direct RPC invocation to anonymous and even tenant OWNER credentials', async () => {
    const candidate = projection()
    const input = {
      p_org_id: orgA,
      p_billing_account_id: accountA,
      p_provider_customer_id: customerA,
      p_environment: 'TEST' as const,
      p_provider_subscription_id: candidate.providerSubscriptionId,
      p_provider_price_id: candidate.providerPriceId,
      p_provider_status: candidate.providerStatus,
      p_normalized_status: candidate.normalizedStatus,
      p_current_period_start: candidate.currentPeriodStart,
      p_current_period_end: candidate.currentPeriodEnd,
      p_cancel_at_period_end: candidate.cancelAtPeriodEnd,
      p_canceled_at: candidate.canceledAt,
    }
    for (const client of [anonymous, owner]) {
      const { error } = await client.rpc('reconcile_stripe_subscription_projection', input)
      expect(error).not.toBeNull()
    }
    const rows = checked(await admin.from('organization_subscriptions')
      .select('id').eq('provider_subscription_id', candidate.providerSubscriptionId))!
    expect(rows).toHaveLength(0)
  })

  it('serializes concurrent identical writes with exactly one created row', async () => {
    const candidate = projection()
    const results = await Promise.all(Array.from({ length: 5 }, () => save(candidate)))
    expect(results.filter(x => x.outcome === 'CREATED')).toHaveLength(1)
    expect(results.filter(x => x.outcome === 'UNCHANGED')).toHaveLength(4)
    const rows = checked(await admin.from('organization_subscriptions')
      .select('id').eq('provider_subscription_id', candidate.providerSubscriptionId))!
    expect(rows).toHaveLength(1)
  })
})
