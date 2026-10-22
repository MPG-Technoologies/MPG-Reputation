import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return { default: ({ children, href }: { children: unknown; href: string }) =>
    createElement('a', { href }, children as string) }
})

import { SubscriptionOptions } from '../../src/components/billing/subscription-options'

describe('MR-5I26A upgrade cards are discovery-only with no payment authorization', () => {
  it.each(['usage', 'billing'] as const)('renders exactly three plans in %s context', location => {
    const html = renderToStaticMarkup(createElement(SubscriptionOptions, { location }))
    for (const name of ['Monthly', 'Yearly', 'Premium']) {
      expect(html).toContain(name)
    }
    for (const slug of ['monthly', 'yearly', 'premium']) {
      expect(html).toContain(`data-subscription-option="${slug}"`)
    }
    expect(html).toContain('Price and included usage: not published')
    expect(html).toContain('No pricing, subscription, payment, or extra review')
    expect(html).not.toMatch(/₱[\d,.]+/)
    expect(html).not.toMatch(/Subscribe now|Pay now|Start checkout/)
  })
  it('routes customer discovery to billing and never initiates checkout', () => {
    const html = renderToStaticMarkup(createElement(SubscriptionOptions, { location: 'usage' }))
    expect((html.match(/href="\/app\/settings\/billing#subscription-options"/g) ?? [])).toHaveLength(3)
    expect(html).not.toContain('checkout.stripe.com')
    expect(html).not.toContain('<form')
  })
  it('disables billing checkout for every plan, including unconfigured Premium', () => {
    const html = renderToStaticMarkup(createElement(SubscriptionOptions, { location: 'billing' }))
    expect((html.match(/disabled=""/g) ?? [])).toHaveLength(3)
    expect(html).toContain('Premium checkout not available yet')
    expect(html).not.toContain('href="/app/settings/billing#subscription-options"')
  })
  it('keeps shared card placement and leaves the original provider gates intact', () => {
    const usage = readFileSync(resolve(__dirname, '../../src/app/app/settings/usage/client.tsx'),'utf8')
    const billing = readFileSync(resolve(__dirname, '../../src/app/app/settings/billing/page.tsx'),'utf8')
    expect(usage).toContain('<SubscriptionOptions location="usage" />')
    expect(billing).toContain('<SubscriptionOptions location="billing" />')
    expect(billing).toContain("process.env.NODE_ENV !== 'production'")
    expect(billing).toContain("isLocalTestBillingActionEndpointEnabled()")
  })
})
