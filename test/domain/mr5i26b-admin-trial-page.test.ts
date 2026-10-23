import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/lib/support/billing-recovery', () => ({
  isLocalBillingRecoverySupportViewEnabled: vi.fn(() => false),
}))
vi.mock('@/lib/support/subscription-exceptions', () => ({
  isLocalSubscriptionExceptionSupportViewEnabled: vi.fn(() => false),
}))
vi.mock('@/lib/support/trial-extension-requests', () => ({
  isLocalTrialRequestSupportViewEnabled: vi.fn(() => true),
  getSupportTrialExtensionRequests: vi.fn(),
}))

import { headers } from 'next/headers'
import { getSupportTrialExtensionRequests } from '../../src/lib/support/trial-extension-requests'
import SupportTrialRequestsPage from '../../src/app/admin/organizations/[organizationId]/trial-requests/page'

const org = '11111111-1111-4111-8111-111111111111'
const request = '33333333-3333-4333-8333-333333333333'
const reason = 'We need additional evaluation time to assess the review-request workflow.'

function requestHeaders(values: Record<string, string> = {}) {
  vi.mocked(headers).mockResolvedValue({
    has: (key: string) => key in values,
    get: (key: string) => values[key] ?? null,
  } as never)
}

async function html() {
  return renderToStaticMarkup(createElement('main', null,
    await SupportTrialRequestsPage({params: Promise.resolve({organizationId: org})})))
}

describe('MR-5I26B MPG admin trial request page (no payment / entitlement actions)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    requestHeaders()
    vi.mocked(getSupportTrialExtensionRequests).mockResolvedValue({
      status: 'AVAILABLE',
      requests: [{
        id: request, reason, status: 'OPEN',
        requestedAt: '2026-10-22T12:00:00.000Z',
      }],
      context: {
        businessName: 'Synthetic Business', businessStatus: 'ACTIVE',
        trialStatus: 'EXHAUSTED', allocated: 30, consumed: 30,
        durationDays: 30, expiresAt: null,
      },
      truncated: false,
      snapshotAt: '2026-10-22T12:03:00.000Z',
    })
  })

  it.each([
    ['next-router-prefetch', {'next-router-prefetch': '1'}],
    ['next-router-segment-prefetch', {'next-router-segment-prefetch': '1'}],
    ['purpose', {purpose: 'prefetch'}],
    ['sec-purpose', {'sec-purpose': 'prefetch'}],
  ])('does not inspect on %s', async (_kind, values) => {
    requestHeaders(values)
    expect(await html()).toContain('Open this page directly')
    expect(getSupportTrialExtensionRequests).not.toHaveBeenCalled()
  })

  it.each(['DISABLED', 'DENIED', 'UNAVAILABLE'] as const)(
    'never reveals a request when %s', async (status) => {
      vi.mocked(getSupportTrialExtensionRequests).mockResolvedValue({ status })
      const markup = await html()
      expect(markup).toMatch(/Snapshot unavailable|Access unavailable/)
      expect(markup).not.toContain(request)
      expect(markup).not.toContain(reason)
    }
  )

  it('shows only inspected business and usage facts, no approval controls', async () => {
    const markup = await html()
    expect(markup).toContain('Trial extension requests')
    expect(markup).toContain('Synthetic Business')
    expect(markup).toContain('30 / 30')
    expect(markup).toContain(request)
    expect(markup).toContain(reason)
    expect(markup).toContain('Review only')
    expect(markup).toContain('aria-current="page"')
    expect(markup).not.toContain('<form')
    expect(markup).not.toContain('Approve request')
    expect(markup).not.toContain('Change allowance')
    expect(markup).not.toContain('Pay now')
    expect(getSupportTrialExtensionRequests).toHaveBeenCalledTimes(1)
    expect(getSupportTrialExtensionRequests).toHaveBeenCalledWith(org)
  })

  it('renders empty state without claims of trial activation', async () => {
    vi.mocked(getSupportTrialExtensionRequests).mockResolvedValue({
      status: 'AVAILABLE', requests: [],
      context: { businessName: 'Test', businessStatus: 'ACTIVE',
        trialStatus: 'NOT_STARTED', allocated: 30, consumed: 0, durationDays: 30,
        expiresAt: null },
      truncated: false, snapshotAt: '2026-10-22T12:03:00.000Z',
    })
    const markup = await html()
    expect(markup).toContain('No pending trial-extension requests')
    expect(markup).not.toContain('Trial activated')
  })
})
