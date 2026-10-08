import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Mock dependencies for quick-complete action
const mockSend = vi.fn().mockResolvedValue({ ids: ['evt_1'] })

vi.mock('@/inngest/client', () => ({
  inngest: {
    send: (...args: unknown[]) => mockSend(...args),
  },
}))

let mockUser: { id: string; email: string } | null = { id: 'user_1', email: 'owner@test.local' }
let mockMembership: { role: string } | null = { role: 'OWNER' }
let mockLocation: { id: string; status: string } | null = { id: 'loc_1', status: 'ACTIVE' }

const mockSupabase = {
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: mockUser },
      error: null,
    })),
  },
  from: vi.fn((table: string) => {
    if (table === 'organization_users') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: mockMembership, error: null })),
      }
    }
    if (table === 'locations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: mockLocation, error: null })),
      }
    }
    if (table === 'review_destinations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({
          data: { location_id: 'loc_1', status: 'CONFIRMED', canonical_url: 'https://g.page/r/OutboxRecTest123/review' },
          error: null,
        })),
      }
    }
    if (table === 'domain_event_outbox') {
      return {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn(async () => ({ error: null })),
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn(async () => ({ error: null })),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    }
  }),
  rpc: vi.fn(async (fnName: string) => {
    if (fnName === 'submit_quick_complete_atomic') {
      return {
        data: {
          customer_id: 'cust_qc_123',
          completion_event_id: 'comp_qc_456',
          outbox_id: 'outbox_qc_789',
          source_event_id: 'source_qc_001',
        },
        error: null,
      }
    }
    if (fnName === 'submit_completion_system_atomic') {
      return {
        data: {
          duplicate: false,
          customer_id: 'cust_sys_123',
          completion_event_id: 'comp_sys_456',
          outbox_id: 'outbox_sys_789',
          source_event_id: 'source_sys_001',
        },
        error: null,
      }
    }
    return { data: null, error: null }
  }),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockSupabase),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { submitQuickComplete } from '@/actions/quick-complete'
import { PostgresCompletionApiStore } from '@/domain/completion/store'

describe('MR-7B.3: Messaging Payload Minimization Event Contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = { id: 'user_1', email: 'owner@test.local' }
    mockMembership = { role: 'OWNER' }
    mockLocation = { id: 'loc_1', status: 'ACTIVE' }
  })

  it('proves Quick Complete immediate Inngest send contains exactly the canonical five operational fields and no PII', async () => {
    const formData = new FormData()
    formData.append('organizationId', 'org_1')
    formData.append('locationId', 'loc_1')
    formData.append('firstName', 'Jane')
    formData.append('lastName', 'Doe')
    formData.append('email', 'jane.doe@example.test')
    formData.append('phone', '555-123-4567')
    formData.append('completedAt', new Date().toISOString())
    formData.append('permissionEmail', 'allowed')
    formData.append('sourceEventId', 'source_qc_001')

    const res = await submitQuickComplete(formData)
    expect(res.success).toBe(true)

    expect(mockSend).toHaveBeenCalledTimes(1)
    const inngestCall = mockSend.mock.calls[0][0]
    expect(inngestCall.name).toBe('customer.completed')
    expect(inngestCall.id).toBe('outbox_qc_789')

    const payload = inngestCall.data
    const keys = Object.keys(payload).sort()
    expect(keys).toEqual([
      'customerId',
      'eventId',
      'locationId',
      'organizationId',
      'sourceEventId',
    ])

    expect(payload.eventId).toBe('comp_qc_456')
    expect(payload.organizationId).toBe('org_1')
    expect(payload.locationId).toBe('loc_1')
    expect(payload.customerId).toBe('cust_qc_123')
    expect(payload.sourceEventId).toBe('source_qc_001')

    // Strict assertions: NO contact, NO permission, NO completedAt, NO country, NO PII
    expect(payload).not.toHaveProperty('contact')
    expect(payload).not.toHaveProperty('permission')
    expect(payload).not.toHaveProperty('country')
    expect(payload).not.toHaveProperty('completedAt')
    expect(payload).not.toHaveProperty('source')
    expect(payload).not.toHaveProperty('sourceCustomerId')
    expect(payload).not.toHaveProperty('sourceTransactionId')
    expect(payload).not.toHaveProperty('email')
    expect(payload).not.toHaveProperty('phone')
    expect(payload).not.toHaveProperty('firstName')
    expect(payload).not.toHaveProperty('lastName')
  })

  it('proves API Completion immediate Inngest send contains exactly the canonical five operational fields and no PII', async () => {
    const store = new PostgresCompletionApiStore()

    const result = await store.submitCompletion({
      organizationId: 'org_api_1',
      locationId: 'loc_api_1',
      firstName: 'Bob',
      lastName: 'Smith',
      email: 'bob.smith@example.test',
      phone: '555-987-6543',
      permissionEmail: 'allowed',
      permissionSms: 'unknown',
      permissionSource: 'api_v1',
      source: 'api_v1',
      sourceEventId: 'source_sys_001',
      sourceCustomerId: 'cust_ext_1',
      sourceTransactionId: 'txn_ext_1',
      completedAt: new Date().toISOString(),
      country: 'CA',
    })

    expect(result.duplicate).toBe(false)
    expect(mockSend).toHaveBeenCalledTimes(1)

    const inngestCall = mockSend.mock.calls[0][0]
    expect(inngestCall.name).toBe('customer.completed')
    expect(inngestCall.id).toBe('outbox_sys_789')

    const payload = inngestCall.data
    const keys = Object.keys(payload).sort()
    expect(keys).toEqual([
      'customerId',
      'eventId',
      'locationId',
      'organizationId',
      'sourceEventId',
    ])

    expect(payload.eventId).toBe('comp_sys_456')
    expect(payload.organizationId).toBe('org_api_1')
    expect(payload.locationId).toBe('loc_api_1')
    expect(payload.customerId).toBe('cust_sys_123')
    expect(payload.sourceEventId).toBe('source_sys_001')

    // Strict assertions: NO contact, NO permission, NO completedAt, NO country, NO source, NO PII
    expect(payload).not.toHaveProperty('contact')
    expect(payload).not.toHaveProperty('permission')
    expect(payload).not.toHaveProperty('country')
    expect(payload).not.toHaveProperty('completedAt')
    expect(payload).not.toHaveProperty('source')
    expect(payload).not.toHaveProperty('sourceCustomerId')
    expect(payload).not.toHaveProperty('sourceTransactionId')
    expect(payload).not.toHaveProperty('email')
    expect(payload).not.toHaveProperty('phone')
    expect(payload).not.toHaveProperty('firstName')
    expect(payload).not.toHaveProperty('lastName')
  })
})

describe('MR-7B.3: Database Migration Static Schema Guard', () => {
  const migrationSql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261008000000_mr7b3_payload_minimization.sql'),
    'utf8'
  )

  it('proves migration minimizes domain_event_outbox to canonical five keys and does not rebuild contact/permission', () => {
    // Both RPCs must insert into domain_event_outbox
    expect(migrationSql).toContain('INSERT INTO public.domain_event_outbox')

    // Canonical five fields must be constructed
    expect(migrationSql).toContain("'eventId', v_completion_event_id")
    expect(migrationSql).toContain("'organizationId', p_org_id")
    expect(migrationSql).toContain("'locationId', p_loc_id")
    expect(migrationSql).toContain("'customerId', v_customer_id")
    expect(migrationSql).toContain("'sourceEventId', v_source_event_id")

    // The outbox insert blocks MUST NOT include contact or permission objects
    const outboxBlocks = migrationSql
      .split('INSERT INTO public.domain_event_outbox')
      .slice(1)

    for (const block of outboxBlocks) {
      const payloadBuildEnd = block.indexOf("'PENDING'")
      const payloadBuild = block.substring(0, payloadBuildEnd)

      expect(payloadBuild).not.toContain("'contact'")
      expect(payloadBuild).not.toContain("'permission'")
      expect(payloadBuild).not.toContain("'completedAt'")
      expect(payloadBuild).not.toContain("'country'")
      expect(payloadBuild).not.toContain("'sourceCustomerId'")
      expect(payloadBuild).not.toContain("'sourceTransactionId'")
    }
  })

  it('proves authoritative customer_completion_events still retains rich contact/permission records', () => {
    expect(migrationSql).toContain('INSERT INTO public.customer_completion_events')
    expect(migrationSql).toContain("jsonb_build_object('email', v_clean_email, 'phone', NULLIF(TRIM(p_phone)")
    expect(migrationSql).toContain("jsonb_build_object('email', p_permission_email, 'sms', p_permission_sms")
  })

  it('proves fail-closed historical scrub validation checks all 5 operational keys before updating', () => {
    expect(migrationSql).toContain("payload ?& ARRAY['eventId', 'organizationId', 'locationId', 'customerId', 'sourceEventId']")
    expect(migrationSql).toContain("RAISE EXCEPTION")
    expect(migrationSql).toContain("UPDATE public.domain_event_outbox")
  })

  it('proves migration explicitly preserves exact RPC privilege boundaries', () => {
    // submit_quick_complete_atomic:
    // anon EXECUTE = false, authenticated = true, service_role = true
    expect(migrationSql).toContain('REVOKE ALL ON FUNCTION public.submit_quick_complete_atomic')
    expect(migrationSql).toContain('FROM PUBLIC, anon')
    expect(migrationSql).toContain('GRANT EXECUTE ON FUNCTION public.submit_quick_complete_atomic')
    expect(migrationSql).toContain('TO authenticated, service_role')

    // submit_completion_system_atomic:
    // anon EXECUTE = false, authenticated = false, service_role = true
    expect(migrationSql).toContain('REVOKE ALL ON FUNCTION public.submit_completion_system_atomic')
    expect(migrationSql).toContain('FROM PUBLIC, anon, authenticated')
    expect(migrationSql).toContain('GRANT EXECUTE ON FUNCTION public.submit_completion_system_atomic')
    expect(migrationSql).toContain('TO service_role')
  })
})
