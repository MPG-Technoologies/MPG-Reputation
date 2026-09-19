import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { applyProviderReviewRequestTransition } from '../../src/domain/review-request/cas'
import type { ReviewRequestStatus } from '../../src/domain/review-request/transitions'
import { createAdminClient } from '../../src/lib/supabase/admin'

describe('Review Request Optimistic Compare-and-Set (MR-1A.2 Section 7 & 13)', () => {
  const supabase = createAdminClient()

  let testOrgId: string
  let testLocationId: string
  let testCustomerId: string

  beforeAll(async () => {
    const { error: pingErr } = await supabase.from('organizations').select('id').limit(1)
    if (pingErr) return

    const nonce = Date.now()
    const { data: org } = await supabase
      .from('organizations')
      .insert({ name: `CAS Test Org ${nonce}`, slug: `cas-test-org-${nonce}` })
      .select('id')
      .single()
    testOrgId = org!.id

    const { data: loc } = await supabase
      .from('locations')
      .insert({ organization_id: testOrgId, name: 'Main Clinic' })
      .select('id')
      .single()
    testLocationId = loc!.id

    const { data: cust } = await supabase
      .from('customers')
      .insert({
        organization_id: testOrgId,
        location_id: testLocationId,
        first_name: 'CAS',
        last_name: 'Patient',
        email: `cas_${nonce}@example.test`,
      })
      .select('id')
      .single()
    testCustomerId = cust!.id
  })

  afterAll(async () => {
    if (testOrgId) {
      await supabase.from('organizations').delete().eq('id', testOrgId)
    }
  })

  async function createReq(nonce: number, status: ReviewRequestStatus = 'SENT') {
    const { data: cce } = await supabase
      .from('customer_completion_events')
      .insert({
        organization_id: testOrgId,
        location_id: testLocationId,
        customer_id: testCustomerId,
        source: 'quick_complete',
        source_event_id: `src_cas_${nonce}`,
        contact: { email: `patient_${nonce}@example.test` },
        permission: { emailConsent: true },
      })
      .select('id')
      .single()

    const token = `token_cas_${nonce}`
    const { data: req } = await supabase
      .from('review_requests')
      .insert({
        organization_id: testOrgId,
        location_id: testLocationId,
        customer_id: testCustomerId,
        completion_event_id: cce!.id,
        channel: 'email',
        status,
        token,
        token_hash: token,
        ...(status === 'CLICKED' ? { clicked_at: new Date().toISOString() } : {}),
      })
      .select('id')
      .single()

    return req!.id
  }

  it('updates status from SENT to DELIVERED atomically', async () => {
    const reqId = await createReq(Date.now() + 1, 'SENT')

    const result = await applyProviderReviewRequestTransition({
      supabase,
      reviewRequestId: reqId,
      eventType: 'email.delivered',
    })

    expect(result.success).toBe(true)
    expect(result.finalStatus).toBe('DELIVERED')

    const { data: row } = await supabase
      .from('review_requests')
      .select('status, delivered_at')
      .eq('id', reqId)
      .single()
    expect(row?.status).toBe('DELIVERED')
    expect(row?.delivered_at).not.toBeNull()
  })

  it('preserves CLICKED and populates delivered_at when delivery arrives after click', async () => {
    const reqId = await createReq(Date.now() + 2, 'CLICKED')

    const result = await applyProviderReviewRequestTransition({
      supabase,
      reviewRequestId: reqId,
      eventType: 'email.delivered',
    })

    expect(result.success).toBe(true)
    expect(result.finalStatus).toBe('CLICKED')

    const { data: row } = await supabase
      .from('review_requests')
      .select('status, delivered_at, clicked_at')
      .eq('id', reqId)
      .single()
    expect(row?.status).toBe('CLICKED')
    expect(row?.clicked_at).not.toBeNull()
    expect(row?.delivered_at).not.toBeNull()
  })

  it('detects CAS mismatch when status changes to CLICKED concurrently, retries, and preserves CLICKED', async () => {
    const reqId = await createReq(Date.now() + 3, 'SENT')

    let intercepted = false
    const originalFrom = supabase.from.bind(supabase)
    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      const queryBuilder = originalFrom(table)
      if (table === 'review_requests' && !intercepted) {
        const originalSelect = queryBuilder.select.bind(queryBuilder)
        queryBuilder.select = ((...args: Parameters<typeof originalSelect>) => {
          const res = originalSelect(...args)
          const originalSingle = res.single.bind(res)
          res.single = (async () => {
            const singleRes = await originalSingle()
            if (!intercepted && (singleRes.data as { status?: string } | null)?.status === 'SENT') {
              intercepted = true
              // Concurrent writer sets CLICKED!
              await supabase
                .from('review_requests')
                .update({ status: 'CLICKED', clicked_at: new Date().toISOString() })
                .eq('id', reqId)
            }
            return singleRes
          }) as unknown as typeof res.single
          return res
        }) as unknown as typeof queryBuilder.select
      }
      return queryBuilder
    })

    try {
      const result = await applyProviderReviewRequestTransition({
        supabase,
        reviewRequestId: reqId,
        eventType: 'email.delivered',
      })

      expect(result.success).toBe(true)
      expect(result.finalStatus).toBe('CLICKED')

      // Verify row in DB is CLICKED with delivered_at populated
      const { data: row } = await supabase
        .from('review_requests')
        .select('status, delivered_at, clicked_at')
        .eq('id', reqId)
        .single()
      expect(row?.status).toBe('CLICKED')
      expect(row?.clicked_at).not.toBeNull()
      expect(row?.delivered_at).not.toBeNull()
    } finally {
      fromSpy.mockRestore()
    }
  })
})
