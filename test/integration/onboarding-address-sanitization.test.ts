import { describe, it, expect, vi, beforeEach } from 'vitest'

const revalidatePathMock = vi.fn()
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`)
})

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

let lastRpcCall: { fnName: string; params: Record<string, unknown> } | null = null
let lastAuditInsert: { table: string; record: Record<string, unknown> } | null = null

const mockSupabase = {
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: { id: 'user_onboarding_123', email: 'owner@example.test' } },
      error: null,
    })),
  },
  rpc: vi.fn(async (fnName: string, params: Record<string, unknown>) => {
    lastRpcCall = { fnName, params }
    if (fnName === 'create_org_with_owner_and_location') {
      return { data: { organization_id: 'org_test_123', location_id: 'loc_test_456' }, error: null }
    }
    return { data: null, error: new Error('Unknown RPC') }
  }),
}

const mockAdminClient = {
  from: vi.fn((table: string) => ({
    insert: vi.fn(async (record: Record<string, unknown>) => {
      lastAuditInsert = { table, record }
      return { error: null }
    }),
  })),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}))

import { createOrganizationAndLocation } from '@/actions/onboarding'

describe('Onboarding Address Sanitization & Invariants (MR-7B.2 Correction 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastRpcCall = null
    lastAuditInsert = null
  })

  it('1. onboarding address containing CR, LF, tabs, and control characters is sanitized before persistence/RPC input', async () => {
    const formData = new FormData()
    formData.append('orgName', 'Northstar Health')
    formData.append('locName', 'Main Hospital')
    formData.append('address', '  123 Medical Center Way\r\n\tSuite 400\0\x1f Denver, CO 80202  ')

    await expect(createOrganizationAndLocation(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/app/settings/review-destination'
    )

    expect(lastRpcCall).not.toBeNull()
    expect(lastRpcCall?.fnName).toBe('create_org_with_owner_and_location')
    expect(lastRpcCall?.params.p_address).toBe('123 Medical Center Way Suite 400 Denver, CO 80202')
    expect(lastRpcCall?.params.p_address).not.toContain('\r')
    expect(lastRpcCall?.params.p_address).not.toContain('\n')
    expect(lastRpcCall?.params.p_address).not.toContain('\t')
    expect(lastRpcCall?.params.p_address).not.toContain('\0')
    expect(lastRpcCall?.params.p_address).not.toContain('\x1f')
  })

  it('2. empty or whitespace-only address remains null in RPC input', async () => {
    const formData = new FormData()
    formData.append('orgName', 'Northstar Health')
    formData.append('locName', 'Main Hospital')
    formData.append('address', '   \r\n\t  ')

    await expect(createOrganizationAndLocation(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/app/settings/review-destination'
    )

    expect(lastRpcCall).not.toBeNull()
    expect(lastRpcCall?.params.p_address).toBeNull()
  })

  it('3. omitted address in FormData remains null in RPC input', async () => {
    const formData = new FormData()
    formData.append('orgName', 'Northstar Health')
    formData.append('locName', 'Main Hospital')

    await expect(createOrganizationAndLocation(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/app/settings/review-destination'
    )

    expect(lastRpcCall).not.toBeNull()
    expect(lastRpcCall?.params.p_address).toBeNull()
  })

  it('4. address length remains bounded to 300 characters without crashing', async () => {
    const veryLongAddress = 'A'.repeat(500)
    const formData = new FormData()
    formData.append('orgName', 'Northstar Health')
    formData.append('locName', 'Main Hospital')
    formData.append('address', veryLongAddress)

    await expect(createOrganizationAndLocation(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/app/settings/review-destination'
    )

    expect(lastRpcCall).not.toBeNull()
    const storedAddress = lastRpcCall?.params.p_address as string
    expect(storedAddress).toHaveLength(300)
  })

  it('5. audit metadata does not contain raw postal address', async () => {
    const formData = new FormData()
    formData.append('orgName', 'Northstar Health')
    formData.append('locName', 'Main Hospital')
    formData.append('address', '100 Valid Ave, Suite 100, Denver, CO 80202')

    await expect(createOrganizationAndLocation(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/app/settings/review-destination'
    )

    expect(lastAuditInsert).not.toBeNull()
    expect(lastAuditInsert?.table).toBe('audit_events')
    const metadata = lastAuditInsert?.record.metadata as Record<string, unknown>
    expect(metadata).not.toHaveProperty('address')
    expect(metadata).not.toHaveProperty('p_address')
    expect(metadata).toEqual({
      name: 'Northstar Health',
      slug: 'northstar-health',
      location_id: 'loc_test_456',
    })
  })
})
