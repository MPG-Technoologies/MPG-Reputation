export type ReviewRequestStatus =
  | 'SCHEDULED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'CLICKED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SUPPRESSED'

export interface CustomerCompletedEvent {
  id?: string
  type: 'customer.completed'
  organizationId: string
  completionEventId: string
  completedAt: string
  createdAt: string
}

export interface ReviewRequestCreatedEvent {
  id?: string
  type: 'review_request.created'
  organizationId: string
  requestId: string
  customerId: string
  channel: 'email' | 'sms'
  status: ReviewRequestStatus
  createdAt: string
  scheduledFor: string
}

export interface ReviewRequestUpdatedEvent {
  id?: string
  type: 'review_request.updated'
  organizationId: string
  requestId: string
  customerId: string
  channel: 'email' | 'sms'
  previousStatus: ReviewRequestStatus | string
  status: ReviewRequestStatus
  sentAt?: string | null
  clickedAt?: string | null
  failedAt?: string | null
  updatedAt: string
}

export type DashboardRealtimeEvent =
  | CustomerCompletedEvent
  | ReviewRequestCreatedEvent
  | ReviewRequestUpdatedEvent

export interface DashboardKpis {
  completedCount: number
  eligibleCount: number
  scheduledCount: number
  sentCount: number
  clickedCount: number
  failedCount: number
  outboxFailedCount?: number
  ineligibleCount?: number
}

export interface ActivityRequestItem {
  id: string
  customer_id: string
  channel: string
  status: ReviewRequestStatus | string
  token: string
  created_at: string
  sent_at: string | null
  clicked_at: string | null
  error_message?: string | null
  customerName: string
  recipientEmail: string
}

export interface AttentionItem {
  id: string
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
}

export type SystemStatus =
  | 'SETUP_REQUIRED'
  | 'READY_FOR_SYNTHETIC_TEST'
  | 'RUNNING'
  | 'NEEDS_ATTENTION'

export interface DashboardSnapshot {
  kpis: DashboardKpis
  recentRequests: ActivityRequestItem[]
  systemStatus: SystemStatus
  statusDescription: string
  attentionItems: AttentionItem[]
  locationsNeedingDestinationCount: number
}

export type ConnectionState =
  | 'LIVE'
  | 'RECONNECTING'
  | 'SYNCING'
  | 'OFFLINE'

export interface DashboardState {
  organizationId: string
  kpis: DashboardKpis
  recentRequests: ActivityRequestItem[]
  systemStatus: SystemStatus
  statusDescription: string
  attentionItems: AttentionItem[]
  connectionState: ConnectionState
  highlightedKpiKey: keyof DashboardKpis | null
  highlightedRowId: string | null
  announcement: string | null
  processedEventIds: string[]
}
