import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/lib/support/billing-recovery', () => ({
  getSupportBillingRecoveryCases: vi.fn(),
  isLocalBillingRecoverySupportViewEnabled: vi.fn(() => true),
}))
vi.mock('@/lib/support/subscription-exceptions', () => ({
  getSupportSubscriptionExceptionCases: vi.fn(),
  isLocalSubscriptionExceptionSupportViewEnabled: vi.fn(() => true),
}))

import { headers } from 'next/headers'
import { getSupportBillingRecoveryCases } from '../../src/lib/support/billing-recovery'
import { getSupportSubscriptionExceptionCases } from '../../src/lib/support/subscription-exceptions'
import SupportBillingRecoveryPage from '../../src/app/admin/organizations/[organizationId]/billing-recovery/page'
import SupportSubscriptionExceptionsPage from '../../src/app/admin/organizations/[organizationId]/subscription-exceptions/page'

const org = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const requestId = '33333333-3333-4333-8333-333333333333'
const subscriptionId = '44444444-4444-4444-8444-444444444444'

type HeaderFixture = Record<string, string>
function requestHeaders(values: HeaderFixture = {}) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  )
  vi.mocked(headers).mockResolvedValue({
    has: (name: string) => normalized[name.toLowerCase()] !== undefined,
    get: (name: string) => normalized[name.toLowerCase()] ?? null,
  } as never)
}

async function recovery(target = org) {
  return renderToStaticMarkup(createElement('main', null,
    await SupportBillingRecoveryPage({params: Promise.resolve({organizationId: target})})))
}
async function exceptions(target = org) {
  return renderToStaticMarkup(createElement('main', null,
    await SupportSubscriptionExceptionsPage({params: Promise.resolve({organizationId: target})})))
}

const recoveryCase = {
  id: requestId, kind: 'CHECKOUT' as const,
  reason: 'EXPIRED_CHECKOUT_SESSION' as const,
  state: 'OPEN' as const, requestedAt: '2026-10-20T00:00:00.000Z',
}
const exceptionCase = {
  id: requestId,
  subscriptionRecordId: subscriptionId,
  reason: 'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW' as const,
  openedAt: '2026-10-20T00:00:00.000Z',
}

describe('MR-5 integrated MPG-admin TEST review page response boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    requestHeaders()
    vi.mocked(getSupportBillingRecoveryCases).mockResolvedValue({
      status: 'AVAILABLE', cases: [recoveryCase],
      truncated: false, snapshotAt: '2026-10-20T00:01:00.000Z',
    })
    vi.mocked(getSupportSubscriptionExceptionCases).mockResolvedValue({
      status: 'AVAILABLE', cases: [exceptionCase],
      truncated: false, snapshotAt: '2026-10-20T00:01:00.000Z',
    })
  })
  afterEach(() => vi.clearAllMocks())

  it.each([
    ['router-prefetch', {'next-router-prefetch': '1'}],
    ['segment-prefetch', {'next-router-segment-prefetch': '1'}],
    ['purpose-prefetch', {purpose: 'prefetch'}],
    ['sec-purpose-prefetch', {'sec-purpose': 'prefetch'}],
  ])('does not inspect or audit support cases for %s', async (_name, values) => {
    requestHeaders(values)
    expect(await recovery()).toContain('Open this page directly')
    expect(await exceptions()).toContain('Open this page directly')
    expect(getSupportBillingRecoveryCases).not.toHaveBeenCalled()
    expect(getSupportSubscriptionExceptionCases).not.toHaveBeenCalled()
  })

  it.each(['DISABLED','DENIED','UNAVAILABLE'] as const)(
    'never renders support case identifiers when %s', async (status) => {
      vi.mocked(getSupportBillingRecoveryCases).mockResolvedValue({status})
      vi.mocked(getSupportSubscriptionExceptionCases).mockResolvedValue({status})
      const r = await recovery()
      const e = await exceptions()
      for(const markup of [r,e]) {
        expect(markup).toMatch(/Snapshot unavailable|Access unavailable/)
        expect(markup).not.toContain(requestId)
        expect(markup).not.toContain(subscriptionId)
        expect(markup).not.toContain('Open TEST billing review requests')
      }
      expect(getSupportBillingRecoveryCases).toHaveBeenCalledWith(org)
      expect(getSupportSubscriptionExceptionCases).toHaveBeenCalledWith(org)
    }
  )

  it('displays an audited read-only recovery case without implying payment success', async () => {
    const markup = await recovery()
    expect(markup).toContain('Billing recovery reviews')
    expect(markup).toContain(requestId)
    expect(markup).toContain('EXPIRED CHECKOUT SESSION')
    expect(markup).toContain('Investigation only')
    expect(markup).toContain('not payment confirmation')
    expect(markup).not.toContain('Pay now')
    expect(markup).not.toContain('Approve payment')
    expect(markup).not.toContain('Customer email')
    expect(markup).toContain('aria-current="page"')
    expect(getSupportBillingRecoveryCases).toHaveBeenCalledTimes(1)
    expect(getSupportSubscriptionExceptionCases).not.toHaveBeenCalled()
  })

  it('displays an audited synthetic exception, never provider payment evidence', async () => {
    const markup = await exceptions()
    expect(markup).toContain('Subscription exception reviews')
    expect(markup).toContain(requestId)
    expect(markup).toContain(subscriptionId)
    expect(markup).toContain('PAYMENT RECOVERY NEEDS PROVIDER REVIEW')
    expect(markup).toContain('synthetic and unverified')
    expect(markup).not.toContain('Approve payment')
    expect(markup).not.toContain('Pay now')
    expect(getSupportSubscriptionExceptionCases).toHaveBeenCalledTimes(1)
    expect(getSupportBillingRecoveryCases).not.toHaveBeenCalled()
  })

  it('shows truncation truthfully but never makes extra read requests from the UI', async () => {
    vi.mocked(getSupportBillingRecoveryCases).mockResolvedValue({
      status: 'AVAILABLE', cases: [recoveryCase], truncated: true,
      snapshotAt: '2026-10-20T00:01:00.000Z',
    })
    vi.mocked(getSupportSubscriptionExceptionCases).mockResolvedValue({
      status: 'AVAILABLE', cases: [exceptionCase], truncated: true,
      snapshotAt: '2026-10-20T00:01:00.000Z',
    })
    expect(await recovery()).toContain('Only the first 20 cases are displayed')
    expect(await exceptions()).toContain('Only the first 20 cases are displayed')
    expect(getSupportBillingRecoveryCases).toHaveBeenCalledTimes(1)
    expect(getSupportSubscriptionExceptionCases).toHaveBeenCalledTimes(1)
  })

  it('keeps review routes tied to the explicit target, not arbitrary selected client org', async () => {
    await recovery(other)
    await exceptions(other)
    expect(getSupportBillingRecoveryCases).toHaveBeenCalledWith(other)
    expect(getSupportSubscriptionExceptionCases).toHaveBeenCalledWith(other)
    expect(getSupportBillingRecoveryCases).not.toHaveBeenCalledWith(org)
    expect(getSupportSubscriptionExceptionCases).not.toHaveBeenCalledWith(org)
  })

  it('renders empty audited result as genuinely empty, never a failed payment', async () => {
    vi.mocked(getSupportBillingRecoveryCases).mockResolvedValue({
      status: 'AVAILABLE', cases: [], truncated: false,
      snapshotAt: '2026-10-20T00:01:00.000Z',
    })
    vi.mocked(getSupportSubscriptionExceptionCases).mockResolvedValue({
      status: 'AVAILABLE', cases: [], truncated: false,
      snapshotAt: '2026-10-20T00:01:00.000Z',
    })
    expect(await recovery()).toContain('No open TEST billing recovery review requests')
    expect(await exceptions()).toContain('No open synthetic subscription exception cases')
  })
})
