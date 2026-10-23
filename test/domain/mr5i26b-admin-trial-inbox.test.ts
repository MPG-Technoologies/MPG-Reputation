import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/support/access', () => ({ authorizeSupportAccess: vi.fn() }))
vi.mock('@/lib/support/audit', () => ({ recordSupportTrialRequestInspection: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { authorizeSupportAccess } from '../../src/lib/support/access'
import { recordSupportTrialRequestInspection } from '../../src/lib/support/audit'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  getSupportTrialExtensionRequests,
  isLocalTrialRequestSupportViewEnabled,
} from '../../src/lib/support/trial-extension-requests'

const org = '11111111-1111-4111-8111-111111111111'
const actor = '22222222-2222-4222-8222-222222222222'
const requestId = '33333333-3333-4333-8333-333333333333'
const requester = '44444444-4444-4444-8444-444444444444'
const reason = 'Please review our need for additional evaluation time this month.'
const vars = [
  'ENABLE_LOCAL_TRIAL_REQUEST_SUPPORT_VIEW',
  'MPG_TRIAL_REQUEST_SUPPORT_TARGET', 'NEXT_PUBLIC_SUPABASE_URL',
  'ENABLE_LIVE_BILLING', 'ENABLE_LIVE_EMAIL', 'VERCEL_ENV', 'NODE_ENV',
]
const original = Object.fromEntries(vars.map(name => [name, process.env[name]]))

function enable() {
  process.env.ENABLE_LOCAL_TRIAL_REQUEST_SUPPORT_VIEW = 'true'
  process.env.MPG_TRIAL_REQUEST_SUPPORT_TARGET = 'LOCAL_SYNTHETIC'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54331'
  process.env.ENABLE_LIVE_BILLING = 'false'
  process.env.ENABLE_LIVE_EMAIL = 'false'
  delete process.env.VERCEL_ENV
}

function data(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId, organization_id: org, requested_by: requester,
    status: 'OPEN', reason, requested_at: '2026-10-22T12:00:00.000Z',
    ...overrides,
  }
}

function setup({
  rows = [data()],
  organization = { id: org, name: 'Synthetic Business', status: 'ACTIVE' },
  trial = {
    organization_id: org, status: 'EXHAUSTED', allocated_requests: 30,
    consumed_requests: 30, duration_days: 30, expires_at: null,
  },
  error = false,
}: {
  rows?: Record<string, unknown>[]
  organization?: Record<string, unknown> | null
  trial?: Record<string, unknown> | null
  error?: boolean
} = {}) {
  const granted = { organizationId: org, actorId: actor, supabase: {} }
  vi.mocked(authorizeSupportAccess).mockResolvedValue(granted as never)
  vi.mocked(recordSupportTrialRequestInspection).mockResolvedValue(true)

  const requestQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => ({
      data: rows, error: error ? { code: 'DB_READ_FAILED' } : null,
    })),
  }
  const organizationQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: organization, error: null })),
  }
  const trialQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: trial, error: null })),
  }
  const from = vi.fn((table: string) => {
    if (table === 'trial_extension_requests') return requestQuery
    if (table === 'organizations') return organizationQuery
    if (table === 'organization_entitlements') return trialQuery
    throw new Error('Unexpected privileged table: ' + table)
  })
  vi.mocked(createAdminClient).mockReturnValue({ from } as never)
  return { granted, requestQuery, organizationQuery, trialQuery, from }
}

describe('MR-5I26B local MPG trial inbox trust boundary', () => {
  beforeEach(() => { vi.resetAllMocks(); enable() })
  afterEach(() => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('disables on hosted, production, live provider, deployed or missing flag', () => {
    for (const patch of [
      { ENABLE_LOCAL_TRIAL_REQUEST_SUPPORT_VIEW: 'false' },
      { MPG_TRIAL_REQUEST_SUPPORT_TARGET: 'HOSTED_TEST' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://hosted.supabase.co' },
      { ENABLE_LIVE_BILLING: 'true' },
      { ENABLE_LIVE_EMAIL: 'true' },
      { VERCEL_ENV: 'preview' },
      { NODE_ENV: 'production' },
    ]) {
      enable()
      Object.assign(process.env, patch)
      expect(isLocalTrialRequestSupportViewEnabled()).toBe(false)
    }
  })

  it('has no database access or audit when disabled', async () => {
    process.env.ENABLE_LOCAL_TRIAL_REQUEST_SUPPORT_VIEW = 'false'
    expect(await getSupportTrialExtensionRequests(org)).toEqual({ status: 'DISABLED' })
    expect(authorizeSupportAccess).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(recordSupportTrialRequestInspection).not.toHaveBeenCalled()
  })

  it('rejects malformed and ungranted organization before privileged reads', async () => {
    expect(await getSupportTrialExtensionRequests('invalid')).toEqual({ status: 'DENIED' })
    vi.mocked(authorizeSupportAccess).mockResolvedValue(null)
    expect(await getSupportTrialExtensionRequests(org)).toEqual({ status: 'DENIED' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('reads only one organization, rechecks actor, and audits before returning', async () => {
    const q = setup({ rows: [data({ secret_extra_field: 'do-not-return@example.test' })] })
    const result = await getSupportTrialExtensionRequests(org)
    expect(result.status).toBe('AVAILABLE')
    if (result.status !== 'AVAILABLE') return
    expect(result.context).toEqual({
      businessName: 'Synthetic Business', businessStatus: 'ACTIVE',
      trialStatus: 'EXHAUSTED', allocated: 30, consumed: 30, durationDays: 30,
      expiresAt: null,
    })
    expect(result.requests).toEqual([
      { id: requestId, status: 'OPEN', reason, requestedAt: '2026-10-22T12:00:00.000Z' },
    ])
    expect(JSON.stringify(result)).not.toContain('do-not-return@example.test')
    expect(JSON.stringify(result)).not.toContain(requester)
    expect(q.requestQuery.eq).toHaveBeenCalledWith('organization_id', org)
    expect(q.requestQuery.eq).toHaveBeenCalledWith('status', 'OPEN')
    expect(q.requestQuery.limit).toHaveBeenCalledWith(21)
    expect(q.organizationQuery.eq).toHaveBeenCalledWith('id', org)
    expect(q.trialQuery.eq).toHaveBeenCalledWith('organization_id', org)
    expect(authorizeSupportAccess).toHaveBeenCalledTimes(2)
    expect(recordSupportTrialRequestInspection).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: actor, organizationId: org }), 'AVAILABLE'
    )
    expect(q.from.mock.calls.map(x => x[0])).toEqual([
      'trial_extension_requests', 'organizations', 'organization_entitlements',
    ])
  })

  it('never releases a snapshot when support grant is revoked during read', async () => {
    setup()
    vi.mocked(authorizeSupportAccess).mockResolvedValueOnce({
      actorId: actor, organizationId: org, supabase: {},
    } as never).mockResolvedValueOnce(null)
    expect(await getSupportTrialExtensionRequests(org)).toEqual({ status: 'DENIED' })
    expect(recordSupportTrialRequestInspection).not.toHaveBeenCalled()
  })

  it('fails closed when an audit insert fails', async () => {
    setup()
    vi.mocked(recordSupportTrialRequestInspection).mockResolvedValue(false)
    expect(await getSupportTrialExtensionRequests(org)).toEqual({ status: 'UNAVAILABLE' })
  })

  it('returns unavailable and audited failure on unreadable or foreign data', async () => {
    for (const fixtures of [
      { error: true },
      { rows: [data({ organization_id: '99999999-9999-4999-8999-999999999999' })] },
      { rows: [data({ status: 'APPROVED' })] },
      { rows: [data({ reason: 'short' })] },
      { trial: null },
      { organization: null },
      { trial: { organization_id: '99999999-9999-4999-8999-999999999999' } },
    ]) {
      setup(fixtures as never)
      expect(await getSupportTrialExtensionRequests(org)).toEqual({ status: 'UNAVAILABLE' })
      expect(recordSupportTrialRequestInspection).toHaveBeenCalledWith(
        expect.anything(), 'UNAVAILABLE'
      )
    }
  })

  it('returns a bounded twenty rows and marks truncation', async () => {
    setup({
      rows: Array.from({ length: 21 }, (_, n) => data({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(n).padStart(12, '0'),
      })),
    })
    const result = await getSupportTrialExtensionRequests(org)
    expect(result.status).toBe('AVAILABLE')
    if (result.status === 'AVAILABLE') {
      expect(result.requests).toHaveLength(20)
      expect(result.truncated).toBe(true)
    }
  })
})
