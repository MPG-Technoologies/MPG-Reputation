import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: (href: string) => { throw new Error('TEST_REDIRECT:' + href) },
}))
vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ href, children, ...props }: {
      href: string; children: unknown; className?: string
    }) => createElement('a', { href, ...props }, children as string),
  }
})
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { CheckoutReturnScreen } from '../../src/app/billing/checkout/return-screen'
import { createClient } from '../../src/lib/supabase/server'

function session({
  authenticated = true, anonymous = false, failure = false,
}: {authenticated?: boolean; anonymous?: boolean; failure?: boolean} = {}) {
  const getUser = vi.fn(async () => ({
    data: { user: authenticated ? { id: '00000000-0000-4000-8000-000000000001',
      is_anonymous: anonymous } : null },
    error: failure ? { message: 'Synthetic invalid session' } : null,
  }))
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser } } as never)
  return getUser
}
async function html(kind: 'success' | 'cancel') {
  return renderToStaticMarkup(createElement('div', null, await CheckoutReturnScreen({kind})))
}

describe('MR-5I24 TEST checkout return safe multi-business navigation', () => {
  beforeEach(() => { session() })
  afterEach(() => { vi.resetAllMocks() })

  it.each(['success','cancel'] as const)(
    '%s checkout return links only to authenticated chooser, never an arbitrary legacy organization',
    async kind => {
      const markup = await html(kind)
      expect(markup).toContain('MPG Reputation')
      expect(markup).toContain('30 Free Review Requests')
      expect(markup).toContain('Choose business to view billing')
      expect(markup).toContain('href="/workspace/organizations"')
      expect(markup).not.toContain('href="/app/settings/billing"')
      expect(markup).not.toContain('/workspace/organizations/00000000-')
      expect(markup).not.toMatch(/(?:checkout|billing)\.stripe\.com/)
      expect(markup).not.toContain('Payment confirmed')
      expect(markup).not.toContain('Paid subscription activated')
      expect(markup).toContain('never confirms a payment')
    },
  )

  it('success is explicitly pending verification; cancellation makes no successful payment claim', async () => {
    const success = await html('success')
    expect(success).toContain('verification pending')
    expect(success).toContain('does not confirm payment')
    const cancelled = await html('cancel')
    expect(cancelled).toContain('Checkout not completed')
    expect(cancelled).toContain('No subscription or paid access is confirmed')
  })

  it.each([
    {authenticated: false}, {authenticated: true, anonymous: true},
    {authenticated: true, failure: true},
  ])('denies missing, anonymous and failed sessions before any return content', async options => {
    const getUser = session(options)
    await expect(CheckoutReturnScreen({kind: 'success'}))
      .rejects.toThrow('TEST_REDIRECT:/login')
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it('the screen never reads provider status, session query values or privileged records', async () => {
    const getUser = session()
    const markup = await html('success')
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(markup).not.toContain('session_id')
    expect(markup).toContain('Choose business to view billing')
  })
})
