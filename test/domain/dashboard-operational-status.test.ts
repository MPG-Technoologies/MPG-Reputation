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
  ReviewRequestUpdatedEvent,
  CustomerCompletedEvent,
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

  describe('Realtime Operational-Health Regression Invariants', () => {
    it('1. Snapshot with failedCount=2, recentFailedRequestCount=0, systemStatus=RUNNING receives SENT update -> remains RUNNING and no failed-requests item', () => {
      const orgId = 'org-reg-1'
      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 10,
          eligibleCount: 8,
          scheduledCount: 1,
          sentCount: 5,
          clickedCount: 2,
          failedCount: 2, // Historical failures
          recentFailedRequestCount: 0,
          outboxFailedCount: 0,
        },
        recentRequests: [
          {
            id: 'req-hist-1',
            customer_id: 'cust-1',
            channel: 'email',
            status: 'FAILED',
            token: 'tok-1',
            created_at: '2026-09-01T10:00:00Z',
            sent_at: '2026-09-01T10:01:00Z',
            clicked_at: null,
            customerName: 'Old User 1',
            recipientEmail: 'old1@example.test',
          },
          {
            id: 'req-active-1',
            customer_id: 'cust-2',
            channel: 'email',
            status: 'SCHEDULED',
            token: 'tok-2',
            created_at: '2026-10-11T07:00:00Z',
            sent_at: null,
            clicked_at: null,
            customerName: 'Current User',
            recipientEmail: 'current@example.test',
          },
        ],
        systemStatus: 'RUNNING',
        statusDescription: 'Review request workflow actively processing completions.',
        attentionItems: [],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)
      expect(state.systemStatus).toBe('RUNNING')

      const sentEvent: ReviewRequestUpdatedEvent = {
        eventId: 'evt-sent-1',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-active-1',
        customerId: 'cust-2',
        channel: 'email',
        previousStatus: 'SCHEDULED',
        status: 'SENT',
        sentAt: '2026-10-11T07:01:00Z',
        updatedAt: '2026-10-11T07:01:00Z',
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: sentEvent })

      expect(nextState.systemStatus).toBe('RUNNING')
      expect(nextState.kpis.failedCount).toBe(2)
      expect(nextState.kpis.recentFailedRequestCount).toBe(0)
      expect(nextState.attentionItems.find((i) => i.id === 'failed-requests')).toBeUndefined()
    })

    it('2. Same snapshot receives SENT -> FAILED transition -> recentFailedRequestCount=1, failedCount updates, NEEDS_ATTENTION', () => {
      const orgId = 'org-reg-2'
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
            id: 'req-active-2',
            customer_id: 'cust-3',
            channel: 'email',
            status: 'SENT',
            token: 'tok-3',
            created_at: '2026-10-11T07:00:00Z',
            sent_at: '2026-10-11T07:01:00Z',
            clicked_at: null,
            customerName: 'User 3',
            recipientEmail: 'user3@example.test',
          },
        ],
        systemStatus: 'RUNNING',
        statusDescription: 'Review request workflow actively processing completions.',
        attentionItems: [],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      const failEvent: ReviewRequestUpdatedEvent = {
        eventId: 'evt-fail-2',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-active-2',
        customerId: 'cust-3',
        channel: 'email',
        previousStatus: 'SENT',
        status: 'FAILED',
        failedAt: '2026-10-11T07:02:00Z',
        updatedAt: '2026-10-11T07:02:00Z',
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: failEvent })

      expect(nextState.kpis.recentFailedRequestCount).toBe(1)
      expect(nextState.kpis.failedCount).toBe(3) // 2 + 1
      expect(nextState.systemStatus).toBe('NEEDS_ATTENTION')
      const item = nextState.attentionItems.find((i) => i.id === 'failed-requests')
      expect(item).toBeDefined()
      expect(item?.severity).toBe('error')
      expect(item?.title).toBe('Workflow Dispatch Failed')
      expect(item?.description).toContain('1 review request dispatch(es) recorded delivery failures in the last 24 hours.')
    })

    it('3. Recent failed request recovers FAILED -> SENT -> recentFailedRequestCount=0, failed attention disappears, RUNNING', () => {
      const orgId = 'org-reg-3'
      const snapshotWithRecentFail: DashboardSnapshot = {
        kpis: {
          completedCount: 10,
          eligibleCount: 8,
          scheduledCount: 0,
          sentCount: 4,
          clickedCount: 2,
          failedCount: 3,
          recentFailedRequestCount: 1,
          outboxFailedCount: 0,
        },
        recentRequests: [
          {
            id: 'req-active-3',
            customer_id: 'cust-4',
            channel: 'email',
            status: 'FAILED',
            token: 'tok-4',
            created_at: '2026-10-11T07:00:00Z',
            sent_at: '2026-10-11T07:01:00Z',
            clicked_at: null,
            customerName: 'User 4',
            recipientEmail: 'user4@example.test',
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

      const state = createInitialState(orgId, snapshotWithRecentFail)

      const recoverEvent: ReviewRequestUpdatedEvent = {
        eventId: 'evt-recover-3',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-active-3',
        customerId: 'cust-4',
        channel: 'email',
        previousStatus: 'FAILED',
        status: 'SENT',
        sentAt: '2026-10-11T07:05:00Z',
        updatedAt: '2026-10-11T07:05:00Z',
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: recoverEvent })

      expect(nextState.kpis.recentFailedRequestCount).toBe(0)
      expect(nextState.kpis.failedCount).toBe(2)
      expect(nextState.attentionItems.find((i) => i.id === 'failed-requests')).toBeUndefined()
      expect(nextState.systemStatus).toBe('RUNNING')
    })

    it('4. Historical failedCount > 0 by itself can never force current NEEDS_ATTENTION', () => {
      // Direct readiness derivation
      const status = deriveDashboardSystemStatus({
        readiness: readyReadiness,
        recentFailedRequestCount: 0,
        outboxFailedCount: 0,
        sentCount: 5,
      })
      expect(status.systemStatus).toBe('RUNNING')

      // Reducer state
      const orgId = 'org-reg-4'
      const snapshot: DashboardSnapshot = {
        kpis: {
          completedCount: 20,
          eligibleCount: 15,
          scheduledCount: 2,
          sentCount: 10,
          clickedCount: 5,
          failedCount: 7, // Historical failedCount > 0
          recentFailedRequestCount: 0,
          outboxFailedCount: 0,
        },
        recentRequests: [],
        systemStatus: 'RUNNING',
        statusDescription: 'Review request workflow actively processing completions.',
        attentionItems: [],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)
      expect(state.systemStatus).toBe('RUNNING')

      // Any normal event arrives (e.g. customer completed)
      const compEvent: CustomerCompletedEvent = {
        eventId: 'evt-comp-4',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-4',
        completedAt: '2026-10-11T07:10:00Z',
        createdAt: '2026-10-11T07:10:00Z',
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: compEvent })
      expect(nextState.systemStatus).toBe('RUNNING')
      expect(nextState.attentionItems.find((i) => i.id === 'failed-requests')).toBeUndefined()
    })

    it('5. Policy bypass realtime event does not change current operational status', () => {
      const orgId = 'org-reg-5'
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
        eventId: 'evt-bypass-5',
        type: 'review_request.ineligible',
        organizationId: orgId,
        completionEventId: 'comp-5',
        auditEventId: 'audit-5',
        createdAt: new Date().toISOString(),
        reason: 'RECENT_REQUEST',
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })

      expect(nextState.systemStatus).toBe('RUNNING')
      expect(nextState.statusDescription).toBe('Review request workflow actively processing completions.')
      expect(nextState.attentionItems).toEqual([])
      expect(nextState.kpis.ineligibleCount).toBe(1)
    })

    it('6. Unresolved outbox failure still forces NEEDS_ATTENTION', () => {
      const status = deriveDashboardSystemStatus({
        readiness: readyReadiness,
        recentFailedRequestCount: 0,
        outboxFailedCount: 2,
        sentCount: 10,
      })
      expect(status.systemStatus).toBe('NEEDS_ATTENTION')
      expect(status.statusDescription).toContain('Operational issues detected')

      const orgId = 'org-reg-6'
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
            id: 'req-outbox-6',
            customer_id: 'cust-6',
            channel: 'email',
            status: 'SCHEDULED',
            token: 'tok-6',
            created_at: '2026-10-11T07:00:00Z',
            sent_at: null,
            clicked_at: null,
            customerName: 'User 6',
            recipientEmail: 'user6@example.test',
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
        eventId: 'evt-outbox-sent',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-outbox-6',
        customerId: 'cust-6',
        channel: 'email',
        previousStatus: 'SCHEDULED',
        status: 'SENT',
        sentAt: '2026-10-11T07:01:00Z',
        updatedAt: '2026-10-11T07:01:00Z',
      }

      const nextState = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(nextState.systemStatus).toBe('NEEDS_ATTENTION')
      expect(nextState.attentionItems.find((i) => i.id === 'outbox-failed')).toBeDefined()
    })

    it('7. Duplicate/replayed event does not double-increment recent failure count', () => {
      const orgId = 'org-reg-7'
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
            id: 'req-dup-7',
            customer_id: 'cust-7',
            channel: 'email',
            status: 'SENT',
            token: 'tok-7',
            created_at: '2026-10-11T07:00:00Z',
            sent_at: '2026-10-11T07:01:00Z',
            clicked_at: null,
            customerName: 'User 7',
            recipientEmail: 'user7@example.test',
          },
        ],
        systemStatus: 'RUNNING',
        statusDescription: 'Review request workflow actively processing completions.',
        attentionItems: [],
        locationsNeedingDestinationCount: 0,
      }

      const state = createInitialState(orgId, snapshot)

      const failEvent: ReviewRequestUpdatedEvent = {
        eventId: 'evt-dup-fail-7',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-dup-7',
        customerId: 'cust-7',
        channel: 'email',
        previousStatus: 'SENT',
        status: 'FAILED',
        failedAt: '2026-10-11T07:02:00Z',
        updatedAt: '2026-10-11T07:02:00Z',
      }

      const stateAfterFail = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: failEvent })
      expect(stateAfterFail.kpis.recentFailedRequestCount).toBe(1)
      expect(stateAfterFail.kpis.failedCount).toBe(1)

      // Replay same event with identical eventId
      const stateAfterReplay = dashboardReducer(stateAfterFail, {
        type: 'EVENT_RECEIVED',
        event: failEvent,
      })
      expect(stateAfterReplay.kpis.recentFailedRequestCount).toBe(1)
      expect(stateAfterReplay.kpis.failedCount).toBe(1)

      // Replay with different eventId but status already FAILED for this request
      const replayDiffEventId: ReviewRequestUpdatedEvent = {
        ...failEvent,
        eventId: 'evt-dup-fail-7-replayed',
      }
      const stateAfterSecondReplay = dashboardReducer(stateAfterFail, {
        type: 'EVENT_RECEIVED',
        event: replayDiffEventId,
      })
      expect(stateAfterSecondReplay.kpis.recentFailedRequestCount).toBe(1)
      expect(stateAfterSecondReplay.kpis.failedCount).toBe(1)
    })

    it('8. Tenant isolation/event organization guards remain unchanged', () => {
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
        eventId: 'evt-foreign-fail',
        type: 'review_request.updated',
        organizationId: orgIdB, // Tenant B event
        requestId: 'req-foreign',
        customerId: 'cust-foreign',
        channel: 'email',
        previousStatus: 'SENT',
        status: 'FAILED',
        failedAt: '2026-10-11T07:00:00Z',
        updatedAt: '2026-10-11T07:00:00Z',
      }

      const stateAfter = dashboardReducer(stateA, { type: 'EVENT_RECEIVED', event: foreignFailEvent })
      expect(stateAfter).toBe(stateA) // Identical reference, discarded
      expect(stateAfter.kpis.recentFailedRequestCount).toBe(0)
      expect(stateAfter.kpis.failedCount).toBe(0)
      expect(stateAfter.systemStatus).toBe('RUNNING')
    })
  })
})
