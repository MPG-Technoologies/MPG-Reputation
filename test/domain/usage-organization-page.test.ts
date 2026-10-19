import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error('TEST_REDIRECT:' + path) },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/actions/usage', () => ({ getOrganizationUsageSummary: vi.fn() }))
vi.mock('@/components/layout/page-shell', async () => {
  const { createElement } = await import('react')
  return {
    PageShell: ({ children }: { children: unknown }) =>
      createElement('main', null, children as string),
    PageHeader: ({ title, subtitle }: { title: unknown, subtitle?: string }) =>
      createElement('header', null, title as string, subtitle),
  }
})
vi.mock('@/components/ui/icons', async () => {
  const { createElement } = await import('react')
  return { ChartBarIcon: () => createElement('span', { role: 'img' }, 'chart') }
})
vi.mock('../../src/app/app/settings/usage/client', async () => {
  const { createElement } = await import('react')
  return { UsageClient: (props: { organizationId: string, userRole: string }) =>
    createElement('div', { 'data-test': 'usage-client' },
      props.organizationId + ':' + props.userRole) }
})

import UsageSettingsPage from '../../src/app/app/settings/usage/page'
import { createClient } from '../../src/lib/supabase/server'
import { getOrganizationUsageSummary } from '../../src/actions/usage'

const a = { organization_id: '11111111-1111-4111-8111-111111111111', role: 'OWNER' }
const b = { organization_id: '22222222-2222-4222-8222-222222222222', role: 'VIEWER' }

function setup({
  rows = [a] as unknown,
  error = false,
  authenticated = true,
  anonymous = false,
  usageResponse,
}: {
  rows?: unknown
  error?: boolean
  authenticated?: boolean
  anonymous?: boolean
  usageResponse?: unknown
} = {}) {
  const from = vi.fn((table: string) => {
    if (table !== 'organization_users') {
      throw new Error('UNEXPECTED_USAGE_PAGE_TABLE:' + table)
    }
    return {
      select: () => ({ eq: async () => ({
        data: rows,
        error: error ? { message: 'synthetic membership read outage' } : null,
      }) }),
    }
  })
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({
      data: { user: authenticated ? {
        id: '33333333-3333-4333-8333-333333333333', is_anonymous: anonymous,
      } : null },
      error: null,
    })) },
    from,
  } as never)
  vi.mocked(getOrganizationUsageSummary).mockResolvedValue(
    (usageResponse ?? {
      success: true, data: { organizationId: a.organization_id },
    }) as never,
  )
  return { from }
}
async function html() {
  return renderToStaticMarkup(createElement('div', null, await UsageSettingsPage()))
}

describe('MR-5I4J actual server-rendered Usage & Trial page', () => {
  afterEach(() => vi.clearAllMocks())

  it('blocks both multi-org orderings without fetching any usage', async () => {
    for (const rows of [[a,b],[b,a],[a,a]]) {
      const db = setup({rows})
      const markup = await html()
      expect(markup).toContain('Multiple businesses detected')
      expect(markup).not.toContain(a.organization_id)
      expect(markup).not.toContain(b.organization_id)
      expect(markup).not.toContain('data-test="usage-client"')
      expect(vi.mocked(getOrganizationUsageSummary)).not.toHaveBeenCalled()
      expect(db.from).toHaveBeenCalledTimes(1)
      vi.clearAllMocks()
    }
  })
  it('blocks a broken membership read before any trial/usage query', async () => {
    setup({rows:[a],error:true})
    expect(await html()).toContain('Usage organization could not be verified')
    expect(getOrganizationUsageSummary).not.toHaveBeenCalled()
  })
  it('blocks unknown or malformed membership rows', async () => {
    for (const row of [ { ...a, role:'UNKNOWN' }, { ...a, organization_id:'invalid' } ]) {
      setup({rows:[row]})
      expect(await html()).toContain('Usage organization could not be verified')
      expect(getOrganizationUsageSummary).not.toHaveBeenCalled()
      vi.clearAllMocks()
    }
  })
  it('keeps an empty membership distinct from an unavailable result', async () => {
    setup({rows:[]})
    expect(await html()).toContain('No business membership found')
    expect(getOrganizationUsageSummary).not.toHaveBeenCalled()
    vi.clearAllMocks()
    setup({rows:null})
    expect(await html()).toContain('Usage organization could not be verified')
    expect(getOrganizationUsageSummary).not.toHaveBeenCalled()
  })
  it('permits single OWNER, ADMIN, OPERATOR and VIEWER usage only for own org', async () => {
    for (const role of ['OWNER','ADMIN','OPERATOR','VIEWER'] as const) {
      setup({rows:[{...a,role}]})
      const markup = await html()
      expect(markup).toContain('Usage &amp; Trial')
      expect(markup).toContain(a.organization_id + ':' + role)
      expect(getOrganizationUsageSummary).toHaveBeenCalledWith(a.organization_id)
      vi.clearAllMocks()
    }
  })
  it('refuses to render usage actions on summary failure or cross-tenant response', async () => {
    for (const usageResponse of [
      {success:false,error:'synthetic connection lost'},
      {success:true,data:{organizationId:b.organization_id}},
      {success:true,data:null},
    ]) {
      setup({rows:[a],usageResponse})
      const markup=await html()
      expect(markup).toContain('Usage details could not be verified')
      expect(markup).not.toContain('data-test="usage-client"')
      vi.clearAllMocks()
    }
  })
  it('redirects unauthenticated and anonymous sessions before any memberships', async () => {
    for (const opts of [{authenticated:false},{anonymous:true}]) {
      const db=setup(opts)
      await expect(UsageSettingsPage()).rejects.toThrow('TEST_REDIRECT:/login')
      expect(db.from).not.toHaveBeenCalled()
      vi.clearAllMocks()
    }
  })
})
