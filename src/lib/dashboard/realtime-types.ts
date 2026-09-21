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
  eventId?: string
  type: 'customer.completed'
  organizationId: string
  completionEventId: string
  completedAt: string
  createdAt: string
}

export interface ReviewRequestCheckingEvent {
  id?: string
  eventId?: string
  type: 'review_request.checking'
  organizationId: string
  completionEventId: string
  createdAt: string
}

export interface ReviewRequestCreatedEvent {
  id?: string
  eventId?: string
  type: 'review_request.created'
  organizationId: string
  completionEventId?: string
  requestId: string
  customerId: string
  channel: 'email' | 'sms'
  status: ReviewRequestStatus
  createdAt: string
  scheduledFor: string
}

export interface ReviewRequestUpdatedEvent {
  id?: string
  eventId?: string
  type: 'review_request.updated'
  organizationId: string
  completionEventId?: string
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

export interface ReviewRequestIneligibleEvent {
  id?: string
  eventId?: string
  type: 'review_request.ineligible'
  organizationId: string
  completionEventId?: string
  auditEventId: string
  createdAt: string
  reason?: string
  decision?: string
}

export interface ReviewRequestBlockedByEntitlementEvent {
  id?: string
  eventId?: string
  type: 'review_request.blocked_by_entitlement'
  organizationId: string
  completionEventId: string
  auditEventId: string
  createdAt: string
  reason?: string
}

export type DashboardRealtimeEvent =
  | CustomerCompletedEvent
  | ReviewRequestCheckingEvent
  | ReviewRequestCreatedEvent
  | ReviewRequestUpdatedEvent
  | ReviewRequestIneligibleEvent
  | ReviewRequestBlockedByEntitlementEvent

export type LiveActivityStage =
  | 'RECEIVED'
  | 'CHECKING'
  | 'PREPARING'
  | 'SENT'
  | 'BYPASSED'
  | 'FAILED'

export interface LiveActivityItem {
  completionEventId: string
  requestId?: string
  customerName: string
  stage: LiveActivityStage
  createdAt: string
  updatedAt: string
  policyReason?: string
}

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
  delivered_at?: string | null
  reminded_at?: string | null
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

export interface SetupChecklistItem {
  id: string
  label: string
  complete: boolean
  description: string
}

export interface DashboardSnapshot {
  kpis: DashboardKpis
  recentRequests: ActivityRequestItem[]
  liveActivity?: LiveActivityItem[]
  systemStatus: SystemStatus
  statusDescription: string
  attentionItems: AttentionItem[]
  locationsNeedingDestinationCount: number
  setupChecklist?: SetupChecklistItem[]
  renderedAt?: string
}

export { formatPolicyReason } from '@/domain/eligibility'


export type ConnectionState =
  | 'LIVE'
  | 'RECONNECTING'
  | 'SYNCING'
  | 'OFFLINE'

export interface DashboardState {
  organizationId: string
  kpis: DashboardKpis
  recentRequests: ActivityRequestItem[]
  liveActivity: LiveActivityItem[]
  systemStatus: SystemStatus
  statusDescription: string
  attentionItems: AttentionItem[]
  setupChecklist: SetupChecklistItem[]
  locationsNeedingDestinationCount: number
  connectionState: ConnectionState
  highlightedKpiKey: keyof DashboardKpis | null
  highlightedRowId: string | null
  announcement: string | null
  processedEventIds: string[]
  processedCompletionEventIds: string[]
}
