import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error('TEST_REDIRECT:' + path) },
}))
vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return { default: ({ href, children }: { href: string; children: unknown }) =>
    createElement('a', { href }, children as string) }
})
vi.mock('@/components/layout/page-shell', async () => {
  const { createElement } = await import('react')
  return {
    PageShell: ({ children }: { children: unknown }) =>
      createElement('main', null, children as string),
    PageHeader: ({ title, subtitle, actions }: {
      title: string; subtitle?: string; actions?: unknown
    }) => createElement('header', null, title, subtitle, actions as string),
  }
})
vi.mock('@/components/layout/panels', async () => {
  const { createElement } = await import('react')
  return { Panel: ({ children }: { children: unknown }) =>
    createElement('section', null, children as string) }
})
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/billing/pricing', () => ({
  getConfiguredReputationBillingCatalog: vi.fn(),
}))
vi.mock('@/lib/billing/stripe-test-action-request', () => ({
  isLocalTestBillingActionEndpointEnabled: vi.fn(() => false),
}))
vi.mock('../../src/app/app/settings/billing/plan-preview', async () => {
  const { createElement } = await import('react')
  return { BillingPlanPreview: ({ localActionsEnabled }: { localActionsEnabled: boolean }) =>
    createElement('div', null, 'TEST plan preview:', localActionsEnabled
      ? 'TEST billing actions enabled' : 'TEST billing actions blocked') }
})

import BillingSettingsPage from '../../src/app/app/settings/billing/page'
import { createClient } from '../../src/lib/supabase/server'
import { isLocalTestBillingActionEndpointEnabled } from '../../src/lib/billing/stripe-test-action-request'
import { getConfiguredReputationBillingCatalog } from '../../src/lib/billing/pricing'

const a = { organization_id: '11111111-1111-4111-8111-111111111111',
  role: 'OWNER', organizations: { name: 'Synthetic Plumbing' } }
const b = { organization_id: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN', organizations: { name: 'Synthetic Services' } }

function setup(options: {
  memberships: unknown
  membershipError?: boolean
  authenticated?: boolean
  anonymous?: boolean
  subscriptionData?: unknown
  accountData?: unknown
  accountUndefined?: boolean
}) {
  const from = vi.fn((table: string) => {
    if (table === 'organization_users') return {
      select: () => ({ eq: async () => ({
        data: options.memberships,
        error: options.membershipError ? { message: 'synthetic RLS error' } : null,
      }) }),
    }
    if (table === 'organization_billing_accounts') {
      const query = {
        eq: () => query,
        maybeSingle: async () => ({
          data: options.accountUndefined ? undefined
            : options.accountData === undefined ? null : options.accountData,
          error: null,
        }),
      }
      return { select: () => query }
    }
    if (table === 'organization_subscriptions') {
      const query = {
        eq: () => query,
        order: () => query,
        limit: async () => ({
          data: options.subscriptionData === undefined ? [] : options.subscriptionData,
          error: null,
        }),
      }
      return { select: () => query }
    }
    throw new Error('UNEXPECTED_TABLE:' + table)
  })
  const client = {
    auth: { getUser: vi.fn(async () => ({
      data: { user: options.authenticated === false
        ? null : { id: '33333333-3333-4333-8333-333333333333',
          is_anonymous: options.anonymous === true } },
      error: null,
    })) },
    from,
  }
  vi.mocked(createClient).mockResolvedValue(client as never)
  return { from, client }
}

describe('MR-5I4I actual BillingSettingsPage synthetic context and auth behavior', () => {
  const originalPreviewFlag = process.env.ENABLE_MR5D_BILLING_UI_PREVIEW
  afterEach(() => {
    if (originalPreviewFlag === undefined) delete process.env.ENABLE_MR5D_BILLING_UI_PREVIEW
    else process.env.ENABLE_MR5D_BILLING_UI_PREVIEW = originalPreviewFlag
    vi.resetAllMocks()
  })

  it('never loads billing rows or exposes either tenant from two valid organizations', async () => {
    const db = setup({ memberships: [a, b] })
    const html = renderToStaticMarkup(
      createElement('div', null, await BillingSettingsPage()),
    )
    expect(html).toContain('Multiple businesses detected')
    expect(html).toContain('Billing is unavailable')
    expect(html).not.toContain('Synthetic Plumbing')
    expect(html).not.toContain('Synthetic Services')
    expect(html).not.toContain(a.organization_id)
    expect(html).not.toContain(b.organization_id)
    expect(html).not.toContain('TEST plan preview')
    expect(db.from).toHaveBeenCalledTimes(1)
    expect(db.from).toHaveBeenCalledWith('organization_users')
  })

  it('fails closed regardless of membership order or mixed viewer/owner membership', async () => {
    for (const rows of [[b, a], [{ ...a, role: 'VIEWER' }, b]]) {
      const db = setup({ memberships: rows })
      const html = renderToStaticMarkup(createElement('div', null, await BillingSettingsPage()))
      expect(html).toContain('Multiple businesses detected')
      expect(db.from).toHaveBeenCalledTimes(1)
      vi.clearAllMocks()
    }
  })

  it('keeps a single viewer restricted before any billing table query', async () => {
    const db = setup({ memberships: [{ ...a, role: 'VIEWER' }] })
    const html = renderToStaticMarkup(createElement('div', null, await BillingSettingsPage()))
    expect(html).toContain('Owner or administrator access required')
    expect(db.from).toHaveBeenCalledTimes(1)
  })

  it('fails closed on membership read errors and malformed organization IDs', async () => {
    for (const invalid of [
      { memberships: [a], membershipError: true },
      { memberships: [{ ...a, organization_id: 'invalid' }] },
    ]) {
      const db = setup(invalid)
      const html = renderToStaticMarkup(createElement('div', null, await BillingSettingsPage()))
      expect(html).toMatch(/Billing access could not be verified|Billing organization could not be verified/)
      expect(db.from).toHaveBeenCalledTimes(1)
      vi.clearAllMocks()
    }
  })

  it('preserves single OWNER billing overview with org-scoped reads and no paid claim', async () => {
    const db = setup({ memberships: [a] })
    const html = renderToStaticMarkup(createElement('div', null, await BillingSettingsPage()))
    expect(html).toContain('Billing &amp; subscription')
    expect(html).toContain('Synthetic Plumbing')
    expect(html).toContain('30 Free Review Requests')
    expect(html).toContain('Plan selection is not available yet')
    expect(html).not.toContain('TEST plan preview')
    expect(db.from.mock.calls.map(call => call[0])).toEqual([
      'organization_users', 'organization_billing_accounts',
      'organization_subscriptions',
    ])
  })

  it('redirects unauthenticated users before reading any memberships', async () => {
    const db = setup({ memberships: [a], authenticated: false })
    await expect(BillingSettingsPage()).rejects.toThrow('TEST_REDIRECT:/login')
    expect(db.from).not.toHaveBeenCalled()
  })

  it('rejects Supabase anonymous-authenticated sessions before membership or billing reads', async () => {
    const db = setup({ memberships: [a], anonymous: true })
    await expect(BillingSettingsPage()).rejects.toThrow('TEST_REDIRECT:/login')
    expect(db.from).not.toHaveBeenCalled()
  })

  it('never enables local TEST actions when the subscription read returns null without an error', async () => {
    process.env.ENABLE_MR5D_BILLING_UI_PREVIEW = 'true'
    vi.mocked(isLocalTestBillingActionEndpointEnabled).mockReturnValue(true)
    vi.mocked(getConfiguredReputationBillingCatalog).mockReturnValue({
      monthly: { id: 'monthly', amountMinor: 150000, interval: 'month', currency: 'PHP' },
      annual: { id: 'annual', amountMinor: 100000, interval: 'year', currency: 'PHP' },
    } as never)
    const db = setup({ memberships: [a], subscriptionData: null })
    const html = renderToStaticMarkup(createElement('div', null, await BillingSettingsPage()))
    expect(html).toContain('Billing status unavailable')
    expect(html).toContain('TEST billing actions blocked')
    expect(html).not.toContain('TEST billing actions enabled')
    expect(db.from).toHaveBeenCalledTimes(3)
  })

  it('does not enable local TEST actions when account lookup returns undefined', async () => {
    process.env.ENABLE_MR5D_BILLING_UI_PREVIEW = 'true'
    vi.mocked(isLocalTestBillingActionEndpointEnabled).mockReturnValue(true)
    vi.mocked(getConfiguredReputationBillingCatalog).mockReturnValue({
      monthly: { id: 'monthly', amountMinor: 150000, interval: 'month', currency: 'PHP' },
      annual: { id: 'annual', amountMinor: 100000, interval: 'year', currency: 'PHP' },
    } as never)
    const db = setup({ memberships: [a], accountUndefined: true })
    const html = renderToStaticMarkup(createElement('div', null, await BillingSettingsPage()))
    expect(html).toContain('Billing status unavailable')
    expect(html).toContain('TEST billing actions blocked')
    expect(html).not.toContain('TEST billing actions enabled')
    expect(db.from).toHaveBeenCalledTimes(3)
  })

  it('redirects only genuinely empty membership lists to onboarding', async () => {
    const db = setup({ memberships: [] })
    await expect(BillingSettingsPage()).rejects.toThrow('TEST_REDIRECT:/onboarding')
    expect(db.from).toHaveBeenCalledTimes(1)
  })
})
