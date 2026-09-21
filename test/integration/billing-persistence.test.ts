import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_anon_key'

const isDbAvailable = !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'dummy_service_role_key'

describe.skipIf(!isDbAvailable)('MR-5B Billing Persistence & RLS Real PostgreSQL Tests', () => {
  let adminClient: ReturnType<typeof createClient<Database>>
  let ownerAClient: ReturnType<typeof createClient<Database>>
  let adminAClient: ReturnType<typeof createClient<Database>>
  let operatorAClient: ReturnType<typeof createClient<Database>>
  let viewerAClient: ReturnType<typeof createClient<Database>>
  let ownerBClient: ReturnType<typeof createClient<Database>>

  let adminAUserId: string
  let operatorAUserId: string
  let viewerAUserId: string

  let orgAId: string
  let orgBId: string
  let accountAId: string
  let accountBId: string

  let timestamp: number
  let eventPrefix: string

  const createdUserIds: string[] = []

  async function createAuthenticatedUser(email: string) {
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password: 'Password123!',
      email_confirm: true,
    })

    if (error || !data.user) {
      throw new Error(`Failed to create test user ${email}: ${error?.message}`)
    }

    createdUserIds.push(data.user.id)

    const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password: 'Password123!',
    })

    if (signInError) {
      throw new Error(`Failed to sign in ${email}: ${signInError.message}`)
    }

    return { id: data.user.id, client }
  }

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    timestamp = Date.now()
    eventPrefix = `mr5b-${timestamp}`

    const ownerA = await createAuthenticatedUser(`mr5b-owner-a-${timestamp}@test.local`)
    const adminA = await createAuthenticatedUser(`mr5b-admin-a-${timestamp}@test.local`)
    const operatorA = await createAuthenticatedUser(`mr5b-operator-a-${timestamp}@test.local`)
    const viewerA = await createAuthenticatedUser(`mr5b-viewer-a-${timestamp}@test.local`)
    const ownerB = await createAuthenticatedUser(`mr5b-owner-b-${timestamp}@test.local`)

    ownerAClient = ownerA.client
    adminAUserId = adminA.id
    adminAClient = adminA.client
    operatorAUserId = operatorA.id
    operatorAClient = operatorA.client
    viewerAUserId = viewerA.id
    viewerAClient = viewerA.client
    ownerBClient = ownerB.client

    const { data: orgAResult, error: orgAError } = await ownerAClient.rpc(
      'create_org_with_owner_and_location',
      {
        p_org_name: `MR5B Org A ${timestamp}`,
        p_slug: `mr5b-org-a-${timestamp}`,
        p_loc_name: 'MR5B Location A',
      }
    )

    if (orgAError || !orgAResult) {
      throw new Error(`Failed to create Org A: ${orgAError?.message}`)
    }

    orgAId = (orgAResult as { organization_id: string }).organization_id

    const { data: orgBResult, error: orgBError } = await ownerBClient.rpc(
      'create_org_with_owner_and_location',
      {
        p_org_name: `MR5B Org B ${timestamp}`,
        p_slug: `mr5b-org-b-${timestamp}`,
        p_loc_name: 'MR5B Location B',
      }
    )

    if (orgBError || !orgBResult) {
      throw new Error(`Failed to create Org B: ${orgBError?.message}`)
    }

    orgBId = (orgBResult as { organization_id: string }).organization_id

    const { error: membershipError } = await adminClient.from('organization_users').insert([
      { organization_id: orgAId, user_id: adminAUserId, role: 'ADMIN' },
      { organization_id: orgAId, user_id: operatorAUserId, role: 'OPERATOR' },
      { organization_id: orgAId, user_id: viewerAUserId, role: 'VIEWER' },
    ])

    if (membershipError) {
      throw new Error(`Failed to create Org A memberships: ${membershipError.message}`)
    }

    const { data: accountA, error: accountAError } = await adminClient
      .from('organization_billing_accounts')
      .insert({
        organization_id: orgAId,
        provider: 'stripe',
        provider_customer_id: `cus_mr5b_a_${timestamp}`,
        environment: 'TEST',
      })
      .select('id')
      .single()

    if (accountAError || !accountA) {
      throw new Error(`Failed to seed billing account A: ${accountAError?.message}`)
    }

    accountAId = accountA.id

    const { data: accountB, error: accountBError } = await adminClient
      .from('organization_billing_accounts')
      .insert({
        organization_id: orgBId,
        provider: 'stripe',
        provider_customer_id: `cus_mr5b_b_${timestamp}`,
        environment: 'TEST',
      })
      .select('id')
      .single()

    if (accountBError || !accountB) {
      throw new Error(`Failed to seed billing account B: ${accountBError?.message}`)
    }

    accountBId = accountB.id

    const { error: subscriptionsError } = await adminClient
      .from('organization_subscriptions')
      .insert([
        {
          organization_id: orgAId,
          billing_account_id: accountAId,
          provider: 'stripe',
          provider_subscription_id: `sub_mr5b_a_${timestamp}`,
          provider_price_id: `price_fixture_a_${timestamp}`,
          provider_status: 'active',
          normalized_status: 'ACTIVE',
          provider_state_updated_at: '2026-09-21T12:00:00.000Z',
        },
        {
          organization_id: orgBId,
          billing_account_id: accountBId,
          provider: 'stripe',
          provider_subscription_id: `sub_mr5b_b_${timestamp}`,
          provider_price_id: `price_fixture_b_${timestamp}`,
          provider_status: 'active',
          normalized_status: 'ACTIVE',
          provider_state_updated_at: '2026-09-21T12:00:00.000Z',
        },
      ])

    if (subscriptionsError) {
      throw new Error(`Failed to seed subscriptions: ${subscriptionsError.message}`)
    }

    const { error: webhookError } = await adminClient.from('billing_webhook_events').insert({
      provider: 'stripe',
      provider_event_id: `${eventPrefix}-seed`,
      event_type: 'customer.subscription.updated',
      processing_status: 'PROCESSED',
      payload_hash: 'mr5b-seed-hash',
      organization_id: orgAId,
      provider_created_at: '2026-09-21T12:00:00.000Z',
      processed_at: '2026-09-21T12:00:01.000Z',
    })

    if (webhookError) {
      throw new Error(`Failed to seed webhook event: ${webhookError.message}`)
    }
  })

  afterAll(async () => {
    if (adminClient && eventPrefix) {
      await adminClient
        .from('billing_webhook_events')
        .delete()
        .like('provider_event_id', `${eventPrefix}%`)
    }

    if (adminClient && orgAId) {
      await adminClient.from('organizations').delete().eq('id', orgAId)
    }

    if (adminClient && orgBId) {
      await adminClient.from('organizations').delete().eq('id', orgBId)
    }

    if (adminClient) {
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId)
      }
    }
  })

  it('allows service_role to persist billing account, subscription, and webhook projections', async () => {
    const { data: account, error: accountError } = await adminClient
      .from('organization_billing_accounts')
      .select('organization_id, provider, environment')
      .eq('id', accountAId)
      .single()

    expect(accountError).toBeNull()
    expect(account).toEqual({
      organization_id: orgAId,
      provider: 'stripe',
      environment: 'TEST',
    })

    const { data: subscription, error: subscriptionError } = await adminClient
      .from('organization_subscriptions')
      .select('organization_id, normalized_status')
      .eq('provider_subscription_id', `sub_mr5b_a_${timestamp}`)
      .single()

    expect(subscriptionError).toBeNull()
    expect(subscription?.organization_id).toBe(orgAId)
    expect(subscription?.normalized_status).toBe('ACTIVE')

    const { data: webhook, error: webhookError } = await adminClient
      .from('billing_webhook_events')
      .select('organization_id, processing_status')
      .eq('provider_event_id', `${eventPrefix}-seed`)
      .single()

    expect(webhookError).toBeNull()
    expect(webhook?.organization_id).toBe(orgAId)
    expect(webhook?.processing_status).toBe('PROCESSED')
  })

  it('allows OWNER and ADMIN to read their organization billing account and subscription', async () => {
    for (const client of [ownerAClient, adminAClient]) {
      const { data: accounts, error: accountError } = await client
        .from('organization_billing_accounts')
        .select('id, organization_id')
        .eq('organization_id', orgAId)

      expect(accountError).toBeNull()
      expect(accounts).toHaveLength(1)
      expect(accounts?.[0]?.id).toBe(accountAId)

      const { data: subscriptions, error: subscriptionError } = await client
        .from('organization_subscriptions')
        .select('organization_id, normalized_status')
        .eq('organization_id', orgAId)

      expect(subscriptionError).toBeNull()
      expect(subscriptions).toHaveLength(1)
      expect(subscriptions?.[0]?.normalized_status).toBe('ACTIVE')
    }
  })

  it('hides billing account and subscription rows from OPERATOR and VIEWER roles', async () => {
    for (const client of [operatorAClient, viewerAClient]) {
      const { data: accounts, error: accountError } = await client
        .from('organization_billing_accounts')
        .select('id')
        .eq('organization_id', orgAId)

      expect(accountError).toBeNull()
      expect(accounts).toEqual([])

      const { data: subscriptions, error: subscriptionError } = await client
        .from('organization_subscriptions')
        .select('id')
        .eq('organization_id', orgAId)

      expect(subscriptionError).toBeNull()
      expect(subscriptions).toEqual([])
    }
  })

  it('enforces cross-tenant billing isolation', async () => {
    const { data: ownerASeesOrgB, error: ownerAError } = await ownerAClient
      .from('organization_billing_accounts')
      .select('id')
      .eq('organization_id', orgBId)

    expect(ownerAError).toBeNull()
    expect(ownerASeesOrgB).toEqual([])

    const { data: ownerBSeesOrgA, error: ownerBError } = await ownerBClient
      .from('organization_subscriptions')
      .select('id')
      .eq('organization_id', orgAId)

    expect(ownerBError).toBeNull()
    expect(ownerBSeesOrgA).toEqual([])
  })

  it('denies authenticated mutations of billing projections', async () => {
    const { error: accountInsertError } = await ownerAClient
      .from('organization_billing_accounts')
      .insert({
        organization_id: orgAId,
        provider: 'stripe',
        provider_customer_id: `cus_forbidden_${timestamp}`,
        environment: 'TEST',
      })

    expect(accountInsertError).toBeDefined()
    expect(accountInsertError?.code).toBe('42501')

    const { error: subscriptionUpdateError } = await ownerAClient
      .from('organization_subscriptions')
      .update({ provider_status: 'forbidden-client-update' })
      .eq('organization_id', orgAId)

    expect(subscriptionUpdateError).toBeDefined()
    expect(subscriptionUpdateError?.code).toBe('42501')
  })

  it('keeps billing_webhook_events completely server-only', async () => {
    for (const client of [ownerAClient, adminAClient, operatorAClient, viewerAClient]) {
      const { error } = await client
        .from('billing_webhook_events')
        .select('id')
        .eq('organization_id', orgAId)

      expect(error).toBeDefined()
      expect(error?.code).toBe('42501')
    }
  })

  it('enforces one billing account per organization/provider/environment', async () => {
    const { error } = await adminClient.from('organization_billing_accounts').insert({
      organization_id: orgAId,
      provider: 'stripe',
      provider_customer_id: `cus_second_for_same_org_${timestamp}`,
      environment: 'TEST',
    })

    expect(error).toBeDefined()
    expect(error?.code).toBe('23505')
  })

  it('prevents the same provider customer from being attached to another organization in the same environment', async () => {
    const { error } = await adminClient.from('organization_billing_accounts').insert({
      organization_id: orgBId,
      provider: 'stripe',
      provider_customer_id: `cus_mr5b_a_${timestamp}`,
      environment: 'TEST',
    })

    expect(error).toBeDefined()
    expect(error?.code).toBe('23505')
  })

  it('deduplicates provider webhook events by provider event id', async () => {
    const duplicate = {
      provider: 'stripe' as const,
      provider_event_id: `${eventPrefix}-duplicate`,
      event_type: 'customer.subscription.updated',
      processing_status: 'RECEIVED' as const,
      payload_hash: 'same-event-hash',
      organization_id: orgAId,
    }

    const { error: firstError } = await adminClient
      .from('billing_webhook_events')
      .insert(duplicate)

    expect(firstError).toBeNull()

    const { error: duplicateError } = await adminClient
      .from('billing_webhook_events')
      .insert(duplicate)

    expect(duplicateError).toBeDefined()
    expect(duplicateError?.code).toBe('23505')
  })

  it('rejects subscription/account cross-tenant mismatches at the foreign-key boundary', async () => {
    const { error } = await adminClient.from('organization_subscriptions').insert({
      organization_id: orgBId,
      billing_account_id: accountAId,
      provider: 'stripe',
      provider_subscription_id: `sub_cross_tenant_${timestamp}`,
      provider_status: 'active',
      normalized_status: 'ACTIVE',
    })

    expect(error).toBeDefined()
    expect(error?.code).toBe('23503')
  })

  it('rejects duplicate provider subscription ids', async () => {
    const { error } = await adminClient.from('organization_subscriptions').insert({
      organization_id: orgAId,
      billing_account_id: accountAId,
      provider: 'stripe',
      provider_subscription_id: `sub_mr5b_a_${timestamp}`,
      provider_status: 'active',
      normalized_status: 'ACTIVE',
    })

    expect(error).toBeDefined()
    expect(error?.code).toBe('23505')
  })

  it('rejects invalid normalized billing states at the database boundary', async () => {
    const { error } = await adminClient.from('organization_subscriptions').insert({
      organization_id: orgAId,
      billing_account_id: accountAId,
      provider: 'stripe',
      provider_subscription_id: `sub_invalid_status_${timestamp}`,
      provider_status: 'mystery',
      normalized_status: 'INVALID' as never,
    })

    expect(error).toBeDefined()
    expect(error?.code).toBe('23514')
  })
})
