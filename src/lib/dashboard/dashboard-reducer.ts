import type {
  DashboardState,
  DashboardRealtimeEvent,
  DashboardSnapshot,
  ConnectionState,
  ActivityRequestItem,
  DashboardKpis,
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

export function createInitialState(
  organizationId: string,
  snapshot: DashboardSnapshot
): DashboardState {
  return {
    organizationId,
    kpis: { ...snapshot.kpis },
    recentRequests: [...snapshot.recentRequests],
    systemStatus: snapshot.systemStatus,
    statusDescription: snapshot.statusDescription,
    attentionItems: [...snapshot.attentionItems],
    connectionState: 'OFFLINE',
    highlightedKpiKey: null,
    highlightedRowId: null,
    announcement: null,
    processedEventIds: [],
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

      // 2. Event deduplication via event ID
      if (event.id && state.processedEventIds.includes(event.id)) {
        return state
      }

      const nextEventIds = event.id
        ? [event.id, ...state.processedEventIds.slice(0, 49)]
        : state.processedEventIds

      if (event.type === 'customer.completed') {
        const nextCompletedCount = state.kpis.completedCount + 1
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
        }
      }

      if (event.type === 'review_request.created') {
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
        } else if (['SENT', 'DELIVERED', 'CLICKED'].includes(event.status)) {
          newKpis.sentCount = state.kpis.sentCount + 1
          highlightedKpiKey = 'sentCount'
          announcement = 'New review request sent.'
        }

        // Prepend placeholder row if not already in recentRequests
        let nextRecentRequests = state.recentRequests
        const existingIdx = state.recentRequests.findIndex((r) => r.id === event.requestId)
        if (existingIdx === -1) {
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
          nextRecentRequests = [newRow, ...state.recentRequests].slice(0, 10)
        }

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

      if (event.type === 'review_request.updated') {
        const prev = event.previousStatus
        const next = event.status

        // Idempotency: If request already in recent list with same status, ignore duplicate
        const existingRow = state.recentRequests.find((r) => r.id === event.requestId)
        if (existingRow && existingRow.status === next) {
          // If already in target status (e.g. repeated click event), do not double-increment
          return {
            ...state,
            processedEventIds: nextEventIds,
          }
        }

        const newKpis: DashboardKpis = { ...state.kpis }
        let highlightedKpiKey: keyof DashboardKpis | null = null
        let announcement = `Review request updated to ${next}.`

        // Update scheduledCount
        if (prev === 'SCHEDULED' && next !== 'SCHEDULED') {
          newKpis.scheduledCount = Math.max(0, newKpis.scheduledCount - 1)
        } else if (prev !== 'SCHEDULED' && next === 'SCHEDULED') {
          newKpis.scheduledCount = newKpis.scheduledCount + 1
          highlightedKpiKey = 'scheduledCount'
        }

        // Update sentCount: IN ('SENT', 'DELIVERED', 'CLICKED')
        const wasInSent = ['SENT', 'DELIVERED', 'CLICKED'].includes(prev)
        const isInSent = ['SENT', 'DELIVERED', 'CLICKED'].includes(next)
        if (!wasInSent && isInSent) {
          newKpis.sentCount = newKpis.sentCount + 1
          highlightedKpiKey = 'sentCount'
        } else if (wasInSent && !isInSent) {
          newKpis.sentCount = Math.max(0, newKpis.sentCount - 1)
        }

        // Update clickedCount
        if (prev !== 'CLICKED' && next === 'CLICKED') {
          newKpis.clickedCount = newKpis.clickedCount + 1
          highlightedKpiKey = 'clickedCount'
          announcement = 'Review request marked clicked.'
        }

        // Update failedCount
        if (prev !== 'FAILED' && next === 'FAILED') {
          newKpis.failedCount = newKpis.failedCount + 1
          highlightedKpiKey = 'failedCount'
          announcement = 'Review request dispatch failed.'
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

        // System status adjustment if failures or sent count changed
        let systemStatus = state.systemStatus
        let statusDescription = state.statusDescription
        if (newKpis.failedCount > 0) {
          systemStatus = 'NEEDS_ATTENTION'
          statusDescription = 'Operational issues detected in recent dispatches or outbox.'
        } else if (
          state.systemStatus === 'NEEDS_ATTENTION' &&
          newKpis.failedCount === 0 &&
          (newKpis.outboxFailedCount ?? 0) === 0
        ) {
          if (newKpis.sentCount > 0) {
            systemStatus = 'RUNNING'
            statusDescription = 'Review request workflow actively processing completions.'
          } else {
            systemStatus = 'READY_FOR_SYNTHETIC_TEST'
            statusDescription =
              'All locations configured with confirmed review destinations. Ready for synthetic validation.'
          }
        } else if (state.systemStatus === 'READY_FOR_SYNTHETIC_TEST' && newKpis.sentCount > 0) {
          systemStatus = 'RUNNING'
          statusDescription = 'Review request workflow actively processing completions.'
        }

        return {
          ...state,
          kpis: newKpis,
          recentRequests: nextRecentRequests,
          systemStatus,
          statusDescription,
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
