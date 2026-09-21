import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import {
  dashboardReducer,
  createInitialState,
  mergeLiveActivity,
} from '../../src/lib/dashboard/dashboard-reducer'
import type {
  DashboardSnapshot,
  CustomerCompletedEvent,
  ReviewRequestCreatedEvent,
  ReviewRequestUpdatedEvent,
  ReviewRequestIneligibleEvent,
  ReviewRequestCheckingEvent,
  LiveActivityItem,
} from '../../src/lib/dashboard/realtime-types'
import { LiveActivity } from '../../src/app/app/dashboard/live-activity'
import { ActivityPanel } from '../../src/app/app/dashboard/activity-panel'
import { deriveLiveActivity } from '../../src/lib/dashboard/live-activity-projection'
import { formatPolicyReason } from '../../src/domain/eligibility'
import { RealtimeStatus } from '../../src/app/app/dashboard/realtime-status'
import { DashboardKpis } from '../../src/app/app/dashboard/dashboard-kpis'
import { RecentActivity } from '../../src/app/app/dashboard/recent-activity'
import { SystemStatusCard } from '../../src/app/app/dashboard/system-status-card'
import { NeedsAttentionCard } from '../../src/app/app/dashboard/needs-attention-card'
import { QuickLinksCard } from '../../src/app/app/dashboard/quick-links-card'

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

  describe('I. Live Activity Realtime Workflow UX', () => {
    it('1. customer.completed creates RECEIVED activity with default Customer name', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: CustomerCompletedEvent = {
        id: 'evt-comp-1',
        eventId: 'evt-comp-1',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-100',
        completedAt: '2026-09-19T02:00:00Z',
        createdAt: '2026-09-19T02:00:00Z',
      }
      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.liveActivity.length).toBe(1)
      expect(next.liveActivity[0].completionEventId).toBe('comp-100')
      expect(next.liveActivity[0].stage).toBe('RECEIVED')
      expect(next.liveActivity[0].customerName).toBe('Customer')
      expect(next.announcement).toContain('Completion received.')
    })

    it('2. completedCount still increments on customer.completed', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: CustomerCompletedEvent = {
        id: 'evt-comp-count',
        eventId: 'evt-comp-count',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-count-1',
        completedAt: '2026-09-19T02:00:00Z',
        createdAt: '2026-09-19T02:00:00Z',
      }
      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.completedCount).toBe(dummySnapshot.kpis.completedCount + 1)
    })

    it('3. review_request.checking event moves RECEIVED -> CHECKING', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const compEvent: CustomerCompletedEvent = {
        id: 'evt-1',
        eventId: 'evt-1',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-101',
        completedAt: '2026-09-19T02:00:00Z',
        createdAt: '2026-09-19T02:00:00Z',
      }
      const s1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: compEvent })
      expect(s1.liveActivity[0].stage).toBe('RECEIVED')

      const checkEvent: ReviewRequestCheckingEvent = {
        id: 'evt-2',
        eventId: 'evt-2',
        type: 'review_request.checking',
        organizationId: orgId,
        completionEventId: 'comp-101',
        createdAt: '2026-09-19T02:00:01Z',
      }
      const s2 = dashboardReducer(s1, { type: 'EVENT_RECEIVED', event: checkEvent })
      expect(s2.liveActivity[0].stage).toBe('CHECKING')
      expect(s2.announcement).toBe('Checking review request eligibility.')
      expect(s2.kpis).toEqual(s1.kpis)
      expect(s2.recentRequests).toEqual(s1.recentRequests)
    })

    it('4. review_request.created moves CHECKING -> PREPARING and attaches requestId', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const compEvent: CustomerCompletedEvent = {
        id: 'c1',
        eventId: 'c1',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-102',
        completedAt: '2026-09-19T02:00:00Z',
        createdAt: '2026-09-19T02:00:00Z',
      }
      const s1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: compEvent })

      const checkEvent: ReviewRequestCheckingEvent = {
        id: 'c2',
        eventId: 'c2',
        type: 'review_request.checking',
        organizationId: orgId,
        completionEventId: 'comp-102',
        createdAt: '2026-09-19T02:00:01Z',
      }
      const s2 = dashboardReducer(s1, { type: 'EVENT_RECEIVED', event: checkEvent })

      const createdEvent: ReviewRequestCreatedEvent = {
        id: 'c3',
        eventId: 'c3',
        type: 'review_request.created',
        organizationId: orgId,
        completionEventId: 'comp-102',
        requestId: 'req-new-1',
        customerId: 'cust-new-1',
        channel: 'email',
        status: 'SCHEDULED',
        createdAt: '2026-09-19T02:00:02Z',
        scheduledFor: '2026-09-19T02:05:00Z',
      }
      const s3 = dashboardReducer(s2, { type: 'EVENT_RECEIVED', event: createdEvent })
      expect(s3.liveActivity[0].stage).toBe('PREPARING')
      expect(s3.liveActivity[0].requestId).toBe('req-new-1')
      expect(s3.recentRequests[0].id).toBe('req-new-1')
    })

    it('5. SENDING status remains PREPARING', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const createdEvent: ReviewRequestCreatedEvent = {
        id: 'c-prep',
        eventId: 'c-prep',
        type: 'review_request.created',
        organizationId: orgId,
        completionEventId: 'comp-103',
        requestId: 'req-prep-1',
        customerId: 'cust-1',
        channel: 'email',
        status: 'SCHEDULED',
        createdAt: '2026-09-19T02:00:00Z',
        scheduledFor: '2026-09-19T02:05:00Z',
      }
      const s1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: createdEvent })
      expect(s1.liveActivity[0].stage).toBe('PREPARING')

      const updatedSending: ReviewRequestUpdatedEvent = {
        id: 'u-send',
        eventId: 'u-send',
        type: 'review_request.updated',
        organizationId: orgId,
        completionEventId: 'comp-103',
        requestId: 'req-prep-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'SCHEDULED',
        status: 'SENDING',
        updatedAt: '2026-09-19T02:01:00Z',
      }
      const s2 = dashboardReducer(s1, { type: 'EVENT_RECEIVED', event: updatedSending })
      expect(s2.liveActivity[0].stage).toBe('PREPARING')
    })

    it('6. SENT moves PREPARING -> SENT', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const createdEvent: ReviewRequestCreatedEvent = {
        id: 'c-sent',
        eventId: 'c-sent',
        type: 'review_request.created',
        organizationId: orgId,
        completionEventId: 'comp-104',
        requestId: 'req-sent-1',
        customerId: 'cust-1',
        channel: 'email',
        status: 'SCHEDULED',
        createdAt: '2026-09-19T02:00:00Z',
        scheduledFor: '2026-09-19T02:05:00Z',
      }
      const s1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: createdEvent })

      const updatedSent: ReviewRequestUpdatedEvent = {
        id: 'u-sent',
        eventId: 'u-sent',
        type: 'review_request.updated',
        organizationId: orgId,
        completionEventId: 'comp-104',
        requestId: 'req-sent-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'SENDING',
        status: 'SENT',
        sentAt: '2026-09-19T02:01:00Z',
        updatedAt: '2026-09-19T02:01:00Z',
      }
      const s2 = dashboardReducer(s1, { type: 'EVENT_RECEIVED', event: updatedSent })
      expect(s2.liveActivity[0].stage).toBe('SENT')
      expect(s2.announcement).toBe('Review invitation sent.')
    })

    it('7. DELIVERED and CLICKED do not regress SENT', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const createdEvent: ReviewRequestCreatedEvent = {
        id: 'c-clk',
        eventId: 'c-clk',
        type: 'review_request.created',
        organizationId: orgId,
        completionEventId: 'comp-105',
        requestId: 'req-clk-1',
        customerId: 'cust-1',
        channel: 'email',
        status: 'SENT',
        createdAt: '2026-09-19T02:00:00Z',
        scheduledFor: '2026-09-19T02:05:00Z',
      }
      const s1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: createdEvent })
      const sSent = {
        ...s1,
        liveActivity: [{ ...s1.liveActivity[0], stage: 'SENT' as const }],
      }

      const updatedClicked: ReviewRequestUpdatedEvent = {
        id: 'u-clk',
        eventId: 'u-clk',
        type: 'review_request.updated',
        organizationId: orgId,
        completionEventId: 'comp-105',
        requestId: 'req-clk-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'SENT',
        status: 'CLICKED',
        clickedAt: '2026-09-19T02:02:00Z',
        updatedAt: '2026-09-19T02:02:00Z',
      }
      const s2 = dashboardReducer(sSent, { type: 'EVENT_RECEIVED', event: updatedClicked })
      expect(s2.liveActivity[0].stage).toBe('SENT')
    })

    it('8. ineligible moves CHECKING -> BYPASSED', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const checkEvent: ReviewRequestCheckingEvent = {
        id: 'c-byp',
        eventId: 'c-byp',
        type: 'review_request.checking',
        organizationId: orgId,
        completionEventId: 'comp-106',
        createdAt: '2026-09-19T02:00:00Z',
      }
      const s1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: checkEvent })
      expect(s1.liveActivity[0].stage).toBe('CHECKING')

      const ineligEvent: ReviewRequestIneligibleEvent = {
        id: 'u-byp',
        eventId: 'u-byp',
        auditEventId: 'u-byp',
        type: 'review_request.ineligible',
        organizationId: orgId,
        completionEventId: 'comp-106',
        createdAt: '2026-09-19T02:00:02Z',
      }
      const s2 = dashboardReducer(s1, { type: 'EVENT_RECEIVED', event: ineligEvent })
      expect(s2.liveActivity[0].stage).toBe('BYPASSED')
      expect(s2.announcement).toContain('Completion bypassed by policy.')
    })

    it('9. ineligible does not add Recent Review Solicitation', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const ineligEvent: ReviewRequestIneligibleEvent = {
        id: 'u-no-row',
        eventId: 'u-no-row',
        auditEventId: 'u-no-row',
        type: 'review_request.ineligible',
        organizationId: orgId,
        completionEventId: 'comp-107',
        createdAt: '2026-09-19T02:00:02Z',
      }
      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: ineligEvent })
      expect(next.recentRequests.length).toBe(dummySnapshot.recentRequests.length)
    })

    it('10. FAILED moves PREPARING -> FAILED', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const createdEvent: ReviewRequestCreatedEvent = {
        id: 'c-fail',
        eventId: 'c-fail',
        type: 'review_request.created',
        organizationId: orgId,
        completionEventId: 'comp-108',
        requestId: 'req-fail-1',
        customerId: 'cust-1',
        channel: 'email',
        status: 'SCHEDULED',
        createdAt: '2026-09-19T02:00:00Z',
        scheduledFor: '2026-09-19T02:05:00Z',
      }
      const s1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: createdEvent })
      expect(s1.liveActivity[0].stage).toBe('PREPARING')

      const updatedFailed: ReviewRequestUpdatedEvent = {
        id: 'u-fail',
        eventId: 'u-fail',
        type: 'review_request.updated',
        organizationId: orgId,
        completionEventId: 'comp-108',
        requestId: 'req-fail-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'SENDING',
        status: 'FAILED',
        failedAt: '2026-09-19T02:02:00Z',
        updatedAt: '2026-09-19T02:02:00Z',
      }
      const s2 = dashboardReducer(s1, { type: 'EVENT_RECEIVED', event: updatedFailed })
      expect(s2.liveActivity[0].stage).toBe('FAILED')
      expect(s2.announcement).toBe('Review invitation dispatch failed.')
    })

    it('11. duplicate eventId does not duplicate or change counts', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: CustomerCompletedEvent = {
        id: 'dup-id-1',
        eventId: 'dup-id-1',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-dup',
        completedAt: '2026-09-19T02:00:00Z',
        createdAt: '2026-09-19T02:00:00Z',
      }
      const s1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(s1.liveActivity.length).toBe(1)
      expect(s1.kpis.completedCount).toBe(dummySnapshot.kpis.completedCount + 1)

      const s2 = dashboardReducer(s1, { type: 'EVENT_RECEIVED', event })
      expect(s2.liveActivity.length).toBe(1)
      expect(s2.kpis.completedCount).toBe(dummySnapshot.kpis.completedCount + 1)
      expect(s2).toBe(s1)
    })

    it('12. wrong organization is ignored', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestCheckingEvent = {
        id: 'foreign-evt',
        eventId: 'foreign-evt',
        type: 'review_request.checking',
        organizationId: '99999999-9999-9999-9999-999999999999',
        completionEventId: 'comp-foreign',
        createdAt: '2026-09-19T02:00:00Z',
      }
      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next).toBe(state)
      expect(next.liveActivity.length).toBe(0)
    })

    it('13. monotonic protection: late CHECKING cannot regress PREPARING', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const createdEvent: ReviewRequestCreatedEvent = {
        id: 'evt-prep',
        eventId: 'evt-prep',
        type: 'review_request.created',
        organizationId: orgId,
        completionEventId: 'comp-mono-1',
        requestId: 'req-mono-1',
        customerId: 'cust-1',
        channel: 'email',
        status: 'SCHEDULED',
        createdAt: '2026-09-19T02:00:00Z',
        scheduledFor: '2026-09-19T02:05:00Z',
      }
      const s1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: createdEvent })
      expect(s1.liveActivity[0].stage).toBe('PREPARING')

      const lateChecking: ReviewRequestCheckingEvent = {
        id: 'evt-late-check',
        eventId: 'evt-late-check',
        type: 'review_request.checking',
        organizationId: orgId,
        completionEventId: 'comp-mono-1',
        createdAt: '2026-09-19T02:00:01Z',
      }
      const s2 = dashboardReducer(s1, { type: 'EVENT_RECEIVED', event: lateChecking })
      expect(s2.liveActivity[0].stage).toBe('PREPARING')
    })

    it('14. monotonic protection: late RECEIVED cannot regress SENT', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const updatedSent: ReviewRequestUpdatedEvent = {
        id: 'evt-sent',
        eventId: 'evt-sent',
        type: 'review_request.updated',
        organizationId: orgId,
        completionEventId: 'comp-mono-2',
        requestId: 'req-mono-2',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'SENDING',
        status: 'SENT',
        sentAt: '2026-09-19T02:01:00Z',
        updatedAt: '2026-09-19T02:01:00Z',
      }
      const s1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: updatedSent })
      expect(s1.liveActivity[0].stage).toBe('SENT')

      const lateComp: CustomerCompletedEvent = {
        id: 'evt-late-comp',
        eventId: 'evt-late-comp',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-mono-2',
        completedAt: '2026-09-19T02:00:00Z',
        createdAt: '2026-09-19T02:00:00Z',
      }
      const s2 = dashboardReducer(s1, { type: 'EVENT_RECEIVED', event: lateComp })
      expect(s2.liveActivity[0].stage).toBe('SENT')
    })

    it('15. SET_LIVE_ACTIVITY_CUSTOMER updates customerName for the matching completion item', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const compEvent: CustomerCompletedEvent = {
        id: 'evt-named',
        eventId: 'evt-named',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-name-test',
        completedAt: '2026-09-19T02:00:00Z',
        createdAt: '2026-09-19T02:00:00Z',
      }
      const s1 = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: compEvent })
      expect(s1.liveActivity[0].customerName).toBe('Customer')

      const s2 = dashboardReducer(s1, {
        type: 'SET_LIVE_ACTIVITY_CUSTOMER',
        completionEventId: 'comp-name-test',
        customerName: 'Sarah Connor',
      })
      expect(s2.liveActivity[0].customerName).toBe('Sarah Connor')
    })

    it('16. verifies additive migration contains no PII and correct broadcast calls', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20260919020000_dashboard_live_activity.sql'
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      expect(sql).toContain('review_request.checking')
      expect(sql).toContain('NEW.completion_event_id')
      expect(sql).not.toContain("'phone'")
      expect(sql).not.toContain("'email'")
      expect(sql).not.toContain("'token'")
      expect(sql).not.toContain("'customer_name'")
    })

    it('17. verifies review_request created/updated payload includes completionEventId in migration', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20260919020000_dashboard_live_activity.sql'
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      expect(sql).toContain("'completionEventId', NEW.completion_event_id")
    })

    it('18. verifies ineligible payload includes completionEventId in migration', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20260919020000_dashboard_live_activity.sql'
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      expect(sql).toContain("'completionEventId', v_completion_event_id")
    })

    it('19. verifies checking payload includes completionEventId in migration', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20260919020000_dashboard_live_activity.sql'
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      expect(sql).toContain('broadcast_audit_checking')
      expect(sql).toContain("'completionEventId', v_completion_event_id")
    })

    it('20. renders LiveActivity component across all stages and empty state', () => {
      const emptyHtml = renderToString(React.createElement(LiveActivity, { activities: [] }))
      expect(emptyHtml).toContain('Live Activity')
      expect(emptyHtml).toContain('No live workflow activity recorded in this session.')

      const populatedHtml = renderToString(
        React.createElement(LiveActivity, {
          activities: [
            {
              completionEventId: 'comp-1',
              customerName: 'Alice Springs',
              stage: 'CHECKING',
              createdAt: '2026-09-19T02:00:00Z',
              updatedAt: '2026-09-19T02:00:01Z',
            },
            {
              completionEventId: 'comp-2',
              customerName: 'Bob Vance',
              stage: 'BYPASSED',
              createdAt: '2026-09-19T02:00:00Z',
              updatedAt: '2026-09-19T02:00:02Z',
            },
          ],
        })
      )
      expect(populatedHtml).toContain('Alice Springs')
      expect(populatedHtml).toContain('CHECKING')
      expect(populatedHtml).toContain('Checking eligibility and safeguards')
      expect(populatedHtml).toContain('Bob Vance')
      expect(populatedHtml).toContain('BYPASSED')
      expect(populatedHtml).toContain('No request sent — policy rules applied')
    })
  })

  describe('J. Live Activity Reconciliation & Hardening', () => {
    it('1. focus reconciliation preserves liveActivity while updating snapshot data', () => {
      const state = createInitialState(orgId, dummySnapshot)
      state.liveActivity = [
        {
          completionEventId: 'comp-focus-1',
          customerName: 'Claire Redfield',
          stage: 'PREPARING',
          createdAt: '2026-09-19T02:00:00Z',
          updatedAt: '2026-09-19T02:00:05Z',
        },
      ]

      const updatedSnapshot: DashboardSnapshot = {
        ...dummySnapshot,
        kpis: { ...dummySnapshot.kpis, completedCount: 10 },
      }

      const next = dashboardReducer(state, {
        type: 'SNAPSHOT_RECONCILED',
        snapshot: updatedSnapshot,
        reason: 'focus',
        preserveLiveActivity: true,
      })

      expect(next.kpis.completedCount).toBe(10)
      expect(next.liveActivity.length).toBe(1)
      expect(next.liveActivity[0].customerName).toBe('Claire Redfield')
      expect(next.liveActivity[0].stage).toBe('PREPARING')
    })

    it('2. reconnect reconciliation follows truthful reset behavior (clears transient liveActivity)', () => {
      const state = createInitialState(orgId, dummySnapshot)
      state.liveActivity = [
        {
          completionEventId: 'comp-reconnect-1',
          customerName: 'Leon Kennedy',
          stage: 'CHECKING',
          createdAt: '2026-09-19T02:00:00Z',
          updatedAt: '2026-09-19T02:00:05Z',
        },
      ]

      const updatedSnapshot: DashboardSnapshot = {
        ...dummySnapshot,
        kpis: { ...dummySnapshot.kpis, completedCount: 11 },
      }

      const next = dashboardReducer(state, {
        type: 'SNAPSHOT_RECONCILED',
        snapshot: updatedSnapshot,
        reason: 'reconnect',
        preserveLiveActivity: false,
      })

      expect(next.kpis.completedCount).toBe(11)
      expect(next.liveActivity).toEqual([])
    })

    it('3. existing recentRequests row does not stop Live Activity progression and does not double-count KPIs', () => {
      const state = createInitialState(orgId, {
        ...dummySnapshot,
        recentRequests: [
          {
            id: 'req-existing',
            customer_id: 'cust-1',
            channel: 'email',
            status: 'SCHEDULED',
            token: 'token-abc',
            created_at: '2026-09-19T02:00:00Z',
            sent_at: null,
            clicked_at: null,
            customerName: 'Jill Valentine',
            recipientEmail: 'jill@example.test',
          },
        ],
      })
      state.liveActivity = [
        {
          completionEventId: 'comp-existing-1',
          customerName: 'Jill Valentine',
          stage: 'CHECKING',
          createdAt: '2026-09-19T02:00:00Z',
          updatedAt: '2026-09-19T02:00:01Z',
        },
      ]

      const initialEligibleCount = state.kpis.eligibleCount
      const initialScheduledCount = state.kpis.scheduledCount

      const createdEvent: ReviewRequestCreatedEvent = {
        id: 'evt-created-delayed',
        eventId: 'evt-created-delayed',
        type: 'review_request.created',
        organizationId: orgId,
        completionEventId: 'comp-existing-1',
        requestId: 'req-existing',
        customerId: 'cust-1',
        channel: 'email',
        status: 'SCHEDULED',
        createdAt: '2026-09-19T02:00:00Z',
        scheduledFor: '2026-09-19T02:05:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: createdEvent })

      expect(next.liveActivity[0].stage).toBe('PREPARING')
      expect(next.liveActivity[0].requestId).toBe('req-existing')
      expect(next.recentRequests.length).toBe(1)
      expect(next.kpis.eligibleCount).toBe(initialEligibleCount)
      expect(next.kpis.scheduledCount).toBe(initialScheduledCount)
    })

    it('4. existing SENT row + delayed SENT event can still resolve Live Activity to SENT without KPI double counting', () => {
      const state = createInitialState(orgId, {
        ...dummySnapshot,
        recentRequests: [
          {
            id: 'req-sent-1',
            customer_id: 'cust-1',
            channel: 'email',
            status: 'SENT',
            token: 'token-sent',
            created_at: '2026-09-19T02:00:00Z',
            sent_at: '2026-09-19T02:01:00Z',
            clicked_at: null,
            customerName: 'Chris Redfield',
            recipientEmail: 'chris@example.test',
          },
        ],
      })
      state.liveActivity = [
        {
          completionEventId: 'comp-sent-delayed',
          requestId: 'req-sent-1',
          customerName: 'Chris Redfield',
          stage: 'PREPARING',
          createdAt: '2026-09-19T02:00:00Z',
          updatedAt: '2026-09-19T02:00:05Z',
        },
      ]

      const initialSentCount = state.kpis.sentCount

      const updatedSentEvent: ReviewRequestUpdatedEvent = {
        id: 'evt-updated-delayed-sent',
        eventId: 'evt-updated-delayed-sent',
        type: 'review_request.updated',
        organizationId: orgId,
        completionEventId: 'comp-sent-delayed',
        requestId: 'req-sent-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'SENDING',
        status: 'SENT',
        sentAt: '2026-09-19T02:01:00Z',
        updatedAt: '2026-09-19T02:01:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: updatedSentEvent })

      expect(next.liveActivity[0].stage).toBe('SENT')
      expect(next.recentRequests.length).toBe(1)
      expect(next.kpis.sentCount).toBe(initialSentCount)
    })

    it('5. renders LiveActivity header with corrected copy and includes animation & reduced-motion classes', () => {
      const html = renderToString(
        React.createElement(LiveActivity, {
          activities: [
            {
              completionEventId: 'comp-anim-1',
              customerName: 'Ada Wong',
              stage: 'PREPARING',
              createdAt: '2026-09-19T02:00:00Z',
              updatedAt: '2026-09-19T02:00:02Z',
            },
          ],
        })
      )

      expect(html).toContain('1 in this session')
      expect(html).not.toContain('active in session')

      expect(html).toContain('animate-status-crossfade')
      expect(html).toContain('motion-reduce:animate-none')
      expect(html).toContain('motion-reduce:transition-none')

      const completedHtml = renderToString(
        React.createElement(LiveActivity, {
          activities: [
            {
              completionEventId: 'comp-anim-2',
              customerName: 'Ada Wong',
              stage: 'SENT',
              createdAt: '2026-09-19T02:00:00Z',
              updatedAt: '2026-09-19T02:01:00Z',
            },
          ],
        })
      )
      expect(completedHtml).toContain('animate-checkmark-in')
    })

    it('6. verifies globals.css includes live-status-enter and checkmark-scale with reduced-motion overrides', () => {
      const cssPath = path.resolve(__dirname, '../../src/app/globals.css')
      const css = fs.readFileSync(cssPath, 'utf8')

      expect(css).toContain('@keyframes live-status-enter')
      expect(css).toContain('translateY(3px)')
      expect(css).toContain('@keyframes checkmark-scale')
      expect(css).toContain('scale(0.65)')
      expect(css).toContain('.animate-status-crossfade')
      expect(css).toContain('.animate-checkmark-in')
      expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    })
  })

  describe('K. Reorganized Dashboard Layout & Sidebar Cards', () => {
    it('1. KPI cards render all five real metrics with zero fabricated trend indicators', () => {
      const html = renderToString(
        React.createElement(DashboardKpis, {
          kpis: dummySnapshot.kpis,
          highlightedKey: null,
        })
      )

      // All 5 real metrics:
      expect(html).toContain('Completed Customers')
      expect(html).toContain('Eligible Requests')
      expect(html).toContain('Requests Scheduled')
      expect(html).toContain('Invitations Sent')
      expect(html).toContain('Feedback Link Clicks')

      // Zero fabricated metrics:
      expect(html).not.toContain('+ today')
      expect(html).not.toContain('+2 today')
      expect(html).not.toContain('growth')
      expect(html).not.toContain('conversion')
      expect(html).not.toContain('ROI')
      expect(html).not.toContain('star rating')
    })

    it('2. System status card maps all four status states correctly and renders failed count', () => {
      // 1. RUNNING
      const runningHtml = renderToString(
        React.createElement(SystemStatusCard, {
          status: 'RUNNING',
          statusDescription: 'Review request workflow actively processing completions.',
          failedCount: 0,
        })
      )
      expect(runningHtml).toContain('Running')
      expect(runningHtml).toContain('bg-emerald-950')
      expect(runningHtml).toContain('Failed dispatches')
      expect(runningHtml).toContain('Neutral solicitation')
      expect(runningHtml).toContain('Review gating')
      expect(runningHtml).toContain('Truthful Guarantee')

      // 2. READY_FOR_SYNTHETIC_TEST
      const readyHtml = renderToString(
        React.createElement(SystemStatusCard, {
          status: 'READY_FOR_SYNTHETIC_TEST',
          statusDescription: 'Ready for synthetic validation.',
          failedCount: 0,
        })
      )
      expect(readyHtml).toContain('Ready for Test')
      expect(readyHtml).toContain('bg-blue-950')

      // 3. SETUP_REQUIRED
      const setupHtml = renderToString(
        React.createElement(SystemStatusCard, {
          status: 'SETUP_REQUIRED',
          statusDescription: 'No locations configured.',
          failedCount: 0,
          locationsNeedingDestinationCount: 2,
        })
      )
      expect(setupHtml).toContain('Setup Required')
      expect(setupHtml).toContain('bg-amber-950')
      expect(setupHtml).toContain('Configure Review Destination →')

      // 4. NEEDS_ATTENTION with failedCount > 0
      const attentionHtml = renderToString(
        React.createElement(SystemStatusCard, {
          status: 'NEEDS_ATTENTION',
          statusDescription: 'Operational issues detected.',
          failedCount: 3,
        })
      )
      expect(attentionHtml).toContain('Needs Attention')
      expect(attentionHtml).toContain('bg-rose-950')
      expect(attentionHtml).toContain('text-rose-400')
      expect(attentionHtml).toContain('3')
    })

    it('3. Informational bypass does not masquerade as failed system status in NeedsAttentionCard', () => {
      // Empty state
      const emptyHtml = renderToString(React.createElement(NeedsAttentionCard, { items: [] }))
      expect(emptyHtml).toContain('Needs Attention')
      expect(emptyHtml).toContain('No operational issues detected.')

      // Only info item
      const infoHtml = renderToString(
        React.createElement(NeedsAttentionCard, {
          items: [
            {
              id: 'ineligible-suppressed',
              severity: 'info',
              title: 'Completions Bypassed by Policy',
              description: '2 customer completion(s) were safely bypassed.',
            },
          ],
        })
      )
      expect(infoHtml).toContain('Completions Bypassed by Policy')
      expect(infoHtml).toContain('1 condition')
      expect(infoHtml).not.toContain('border-rose-900') // Not error styled
      expect(infoHtml).toContain('bg-slate-800')
    })

    it('4. QuickLinksCard links exclusively to valid active application routes', () => {
      const html = renderToString(React.createElement(QuickLinksCard))
      expect(html).toContain('Quick Links')
      expect(html).toContain('/app/quick-complete')
      expect(html).toContain('/app/settings/location')
      expect(html).toContain('/app/settings/review-destination')

      // Ensure no fictional settings routes
      expect(html).not.toContain('href="/app/settings"')
      expect(html).not.toContain('href="/app/settings/general"')
    })

    it('5. RecentActivity renders compact desktop table and mobile stacked cards with test links', () => {
      const html = renderToString(
        React.createElement(RecentActivity, {
          requests: dummySnapshot.recentRequests,
          orgName: 'Northstar Clinic',
          highlightedRowId: null,
        })
      )

      // Desktop table elements
      expect(html).toContain('<table')
      expect(html).toContain('<thead')
      expect(html).toContain('Customer')
      expect(html).toContain('Channel')
      expect(html).toContain('Status')
      expect(html).toContain('Created')
      expect(html).toContain('Clicked')
      expect(html).toContain('Actions')

      // Data rendering
      expect(html).toContain('Alice Smith')
      expect(html).toContain('alice@example.test')
      expect(html).toContain('SENT')
      expect(html).toContain('Test Link ↗')
      expect(html).toContain('Preview')

      // Mobile responsive elements
      expect(html).toContain('md:hidden')
      expect(html).toContain('hidden md:block')
    })

    it('6. LiveActivity renders 3-column desktop layout and mobile stacked layout', () => {
      const html = renderToString(
        React.createElement(LiveActivity, {
          activities: [
            {
              completionEventId: 'comp-col-test',
              customerName: 'Marcus Holloway',
              stage: 'CHECKING',
              createdAt: '2026-09-19T02:00:00Z',
              updatedAt: '2026-09-19T02:00:01Z',
            },
          ],
        })
      )

      // Desktop 3-column layout classes
      expect(html).toContain('hidden md:grid md:grid-cols-[200px_1fr_210px]')
      // Mobile stacked layout classes
      expect(html).toContain('md:hidden')
      expect(html).toContain('Marcus Holloway')
      expect(html).toContain('Checking eligibility and safeguards')
      expect(html).toContain('1 in this session')
    })

    it('7. verifies live-dashboard.tsx layout implements approved responsive layout and eliminates redundant bottom cards', () => {
      const componentPath = path.resolve(
        __dirname,
        '../../src/app/app/dashboard/live-dashboard.tsx'
      )
      const code = fs.readFileSync(componentPath, 'utf8')

      // Grid definition
      expect(code).toContain('xl:grid-cols-[minmax(0,1fr)_340px]')

      // Primary operational modules
      expect(code).toContain('<ActivityPanel')
      expect(code).toContain('<SystemStatusPanel')
      expect(code).toContain('<DashboardKpis')

      // Redundant quick-link bottom cards must NOT be rendered
      expect(code).not.toContain('<QuickLinksCard')

      // Header structure
      expect(code).toContain('Good morning,')
      expect(code).toContain('+ Quick Complete')
    })
  })

  describe('N. Live Activity Data Integrity & BYPASSED Lifecycle (Staging Bug Fix)', () => {
    const testOrgId = '655b20ad-b798-410c-8b14-14cab68040bd'

    it('1. customer.completed immediately appears in Live Activity', () => {
      const state = createInitialState(testOrgId, {
        ...dummySnapshot,
        liveActivity: [],
      })
      const event: CustomerCompletedEvent = {
        id: 'evt-cce-1',
        eventId: 'evt-cce-1',
        type: 'customer.completed',
        organizationId: testOrgId,
        completionEventId: 'comp-100',
        completedAt: '2026-09-20T08:00:00Z',
        createdAt: '2026-09-20T08:00:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.liveActivity.length).toBe(1)
      expect(next.liveActivity[0].completionEventId).toBe('comp-100')
      expect(next.liveActivity[0].stage).toBe('RECEIVED')
      expect(next.liveActivity[0].customerName).toBe('Customer')
      expect(next.kpis.completedCount).toBe(dummySnapshot.kpis.completedCount + 1)
    })

    it('2. review_request.ineligible transitions that item to BYPASSED with policyReason', () => {
      const state = createInitialState(testOrgId, {
        ...dummySnapshot,
        liveActivity: [
          {
            completionEventId: 'comp-100',
            customerName: 'Malcolm Patem',
            stage: 'CHECKING',
            createdAt: '2026-09-20T08:00:00Z',
            updatedAt: '2026-09-20T08:00:01Z',
          },
        ],
      })

      const ineligEvent: ReviewRequestIneligibleEvent = {
        id: 'audit-inelig-1',
        auditEventId: 'audit-inelig-1',
        type: 'review_request.ineligible',
        organizationId: testOrgId,
        completionEventId: 'comp-100',
        decision: 'LOCATION_INACTIVE',
        reason: 'Location status is NOT_FOUND',
        createdAt: '2026-09-20T08:00:02Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: ineligEvent })
      expect(next.liveActivity.length).toBe(1)
      expect(next.liveActivity[0].completionEventId).toBe('comp-100')
      expect(next.liveActivity[0].stage).toBe('BYPASSED')
      expect(next.liveActivity[0].customerName).toBe('Malcolm Patem')
      expect(next.liveActivity[0].policyReason).toBe(
        formatPolicyReason(ineligEvent.reason, ineligEvent.decision)
      )
      expect(next.liveActivity[0].policyReason).toBe('Location inactive')
      expect(next.kpis.ineligibleCount).toBe(1)
      expect(next.recentRequests.length).toBe(dummySnapshot.recentRequests.length)
    })

    it('3. BYPASSED renders visibly in ActivityPanel with title, customer name, policy reason, and neutral/amber badge', () => {
      const html = renderToString(
        React.createElement(ActivityPanel, {
          liveActivities: [
            {
              completionEventId: 'comp-100',
              customerName: 'Malcolm Patem',
              stage: 'BYPASSED',
              policyReason: 'Location inactive',
              createdAt: '2026-09-20T08:00:00Z',
              updatedAt: '2026-09-20T08:00:02Z',
            },
          ],
          recentRequests: [],
          orgName: 'Northstar Dental Test',
        })
      )

      expect(html).toContain('Bypassed by policy')
      expect(html).toContain('Malcolm Patem – Location inactive')
      expect(html).toContain('bg-amber-950/60')
      expect(html).not.toContain('No recent activity recorded yet')
    })

    it('4. BYPASSED completion does NOT create a Recent Solicitation row', () => {
      const state = createInitialState(testOrgId, {
        ...dummySnapshot,
        recentRequests: [],
        liveActivity: [
          {
            completionEventId: 'comp-100',
            customerName: 'Malcolm Patem',
            stage: 'BYPASSED',
            policyReason: 'Location inactive',
            createdAt: '2026-09-20T08:00:00Z',
            updatedAt: '2026-09-20T08:00:02Z',
          },
        ],
      })

      // Verification: Live Activity contains the bypassed completion, but recentRequests remains strictly empty
      expect(state.liveActivity.length).toBe(1)
      expect(state.liveActivity[0].stage).toBe('BYPASSED')
      expect(state.recentRequests).toEqual([])

      // Also verify when passed to ActivityPanel, recentRequests is empty
      const html = renderToString(
        React.createElement(ActivityPanel, {
          liveActivities: state.liveActivity,
          recentRequests: state.recentRequests,
          orgName: 'Northstar Dental Test',
        })
      )

      expect(html).toContain('Bypassed by policy')
      expect(html).toContain('Malcolm Patem – Location inactive')
      expect(html).not.toContain('Review request dispatched')
      expect(html).not.toContain('Invitation sent')
    })

    it('5. dashboard reload/reconciliation retains recent persisted completion activity', () => {
      const persistedActivity: LiveActivityItem[] = [
        {
          completionEventId: 'comp-persisted-1',
          customerName: 'Malcolm Patem',
          stage: 'BYPASSED',
          policyReason: 'Location inactive',
          createdAt: '2026-09-20T08:00:00Z',
          updatedAt: '2026-09-20T08:00:02Z',
        },
      ]

      // Initial state creation simulates initial page load
      const state = createInitialState(testOrgId, {
        ...dummySnapshot,
        liveActivity: persistedActivity,
      })
      expect(state.liveActivity.length).toBe(1)
      expect(state.liveActivity[0].stage).toBe('BYPASSED')
      expect(state.liveActivity[0].customerName).toBe('Malcolm Patem')

      // SNAPSHOT_RECONCILED simulates focus or reconnect
      const reconciledSnapshot: DashboardSnapshot = {
        ...dummySnapshot,
        liveActivity: persistedActivity,
      }

      const next = dashboardReducer(state, {
        type: 'SNAPSHOT_RECONCILED',
        snapshot: reconciledSnapshot,
        preserveLiveActivity: true,
      })

      expect(next.liveActivity.length).toBe(1)
      expect(next.liveActivity[0].completionEventId).toBe('comp-persisted-1')
      expect(next.liveActivity[0].stage).toBe('BYPASSED')
    })

    it('6. actual review_request creation appears in Recent Solicitations and updates Live Activity to PREPARING', () => {
      const state = createInitialState(testOrgId, {
        ...dummySnapshot,
        recentRequests: [],
        liveActivity: [
          {
            completionEventId: 'comp-eligible',
            customerName: 'Claire Redfield',
            stage: 'CHECKING',
            createdAt: '2026-09-20T08:00:00Z',
            updatedAt: '2026-09-20T08:00:01Z',
          },
        ],
      })

      const createdEvent: ReviewRequestCreatedEvent = {
        id: 'evt-rr-create',
        eventId: 'evt-rr-create',
        type: 'review_request.created',
        organizationId: testOrgId,
        completionEventId: 'comp-eligible',
        requestId: 'req-new-1',
        customerId: 'cust-claire',
        channel: 'email',
        status: 'SCHEDULED',
        scheduledFor: '2026-09-20T08:05:00Z',
        createdAt: '2026-09-20T08:00:03Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: createdEvent })
      expect(next.recentRequests.length).toBe(1)
      expect(next.recentRequests[0].id).toBe('req-new-1')
      expect(next.liveActivity[0].stage).toBe('PREPARING')
      expect(next.liveActivity[0].requestId).toBe('req-new-1')
      expect(next.kpis.eligibleCount).toBe(dummySnapshot.kpis.eligibleCount + 1)
      expect(next.kpis.scheduledCount).toBe(dummySnapshot.kpis.scheduledCount + 1)
    })

    it('7. snapshot + realtime merging does not duplicate rows', () => {
      const currentActivity: LiveActivityItem[] = [
        {
          completionEventId: 'comp-100',
          customerName: 'Malcolm Patem',
          stage: 'BYPASSED',
          policyReason: 'Location inactive',
          createdAt: '2026-09-20T08:00:00Z',
          updatedAt: '2026-09-20T08:00:02Z',
        },
      ]

      const incomingSnapshotActivity: LiveActivityItem[] = [
        {
          completionEventId: 'comp-100',
          customerName: 'Customer',
          stage: 'BYPASSED',
          policyReason: 'Location inactive',
          createdAt: '2026-09-20T08:00:00Z',
          updatedAt: '2026-09-20T08:00:02Z',
        },
        {
          completionEventId: 'comp-200',
          customerName: 'Jill Valentine',
          stage: 'SENT',
          createdAt: '2026-09-20T07:00:00Z',
          updatedAt: '2026-09-20T07:01:00Z',
        },
      ]

      const merged = mergeLiveActivity(currentActivity, incomingSnapshotActivity)
      expect(merged.length).toBe(2)
      // comp-100 retains the enriched customerName 'Malcolm Patem'
      const comp100 = merged.find((m) => m.completionEventId === 'comp-100')
      expect(comp100?.customerName).toBe('Malcolm Patem')
      expect(comp100?.stage).toBe('BYPASSED')
      expect(comp100?.policyReason).toBe('Location inactive')
    })

    it('8. tenant isolation remains strictly enforced', () => {
      const state = createInitialState(testOrgId, dummySnapshot)
      const foreignOrgId = '99999999-9999-9999-9999-999999999999'

      const foreignEvent: CustomerCompletedEvent = {
        id: 'evt-foreign',
        eventId: 'evt-foreign',
        type: 'customer.completed',
        organizationId: foreignOrgId,
        completionEventId: 'comp-foreign',
        completedAt: '2026-09-20T08:00:00Z',
        createdAt: '2026-09-20T08:00:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: foreignEvent })
      expect(next).toBe(state) // Exact referential equality, no mutations
      expect(next.kpis.completedCount).toBe(dummySnapshot.kpis.completedCount)
    })

    it('9. duplicate completion event does not double-count completedCount KPI', () => {
      const state = createInitialState(testOrgId, dummySnapshot)
      const event: CustomerCompletedEvent = {
        id: 'evt-dup',
        eventId: 'evt-dup',
        type: 'customer.completed',
        organizationId: testOrgId,
        completionEventId: 'comp-dup-1',
        completedAt: '2026-09-20T08:00:00Z',
        createdAt: '2026-09-20T08:00:00Z',
      }

      const once = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(once.kpis.completedCount).toBe(dummySnapshot.kpis.completedCount + 1)

      // Re-delivery of the exact same event ID
      const twice = dashboardReducer(once, { type: 'EVENT_RECEIVED', event })
      expect(twice.kpis.completedCount).toBe(once.kpis.completedCount)
      expect(twice.liveActivity.length).toBe(1)
    })

    it('10. deriveLiveActivity pure projection correctly projects completions, requests, audits, and customer names', () => {
      const completions = [
        { id: 'c-1', customer_id: 'cust-1', created_at: '2026-09-20T08:00:00Z' },
        { id: 'c-2', customer_id: 'cust-2', created_at: '2026-09-20T07:00:00Z' },
        { id: 'c-3', customer_id: 'cust-3', created_at: '2026-09-20T06:00:00Z' },
      ]

      const requests = [
        { id: 'req-1', completion_event_id: 'c-1', status: 'SENT', updated_at: '2026-09-20T08:01:00Z' },
      ]

      const auditEvents = [
        {
          id: 'ae-2',
          metadata: { completionEventId: 'c-2', decision: 'NO_REVIEW_DESTINATION', reason: 'No Google place configured' },
          created_at: '2026-09-20T07:00:01Z',
        },
      ]

      const customerMap = {
        'cust-1': { first_name: 'Alice', last_name: 'Walker' },
        'cust-2': { first_name: 'Bob', last_name: 'Builder' },
        'cust-3': { first_name: 'Charlie', last_name: null },
      }

      const projected = deriveLiveActivity(completions, requests, auditEvents, customerMap)
      expect(projected.length).toBe(3)

      expect(projected[0]).toEqual({
        completionEventId: 'c-1',
        requestId: 'req-1',
        customerName: 'Alice Walker',
        stage: 'SENT',
        policyReason: undefined,
        createdAt: '2026-09-20T08:00:00Z',
        updatedAt: '2026-09-20T08:01:00Z',
      })

      expect(projected[1]).toEqual({
        completionEventId: 'c-2',
        requestId: undefined,
        customerName: 'Bob Builder',
        stage: 'BYPASSED',
        policyReason: 'No review destination configured',
        createdAt: '2026-09-20T07:00:00Z',
        updatedAt: '2026-09-20T07:00:01Z',
      })

      expect(projected[2]).toEqual({
        completionEventId: 'c-3',
        requestId: undefined,
        customerName: 'Charlie',
        stage: 'RECEIVED',
        policyReason: undefined,
        createdAt: '2026-09-20T06:00:00Z',
        updatedAt: '2026-09-20T06:00:00Z',
      })
    })
  })
})