import type {
  DashboardState,
  DashboardRealtimeEvent,
  DashboardSnapshot,
  ConnectionState,
  ActivityRequestItem,
  DashboardKpis,
  AttentionItem,
  SystemStatus,
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

const SCHEDULED_SET = new Set(['SCHEDULED'])
const SENT_SET = new Set(['SENT', 'DELIVERED', 'CLICKED'])
const CLICKED_SET = new Set(['CLICKED'])
const FAILED_SET = new Set(['FAILED'])

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
    case 'SET_CONNECTION_STATE': {
      if (state.connectionState === action.connectionState) {
        return state
      }
      return {
        ...state,
        connectionState: action.connectionState,
      }
    }

    case 'CLEAR_HIGHLIGHTS': {
      if (state.highlightedKpiKey === null && state.highlightedRowId === null) {
        return state
      }
      return {
        ...state,
        highlightedKpiKey: null,
        highlightedRowId: null,
      }
    }

    case 'SNAPSHOT_RECONCILED': {
      return {
        ...state,
        kpis: { ...action.snapshot.kpis },
        recentRequests: [...action.snapshot.recentRequests],
        systemStatus: action.snapshot.systemStatus,
        statusDescription: action.snapshot.statusDescription,
        attentionItems: [...action.snapshot.attentionItems],
        highlightedKpiKey: null,
        highlightedRowId: null,
        announcement: 'Dashboard reconciled with latest data.',
      }
    }

    case 'SET_SINGLE_ROW_CUSTOMER': {
      const idx = state.recentRequests.findIndex((r) => r.id === action.requestId)
      if (idx === -1) return state

      const updated = [...state.recentRequests]
      updated[idx] = {
        ...updated[idx],
        customerName: action.customerName,
        recipientEmail: action.recipientEmail,
        token: action.token,
      }
      return {
        ...state,
        recentRequests: updated,
      }
    }

    case 'EVENT_RECEIVED': {
      const event = action.event

      // 1. Organization boundary verification
      if (!event || event.organizationId !== state.organizationId) {
        return state
      }

      // 2. Event deduplication via eventId or id
      const eventId = event.eventId || event.id
      if (eventId && state.processedEventIds.includes(eventId)) {
        return state
      }

      const nextEventIds = eventId
        ? [eventId, ...state.processedEventIds.slice(0, 49)]
        : state.processedEventIds

      // A. Customer Completed Event
      if (event.type === 'customer.completed') {
        // Guard against duplicate completion event
        if (
          event.completionEventId &&
          state.processedCompletionEventIds.includes(event.completionEventId)
        ) {
          return {
            ...state,
            processedEventIds: nextEventIds,
          }
        }

        const nextCompletedCount = state.kpis.completedCount + 1
        const nextCompletionEventIds = event.completionEventId
          ? [event.completionEventId, ...state.processedCompletionEventIds.slice(0, 49)]
          : state.processedCompletionEventIds

        return {
          ...state,
          kpis: {
            ...state.kpis,
            completedCount: nextCompletedCount,
          },
          highlightedKpiKey: 'completedCount',
          highlightedRowId: null,
          announcement: `Completed Customers increased to ${nextCompletedCount}.`,
          processedEventIds: nextEventIds,
          processedCompletionEventIds: nextCompletionEventIds,
        }
      }

      // B. Review Request Created Event
      if (event.type === 'review_request.created') {
        const existingIdx = state.recentRequests.findIndex((r) => r.id === event.requestId)
        if (existingIdx !== -1) {
          // Already present, ignore duplicate creation
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

        let announcement = 'New review request created.'
        let highlightedKpiKey: keyof DashboardKpis | null = null

        if (event.status === 'SCHEDULED') {
          newKpis.scheduledCount = state.kpis.scheduledCount + 1
          highlightedKpiKey = 'scheduledCount'
          announcement = 'New review request scheduled.'
        } else if (SENT_SET.has(event.status)) {
          newKpis.sentCount = state.kpis.sentCount + 1
          highlightedKpiKey = 'sentCount'
          announcement = 'New review request sent.'
        }

        // Prepend placeholder row
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

        return {
          ...state,
          kpis: newKpis,
          recentRequests: nextRecentRequests,
          highlightedKpiKey,
          highlightedRowId: event.requestId,
          announcement,
          processedEventIds: nextEventIds,
        }
      }

      // C. Review Request Updated Event
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
          announcement = 'Review request dispatch failed.'
        } else if (newKpis.sentCount > state.kpis.sentCount) {
          highlightedKpiKey = 'sentCount'
          announcement = 'Review request sent.'
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
          systemStatus: nextSystemStatus,
          statusDescription: nextStatusDescription,
          attentionItems: nextAttentionItems,
          highlightedKpiKey,
          highlightedRowId: event.requestId,
          announcement,
          processedEventIds: nextEventIds,
        }
      }

      return state
    }

    default:
      return state
  }
}
