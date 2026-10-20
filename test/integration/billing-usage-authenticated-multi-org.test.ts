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
import BillingSettingsPage from '../../src/app/app/settings/billing/page'
import UsageSettingsPage from '../../src/app/app/settings/usage/page'

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

function requireData<T>(res: { data: T | null; error: unknown }, why: string): T {
  if (res.error || !res.data) throw new Error('SYNTHETIC_MULTI_ORG_' + why)
  return res.data
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
    const reselected = await resolveCurrentServerOrganization()
    expect(reselected).toMatchObject({
      outcome:'SELECTED',organization:{organizationId:orgA,role:'OWNER'},
    })
    const billingA = await billingPage()
    expect(billingA).toContain('Test A')
    expect(billingA).not.toContain('Test B')
    expect(billingA).toContain('30 Free Review Requests')
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
    expect(await usagePage()).toContain('data-usage-org="' + orgB + '"')
  }, 45000)

  it('unauthenticated requests expose no organization or billing/usage page', async () => {
    currentSession = anonymous
    expect(await resolveCurrentServerOrganization(orgA))
      .toEqual({outcome:'AUTH_REQUIRED'})
    expect((await getOrganizationUsageSummary(orgA)).success).toBe(false)
    await expect(BillingSettingsPage()).rejects.toThrow('SYNTHETIC_REDIRECT:/login')
    await expect(UsageSettingsPage()).rejects.toThrow('SYNTHETIC_REDIRECT:/login')
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})
