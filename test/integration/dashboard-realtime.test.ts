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
  DashboardRealtimeEvent,
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

describe('Dashboard Realtime Synchronization Engine (Section 19)', () => {
  describe('A. Pure Reducer KPI State Transitions', () => {
    it('1. customer.completed increments completedCount by 1', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: CustomerCompletedEvent = {
        id: 'evt-1',
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
    })

    it('2. review_request.created with SCHEDULED increments eligibleCount and scheduledCount', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestCreatedEvent = {
        id: 'evt-2',
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
      }
      const secondPass = dashboardReducer(firstPass, {
        type: 'EVENT_RECEIVED',
        event: duplicateEvent,
      })
      expect(secondPass.kpis.clickedCount).toBe(2) // Kept at 2!
    })

    it('6. counts never go below zero', () => {
      const zeroSnapshot: DashboardSnapshot = {
        ...dummySnapshot,
        kpis: {
          ...dummySnapshot.kpis,
          scheduledCount: 0,
          sentCount: 0,
        },
      }
      const state = createInitialState(orgId, zeroSnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-zero',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-nonexistent',
        customerId: 'cust-x',
        channel: 'email',
        previousStatus: 'SCHEDULED',
        status: 'FAILED',
        updatedAt: '2026-09-18T10:30:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.scheduledCount).toBe(0)
      expect(next.kpis.sentCount).toBe(0)
      expect(next.kpis.failedCount).toBe(1)
    })

    it('7. transition to FAILED updates system status to NEEDS_ATTENTION', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-fail',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-1',
        customerId: 'cust-1',
        channel: 'email',
        previousStatus: 'SENT',
        status: 'FAILED',
        failedAt: '2026-09-18T10:35:00Z',
        updatedAt: '2026-09-18T10:35:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      expect(next.kpis.failedCount).toBe(1)
      expect(next.systemStatus).toBe('NEEDS_ATTENTION')
      expect(next.statusDescription).toContain('Operational issues detected')
    })
  })

  describe('B. Realtime Payload Validation & Tenant Isolation', () => {
    it('1. ignores event intended for a different organization', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const foreignEvent: CustomerCompletedEvent = {
        id: 'foreign-evt',
        type: 'customer.completed',
        organizationId: '99999999-9999-9999-9999-999999999999',
        completionEventId: 'c-999',
        completedAt: '2026-09-18T10:40:00Z',
        createdAt: '2026-09-18T10:40:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: foreignEvent })
      expect(next).toBe(state)
      expect(next.kpis.completedCount).toBe(3)
    })

    it('2. ignores duplicate event ID', () => {
      const state = createInitialState(orgId, dummySnapshot)
      state.processedEventIds = ['already-processed-id']

      const duplicateEvent: CustomerCompletedEvent = {
        id: 'already-processed-id',
        type: 'customer.completed',
        organizationId: orgId,
        completionEventId: 'comp-x',
        completedAt: '2026-09-18T10:40:00Z',
        createdAt: '2026-09-18T10:40:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: duplicateEvent })
      expect(next).toBe(state)
      expect(next.kpis.completedCount).toBe(3)
    })

    it('3. safely ignores unknown event types', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const unknownEvent = {
        id: 'unknown-evt',
        type: 'unknown.type.event',
        organizationId: orgId,
      } as unknown as DashboardRealtimeEvent

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event: unknownEvent })
      expect(next.kpis).toEqual(state.kpis)
    })
  })

  describe('C. Activity List In-Place Updates', () => {
    it('1. updates matching activity row in-place while retaining customer info', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-update',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-2',
        customerId: 'cust-2',
        channel: 'email',
        previousStatus: 'SCHEDULED',
        status: 'SENT',
        sentAt: '2026-09-18T10:45:00Z',
        updatedAt: '2026-09-18T10:45:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      const row = next.recentRequests.find((r) => r.id === 'req-2')
      expect(row?.status).toBe('SENT')
      expect(row?.sent_at).toBe('2026-09-18T10:45:00Z')
      expect(row?.customerName).toBe('Bob Jones')
      expect(row?.recipientEmail).toBe('bob@example.test')
      expect(row?.token).toBe('token-def-456')
      expect(next.highlightedRowId).toBe('req-2')
    })

    it('2. unrelated row remains unchanged', () => {
      const state = createInitialState(orgId, dummySnapshot)
      const event: ReviewRequestUpdatedEvent = {
        id: 'evt-update',
        type: 'review_request.updated',
        organizationId: orgId,
        requestId: 'req-2',
        customerId: 'cust-2',
        channel: 'email',
        previousStatus: 'SCHEDULED',
        status: 'SENT',
        sentAt: '2026-09-18T10:45:00Z',
        updatedAt: '2026-09-18T10:45:00Z',
      }

      const next = dashboardReducer(state, { type: 'EVENT_RECEIVED', event })
      const unaffectedRow = next.recentRequests.find((r) => r.id === 'req-1')
      expect(unaffectedRow).toEqual(dummySnapshot.recentRequests[0])
    })
  })

  describe('D. Connection Status Indicator Component', () => {
    it('renders LIVE state with green dot and semantic text', () => {
      const html = renderToString(React.createElement(RealtimeStatus, { status: 'LIVE' }))
      expect(html).toContain('Live')
      expect(html).toContain('bg-emerald-400')
      expect(html).toContain('role="status"')
      expect(html).toContain('Realtime connection active: Live')
    })

    it('renders RECONNECTING state with amber dot and pulsing text', () => {
      const html = renderToString(React.createElement(RealtimeStatus, { status: 'RECONNECTING' }))
      expect(html).toContain('Reconnecting…')
      expect(html).toContain('bg-amber-400')
      expect(html).toContain('animate-pulse')
      expect(html).toContain('Realtime connection lost: Reconnecting…')
    })

    it('renders SYNCING state with blue dot', () => {
      const html = renderToString(React.createElement(RealtimeStatus, { status: 'SYNCING' }))
      expect(html).toContain('Syncing…')
      expect(html).toContain('bg-blue-400')
      expect(html).toContain('animate-pulse')
    })

    it('renders OFFLINE state with slate dot', () => {
      const html = renderToString(React.createElement(RealtimeStatus, { status: 'OFFLINE' }))
      expect(html).toContain('Offline')
      expect(html).toContain('bg-slate-500')
    })
  })

  describe('E. Data Privacy & Zero PII in Realtime Migration', () => {
    it('verifies migration SQL strictly omits token, token_hash, and customer contact data from payloads', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20260918235000_dashboard_realtime.sql'
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      // Must NOT include customer phone/email/contact in trigger payloads
      expect(sql).not.toContain("'phone'")
      expect(sql).not.toContain("'email'")
      expect(sql).not.toContain("'contact'")
      expect(sql).not.toContain("'token'")
      expect(sql).not.toContain("'token_hash'")

      // Must include topic format organization:<org_id>:dashboard
      expect(sql).toContain("organization:' || NEW.organization_id::text || ':dashboard")

      // Must define RLS policy on realtime.messages
      expect(sql).toContain('CREATE POLICY "Members can listen to their organization dashboard"')
      expect(sql).toContain('ON realtime.messages')

      // Must catch exceptions to preserve transaction safety
      expect(sql).toContain('EXCEPTION WHEN OTHERS THEN')
    })
  })

  describe('F. UI Components Render Cleanly', () => {
    it('DashboardKpis renders all 5 metrics with highlight support', () => {
      const html = renderToString(
        React.createElement(DashboardKpis, {
          kpis: dummySnapshot.kpis,
          highlightedKey: 'clickedCount',
        })
      )

      expect(html).toContain('Completed Customers')
      expect(html).toContain('Eligible Requests')
      expect(html).toContain('Requests Scheduled')
      expect(html).toContain('Invitations Sent')
      expect(html).toContain('Feedback Link Clicks')
      expect(html).toContain('border-blue-500/80') // highlighted border on clickedCount card
    })

    it('RecentActivity renders solicitation rows with Test Link and preview', () => {
      const html = renderToString(
        React.createElement(RecentActivity, {
          requests: dummySnapshot.recentRequests,
          orgName: 'Northstar Clinic',
          highlightedRowId: 'req-1',
        })
      )

      expect(html).toContain('Alice Smith')
      expect(html).toContain('Bob Jones')
      expect(html).toContain('Test Link ↗')
      expect(html).toContain('/r/token-abc-123')
      expect(html).toContain('Inspect Development Email Representation')
      expect(html).toContain('Northstar Clinic')
    })
  })
})
