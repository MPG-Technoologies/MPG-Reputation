import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  dashboardReducer,
} from '@/lib/dashboard/dashboard-reducer'
import type { DashboardSnapshot } from '@/lib/dashboard/realtime-types'

describe('dashboard entitlement-blocked lifecycle', () => {
  it('moves an evaluating completion to bypassed without counting it as policy ineligible', () => {
    const snapshot: DashboardSnapshot = {
      kpis: {
        completedCount: 1,
        eligibleCount: 0,
        scheduledCount: 0,
        sentCount: 0,
        clickedCount: 0,
        failedCount: 0,
        ineligibleCount: 0,
      },
      recentRequests: [],
      liveActivity: [
        {
          completionEventId: 'completion-1',
          customerName: 'Test Customer',
          stage: 'CHECKING',
          createdAt: '2026-09-21T09:00:00.000Z',
          updatedAt: '2026-09-21T09:00:01.000Z',
        },
      ],
      systemStatus: 'RUNNING',
      statusDescription: 'Testing',
      attentionItems: [],
      locationsNeedingDestinationCount: 0,
      setupChecklist: [],
    }

    const state = createInitialState('org-1', snapshot)

    const next = dashboardReducer(state, {
      type: 'EVENT_RECEIVED',
      event: {
        id: 'audit-1',
        eventId: 'audit-1',
        type: 'review_request.blocked_by_entitlement',
        organizationId: 'org-1',
        completionEventId: 'completion-1',
        auditEventId: 'audit-1',
        createdAt: '2026-09-21T09:00:02.000Z',
        reason: 'TRIAL_NOT_ACTIVE',
      },
    })

    expect(next.liveActivity[0]?.stage).toBe('BYPASSED')
    expect(next.liveActivity[0]?.policyReason).toBe('Trial not active')
    expect(next.kpis.ineligibleCount).toBe(0)
  })
})
