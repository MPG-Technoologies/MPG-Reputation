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
vi.mock('@/components/workspace/scoped-business-nav', () => ({
  ScopedBusinessNav: () => createElement('nav', null, 'Scoped organization navigation'),
}))
vi.mock('@/lib/workspace/server-active-organization', () => ({
  resolveCurrentServerOrganization: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import ScopedBillingPage from '../../src/app/workspace/organizations/[organizationId]/billing/page'
import { createClient } from '../../src/lib/supabase/server'
import { resolveCurrentServerOrganization } from '../../src/lib/workspace/server-active-organization'

const organizationId = '11111111-1111-4111-8111-111111111111'
const organization = {
  organizationId, organizationName: 'Synthetic Clinic', role: 'OWNER',
}
const verified = {
  billing_account_id: 'account-a', normalized_status: 'ACTIVE',
  current_period_end: '2026-11-20T08:00:00+08:00',
  cancel_at_period_end: false, environment: 'TEST',
}

function setup(role: string, subscription: unknown = verified) {
  vi.mocked(resolveCurrentServerOrganization).mockResolvedValue({
    outcome: 'SELECTED', organization: { ...organization, role },
  } as never)
  const from = vi.fn((name: string) => {
    if (name === 'organization_billing_accounts') {
      const query = {
        eq: () => query,
        maybeSingle: async () => ({ data: { id: 'account-a' }, error: null }),
      }
      return { select: () => query }
    }
    if (name === 'organization_subscriptions') {
      const query = {
        eq: () => query, order: () => query,
        limit: async () => ({ data: [subscription], error: null }),
      }
      return { select: () => query }
    }
    throw new Error('Unexpected billing read: ' + name)
  })
  vi.mocked(createClient).mockResolvedValue({ from } as never)
  return from
}
async function render() {
  return renderToStaticMarkup(createElement('div', null, await ScopedBillingPage({
    params: Promise.resolve({ organizationId }),
  })))
}

describe('MR-5I23 scoped billing projection render fail-closed controls', () => {
  afterEach(() => vi.resetAllMocks())

  it('shows a real TEST projection without claiming settled payment', async () => {
    const from = setup('OWNER')
    const markup = await render()
    expect(markup).toContain('Provider reports active (TEST)')
    expect(markup).toContain('Recorded period end: 2026-11-20 UTC')
    expect(markup).toContain('does not prove invoice settlement')
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('does not throw or show active/payment state for unknown or malformed projection rows', async () => {
    for (const row of [
      { ...verified, normalized_status: 'PAID' },
      { ...verified, current_period_end: 'not-a-date' },
      { ...verified, current_period_end: '2026-11-20T08:00:00' },
      { ...verified, cancel_at_period_end: null },
    ]) {
      const from = setup('ADMIN', row)
      const markup = await render()
      expect(markup).toContain('Billing status unavailable')
      expect(markup).toContain('TEST billing account could not be verified')
      expect(markup).not.toContain('Provider reports active')
      expect(markup).not.toContain('Recorded period end:')
      expect(from).toHaveBeenCalledTimes(2)
      vi.clearAllMocks()
    }
  })

  it('does not read billing rows for non-admin roles or an unverified organization', async () => {
    for (const role of ['VIEWER', 'OPERATOR']) {
      const from = setup(role)
      const markup = await render()
      expect(markup).toContain('Owner or administrator access required')
      expect(from).not.toHaveBeenCalled()
      vi.clearAllMocks()
    }
    vi.mocked(resolveCurrentServerOrganization).mockResolvedValue({ outcome: 'UNAVAILABLE' } as never)
    const from = vi.fn()
    vi.mocked(createClient).mockResolvedValue({ from } as never)
    expect(await render()).toContain('Business access could not be verified')
    expect(from).not.toHaveBeenCalled()
  })

  it('redirects unauthenticated sessions without loading billing records', async () => {
    vi.mocked(resolveCurrentServerOrganization).mockResolvedValue({ outcome: 'AUTH_REQUIRED' })
    const from = vi.fn()
    vi.mocked(createClient).mockResolvedValue({ from } as never)
    await expect(ScopedBillingPage({params: Promise.resolve({organizationId})}))
      .rejects.toThrow('TEST_REDIRECT:/login')
    expect(from).not.toHaveBeenCalled()
  })
})
