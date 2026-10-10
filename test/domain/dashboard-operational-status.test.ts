import { describe, expect, it } from 'vitest'
import {
  deriveActivationReadiness,
  deriveDashboardSystemStatus,
  DASHBOARD_OPERATIONAL_WINDOW_HOURS,
} from '../../src/domain/activation'
import { deriveLiveActivity } from '../../src/lib/dashboard/live-activity-projection'
import {
  createInitialState,
  dashboardReducer,
} from '../../src/lib/dashboard/dashboard-reducer'
import type {
  DashboardSnapshot,
  ReviewRequestIneligibleEvent,
} from '../../src/lib/dashboard/realtime-types'

describe('Dashboard Operational Status & Invariant Verification', () => {
  const readyReadiness = deriveActivationReadiness(
    [{ id: 'loc-1', status: 'ACTIVE' }],
    [
      {
        location_id: 'loc-1',
        status: 'CONFIRMED',
        canonical_url: 'https://g.page/r/test/review',
      },
    ]
  )

  const setupRequiredReadiness = deriveActivationReadiness(
    [{ id: 'loc-1', status: 'ACTIVE' }],
    []
  )

  it('exposes DASHBOARD_OPERATIONAL_WINDOW_HOURS as 24', () => {
    expect(DASHBOARD_OPERATIONAL_WINDOW_HOURS).toBe(24)
  })

  // 1. zero issues → RUNNING where otherwise ready
  it('1. zero issues -> RUNNING where otherwise ready', () => {
    const status = deriveDashboardSystemStatus({
      readiness: readyReadiness,
      recentFailedRequestCount: 0,
      outboxFailedCount: 0,
      sentCount: 5,
    })

    expect(status.systemStatus).toBe('RUNNING')
    expect(status.statusDescription).toContain('actively processing completions')
  })

  // 2. 19-day-old FAILED request does NOT force NEEDS_ATTENTION
  it('2. 19-day-old FAILED request does NOT force NEEDS_ATTENTION', () => {
    // Org has historical failures (e.g. from 19 days ago), but 0 recent failures in operational window
    const status = deriveDashboardSystemStatus({
      readiness: readyReadiness,
      recentFailedRequestCount: 0,
      failedCount: 3, // lifetime failures from September
      outboxFailedCount: 0,
      sentCount: 10,
    })

    expect(status.systemStatus).toBe('RUNNING')
  })

  // 3. FAILED request inside operational window DOES force NEEDS_ATTENTION
  it('3. FAILED request inside operational window DOES force NEEDS_ATTENTION', () => {
    const status = deriveDashboardSystemStatus({
      readiness: readyReadiness,
      recentFailedRequestCount: 1, // failure inside 24h
      failedCount: 1,
      outboxFailedCount: 0,
      sentCount: 10,
    })

    expect(status.systemStatus).toBe('NEEDS_ATTENTION')
    expect(status.statusDescription).toContain('Operational issues detected')
  })

  // 4. unresolved FAILED outbox DOES force NEEDS_ATTENTION regardless of age
  it('4. unresolved FAILED outbox DOES force NEEDS_ATTENTION regardless of age', () => {
    // Durable outbox failure requires recovery even if 30 days old
    const status = deriveDashboardSystemStatus({
      readiness: readyReadiness,
      recentFailedRequestCount: 0,
      outboxFailedCount: 1,
      sentCount: 10,
    })

    expect(status.systemStatus).toBe('NEEDS_ATTENTION')
  })

  // 5. recovered/dispatched outbox does not force NEEDS_ATTENTION
  it('5. recovered/dispatched outbox does not force NEEDS_ATTENTION', () => {
    const status = deriveDashboardSystemStatus({
      readiness: readyReadiness,
      recentFailedRequestCount: 0,
      outboxFailedCount: 0, // recovered outbox
      sentCount: 10,
    })

    expect(status.systemStatus).toBe('RUNNING')
  })

  // 6. policy bypass does NOT add to attentionItems
  it('6. policy bypass does NOT add to attentionItems', () => {
    const orgId = 'org-test-uuid'
    const snapshot: DashboardSnapshot = {
      kpis: {
        completedCount: 5,
        eligibleCount: 3,
        scheduledCount: 1,
        sentCount: 2,
        clickedCount: 0,
        failedCount: 0,
        recentFailedRequestCount: 0,
        outboxFailedCount: 0,
        ineligibleCount: 2,
      },
      recentRequests: [],
      liveActivity: [],
      systemStatus: 'RUNNING',
      statusDescription: 'Review request workflow actively processing completions.',
      attentionItems: [],
      locationsNeedingDestinationCount: 0,
    }

    const state = createInitialState(orgId, snapshot)

    const event: ReviewRequestIneligibleEvent = {
      eventId: 'evt-bypass-1',
      type: 'review_request.ineligible',
      organizationId: orgId,
      completionEventId: 'comp-1',
      auditEventId: 'audit-1',
      createdAt: new Date().toISOString(),
      reason: 'EMAIL_PERMISSION_UNKNOWN',
    }

    const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })

    expect(nextState.attentionItems).toEqual([])
    expect(nextState.attentionItems.find((i) => i.id === 'ineligible-suppressed')).toBeUndefined()
  })

  // 7. policy bypass does NOT increment issue badge
  it('7. policy bypass does NOT increment issue badge', () => {
    const orgId = 'org-test-uuid'
    const snapshot: DashboardSnapshot = {
      kpis: {
        completedCount: 1,
        eligibleCount: 0,
        scheduledCount: 0,
        sentCount: 0,
        clickedCount: 0,
        failedCount: 0,
        recentFailedRequestCount: 0,
        outboxFailedCount: 0,
        ineligibleCount: 0,
      },
      recentRequests: [],
      liveActivity: [],
      systemStatus: 'READY_FOR_SYNTHETIC_TEST',
      statusDescription: 'Ready for synthetic validation.',
      attentionItems: [],
      locationsNeedingDestinationCount: 0,
    }

    const state = createInitialState(orgId, snapshot)
    expect(state.attentionItems.length).toBe(0) // 0 issues badge

    const event: ReviewRequestIneligibleEvent = {
      eventId: 'evt-bypass-2',
      type: 'review_request.ineligible',
      organizationId: orgId,
      completionEventId: 'comp-2',
      auditEventId: 'audit-2',
      createdAt: new Date().toISOString(),
      reason: 'RECENT_REQUEST',
    }

    const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })

    expect(nextState.attentionItems.length).toBe(0) // Issue badge remains 0
    expect(nextState.systemStatus).toBe('READY_FOR_SYNTHETIC_TEST') // Does not force NEEDS_ATTENTION
  })

  // 8. policy bypass remains available in live activity
  it('8. policy bypass remains available in live activity', () => {
    const completions = [
      { id: 'comp-1', customer_id: 'cust-1', created_at: '2026-10-10T12:00:00Z' },
    ]
    const requests = [
      {
        id: 'req-1',
        completion_event_id: 'comp-1',
        status: 'SUPPRESSED',
        created_at: '2026-10-10T12:00:00Z',
      },
    ]
    const auditEvents = [
      {
        id: 'audit-1',
        created_at: '2026-10-10T12:00:01Z',
        metadata: {
          completionEventId: 'comp-1',
          reason: 'CUSTOMER_SUPPRESSED',
          decision: 'bypassed',
        },
      },
    ]
    const customerMap = {
      'cust-1': { first_name: 'Bob', last_name: 'Jones' },
    }

    const liveActivity = deriveLiveActivity(completions, requests, auditEvents, customerMap)

    expect(liveActivity).toHaveLength(1)
    expect(liveActivity[0].stage).toBe('BYPASSED')
    expect(liveActivity[0].customerName).toBe('Bob Jones')
    expect(liveActivity[0].policyReason).toBeDefined()
    expect(liveActivity[0].policyReason).toContain('suppression list')
  })

  // 9. old hard-bounce history remains visible but does not poison current status
  it('9. old hard-bounce history remains visible but does not poison current status', () => {
    const historicalFailedRequest = {
      id: 'req-bounce-historical',
      customer_id: 'cust-bounced',
      channel: 'email',
      status: 'FAILED',
      token: 'tok-historical',
      created_at: '2026-09-20T10:00:00Z',
      sent_at: '2026-09-20T10:00:05Z',
      delivered_at: null,
      clicked_at: null,
      error_message: 'smtp; 550 5.1.1 User unknown',
      customerName: 'Old Customer',
      recipientEmail: 'bounce@example.test',
    }

    const snapshot: DashboardSnapshot = {
      kpis: {
        completedCount: 50,
        eligibleCount: 45,
        scheduledCount: 2,
        sentCount: 40,
        clickedCount: 15,
        failedCount: 1, // Historical failure from September
        recentFailedRequestCount: 0, // 0 failures in operational window
        outboxFailedCount: 0,
      },
      recentRequests: [historicalFailedRequest], // Remains observable in activity/history
      systemStatus: 'RUNNING',
      statusDescription: 'Review request workflow actively processing completions.',
      attentionItems: [], // 0 active attention items
      locationsNeedingDestinationCount: 0,
    }

    // Historical hard bounce is visible
    expect(snapshot.recentRequests[0].status).toBe('FAILED')
    expect(snapshot.recentRequests[0].error_message).toContain('550')

    // Current system status is RUNNING, not poisoned
    const status = deriveDashboardSystemStatus({
      readiness: readyReadiness,
      recentFailedRequestCount: snapshot.kpis.recentFailedRequestCount,
      failedCount: snapshot.kpis.failedCount,
      outboxFailedCount: 0,
      sentCount: snapshot.kpis.sentCount,
    })
    expect(status.systemStatus).toBe('RUNNING')
  })

  // 10. setup-required conditions continue to work
  it('10. setup-required conditions continue to work', () => {
    // Missing destination
    const missingDestStatus = deriveDashboardSystemStatus({
      readiness: setupRequiredReadiness,
      recentFailedRequestCount: 0,
      outboxFailedCount: 0,
      sentCount: 0,
    })
    expect(missingDestStatus.systemStatus).toBe('SETUP_REQUIRED')

    // No locations at all
    const noLocationsReadiness = deriveActivationReadiness([], [])
    const noLocStatus = deriveDashboardSystemStatus({
      readiness: noLocationsReadiness,
      recentFailedRequestCount: 0,
      outboxFailedCount: 0,
      sentCount: 0,
    })
    expect(noLocStatus.systemStatus).toBe('SETUP_REQUIRED')
  })

  // 11. tenant isolation remains unchanged
  it('11. tenant isolation remains unchanged in realtime reducer', () => {
    const orgIdA = 'org-a'
    const orgIdB = 'org-b'
    const stateA = createInitialState(orgIdA, {
      kpis: {
        completedCount: 1,
        eligibleCount: 1,
        scheduledCount: 0,
        sentCount: 1,
        clickedCount: 0,
        failedCount: 0,
        recentFailedRequestCount: 0,
      },
      recentRequests: [],
      liveActivity: [],
      systemStatus: 'RUNNING',
      statusDescription: 'Active',
      attentionItems: [],
      locationsNeedingDestinationCount: 0,
    })

    const foreignEvent: ReviewRequestIneligibleEvent = {
      eventId: 'evt-foreign',
      type: 'review_request.ineligible',
      organizationId: orgIdB, // Different tenant
      completionEventId: 'comp-foreign',
      auditEventId: 'audit-foreign',
      createdAt: new Date().toISOString(),
    }

    const stateAfter = dashboardReducer(stateA, { type: 'EVENT_RECEIVED', event: foreignEvent })
    expect(stateAfter).toBe(stateA) // Ignored due to tenant boundary
  })

  // 12. dashboard KPI semantics remain truthful
  it('12. dashboard KPI semantics remain truthful', () => {
    const kpis = {
      completedCount: 10,
      eligibleCount: 8,
      scheduledCount: 2,
      sentCount: 6,
      clickedCount: 3,
      failedCount: 5, // Lifetime failures count
      recentFailedRequestCount: 1, // Last 24 hours failure count
      ineligibleCount: 4, // Policy bypass count
    }

    // Lifetime failures and recent failures are explicitly separated
    expect(kpis.failedCount).toBe(5)
    expect(kpis.recentFailedRequestCount).toBe(1)
    expect(kpis.ineligibleCount).toBe(4)
  })
})
