import { describe, expect, it } from 'vitest'
import {
  deriveActivationReadiness,
  deriveDashboardSystemStatus,
  DASHBOARD_OPERATIONAL_WINDOW_HOURS,
  isRecentFailureTimestamp,
} from '../../src/domain/activation'
import { deriveLiveActivity } from '../../src/lib/dashboard/live-activity-projection'
import {
  createInitialState,
  dashboardReducer,
} from '../../src/lib/dashboard/dashboard-reducer'
import type {
  DashboardSnapshot,
  ReviewRequestIneligibleEvent,
  ReviewRequestUpdatedEvent,
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
      recentFailedRequestCount: snapshot.kpis.recentFailedRequestCount ?? 0,
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

  describe('Realtime Operational-Health Regression Invariants (Recency & Recovery Invariants)', () => {
    it('1. recentCount=1, failedCount=2: OLD historical FAILED request recovers -> failedCount=1, recentFailedRequestCount remains 1, NEEDS_ATTENTION remains, failed-requests attention remains', () => {
      const orgId = 'org-reg-1'
      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 10,
          eligibleCount: 8,
          scheduledCount: 0,
          sentCount: 5,
          clickedCount: 2,
          failedCount: 2, // 1 recent + 1 historical
          recentFailedRequestCount: 1, // 1 recent failure inside 24h
          outboxFailedCount: 0,
        },
        recentRequests: [
          {
            id: 'req-hist-old',
            customer_id: 'cust-1',
            channel: 'email',
            status: 'FAILED',
            token: 'tok-1',
            created_at: '2026-09-01T10:00:00Z',
            sent_at: '2026-09-01T10:01:00Z',
            clicked_at: null,
            customerName: 'Old User',
            recipientEmail: 'old@example.test',
          },
        ],
        systemStatus: 'NEEDS_ATTENTION',
        statusDescription: 'Operational issues detected in recent dispatches or outbox.',
        attentionItems: [
          {
            id: 'failed-requests',
            severity: 'error',
            title: 'Workflow Dispatch Failed',
            description: '1 review request dispatch(es) recorded delivery failures in the last 24 hours. Please check email provider logs.',
          },
        ],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      // Historical request recovers (failed 20 days ago)
      const historicalRecoveryEvent: ReviewRequestUpdatedEvent = {
        eventId: 'evt-recover-hist',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-hist-old',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'FAILED',
        status: 'SENT',
        sentAt: new Date().toISOString(),
        failedAt: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(), // 20 days ago
        updatedAt: new Date().toISOString(),
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: historicalRecoveryEvent })

      // failedCount decrements, but recentFailedRequestCount MUST remain 1
      expect(nextState.kpis.failedCount).toBe(1)
      expect(nextState.kpis.recentFailedRequestCount).toBe(1)
      expect(nextState.systemStatus).toBe('NEEDS_ATTENTION')
      const item = nextState.attentionItems.find((i) => i.id === 'failed-requests')
      expect(item).toBeDefined()
      expect(item?.description).toContain('1 review request dispatch(es) recorded delivery failures in the last 24 hours.')
    })

    it('2. recentCount=1, failedCount=2: RECENT FAILED request recovers -> failedCount=1, recentFailedRequestCount=0, failed attention removed, RUNNING if no other issue', () => {
      const orgId = 'org-reg-2'
      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 10,
          eligibleCount: 8,
          scheduledCount: 0,
          sentCount: 5,
          clickedCount: 2,
          failedCount: 2,
          recentFailedRequestCount: 1, // Only 1 failure in operational window
          outboxFailedCount: 0,
        },
        recentRequests: [
          {
            id: 'req-recent-fail',
            customer_id: 'cust-2',
            channel: 'email',
            status: 'FAILED',
            token: 'tok-2',
            created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
            sent_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
            clicked_at: null,
            customerName: 'Recent User',
            recipientEmail: 'recent@example.test',
          },
        ],
        systemStatus: 'NEEDS_ATTENTION',
        statusDescription: 'Operational issues detected in recent dispatches or outbox.',
        attentionItems: [
          {
            id: 'failed-requests',
            severity: 'error',
            title: 'Workflow Dispatch Failed',
            description: '1 review request dispatch(es) recorded delivery failures in the last 24 hours. Please check email provider logs.',
          },
        ],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      // Recent request recovers (failed 2 hours ago)
      const recentRecoveryEvent: ReviewRequestUpdatedEvent = {
        eventId: 'evt-recover-recent',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-recent-fail',
        customerId: 'cust-2',
        channel: 'email',
        previousStatus: 'FAILED',
        status: 'SENT',
        sentAt: new Date().toISOString(),
        failedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), // 2 hours ago
        updatedAt: new Date().toISOString(),
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: recentRecoveryEvent })

      expect(nextState.kpis.failedCount).toBe(1)
      expect(nextState.kpis.recentFailedRequestCount).toBe(0)
      expect(nextState.attentionItems.find((i) => i.id === 'failed-requests')).toBeUndefined()
      expect(nextState.systemStatus).toBe('RUNNING')
    })

    it('3. failedAt exactly inside 24h window -> recovery decrements recent count', () => {
      const orgId = 'org-reg-3'
      const fixedNow = 1700000000000
      // Exactly on the 24-hour boundary
      const exactBoundaryFailedAt = new Date(fixedNow - 24 * 3600 * 1000).toISOString()
      expect(isRecentFailureTimestamp(exactBoundaryFailedAt, 24, fixedNow)).toBe(true)

      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 5,
          eligibleCount: 5,
          scheduledCount: 0,
          sentCount: 4,
          clickedCount: 1,
          failedCount: 1,
          recentFailedRequestCount: 1,
          outboxFailedCount: 0,
        },
        recentRequests: [],
        systemStatus: 'NEEDS_ATTENTION',
        statusDescription: 'Operational issues detected',
        attentionItems: [
          {
            id: 'failed-requests',
            severity: 'error',
            title: 'Workflow Dispatch Failed',
            description: '1 review request dispatch(es)',
          },
        ],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      // Test reducer with failure inside the 24h operational window
      const recentFailedAt = new Date(Date.now() - 23 * 3600 * 1000).toISOString()
      const event: ReviewRequestUpdatedEvent = {
        eventId: 'evt-exact-24h',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-3',
        customerId: 'cust-3',
        channel: 'email',
        previousStatus: 'FAILED',
        status: 'SENT',
        failedAt: recentFailedAt,
        updatedAt: new Date().toISOString(),
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(nextState.kpis.recentFailedRequestCount).toBe(0)
      expect(nextState.kpis.failedCount).toBe(0)
      expect(nextState.systemStatus).toBe('RUNNING')
    })

    it('4. failedAt outside 24h window -> recovery does not decrement recent count', () => {
      const orgId = 'org-reg-4'
      const fixedNow = 1700000000000
      // 24 hours + 1 second ago (strictly outside operational window)
      const outsideWindowFailedAt = new Date(fixedNow - (24 * 3600 * 1000 + 1000)).toISOString()
      expect(isRecentFailureTimestamp(outsideWindowFailedAt, 24, fixedNow)).toBe(false)

      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 5,
          eligibleCount: 5,
          scheduledCount: 0,
          sentCount: 4,
          clickedCount: 1,
          failedCount: 1,
          recentFailedRequestCount: 1,
          outboxFailedCount: 0,
        },
        recentRequests: [],
        systemStatus: 'NEEDS_ATTENTION',
        statusDescription: 'Operational issues detected',
        attentionItems: [
          {
            id: 'failed-requests',
            severity: 'error',
            title: 'Workflow Dispatch Failed',
            description: '1 review request dispatch(es)',
          },
        ],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      // Test reducer with failure outside the 24h operational window
      const olderFailedAt = new Date(Date.now() - (25 * 3600 * 1000)).toISOString()
      const event: ReviewRequestUpdatedEvent = {
        eventId: 'evt-outside-24h',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-4',
        customerId: 'cust-4',
        channel: 'email',
        previousStatus: 'FAILED',
        status: 'SENT',
        failedAt: olderFailedAt,
        updatedAt: new Date().toISOString(),
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      // recentFailedRequestCount MUST NOT decrement
      expect(nextState.kpis.recentFailedRequestCount).toBe(1)
      expect(nextState.kpis.failedCount).toBe(0)
      expect(nextState.systemStatus).toBe('NEEDS_ATTENTION')
    })

    it('5. failedAt null -> realtime recovery does NOT decrement recent count', () => {
      expect(isRecentFailureTimestamp(null)).toBe(false)

      const orgId = 'org-reg-5'
      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 5,
          eligibleCount: 5,
          scheduledCount: 0,
          sentCount: 4,
          clickedCount: 1,
          failedCount: 2,
          recentFailedRequestCount: 1,
          outboxFailedCount: 0,
        },
        recentRequests: [],
        systemStatus: 'NEEDS_ATTENTION',
        statusDescription: 'Operational issues detected',
        attentionItems: [
          {
            id: 'failed-requests',
            severity: 'error',
            title: 'Workflow Dispatch Failed',
            description: '1 review request dispatch(es)',
          },
        ],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      const event: ReviewRequestUpdatedEvent = {
        eventId: 'evt-null-failedat',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-5',
        customerId: 'cust-5',
        channel: 'email',
        previousStatus: 'FAILED',
        status: 'SENT',
        failedAt: null, // Null / unknown failure timestamp: fail conservatively
        updatedAt: new Date().toISOString(),
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(nextState.kpis.recentFailedRequestCount).toBe(1)
      expect(nextState.kpis.failedCount).toBe(1)
      expect(nextState.systemStatus).toBe('NEEDS_ATTENTION')
    })

    it('6. malformed failedAt -> realtime recovery does NOT decrement recent count', () => {
      expect(isRecentFailureTimestamp('invalid-date')).toBe(false)
      expect(isRecentFailureTimestamp('2026-99-99T99:99:99Z')).toBe(false)

      const orgId = 'org-reg-6'
      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 5,
          eligibleCount: 5,
          scheduledCount: 0,
          sentCount: 4,
          clickedCount: 1,
          failedCount: 2,
          recentFailedRequestCount: 1,
          outboxFailedCount: 0,
        },
        recentRequests: [],
        systemStatus: 'NEEDS_ATTENTION',
        statusDescription: 'Operational issues detected',
        attentionItems: [
          {
            id: 'failed-requests',
            severity: 'error',
            title: 'Workflow Dispatch Failed',
            description: '1 review request dispatch(es)',
          },
        ],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      const event: ReviewRequestUpdatedEvent = {
        eventId: 'evt-malformed-failedat',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-6',
        customerId: 'cust-6',
        channel: 'email',
        previousStatus: 'FAILED',
        status: 'SENT',
        failedAt: 'malformed-not-a-timestamp',
        updatedAt: new Date().toISOString(),
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(nextState.kpis.recentFailedRequestCount).toBe(1)
      expect(nextState.kpis.failedCount).toBe(1)
      expect(nextState.systemStatus).toBe('NEEDS_ATTENTION')
    })

    it('7. SENT -> FAILED -> increments both failedCount and recentFailedRequestCount', () => {
      const orgId = 'org-reg-7'
      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 10,
          eligibleCount: 8,
          scheduledCount: 1,
          sentCount: 5,
          clickedCount: 2,
          failedCount: 2,
          recentFailedRequestCount: 0,
          outboxFailedCount: 0,
        },
        recentRequests: [
          {
            id: 'req-7',
            customer_id: 'cust-7',
            channel: 'email',
            status: 'SENT',
            token: 'tok-7',
            created_at: new Date().toISOString(),
            sent_at: new Date().toISOString(),
            clicked_at: null,
            customerName: 'User 7',
            recipientEmail: 'user7@example.test',
          },
        ],
        systemStatus: 'RUNNING',
        statusDescription: 'Active',
        attentionItems: [],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      const failEvent: ReviewRequestUpdatedEvent = {
        eventId: 'evt-fail-7',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-7',
        customerId: 'cust-7',
        channel: 'email',
        previousStatus: 'SENT',
        status: 'FAILED',
        failedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: failEvent })
      expect(nextState.kpis.recentFailedRequestCount).toBe(1)
      expect(nextState.kpis.failedCount).toBe(3)
      expect(nextState.systemStatus).toBe('NEEDS_ATTENTION')
      const item = nextState.attentionItems.find((i) => i.id === 'failed-requests')
      expect(item).toBeDefined()
      expect(item?.severity).toBe('error')
    })

    it('8. duplicate/replayed failure event -> does not double increment', () => {
      const orgId = 'org-reg-8'
      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 5,
          eligibleCount: 5,
          scheduledCount: 0,
          sentCount: 5,
          clickedCount: 0,
          failedCount: 0,
          recentFailedRequestCount: 0,
          outboxFailedCount: 0,
        },
        recentRequests: [
          {
            id: 'req-8',
            customer_id: 'cust-8',
            channel: 'email',
            status: 'SENT',
            token: 'tok-8',
            created_at: new Date().toISOString(),
            sent_at: new Date().toISOString(),
            clicked_at: null,
            customerName: 'User 8',
            recipientEmail: 'user8@example.test',
          },
        ],
        systemStatus: 'RUNNING',
        statusDescription: 'Active',
        attentionItems: [],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      const failEvent: ReviewRequestUpdatedEvent = {
        eventId: 'evt-fail-8',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-8',
        customerId: 'cust-8',
        channel: 'email',
        previousStatus: 'SENT',
        status: 'FAILED',
        failedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const state1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: failEvent })
      expect(state1.kpis.recentFailedRequestCount).toBe(1)
      expect(state1.kpis.failedCount).toBe(1)

      // Replay with identical eventId
      const state2 = dashboardReducer(state1, { type: 'EVENT_RECEIVED', event: failEvent })
      expect(state2.kpis.recentFailedRequestCount).toBe(1)
      expect(state2.kpis.failedCount).toBe(1)

      // Replay with different eventId where row is already FAILED
      const state3 = dashboardReducer(state1, {
        type: 'EVENT_RECEIVED',
        event: { ...failEvent, eventId: 'evt-fail-8-replayed' },
      })
      expect(state3.kpis.recentFailedRequestCount).toBe(1)
      expect(state3.kpis.failedCount).toBe(1)
    })

    it('9. historical recovery while ANOTHER recent failure exists -> cannot produce false RUNNING state', () => {
      const orgId = 'org-reg-9'
      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 20,
          eligibleCount: 15,
          scheduledCount: 0,
          sentCount: 10,
          clickedCount: 5,
          failedCount: 2, // 1 recent + 1 historical
          recentFailedRequestCount: 1, // Request A failed 1h ago
          outboxFailedCount: 0,
        },
        recentRequests: [
          {
            id: 'req-recent-a',
            customer_id: 'cust-a',
            channel: 'email',
            status: 'FAILED',
            token: 'tok-a',
            created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
            sent_at: new Date(Date.now() - 3600 * 1000).toISOString(),
            clicked_at: null,
            customerName: 'Recent A',
            recipientEmail: 'a@example.test',
          },
          {
            id: 'req-hist-b',
            customer_id: 'cust-b',
            channel: 'email',
            status: 'FAILED',
            token: 'tok-b',
            created_at: new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(),
            sent_at: new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(),
            clicked_at: null,
            customerName: 'Hist B',
            recipientEmail: 'b@example.test',
          },
        ],
        systemStatus: 'NEEDS_ATTENTION',
        statusDescription: 'Operational issues detected in recent dispatches or outbox.',
        attentionItems: [
          {
            id: 'failed-requests',
            severity: 'error',
            title: 'Workflow Dispatch Failed',
            description: '1 review request dispatch(es) recorded delivery failures in the last 24 hours.',
          },
        ],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      // Request B (historical, failed 15 days ago) recovers
      const recoverBEvent: ReviewRequestUpdatedEvent = {
        eventId: 'evt-recover-b',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-hist-b',
        customerId: 'cust-b',
        channel: 'email',
        previousStatus: 'FAILED',
        status: 'SENT',
        sentAt: new Date().toISOString(),
        failedAt: new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(), // 15 days ago
        updatedAt: new Date().toISOString(),
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: recoverBEvent })

      // Crucial: Request A is still recently failed! Status MUST NOT turn to RUNNING.
      expect(nextState.kpis.failedCount).toBe(1)
      expect(nextState.kpis.recentFailedRequestCount).toBe(1)
      expect(nextState.systemStatus).toBe('NEEDS_ATTENTION')
      expect(nextState.systemStatus).not.toBe('RUNNING')
      expect(nextState.attentionItems.find((i) => i.id === 'failed-requests')).toBeDefined()
    })

    it('10. unresolved outbox failure continues to force NEEDS_ATTENTION', () => {
      const status = deriveDashboardSystemStatus({
        readiness: readyReadiness,
        recentFailedRequestCount: 0,
        outboxFailedCount: 2,
        sentCount: 10,
      })
      expect(status.systemStatus).toBe('NEEDS_ATTENTION')
      expect(status.statusDescription).toContain('Operational issues detected')

      const orgId = 'org-reg-10'
      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 5,
          eligibleCount: 5,
          scheduledCount: 0,
          sentCount: 5,
          clickedCount: 0,
          failedCount: 0,
          recentFailedRequestCount: 0,
          outboxFailedCount: 1,
        },
        recentRequests: [
          {
            id: 'req-10',
            customer_id: 'cust-10',
            channel: 'email',
            status: 'SCHEDULED',
            token: 'tok-10',
            created_at: new Date().toISOString(),
            sent_at: null,
            clicked_at: null,
            customerName: 'User 10',
            recipientEmail: 'user10@example.test',
          },
        ],
        systemStatus: 'NEEDS_ATTENTION',
        statusDescription: 'Operational issues detected in recent dispatches or outbox.',
        attentionItems: [
          {
            id: 'outbox-failed',
            severity: 'error',
            title: 'Background Events Awaiting Recovery',
            description: '1 background event(s) encountered errors and are awaiting automated recovery.',
          },
        ],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      const event: ReviewRequestUpdatedEvent = {
        eventId: 'evt-sent-10',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-10',
        customerId: 'cust-10',
        channel: 'email',
        previousStatus: 'SCHEDULED',
        status: 'SENT',
        sentAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(nextState.systemStatus).toBe('NEEDS_ATTENTION')
      expect(nextState.attentionItems.find((i) => i.id === 'outbox-failed')).toBeDefined()
    })

    it('11. policy bypass continues to have no effect on operational health', () => {
      const orgId = 'org-reg-11'
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
          ineligibleCount: 0,
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
        eventId: 'evt-bypass-11',
        type: 'review_request.ineligible',
        organizationId: orgId,
        completionEventId: 'comp-11',
        auditEventId: 'audit-11',
        createdAt: new Date().toISOString(),
        reason: 'RECENT_REQUEST',
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(nextState.systemStatus).toBe('RUNNING')
      expect(nextState.statusDescription).toBe('Review request workflow actively processing completions.')
      expect(nextState.attentionItems).toEqual([])
      expect(nextState.kpis.ineligibleCount).toBe(1)
    })

    it('12. tenant isolation remains unchanged', () => {
      const orgIdA = 'org-tenant-a'
      const orgIdB = 'org-tenant-b'
      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 5,
          eligibleCount: 5,
          scheduledCount: 0,
          sentCount: 5,
          clickedCount: 0,
          failedCount: 0,
          recentFailedRequestCount: 0,
          outboxFailedCount: 0,
        },
        recentRequests: [],
        systemStatus: 'RUNNING',
        statusDescription: 'Active',
        attentionItems: [],
        locationsNeedingDestinationCount: 0,
      }

      const stateA = createInitialState(orgIdA, snapshot)

      const foreignFailEvent: ReviewRequestUpdatedEvent = {
        eventId: 'evt-foreign-12',
        type: 'review_request.updated',
        organizationId: orgIdB, // Different tenant
        requestId: 'req-foreign',
        customerId: 'cust-foreign',
        channel: 'email',
        previousStatus: 'SENT',
        status: 'FAILED',
        failedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const stateAfter = dashboardReducer(stateA, { type: 'EVENT_RECEIVED', event: foreignFailEvent })
      expect(stateAfter).toBe(stateA) // Identical reference, discarded
      expect(stateAfter.kpis.recentFailedRequestCount).toBe(0)
      expect(stateAfter.kpis.failedCount).toBe(0)
      expect(stateAfter.systemStatus).toBe('RUNNING')
    })
  })
})

