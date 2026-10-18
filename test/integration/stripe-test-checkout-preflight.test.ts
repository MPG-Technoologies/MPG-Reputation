import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
import { prepareStripeTestCheckout } from '../../src/lib/billing/stripe-test-checkout-preflight'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const options = { auth: { autoRefreshToken: false, persistSession: false } }
const admin = createClient<Database>(url, serviceKey, options)
const owner = createClient<Database>(url, anonKey, options)
const viewer = createClient<Database>(url, anonKey, options)
const anonymous = createClient<Database>(url, anonKey, options)
const run = randomUUID().replaceAll('-', '')
const customer = 'cus_Mr5dSynthetic' + run
const priceId = 'price_Mr5dSyntheticMonthly'
const savedMonthly = process.env.STRIPE_TEST_MONTHLY_PRICE_ID

let ownerId = ''
let viewerId = ''
let orgId = ''
let foreignOrgId = ''
let billingAccountId = ''

function checked<T extends { data: unknown; error: unknown }>(response: T): NonNullable<T['data']> {
  if (response.error || response.data === null) {
    throw new Error('MR-5D1 disposable SQL setup failed', { cause: response.error })
  }
  return response.data as NonNullable<T['data']>
}

const fetchPrice = vi.fn(async (id: string) => ({
  id, currency: 'php', unitAmountMinor: 150_000,
  interval: 'month', intervalCount: 1, active: true, liveMode: false,
}))

async function check(
  supabase: typeof owner,
  organizationId: string = orgId
) {
  return prepareStripeTestCheckout({
    supabase, organizationId, planId: 'monthly', retrievePrice: fetchPrice,
  })
}

describe('MR-5D1 TEST checkout tenant and RLS preflight (disposable PostgreSQL)', () => {
  beforeAll(async () => {
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    expect(serviceKey).toBeTruthy()
    process.env.STRIPE_TEST_MONTHLY_PRICE_ID = priceId

    orgId = checked(await admin.from('organizations').insert({
      name: 'MR5D1 isolated subscription org',
      slug: 'mr5d1-a-' + run,
    }).select('id').single()).id
    foreignOrgId = checked(await admin.from('organizations').insert({
      name: 'MR5D1 foreign org',
      slug: 'mr5d1-b-' + run,
    }).select('id').single()).id
    billingAccountId = checked(await admin.from('organization_billing_accounts').insert({
      organization_id: orgId, provider: 'stripe',
      environment: 'TEST', provider_customer_id: customer,
    }).select('id').single()).id

    const ownerEmail = 'mr5d1-owner-' + run + '@example.test'
    const viewerEmail = 'mr5d1-viewer-' + run + '@example.test'
    const ownerPass = randomUUID()
    const viewerPass = randomUUID()
    const createdOwner = checked(await admin.auth.admin.createUser({
      email: ownerEmail, password: ownerPass, email_confirm: true,
    }))
    const createdViewer = checked(await admin.auth.admin.createUser({
      email: viewerEmail, password: viewerPass, email_confirm: true,
    }))
    if (!createdOwner.user || !createdViewer.user) throw new Error('Test users unavailable')
    ownerId = createdOwner.user.id
    viewerId = createdViewer.user.id
    checked(await admin.from('organization_users').insert([
      { organization_id: orgId, user_id: ownerId, role: 'OWNER' },
      { organization_id: orgId, user_id: viewerId, role: 'VIEWER' },
    ]).select('id'))
    checked(await owner.auth.signInWithPassword({ email: ownerEmail, password: ownerPass }))
    checked(await viewer.auth.signInWithPassword({ email: viewerEmail, password: viewerPass }))
  }, 30000)

  afterAll(async () => {
    if (savedMonthly === undefined) delete process.env.STRIPE_TEST_MONTHLY_PRICE_ID
    else process.env.STRIPE_TEST_MONTHLY_PRICE_ID = savedMonthly
    if (orgId) checked(await admin.from('organizations').delete().eq('id', orgId).select('id'))
    if (foreignOrgId) checked(await admin.from('organizations').delete().eq('id', foreignOrgId).select('id'))
    if (ownerId) {
      const { error } = await admin.auth.admin.deleteUser(ownerId)
      if (error) throw error
    }
    if (viewerId) {
      const { error } = await admin.auth.admin.deleteUser(viewerId)
      if (error) throw error
    }
  })

  it('permits only the signed-in tenant OWNER to prepare the trusted TEST price', async () => {
    const result = await check(owner)
    expect(result.outcome).toBe('READY')
    if (result.outcome !== 'READY') return
    expect(result.intent).toMatchObject({
      organizationId: orgId,
      billingAccountId,
      stripeCustomerId: customer,
      stripePriceId: priceId,
      amountMinor: 150_000,
      interval: 'month',
    })
    expect(fetchPrice).toHaveBeenCalledWith(priceId)
  })

  it('refuses unauthenticated sessions without fetching provider prices', async () => {
    fetchPrice.mockClear()
    expect(await check(anonymous)).toEqual({
      outcome: 'BLOCKED', reason: 'NOT_AUTHENTICATED',
    })
    expect(fetchPrice).not.toHaveBeenCalled()
  })

  it('refuses VIEWER access and cross-organization OWNER requests', async () => {
    fetchPrice.mockClear()
    expect(await check(viewer)).toEqual({
      outcome: 'BLOCKED', reason: 'NOT_AUTHORIZED',
    })
    expect(await check(owner, foreignOrgId)).toEqual({
      outcome: 'BLOCKED', reason: 'NOT_AUTHORIZED',
    })
    expect(fetchPrice).not.toHaveBeenCalled()
  })

  it('blocks a second checkout when a non-ended subscription already exists', async () => {
    checked(await admin.from('organization_subscriptions').insert({
      organization_id: orgId, billing_account_id: billingAccountId,
      provider: 'stripe', environment: 'TEST',
      provider_subscription_id: 'sub_Mr5dSynthetic' + run,
      provider_status: 'active', normalized_status: 'ACTIVE',
    }).select('id'))
    fetchPrice.mockClear()
    expect(await check(owner)).toEqual({
      outcome: 'BLOCKED', reason: 'SUBSCRIPTION_EXISTS',
    })
    expect(fetchPrice).not.toHaveBeenCalled()
  })
})
