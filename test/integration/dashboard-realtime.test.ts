import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import {
  dashboardReducer,
  createInitialState,
} from '../../src/lib/dashboard/dashboard-reducer'
import type {
  DashboardSnapshot,
  CustomerCompletedEvent,
  ReviewRequestCreatedEvent,
  ReviewRequestUpdatedEvent,
  ReviewRequestIneligibleEvent,
} from '../../src/lib/dashboard/realtime-types'
import { RealtimeStatus } from '../../src/app/app/dashboard/realtime-status'
import { DashboardKpis } from '../../src/app/app/dashboard/dashboard-kpis'
import { RecentActivity } from '../../src/app/app/dashboard/recent-activity'

const dummySnapshot: DashboardSnapshot = {
  kpis: {
    completedCount: 3,
    eligibleCount: 3,
    scheduledCount: 1,
    sentCount: 2,
    clickedCount: 1,
    failedCount: 0,
    outboxFailedCount: 0,
    ineligibleCount: 0,
  },
  recentRequests: [
    {
      id: 'req-1',
      customer_id: 'cust-1',
      channel: 'email',
      status: 'SENT',
      token: 'token-abc-123',
      created_at: '2026-09-18T10:00:00Z',
      sent_at: '2026-09-18T10:01:00Z',
      clicked_at: null,
      customerName: 'Alice Smith',
      recipientEmail: 'alice@example.test',
    },
    {
      id: 'req-2',
      customer_id: 'cust-2',
      channel: 'email',
      status: 'SCHEDULED',
      token: 'token-def-456',
      created_at: '2026-09-18T10:05:00Z',
      sent_at: null,
      clicked_at: null,
      customerName: 'Bob Jones',
      recipientEmail: 'bob@example.test',
    },
  ],
  systemStatus: 'RUNNING',
  statusDescription: 'Review request workflow actively processing completions.',
  attentionItems: [],
  locationsNeedingDestinationCount: 0,
}

const orgId = '11111111-1111-1111-1111-111111111111'

describe('Dashboard Realtime Synchronization Engine (Hardening Pass)', () => {
  describe('A. Pure Reducer KPI State Transitions & Generic Model', () => {
    it('1. customer.completed increments completedCount by 1', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: CustomerCompletedEvent = {
        id: 'evt-1',
        eventId: 'evt-1',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-1',
        completedAt: '2026-09-18T10:10:00Z',
        createdAt: '2026-09-18T10:10:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.completedCount).toBe(4)
      expect(next.highlightedKpiKey).toBe('completedCount')
      expect(next.announcement).toContain('Completed Customers increased to 4')
      expect(next.processedEventIds).toContain('evt-1')
      expect(next.processedCompletionEventIds).toContain('comp-1')
    })

    it('2. review_request.created with SCHEDULED increments eligibleCount and scheduledCount', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestCreatedEvent = {
        id: 'evt-2',
        eventId: 'evt-2',
        type: 'review_request.created',
        organizationId: orgId,
        requestId: 'req-3',
        customerId: 'cust-3',
        channel: 'email',
        status: 'SCHEDULED',
        createdAt: '2026-09-18T10:15:00Z',
        scheduledFor: '2026-09-18T10:20:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.eligibleCount).toBe(4)
      expect(next.kpis.scheduledCount).toBe(2)
      expect(next.highlightedKpiKey).toBe('scheduledCount')
      expect(next.recentRequests.length).toBe(3)
      expect(next.recentRequests[0].id).toBe('req-3')
    })

    it('3. SCHEDULED -> SENT decrements scheduledCount and increments sentCount', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-3',
        eventId: 'evt-3',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-2',
        customerId: 'cust-2',
        channel: 'email',
        previousStatus: 'SCHEDULED',
        status: 'SENT',
        sentAt: '2026-09-18T10:20:00Z',
        updatedAt: '2026-09-18T10:20:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.scheduledCount).toBe(0) // 1 - 1 = 0
      expect(next.kpis.sentCount).toBe(3) // 2 + 1 = 3
      expect(next.highlightedKpiKey).toBe('sentCount')
      expect(next.recentRequests.find((r) => r.id === 'req-2')?.status).toBe('SENT')
    })

    it('4. SENT -> CLICKED increments clickedCount by 1 and does NOT decrement sentCount', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-4',
        eventId: 'evt-4',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'SENT',
        status: 'CLICKED',
        clickedAt: '2026-09-18T10:25:00Z',
        updatedAt: '2026-09-18T10:25:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.clickedCount).toBe(2) // 1 + 1 = 2
      // Sent count definition: status IN ('SENT', 'DELIVERED', 'CLICKED')
      // Since both SENT and CLICKED are in that set, sentCount must remain unchanged!
      expect(next.kpis.sentCount).toBe(2)
      expect(next.highlightedKpiKey).toBe('clickedCount')
      expect(next.announcement).toBe('Review request marked clicked.')

      const updatedRow = next.recentRequests.find((r) => r.id === 'req-1')
      expect(updatedRow?.status).toBe('CLICKED')
      expect(updatedRow?.clicked_at).toBe('2026-09-18T10:25:00Z')
      expect(updatedRow?.customerName).toBe('Alice Smith')
      expect(updatedRow?.token).toBe('token-abc-123')
    })

    it('5. duplicate CLICKED event does not double-increment clickedCount', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-click-1',
        eventId: 'evt-click-1',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'SENT',
        status: 'CLICKED',
        clickedAt: '2026-09-18T10:25:00Z',
        updatedAt: '2026-09-18T10:25:00Z',
      }

      const firstPass = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(firstPass.kpis.clickedCount).toBe(2)

      // Arrives a second time with new event id but target status already CLICKED on that row
      const duplicateEvent: ReviewRequestUpdatedEvent = {
        ...event,
        id: 'evt-click-2',
        eventId: 'evt-click-2',
      }
      const secondPass = dashboardReducer(firstPass, {
        type: 'EVENT_RECEIVED',
        event: duplicateEvent,
      })
      expect(secondPass.kpis.clickedCount).toBe(2) // Kept at 2!
    })

    it('6. counts never go below zero (zero-floor enforcement)', () => {
      const zeroSnapshot: DashboardSnapshot = {
        ...dummySnapshot,
        kpis: {
          ...dummySnapshot.kpis,
          scheduledCount: 0,
          sentCount: 0,
          failedCount: 0,
        },
      }
      const state = createInitialState(orgId, zeroSnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-zero',
        eventId: 'evt-zero',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-nonexistent',
        customerId: 'cust-x',
        channel: 'email',
        previousStatus: 'SCHEDULED',
        status: 'SENDING',
        updatedAt: '2026-09-18T10:30:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.scheduledCount).toBe(0) // 0 - 1 clamped to 0
      expect(next.kpis.sentCount).toBe(0)
    })

    it('7. handles SENDING -> FAILED transition', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-sending-failed',
        eventId: 'evt-sending-failed',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'SENDING',
        status: 'FAILED',
        failedAt: '2026-09-18T10:30:00Z',
        updatedAt: '2026-09-18T10:30:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.failedCount).toBe(1)
      expect(next.systemStatus).toBe('NEEDS_ATTENTION')
    })

    it('8. handles FAILED -> SENDING retry transition (decrements failedCount)', () => {
      const failedSnapshot: DashboardSnapshot = {
        ...dummySnapshot,
        kpis: { ...dummySnapshot.kpis, failedCount: 1 },
      }
      const state = createInitialState(orgId, failedSnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-retry-start',
        eventId: 'evt-retry-start',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'FAILED',
        status: 'SENDING',
        updatedAt: '2026-09-18T10:32:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.failedCount).toBe(0) // 1 - 1 = 0
      expect(next.systemStatus).toBe('RUNNING')
      expect(next.attentionItems.find((i) => i.id === 'failed-requests')).toBeUndefined()
    })

    it('9. handles FAILED -> SENT direct recovery transition', () => {
      const failedSnapshot: DashboardSnapshot = {
        ...dummySnapshot,
        kpis: { ...dummySnapshot.kpis, failedCount: 1, sentCount: 2 },
        recentRequests: [
          { ...dummySnapshot.recentRequests[0], status: 'FAILED' },
          dummySnapshot.recentRequests[1],
        ],
      }
      const state = createInitialState(orgId, failedSnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-direct-recover',
        eventId: 'evt-direct-recover',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'FAILED',
        status: 'SENT',
        sentAt: '2026-09-18T10:33:00Z',
        updatedAt: '2026-09-18T10:33:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.failedCount).toBe(0) // decremented
      expect(next.kpis.sentCount).toBe(3) // incremented
      expect(next.systemStatus).toBe('RUNNING')
    })

    it('10. full retry lifecycle: FAILED -> SENDING -> SENT', () => {
      const failedSnapshot: DashboardSnapshot = {
        ...dummySnapshot,
        kpis: { ...dummySnapshot.kpis, failedCount: 1, sentCount: 2 },
      }
      const state = createInitialState(orgId, failedSnapshot)

      // Step 1: FAILED -> SENDING
      const step1 = dashboardReducer(state, {
        type: 'EVENT_RECEIVED',
        event: {
          id: 'evt-step1',
          eventId: 'evt-step1',
          type: 'review_request.updated',
          organizationId: orgId,
          requestId: 'req-1',
          customerId: 'cust-1',
          channel: 'email',
          previousStatus: 'FAILED',
          status: 'SENDING',
          updatedAt: '2026-09-18T10:34:00Z',
        },
      })
      expect(step1.kpis.failedCount).toBe(0)
      expect(step1.kpis.sentCount).toBe(2)

      // Step 2: SENDING -> SENT
      const step2 = dashboardReducer(step1, {
        type: 'EVENT_RECEIVED',
        event: {
          id: 'evt-step2',
          eventId: 'evt-step2',
          type: 'review_request.updated',
          organizationId: orgId,
          requestId: 'req-1',
          customerId: 'cust-1',
          channel: 'email',
          previousStatus: 'SENDING',
          status: 'SENT',
          sentAt: '2026-09-18T10:35:00Z',
          updatedAt: '2026-09-18T10:35:00Z',
        },
      })
      expect(step2.kpis.failedCount).toBe(0)
      expect(step2.kpis.sentCount).toBe(3)
    })
  })

  describe('B. Deduplication & Idempotency', () => {
    it('1. deduplicates customer.completed via eventId', () => {
      const state = createInitialState(orgId, dummySnapshot)
      state.processedEventIds = ['dup-event-id']

      const event: CustomerCompletedEvent = {
        id: 'dup-event-id',
        eventId: 'dup-event-id',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-new',
        completedAt: '2026-09-18T10:40:00Z',
        createdAt: '2026-09-18T10:40:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next).toBe(state)
      expect(next.kpis.completedCount).toBe(3)
    })

    it('2. deduplicates customer.completed via completionEventId', () => {
      const state = createInitialState(orgId, dummySnapshot)
      state.processedCompletionEventIds = ['comp-existing']

      const event: CustomerCompletedEvent = {
        id: 'new-event-id',
        eventId: 'new-event-id',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-existing',
        completedAt: '2026-09-18T10:40:00Z',
        createdAt: '2026-09-18T10:40:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.completedCount).toBe(3)
    })

    it('3. deduplicates review_request.created for existing requestId', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestCreatedEvent = {
        id: 'evt-create-dup',
        eventId: 'evt-create-dup',
        type: 'review_request.created',
        organizationId: orgId,
        requestId: 'req-1', // Already in recentRequests!
        customerId: 'cust-1',
        channel: 'email',
        status: 'SCHEDULED',
        createdAt: '2026-09-18T10:45:00Z',
        scheduledFor: '2026-09-18T10:45:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.eligibleCount).toBe(3) // Not incremented!
    })
  })

  describe('C. Needs Attention Consistency', () => {
    it('1. adds Workflow Dispatch Failed item when first failure occurs', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-fail',
        eventId: 'evt-fail',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'SENT',
        status: 'FAILED',
        failedAt: '2026-09-18T10:50:00Z',
        updatedAt: '2026-09-18T10:50:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.systemStatus).toBe('NEEDS_ATTENTION')
      const item = next.attentionItems.find((i) => i.id === 'failed-requests')
      expect(item).toBeDefined()
      expect(item?.severity).toBe('error')
      expect(item?.title).toBe('Workflow Dispatch Failed')
      expect(item?.description).toContain('1 review request dispatch(es)')
    })

    it('2. removes Workflow Dispatch Failed item when all failed requests recover', () => {
      const state = createInitialState(orgId, {
        ...dummySnapshot,
        kpis: { ...dummySnapshot.kpis, failedCount: 1 },
        recentRequests: [
          { ...dummySnapshot.recentRequests[0], status: 'FAILED' },
          dummySnapshot.recentRequests[1],
        ],
        systemStatus: 'NEEDS_ATTENTION',
        attentionItems: [
          {
            id: 'failed-requests',
            severity: 'error',
            title: 'Workflow Dispatch Failed',
            description: '1 review request dispatch(es) recorded delivery failures.',
          },
        ],
      })

      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-recover',
        eventId: 'evt-recover',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'FAILED',
        status: 'SENT',
        sentAt: '2026-09-18T10:55:00Z',
        updatedAt: '2026-09-18T10:55:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.failedCount).toBe(0)
      expect(next.systemStatus).toBe('RUNNING')
      expect(next.attentionItems.find((i) => i.id === 'failed-requests')).toBeUndefined()
    })
  })

  describe('D. Connection Status Indicator & Reduced Motion', () => {
    it('renders LIVE state with green dot', () => {
      const html = renderToString(React.createElement(RealtimeStatus, { status: 'LIVE' }))
      expect(html).toContain('Live')
      expect(html).toContain('bg-emerald-400')
      expect(html).toContain('role="status"')
    })

    it('enforces motion-reduce:animate-none on pulsing indicators', () => {
      const reconnectHtml = renderToString(
        React.createElement(RealtimeStatus, { status: 'RECONNECTING' })
      )
      expect(reconnectHtml).toContain('animate-pulse')
      expect(reconnectHtml).toContain('motion-reduce:animate-none')

      const syncingHtml = renderToString(
        React.createElement(RealtimeStatus, { status: 'SYNCING' })
      )
      expect(syncingHtml).toContain('animate-pulse')
      expect(syncingHtml).toContain('motion-reduce:animate-none')
    })
  })

  describe('E. Hardening Migration & RLS Extension Restraints', () => {
    it('verifies hardening migration restricts RLS policy to extension = "broadcast"', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20260919003000_dashboard_realtime_hardening.sql'
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      expect(sql).toContain("extension = 'broadcast'")
      expect(sql).toContain("realtime.topic() LIKE 'organization:%:dashboard'")
      expect(sql).toContain('gen_random_uuid()')
      expect(sql).toContain("'eventId'")
      expect(sql).not.toContain("'phone'")
      expect(sql).not.toContain("'email'")
      expect(sql).not.toContain("'token'")
    })
  })

  describe('F. Realtime Auth Bootstrap Verification', () => {
    it('verifies live-dashboard.tsx executes setAuth before channel subscribe', () => {
      const componentPath = path.resolve(
        __dirname,
        '../../src/app/app/dashboard/live-dashboard.tsx'
      )
      const code = fs.readFileSync(componentPath, 'utf8')

      expect(code).toContain('supabase.realtime.setAuth')
      const setAuthIndex = code.indexOf('supabase.realtime.setAuth')
      const channelIndex = code.indexOf('supabase.channel(topic')
      expect(setAuthIndex).toBeLessThan(channelIndex)
    })
  })

  describe('G. UI Components Render Cleanly', () => {
    it('DashboardKpis renders metrics and highlights cleanly', () => {
      const html = renderToString(
        React.createElement(DashboardKpis, {
          kpis: dummySnapshot.kpis,
          highlightedKey: 'clickedCount',
        })
      )

      expect(html).toContain('Feedback Link Clicks')
      expect(html).toContain('border-blue-500/80')
    })

    it('RecentActivity renders solicitation rows', () => {
      const html = renderToString(
        React.createElement(RecentActivity, {
          requests: dummySnapshot.recentRequests,
          orgName: 'Northstar Clinic',
          highlightedRowId: 'req-1',
        })
      )

      expect(html).toContain('Alice Smith')
      expect(html).toContain('Test Link ↗')
    })
  })
  describe('H. Policy Bypass / Ineligible Completion Realtime Synchronization', () => {
    it('1. increments ineligibleCount from 2 to 3 and updates existing attention item description', () => {
      const stateWithTwo = createInitialState(orgId, {
        ...dummySnapshot,
        kpis: { ...dummySnapshot.kpis, ineligibleCount: 2 },
        attentionItems: [
          {
            id: 'ineligible-suppressed',
            severity: 'info',
            title: 'Completions Bypassed by Policy',
            description:
              '2 customer completion(s) were safely bypassed due to missing customer consent, recent request cooldown, or suppression.',
          },
        ],
      })

      const event: ReviewRequestIneligibleEvent = {
        id: 'audit-evt-1',
        eventId: 'audit-evt-1',
        auditEventId: 'audit-evt-1',
        type: 'review_request.ineligible',
        organizationId: orgId,
        createdAt: '2026-09-19T01:00:00Z',
      }

      const next = dashboardReducer(stateWithTwo, { type: 'EVENT_RECEIVED', event })

      expect(next.kpis.ineligibleCount).toBe(3)
      const item = next.attentionItems.find((i) => i.id === 'ineligible-suppressed')
      expect(item).toBeDefined()
      expect(item?.severity).toBe('info')
      expect(item?.description).toContain('3 customer completion(s) were safely bypassed')
      expect(next.announcement).toContain('Completions bypassed by policy increased to 3.')
    })

    it('2. creates the informational attention item when starting from ineligibleCount = 0', () => {
      const stateZero = createInitialState(orgId, {
        ...dummySnapshot,
        kpis: { ...dummySnapshot.kpis, ineligibleCount: 0 },
        attentionItems: [],
      })

      const event: ReviewRequestIneligibleEvent = {
        id: 'audit-evt-first',
        eventId: 'audit-evt-first',
        auditEventId: 'audit-evt-first',
        type: 'review_request.ineligible',
        organizationId: orgId,
        createdAt: '2026-09-19T01:05:00Z',
      }

      const next = dashboardReducer(stateZero, { type: 'EVENT_RECEIVED', event })

      expect(next.kpis.ineligibleCount).toBe(1)
      const item = next.attentionItems.find((i) => i.id === 'ineligible-suppressed')
      expect(item).toBeDefined()
      expect(item?.id).toBe('ineligible-suppressed')
      expect(item?.severity).toBe('info')
      expect(item?.title).toBe('Completions Bypassed by Policy')
      expect(item?.description).toContain('1 customer completion(s) were safely bypassed')
    })

    it('3. duplicate eventId does not increment twice (idempotency)', () => {
      const state = createInitialState(orgId, {
        ...dummySnapshot,
        kpis: { ...dummySnapshot.kpis, ineligibleCount: 2 },
      })

      const event: ReviewRequestIneligibleEvent = {
        id: 'audit-evt-dup',
        eventId: 'audit-evt-dup',
        auditEventId: 'audit-evt-dup',
        type: 'review_request.ineligible',
        organizationId: orgId,
        createdAt: '2026-09-19T01:10:00Z',
      }

      const firstPass = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(firstPass.kpis.ineligibleCount).toBe(3)

      // Deliver duplicate
      const secondPass = dashboardReducer(firstPass, { type: 'EVENT_RECEIVED', event })
      expect(secondPass.kpis.ineligibleCount).toBe(3)
      expect(secondPass).toBe(firstPass)
    })

    it('4. ignores event intended for a different organization', () => {
      const state = createInitialState(orgId, {
        ...dummySnapshot,
        kpis: { ...dummySnapshot.kpis, ineligibleCount: 2 },
      })

      const foreignEvent: ReviewRequestIneligibleEvent = {
        id: 'audit-evt-foreign',
        eventId: 'audit-evt-foreign',
        auditEventId: 'audit-evt-foreign',
        type: 'review_request.ineligible',
        organizationId: '88888888-8888-8888-8888-888888888888',
        createdAt: '2026-09-19T01:15:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: foreignEvent })
      expect(next).toBe(state)
      expect(next.kpis.ineligibleCount).toBe(2)
    })

    it('5. does NOT change eligibleCount, scheduledCount, sentCount, clickedCount, or failedCount', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestIneligibleEvent = {
        id: 'audit-evt-kpi-check',
        eventId: 'audit-evt-kpi-check',
        auditEventId: 'audit-evt-kpi-check',
        type: 'review_request.ineligible',
        organizationId: orgId,
        createdAt: '2026-09-19T01:20:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.eligibleCount).toBe(dummySnapshot.kpis.eligibleCount)
      expect(next.kpis.scheduledCount).toBe(dummySnapshot.kpis.scheduledCount)
      expect(next.kpis.sentCount).toBe(dummySnapshot.kpis.sentCount)
      expect(next.kpis.clickedCount).toBe(dummySnapshot.kpis.clickedCount)
      expect(next.kpis.failedCount).toBe(dummySnapshot.kpis.failedCount)
    })

    it('6. does NOT add anything to recentRequests', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestIneligibleEvent = {
        id: 'audit-evt-row-check',
        eventId: 'audit-evt-row-check',
        auditEventId: 'audit-evt-row-check',
        type: 'review_request.ineligible',
        organizationId: orgId,
        createdAt: '2026-09-19T01:25:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.recentRequests.length).toBe(dummySnapshot.recentRequests.length)
      expect(next.recentRequests).toEqual(dummySnapshot.recentRequests)
    })

    it('7. systemStatus remains RUNNING when this is the only informational condition', () => {
      const state = createInitialState(orgId, {
        ...dummySnapshot,
        systemStatus: 'RUNNING',
      })

      const event: ReviewRequestIneligibleEvent = {
        id: 'audit-evt-status-check',
        eventId: 'audit-evt-status-check',
        auditEventId: 'audit-evt-status-check',
        type: 'review_request.ineligible',
        organizationId: orgId,
        createdAt: '2026-09-19T01:30:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.systemStatus).toBe('RUNNING')
    })

    it('8. verifies additive migration contains correct trigger, event name, and no PII', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20260919010000_dashboard_ineligible_realtime.sql'
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      expect(sql).toContain("NEW.event_type <> 'review_request.ineligible'")
      expect(sql).toContain("review_request.ineligible")
      expect(sql).toContain("organization:' || NEW.organization_id::text || ':dashboard")
      expect(sql).toContain("audit_events")
      expect(sql).not.toContain("'phone'")
      expect(sql).not.toContain("'email'")
      expect(sql).not.toContain("'token'")
      expect(sql).not.toContain("'metadata'")
    })

    it('9. verifies live-dashboard registers broadcast listener for review_request.ineligible', () => {
      const componentPath = path.resolve(
        __dirname,
        '../../src/app/app/dashboard/live-dashboard.tsx'
      )
      const code = fs.readFileSync(componentPath, 'utf8')

      expect(code).toContain("event: 'review_request.ineligible'")
    })
  })
})
