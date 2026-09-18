import type {
  DashboardState,
  DashboardRealtimeEvent,
  DashboardSnapshot,
  ConnectionState,
  ActivityRequestItem,
  DashboardKpis,
  AttentionItem,
  SystemStatus,
  LiveActivityItem,
  LiveActivityStage,
} from './realtime-types'

export type DashboardAction =
  | { type: 'EVENT_RECEIVED'; event: DashboardRealtimeEvent }
  | { type: 'SNAPSHOT_RECONCILED'; snapshot: DashboardSnapshot }
  | { type: 'SET_CONNECTION_STATE'; connectionState: ConnectionState }
  | { type: 'CLEAR_HIGHLIGHTS' }
  | {
      type: 'SET_SINGLE_ROW_CUSTOMER'
      requestId: string
      customerName: string
      recipientEmail: string
      token: string
    }
  | {
      type: 'SET_LIVE_ACTIVITY_CUSTOMER'
      completionEventId: string
      customerName: string
    }

const SCHEDULED_SET = new Set(['SCHEDULED'])
const SENT_SET = new Set(['SENT', 'DELIVERED', 'CLICKED'])
const CLICKED_SET = new Set(['CLICKED'])
const FAILED_SET = new Set(['FAILED'])

const STAGE_RANK: Record<LiveActivityStage, number> = {
  RECEIVED: 1,
  CHECKING: 2,
  PREPARING: 3,
  SENT: 4,
  BYPASSED: 99,
  FAILED: 99,
}

function canAdvanceStage(current: LiveActivityStage, target: LiveActivityStage): boolean {
  if (current === target) return true
  if (current === 'BYPASSED' || current === 'SENT') return false
  if (current === 'FAILED') {
    return target === 'SENT' // Allow retry recovery to SENT if explicitly sent
  }
  if (target === 'BYPASSED' || target === 'FAILED') return true
  return STAGE_RANK[target] > STAGE_RANK[current]
}

function updateLiveActivityList(
  currentList: LiveActivityItem[],
  params: {
    completionEventId?: string
    requestId?: string
    targetStage: LiveActivityStage
    customerName?: string
    createdAt?: string
  }
): LiveActivityItem[] {
  const { completionEventId, requestId, targetStage, customerName, createdAt } = params
  const now = new Date().toISOString()

  // Find existing item by completionEventId or requestId
  const existingIdx = currentList.findIndex((item) => {
    if (completionEventId && item.completionEventId === completionEventId) return true
    if (requestId && item.requestId && item.requestId === requestId) return true
    return false
  })

  if (existingIdx >= 0) {
    const existingItem = currentList[existingIdx]
    const shouldAdvance = canAdvanceStage(existingItem.stage, targetStage)
    const updatedStage = shouldAdvance ? targetStage : existingItem.stage

    const updatedItem: LiveActivityItem = {
      ...existingItem,
      stage: updatedStage,
      requestId: requestId || existingItem.requestId,
      customerName: customerName || existingItem.customerName,
      updatedAt: now,
    }

    const nextList = [...currentList]
    nextList[existingIdx] = updatedItem
    return nextList
  }

  // If not found and we have completionEventId, create new item
  if (completionEventId) {
    const newItem: LiveActivityItem = {
      completionEventId,
      requestId,
      customerName: customerName || 'Customer',
      stage: targetStage,
      createdAt: createdAt || now,
      updatedAt: now,
    }
    return [newItem, ...currentList].slice(0, 5)
  }

  return currentList
}

function transitionCount(
  current: number,
  prev: string,
  next: string,
  set: Set<string>
): number {
  const wasIn = set.has(prev)
  const isIn = set.has(next)
  if (wasIn && !isIn) {
    return Math.max(0, current - 1)
  }
  if (!wasIn && isIn) {
    return current + 1
  }
  return current
}

export function createInitialState(
  organizationId: string,
  snapshot: DashboardSnapshot
): DashboardState {
  return {
    organizationId,
    kpis: { ...snapshot.kpis },
    recentRequests: snapshot.recentRequests.map((r) => ({ ...r })),
    liveActivity: [],
    systemStatus: snapshot.systemStatus,
    statusDescription: snapshot.statusDescription,
    attentionItems: snapshot.attentionItems.map((i) => ({ ...i })),
    connectionState: 'OFFLINE',
    highlightedKpiKey: null,
    highlightedRowId: null,
    announcement: null,
    processedEventIds: [],
    processedCompletionEventIds: [],
  }
}

export function dashboardReducer(
  state: DashboardState,
  action: DashboardAction
): DashboardState {
  switch (action.type) {
    case 'SET_CONNECTION_STATE':
      return {
        ...state,
        connectionState: action.connectionState,
      }

    case 'CLEAR_HIGHLIGHTS':
      return {
        ...state,
        highlightedKpiKey: null,
        highlightedRowId: null,
        announcement: null,
      }

    case 'SET_SINGLE_ROW_CUSTOMER': {
      const updatedRows = state.recentRequests.map((r) => {
        if (r.id === action.requestId) {
          return {
            ...r,
            customerName: action.customerName,
            recipientEmail: action.recipientEmail,
            token: action.token || r.token,
          }
        }
        return r
      })

      // Also update customerName in liveActivity if matching requestId exists
      const updatedLiveActivity = state.liveActivity.map((item) => {
        if (item.requestId === action.requestId && item.customerName === 'Customer') {
          return {
            ...item,
            customerName: action.customerName,
            updatedAt: new Date().toISOString(),
          }
        }
        return item
      })

      return {
        ...state,
        recentRequests: updatedRows,
        liveActivity: updatedLiveActivity,
      }
    }

    case 'SET_LIVE_ACTIVITY_CUSTOMER': {
      const updatedLiveActivity = state.liveActivity.map((item) => {
        if (item.completionEventId === action.completionEventId) {
          return {
            ...item,
            customerName: action.customerName,
            updatedAt: new Date().toISOString(),
          }
        }
        return item
      })

      return {
        ...state,
        liveActivity: updatedLiveActivity,
      }
    }

    case 'SNAPSHOT_RECONCILED': {
      return {
        ...state,
        kpis: { ...action.snapshot.kpis },
        recentRequests: action.snapshot.recentRequests.map((r) => ({ ...r })),
        liveActivity: [], // Clear transient session activity on authoritative snapshot reconciliation
        systemStatus: action.snapshot.systemStatus,
        statusDescription: action.snapshot.statusDescription,
        attentionItems: action.snapshot.attentionItems.map((i) => ({ ...i })),
      }
    }

    case 'EVENT_RECEIVED': {
      const { event } = action

      // 1. Organization boundary enforcement
      if (event.organizationId !== state.organizationId) {
        return state
      }

      // 2. Event deduplication via eventId, id, or auditEventId
      const eventId =
        event.eventId ||
        event.id ||
        ('auditEventId' in event ? event.auditEventId : undefined)
      if (eventId && state.processedEventIds.includes(eventId)) {
        return state
      }
      const nextEventIds = eventId
        ? [eventId, ...state.processedEventIds].slice(0, 100)
        : state.processedEventIds

      // A. Customer Completed Event
      if (event.type === 'customer.completed') {
        const isDuplicateCompletion = state.processedCompletionEventIds.includes(
          event.completionEventId
        )

        const nextCompletionIds = isDuplicateCompletion
          ? state.processedCompletionEventIds
          : [event.completionEventId, ...state.processedCompletionEventIds].slice(0, 100)

        const nextCompletedCount = isDuplicateCompletion
          ? state.kpis.completedCount
          : state.kpis.completedCount + 1

        const updatedLiveActivity = updateLiveActivityList(state.liveActivity, {
          completionEventId: event.completionEventId,
          targetStage: 'RECEIVED',
          customerName: 'Customer',
          createdAt: event.createdAt,
        })

        return {
          ...state,
          kpis: {
            ...state.kpis,
            completedCount: nextCompletedCount,
          },
          liveActivity: updatedLiveActivity,
          highlightedKpiKey: isDuplicateCompletion ? null : 'completedCount',
          highlightedRowId: null,
          announcement: `Completed Customers increased to ${nextCompletedCount}. Completion received.`,
          processedEventIds: nextEventIds,
          processedCompletionEventIds: nextCompletionIds,
        }
      }

      // B. Review Request Checking Event (Eligibility check started)
      if (event.type === 'review_request.checking') {
        const updatedLiveActivity = updateLiveActivityList(state.liveActivity, {
          completionEventId: event.completionEventId,
          targetStage: 'CHECKING',
          createdAt: event.createdAt,
        })

        return {
          ...state,
          liveActivity: updatedLiveActivity,
          announcement: 'Checking review request eligibility.',
          processedEventIds: nextEventIds,
        }
      }

      // C. Review Request Created Event
      if (event.type === 'review_request.created') {
        // Deduplication: ignore if request already in recentRequests
        if (state.recentRequests.some((r) => r.id === event.requestId)) {
          return {
            ...state,
            processedEventIds: nextEventIds,
          }
        }

        const nextEligibleCount = state.kpis.eligibleCount + 1
        const newKpis: DashboardKpis = {
          ...state.kpis,
          eligibleCount: nextEligibleCount,
        }

        const announcement = 'Preparing review invitation.'
        let highlightedKpiKey: keyof DashboardKpis | null = null

        if (event.status === 'SCHEDULED') {
          newKpis.scheduledCount = state.kpis.scheduledCount + 1
          highlightedKpiKey = 'scheduledCount'
        } else if (SENT_SET.has(event.status)) {
          newKpis.sentCount = state.kpis.sentCount + 1
          highlightedKpiKey = 'sentCount'
        }

        // Prepend placeholder row to Recent Solicitations
        const newRow: ActivityRequestItem = {
          id: event.requestId,
          customer_id: event.customerId,
          channel: event.channel,
          status: event.status,
          token: '',
          created_at: event.createdAt,
          sent_at: null,
          clicked_at: null,
          customerName: 'Customer',
          recipientEmail: 'unknown',
        }
        const nextRecentRequests = [newRow, ...state.recentRequests].slice(0, 10)

        // Live Activity evolves to PREPARING
        const updatedLiveActivity = updateLiveActivityList(state.liveActivity, {
          completionEventId: event.completionEventId,
          requestId: event.requestId,
          targetStage: 'PREPARING',
          createdAt: event.createdAt,
        })

        return {
          ...state,
          kpis: newKpis,
          recentRequests: nextRecentRequests,
          liveActivity: updatedLiveActivity,
          highlightedKpiKey,
          highlightedRowId: event.requestId,
          announcement,
          processedEventIds: nextEventIds,
        }
      }

      // D. Review Request Updated Event
      if (event.type === 'review_request.updated') {
        const prev = event.previousStatus
        const next = event.status

        // Idempotency: If existing row already has the target status, ignore duplicate update
        const existingRow = state.recentRequests.find((r) => r.id === event.requestId)
        if (existingRow && existingRow.status === next) {
          return {
            ...state,
            processedEventIds: nextEventIds,
          }
        }

        // Generic transition model
        const newKpis: DashboardKpis = {
          ...state.kpis,
          scheduledCount: transitionCount(state.kpis.scheduledCount, prev, next, SCHEDULED_SET),
          sentCount: transitionCount(state.kpis.sentCount, prev, next, SENT_SET),
          clickedCount: transitionCount(state.kpis.clickedCount, prev, next, CLICKED_SET),
          failedCount: transitionCount(state.kpis.failedCount, prev, next, FAILED_SET),
        }

        let highlightedKpiKey: keyof DashboardKpis | null = null
        let announcement = `Review request updated to ${next}.`

        if (newKpis.clickedCount > state.kpis.clickedCount) {
          highlightedKpiKey = 'clickedCount'
          announcement = 'Review request marked clicked.'
        } else if (newKpis.failedCount > state.kpis.failedCount) {
          highlightedKpiKey = 'failedCount'
          announcement = 'Review invitation dispatch failed.'
        } else if (newKpis.sentCount > state.kpis.sentCount) {
          highlightedKpiKey = 'sentCount'
          announcement = 'Review invitation sent.'
        } else if (newKpis.scheduledCount > state.kpis.scheduledCount) {
          highlightedKpiKey = 'scheduledCount'
          announcement = 'Review request scheduled.'
        }

        // Update recentRequests row
        let nextRecentRequests = state.recentRequests
        if (existingRow) {
          nextRecentRequests = state.recentRequests.map((row) => {
            if (row.id !== event.requestId) return row
            return {
              ...row,
              status: next,
              sent_at: event.sentAt !== undefined ? event.sentAt : row.sent_at,
              clicked_at: event.clickedAt !== undefined ? event.clickedAt : row.clicked_at,
            }
          })
        }

        // Live Activity stage determination
        let liveStage: LiveActivityStage = 'PREPARING'
        if (event.status === 'SENDING') {
          liveStage = 'PREPARING'
        } else if (SENT_SET.has(event.status)) {
          liveStage = 'SENT'
        } else if (FAILED_SET.has(event.status)) {
          liveStage = 'FAILED'
        }

        const updatedLiveActivity = updateLiveActivityList(state.liveActivity, {
          completionEventId: event.completionEventId,
          requestId: event.requestId,
          targetStage: liveStage,
        })

        // Needs Attention & System Status consistency
        let nextSystemStatus: SystemStatus = state.systemStatus
        let nextStatusDescription = state.statusDescription
        let nextAttentionItems: AttentionItem[] = [...state.attentionItems]

        if (newKpis.failedCount > 0) {
          nextSystemStatus = 'NEEDS_ATTENTION'
          nextStatusDescription = 'Operational issues detected in recent dispatches or outbox.'

          const failedIdx = nextAttentionItems.findIndex((i) => i.id === 'failed-requests')
          const failedItem: AttentionItem = {
            id: 'failed-requests',
            severity: 'error',
            title: 'Workflow Dispatch Failed',
            description: `${newKpis.failedCount} review request dispatch(es) recorded delivery failures. Please check email provider logs.`,
          }
          if (failedIdx >= 0) {
            nextAttentionItems[failedIdx] = failedItem
          } else {
            nextAttentionItems = [failedItem, ...nextAttentionItems]
          }
        } else {
          // failedCount === 0: remove failed-requests attention item
          nextAttentionItems = nextAttentionItems.filter((i) => i.id !== 'failed-requests')

          const hasErrors = nextAttentionItems.some((i) => i.severity === 'error')
          if (hasErrors || (newKpis.outboxFailedCount ?? 0) > 0) {
            nextSystemStatus = 'NEEDS_ATTENTION'
            nextStatusDescription = 'Operational issues detected in recent dispatches or outbox.'
          } else {
            // No failure conditions: return to authoritative status
            if (nextAttentionItems.some((i) => i.id === 'missing-location' || i.id === 'missing-destination')) {
              nextSystemStatus = 'SETUP_REQUIRED'
              nextStatusDescription = 'Initial setup required before requests can be dispatched.'
            } else if (newKpis.sentCount > 0) {
              nextSystemStatus = 'RUNNING'
              nextStatusDescription = 'Review request workflow actively processing completions.'
            } else {
              nextSystemStatus = 'READY_FOR_SYNTHETIC_TEST'
              nextStatusDescription =
                'All locations configured with confirmed review destinations. Ready for synthetic validation.'
            }
          }
        }

        return {
          ...state,
          kpis: newKpis,
          recentRequests: nextRecentRequests,
          liveActivity: updatedLiveActivity,
          systemStatus: nextSystemStatus,
          statusDescription: nextStatusDescription,
          attentionItems: nextAttentionItems,
          highlightedKpiKey,
          highlightedRowId: event.requestId,
          announcement,
          processedEventIds: nextEventIds,
        }
      }

      // E. Review Request Ineligible / Policy Bypass Event
      if (event.type === 'review_request.ineligible') {
        const nextIneligibleCount = (state.kpis.ineligibleCount ?? 0) + 1
        const newKpis: DashboardKpis = {
          ...state.kpis,
          ineligibleCount: nextIneligibleCount,
        }

        let nextAttentionItems: AttentionItem[] = [...state.attentionItems]
        const ineligibleIdx = nextAttentionItems.findIndex((i) => i.id === 'ineligible-suppressed')
        const ineligibleItem: AttentionItem = {
          id: 'ineligible-suppressed',
          severity: 'info',
          title: 'Completions Bypassed by Policy',
          description: `${nextIneligibleCount} customer completion(s) were safely bypassed due to missing customer consent, recent request cooldown, or suppression.`,
        }

        if (ineligibleIdx >= 0) {
          nextAttentionItems[ineligibleIdx] = ineligibleItem
        } else {
          nextAttentionItems = [...nextAttentionItems, ineligibleItem]
        }

        // Live Activity transitions to BYPASSED
        const updatedLiveActivity = updateLiveActivityList(state.liveActivity, {
          completionEventId: event.completionEventId,
          targetStage: 'BYPASSED',
        })

        return {
          ...state,
          kpis: newKpis,
          attentionItems: nextAttentionItems,
          liveActivity: updatedLiveActivity,
          highlightedKpiKey: 'ineligibleCount',
          highlightedRowId: null,
          announcement: `Completions bypassed by policy increased to ${nextIneligibleCount}. Completion bypassed by policy.`,
          processedEventIds: nextEventIds,
        }
      }

      return state
    }

    default:
      return state
  }
}
