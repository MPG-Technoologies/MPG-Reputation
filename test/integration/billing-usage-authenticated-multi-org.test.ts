import { randomUUID } from 'node:crypto'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

/**
 * Real Supabase Auth/RLS + server-rendered Billing/Usage acceptance.
 * Disposable synthetic database only; no live browser, provider, payments,
 * production migration, trial activation or elevated tenant read.
 */
let currentSession: ReturnType<typeof createClient<Database>>
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => currentSession),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => { throw new Error('PRIVILEGED_TRIAL_ACTION_FORBIDDEN') }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error('SYNTHETIC_REDIRECT:' + path) },
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement('a', { href }, children),
}))
vi.mock('@/components/layout/page-shell', () => ({
  PageShell: ({ children }: { children: ReactNode }) =>
    createElement('main', null, children),
  PageHeader: ({ title, subtitle, actions }: {
    title: ReactNode; subtitle?: ReactNode; actions?: ReactNode
  }) => createElement('header', null, title, subtitle, actions),
}))
vi.mock('@/components/layout/panels', () => ({
  Panel: ({ children }: { children: ReactNode }) =>
    createElement('section', null, children),
}))
vi.mock('@/components/ui/icons', () => ({
  ChartBarIcon: () => createElement('span', null, 'chart'),
}))
vi.mock('../../src/app/app/settings/usage/client', () => ({
  UsageClient: ({ organizationId, userRole }: {
    organizationId: string; userRole: string
  }) => createElement('div', { 'data-usage-org': organizationId,
    'data-usage-role': userRole }, 'Real usage session accepted'),
}))
vi.mock('../../src/app/app/settings/billing/plan-preview', () => ({
  BillingPlanPreview: () =>
    createElement('span', null, 'Unapproved TEST pricing preview blocked'),
}))

import { resolveCurrentServerOrganization } from '../../src/lib/workspace/server-active-organization'
import { getOrganizationUsageSummary, startOrganizationTrialAction } from '../../src/actions/usage'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { admitStripeTestBillingAction } from '../../src/lib/billing/stripe-test-billing-action-admission'
import BillingSettingsPage from '../../src/app/app/settings/billing/page'
import UsageSettingsPage from '../../src/app/app/settings/usage/page'
import BusinessChooserPage from '../../src/app/workspace/organizations/page'
import ScopedBillingPage from '../../src/app/workspace/organizations/[organizationId]/billing/page'
import ScopedUsagePage from '../../src/app/workspace/organizations/[organizationId]/usage/page'
import ScopedDashboard from '../../src/app/workspace/organizations/[organizationId]/dashboard/page'
import ScopedCustomers from '../../src/app/workspace/organizations/[organizationId]/customers/page'
import ScopedLocations from '../../src/app/workspace/organizations/[organizationId]/locations/page'
import ScopedDestinations from '../../src/app/workspace/organizations/[organizationId]/review-destination/page'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const token = randomUUID().replaceAll('-', '')
const opts = { auth: { autoRefreshToken: false, persistSession: false } }
const admin = createClient<Database>(url, serviceKey, opts)
const anonymous = createClient<Database>(url, anonKey, opts)
const userA = createClient<Database>(url, anonKey, opts)
const userB = createClient<Database>(url, anonKey, opts)
const orgIds: string[] = []
const createdUserIds: string[] = []
let orgA = ''
let orgB = ''
let orgC = ''
let ownerAId = ''
let locationA = ''
let locationB = ''

function requireData<T extends { data: unknown; error: unknown }>(
  res: T, why: string
): NonNullable<T['data']> {
  if (res.error || res.data === null) throw new Error('SYNTHETIC_MULTI_ORG_' + why)
  return res.data as NonNullable<T['data']>
}
async function makeUser(label: string, client: typeof admin) {
  const email = 'mr5-multi-' + label + '-' + token + '@example.test'
  const password = randomUUID()
  const created = requireData(await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  }), 'CREATE_USER')
  if (!created.user) throw new Error('SYNTHETIC_MULTI_ORG_MISSING_USER')
  createdUserIds.push(created.user.id)
  requireData(await client.auth.signInWithPassword({ email, password }), 'LOGIN')
  return created.user.id
}
async function makeOrg(name: string) {
  const row = requireData(await admin.from('organizations').insert({
    name: 'Test ' + name,
    slug: 'mr5-tenant-' + name.toLowerCase() + '-' + token,
  }).select('id').single(), 'CREATE_ORG')
  orgIds.push(row.id)
  return row.id
}
async function billingPage() {
  return renderToStaticMarkup(createElement('div', null, await BillingSettingsPage()))
}
async function usagePage() {
  return renderToStaticMarkup(createElement('div', null, await UsageSettingsPage()))
}
async function chooserPage() {
  return renderToStaticMarkup(createElement('div', null, await BusinessChooserPage()))
}
async function scopedBilling(id: string) {
  return renderToStaticMarkup(createElement('div', null,
    await ScopedBillingPage({ params: Promise.resolve({ organizationId: id }) })))
}
async function scopedUsage(id: string) {
  return renderToStaticMarkup(createElement('div', null,
    await ScopedUsagePage({ params: Promise.resolve({ organizationId: id }) })))
}
async function operationalPage(
  handler: (props: {params: Promise<{organizationId:string}>}) => Promise<ReactNode>,
  id: string,
) {
  return renderToStaticMarkup(createElement('div', null,
    await handler({params:Promise.resolve({organizationId:id})})))
}

describe('MR-5 authenticated two-business Billing and Usage access continuity (disposable DB)', () => {
  const oldPreview = process.env.ENABLE_MR5D_BILLING_UI_PREVIEW
  beforeAll(async () => {
    if (!['http://127.0.0.1:54331', 'http://localhost:54331'].includes(url) ||
        process.env.NODE_ENV === 'production' ||
        process.env.VERCEL_ENV !== undefined ||
        process.env.ENABLE_LIVE_BILLING === 'true') {
      throw new Error('DISPOSABLE_SUPABASE_REQUIRED')
    }
    process.env.ENABLE_MR5D_BILLING_UI_PREVIEW = 'false'
    ownerAId = await makeUser('ownerA', userA)
    const bId = await makeUser('ownerB', userB)
    orgA = await makeOrg('A')
    orgB = await makeOrg('B')
    orgC = await makeOrg('C')
    requireData(await admin.from('organization_users').insert([
      { organization_id: orgA, user_id: ownerAId, role: 'OWNER' },
      { organization_id: orgB, user_id: ownerAId, role: 'VIEWER' },
      { organization_id: orgB, user_id: bId, role: 'OWNER' },
    ]).select('id'), 'CREATE_MEMBERSHIPS')
    for (const orgId of [orgA, orgB]) {
      const { error } = await admin.rpc('provision_organization_trial', {
        p_org_id: orgId,
      })
      if (error) throw new Error('SYNTHETIC_TRIAL_PROVISIONING_FAILED')
    }
    requireData(await admin.from('organization_billing_accounts').insert({
      organization_id: orgA, environment: 'TEST', provider: 'stripe',
      provider_customer_id: 'cus_Mr5Multi' + token,
    }).select('id').single(), 'CREATE_TEST_ACCOUNT')
    locationA = requireData(await admin.from('locations').insert({
      organization_id:orgA,name:'Tenant Alpha Synthetic Location',status:'ACTIVE',
    }).select('id').single(),'CREATE_LOCATION_A').id
    locationB = requireData(await admin.from('locations').insert({
      organization_id:orgB,name:'Tenant Beta Synthetic Location',status:'INACTIVE',
    }).select('id').single(),'CREATE_LOCATION_B').id
    requireData(await admin.from('customers').insert([
      {organization_id:orgA,location_id:locationA,first_name:'AlphaSynthetic',permission_email:'unknown'},
      {organization_id:orgB,location_id:locationB,first_name:'BetaSynthetic',permission_email:'denied'},
    ]).select('id'),'CREATE_CUSTOMERS')
    currentSession = userA
  }, 30000)

  afterAll(async () => {
    if (oldPreview === undefined) delete process.env.ENABLE_MR5D_BILLING_UI_PREVIEW
    else process.env.ENABLE_MR5D_BILLING_UI_PREVIEW = oldPreview
    for (const orgId of orgIds) {
      const { error } = await admin.from('organizations').delete().eq('id', orgId)
      if (error) throw new Error('SYNTHETIC_MULTI_ORG_CLEANUP_FAILED')
    }
    for (const userId of createdUserIds) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) throw new Error('SYNTHETIC_MULTI_ORG_USER_CLEANUP_FAILED')
    }
  }, 30000)

  it('gates local TEST billing admission using actual authenticated multi-tenant RLS and atomic limits', async () => {
    // This calls only the admission boundary: never Stripe, checkout creation,
    // customer provisioning, subscription finalization, or paid entitlements.
    const keys = [
      'ENABLE_STRIPE_TEST_BILLING_ACTIONS',
      'MPG_STRIPE_TEST_BILLING_ACTION_TARGET',
      'MPG_BILLING_CHECKOUT_RETURN_ORIGIN',
      'ENABLE_LIVE_BILLING',
    ] as const
    const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]))
    try {
      process.env.ENABLE_STRIPE_TEST_BILLING_ACTIONS = 'true'
      process.env.MPG_STRIPE_TEST_BILLING_ACTION_TARGET = 'LOCAL_SYNTHETIC'
      process.env.MPG_BILLING_CHECKOUT_RETURN_ORIGIN = 'http://localhost:3000'
      process.env.ENABLE_LIVE_BILLING = 'false'
      const request = {
        method: 'POST', origin: 'http://localhost:3000',
        fetchSite: 'same-origin', fetchMode: 'cors',
        contentType: 'application/json', actionHeader: '1',
      }
      const admit = (userSupabase: typeof admin, organizationId: string,
        action: 'CUSTOMER_SETUP' | 'CHECKOUT' | 'PORTAL' = 'CHECKOUT') =>
        admitStripeTestBillingAction({
          userSupabase, trustedBillingSupabase: admin,
          organizationId, action, request,
        })

      // This real OWNER of A also holds a VIEWER membership in B. An
      // untrusted posted org UUID must never resolve that ambiguity.
      expect(await admit(userA, orgA)).toEqual({
        outcome: 'DENIED', reason: 'NOT_AUTHORIZED',
      })
      expect(await admit(userA, orgB)).toEqual({
        outcome: 'DENIED', reason: 'NOT_AUTHORIZED',
      })

      // An actual signed-in OWNER of B cannot claim a billing action for A.
      expect(await admit(userB, orgA)).toEqual({
        outcome: 'DENIED', reason: 'NOT_AUTHORIZED',
      })
      const { count: foreignAttempts, error: foreignError } = await admin
        .from('stripe_test_billing_action_limits')
        .select('organization_id', { count: 'exact', head: true })
        .eq('organization_id', orgA)
      expect(foreignError).toBeNull()
      expect(foreignAttempts).toBe(0)

      // The same B-owner session is admitted for its own organization, but
      // the privileged SQL rate limit admits exactly five actions in its
      // minute window, shared across setup/checkout/portal requests.
      const actions = ['CUSTOMER_SETUP','CHECKOUT','PORTAL','CHECKOUT','PORTAL'] as const
      for (let i = 0; i < actions.length; i++) {
        expect(await admit(userB, orgB, actions[i])).toEqual({
          outcome: 'ALLOWED', remaining: 4 - i,
        })
      }
      expect(await admit(userB, orgB)).toEqual({
        outcome: 'DENIED', reason: 'RATE_LIMITED',
      })
      const { data: limit, error: limitError } = await admin
        .from('stripe_test_billing_action_limits')
        .select('attempts,last_action')
        .eq('organization_id', orgB).single()
      expect(limitError).toBeNull()
      expect(limit).toMatchObject({ attempts: 5, last_action: 'PORTAL' })

      // Admission alone must not create a Customer, Checkout reservation,
      // subscription, reviewed invoice or paid access.
      const tables = [
        'stripe_test_customer_provisioning',
        'stripe_test_checkout_reservations',
        'billing_synthetic_invoice_reconciliation_reviews',
        'organization_subscriptions',
      ] as const
      for (const table of tables) {
        const { count, error } = await admin.from(table)
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgB)
        expect(error, table).toBeNull()
        expect(count, table).toBe(0)
      }
      const { data: trial, error: trialError } = await admin
        .from('organization_entitlements')
        .select('allocated_requests,consumed_requests,status')
        .eq('organization_id', orgB).single()
      expect(trialError).toBeNull()
      expect(trial).toMatchObject({
        allocated_requests: 30, consumed_requests: 0, status: 'NOT_STARTED',
      })
    } finally {
      for (const key of keys) {
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
      }
    }
  }, 30000)

  it('requires explicit tenant choice, refuses Billing/Usage ambiguity, preserves RLS role separation and rechecks revocation', async () => {
    currentSession = userA
    const unresolved = await resolveCurrentServerOrganization()
    expect(unresolved.outcome).toBe('SELECTION_REQUIRED')
    if (unresolved.outcome !== 'SELECTION_REQUIRED') throw new Error('CHOICE_REQUIRED')
    expect(unresolved.choices).toEqual([
      { organizationId: orgA, organizationName: 'Test A', role: 'OWNER' },
      { organizationId: orgB, organizationName: 'Test B', role: 'VIEWER' },
    ].sort((x, y) => x.organizationId.localeCompare(y.organizationId)))

    expect(await resolveCurrentServerOrganization(orgA))
      .toMatchObject({outcome:'SELECTED',organization:{organizationId:orgA,role:'OWNER'}})
    expect(await resolveCurrentServerOrganization(orgB))
      .toMatchObject({outcome:'SELECTED',organization:{organizationId:orgB,role:'VIEWER'}})
    for (const denied of [orgC, 'forged-business', '']) {
      expect(await resolveCurrentServerOrganization(denied)).toEqual({
        outcome:'SELECTION_DENIED',
      })
    }

    const billingBlocked = await billingPage()
    const usageBlocked = await usagePage()
    expect(billingBlocked).toContain('Multiple businesses detected')
    expect(usageBlocked).toContain('Multiple businesses detected')
    for (const markup of [billingBlocked, usageBlocked]) {
      expect(markup).not.toContain('Test A')
      expect(markup).not.toContain('Test B')
      expect(markup).not.toContain('data-usage-org')
      expect(markup).not.toContain('TEST plan preview')
    }

    // The new isolated URLs are explicit, independently revalidated and
    // detached from /app's arbitrary first-membership shell.
    const chooser = await chooserPage()
    expect(chooser).toContain('Test A')
    expect(chooser).toContain('Test B')
    expect(chooser).toContain('/workspace/organizations/' + orgA + '/billing')
    for (const view of ['dashboard','customers','locations','review-destination']) {
      expect(chooser).toContain('/workspace/organizations/' + orgA + '/' + view)
      expect(chooser).toContain('/workspace/organizations/' + orgB + '/' + view)
    }
    expect(chooser).toContain('/workspace/organizations/' + orgB + '/usage')
    expect(chooser).not.toContain('/workspace/organizations/' + orgB + '/billing')

    const billingA = await scopedBilling(orgA)
    expect(billingA).toContain('Test A')
    expect(billingA).toContain('30 Free Review Requests')
    expect(billingA).not.toContain('Test B')
    expect(billingA).not.toContain('1500')
    expect(billingA).not.toContain('Open TEST checkout')
    const usageB = await scopedUsage(orgB)
    expect(usageB).toContain('Test B')
    expect(usageB).toContain('VIEWER')
    expect(usageB).toContain('30 remaining of 30 review requests')
    expect(usageB).not.toContain('Test A')
    expect(usageB).not.toContain('Billing overview')
    const billingDenied = await scopedBilling(orgB)
    expect(billingDenied).toContain('Owner or administrator access required')
    expect(billingDenied).not.toContain('Test B')
    for (const id of [orgC, 'not-a-uuid']) {
      const invalidBilling = await scopedBilling(id)
      const invalidUsage = await scopedUsage(id)
      expect(invalidBilling).toContain('Business access could not be verified')
      expect(invalidUsage).toContain('Business access could not be verified')
      expect(invalidBilling + invalidUsage).not.toContain('Test A')
      expect(invalidBilling + invalidUsage).not.toContain('Test B')
    }

    const dashA = await operationalPage(ScopedDashboard,orgA)
    const customersA = await operationalPage(ScopedCustomers,orgA)
    const locationsA = await operationalPage(ScopedLocations,orgA)
    const destinationA = await operationalPage(ScopedDestinations,orgA)
    expect(dashA).toContain('Test A')
    expect(dashA).toContain('Recorded completions')
    expect(dashA).not.toContain('Test B')
    expect(customersA).toContain('AlphaSynthetic')
    expect(customersA).not.toContain('BetaSynthetic')
    expect(locationsA).toContain('Tenant Alpha Synthetic Location')
    expect(locationsA).not.toContain('Tenant Beta Synthetic Location')
    expect(destinationA).toContain('No Google review destinations configured')
    const dashB = await operationalPage(ScopedDashboard,orgB)
    const customersB = await operationalPage(ScopedCustomers,orgB)
    const locationsB = await operationalPage(ScopedLocations,orgB)
    expect(dashB).toContain('Test B')
    expect(customersB).toContain('BetaSynthetic')
    expect(customersB).not.toContain('AlphaSynthetic')
    expect(locationsB).toContain('Tenant Beta Synthetic Location')
    expect(locationsB).not.toContain('Tenant Alpha Synthetic Location')
    for (const handler of [ScopedDashboard,ScopedCustomers,ScopedLocations,ScopedDestinations]) {
      for (const id of [orgC, 'not-a-uuid']) {
        const unavailable = await operationalPage(handler,id)
        expect(unavailable).toContain('Business access could not be verified')
        expect(unavailable).not.toContain('AlphaSynthetic')
        expect(unavailable).not.toContain('BetaSynthetic')
      }
    }
    const ownUsage = await getOrganizationUsageSummary(orgA)
    const viewerUsage = await getOrganizationUsageSummary(orgB)
    expect(ownUsage).toMatchObject({
      success:true,data:{organizationId:orgA,entitlement:{
        status:'NOT_STARTED',allocatedRequests:30,consumedRequests:0,
      }},
    })
    expect(viewerUsage).toMatchObject({
      success:true,data:{organizationId:orgB,entitlement:{
        status:'NOT_STARTED',allocatedRequests:30,consumedRequests:0,
      }},
    })
    expect((await getOrganizationUsageSummary(orgC)).success).toBe(false)
    const attempt = await startOrganizationTrialAction(orgB)
    expect(attempt).toMatchObject({success:false,reason:'UNAUTHORIZED'})
    expect(createAdminClient).not.toHaveBeenCalled()

    // A revoked membership is not rescued by an earlier successful SELECTED.
    requireData(await admin.from('organization_users').delete()
      .eq('organization_id', orgB).eq('user_id', ownerAId)
      .select('id'), 'REVOKE_VIEWER')
    expect(await resolveCurrentServerOrganization(orgB))
      .toEqual({outcome:'SELECTION_DENIED'})
    expect((await getOrganizationUsageSummary(orgB)).success).toBe(false)
    const revokedScoped = await scopedUsage(orgB)
    expect(revokedScoped).toContain('Business access could not be verified')
    expect(revokedScoped).not.toContain('Test B')
    for (const handler of [ScopedDashboard,ScopedCustomers,ScopedLocations,ScopedDestinations]) {
      const denied = await operationalPage(handler,orgB)
      expect(denied).toContain('Business access could not be verified')
      expect(denied).not.toContain('BetaSynthetic')
    }
    const reselected = await resolveCurrentServerOrganization()
    expect(reselected).toMatchObject({
      outcome:'SELECTED',organization:{organizationId:orgA,role:'OWNER'},
    })
    const legacyBillingA = await billingPage()
    expect(legacyBillingA).toContain('Test A')
    expect(legacyBillingA).not.toContain('Test B')
    expect(legacyBillingA).toContain('30 Free Review Requests')
    const usageA = await usagePage()
    expect(usageA).toContain('data-usage-org="' + orgA + '"')
    expect(usageA).toContain('data-usage-role="OWNER"')
    expect(usageA).not.toContain(orgB)

    // Another authenticated tenant owner may still view B, but never A.
    currentSession = userB
    expect(await resolveCurrentServerOrganization(orgA))
      .toEqual({outcome:'SELECTION_DENIED'})
    expect((await getOrganizationUsageSummary(orgA)).success).toBe(false)
    expect((await getOrganizationUsageSummary(orgB)).success).toBe(true)
    expect(await billingPage()).not.toContain('Test A')
    expect(await scopedBilling(orgB)).toContain('Test B')
    expect(await operationalPage(ScopedCustomers,orgB)).toContain('BetaSynthetic')
    expect(await operationalPage(ScopedCustomers,orgA))
      .toContain('Business access could not be verified')
    expect(await scopedUsage(orgB)).toContain('30 remaining of 30 review requests')
    expect(await scopedBilling(orgA)).toContain('Business access could not be verified')
    expect(await usagePage()).toContain('data-usage-org="' + orgB + '"')
  }, 45000)

  it('unauthenticated requests expose no organization or billing/usage page', async () => {
    currentSession = anonymous
    expect(await resolveCurrentServerOrganization(orgA))
      .toEqual({outcome:'AUTH_REQUIRED'})
    expect((await getOrganizationUsageSummary(orgA)).success).toBe(false)
    await expect(BillingSettingsPage()).rejects.toThrow('SYNTHETIC_REDIRECT:/login')
    await expect(UsageSettingsPage()).rejects.toThrow('SYNTHETIC_REDIRECT:/login')
    await expect(BusinessChooserPage()).rejects.toThrow('SYNTHETIC_REDIRECT:/login')
    for (const handler of [ScopedDashboard,ScopedCustomers,ScopedLocations,ScopedDestinations]) {
      await expect(handler({params:Promise.resolve({organizationId:orgA})}))
        .rejects.toThrow('SYNTHETIC_REDIRECT:/login')
    }
    await expect(ScopedBillingPage({params:Promise.resolve({organizationId:orgA})}))
      .rejects.toThrow('SYNTHETIC_REDIRECT:/login')
    await expect(ScopedUsagePage({params:Promise.resolve({organizationId:orgA})}))
      .rejects.toThrow('SYNTHETIC_REDIRECT:/login')
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})
