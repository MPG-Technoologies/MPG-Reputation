import { formatPolicyReason } from '@/domain/eligibility'
import type { LiveActivityItem, LiveActivityStage } from './realtime-types'

export interface CompletionRecord {
  id: string
  customer_id: string
  created_at: string
}

export interface MatchedRequestRecord {
  id: string
  completion_event_id: string
  status: string
  created_at?: string
  updated_at?: string
}

export interface IneligibleAuditRecord {
  id: string
  metadata?: unknown
  created_at?: string
}

export interface CustomerNameRecord {
  first_name: string
  last_name: string | null
}

export function deriveLiveActivity(
  completions: CompletionRecord[],
  requests: MatchedRequestRecord[],
  auditEvents: IneligibleAuditRecord[],
  customerMap: Record<string, CustomerNameRecord>
): LiveActivityItem[] {
  if (!completions || completions.length === 0) {
    return []
  }

  // 1. Index requests by completion_event_id
  const requestByCompletionId = new Map<string, MatchedRequestRecord>()
  for (const req of requests) {
    if (req.completion_event_id) {
      requestByCompletionId.set(req.completion_event_id, req)
    }
  }

  // 2. Index ineligible audit events by completionEventId or eventId
  const ineligibleByCompletionId = new Map<string, IneligibleAuditRecord>()
  for (const audit of auditEvents) {
    const meta = (audit.metadata && typeof audit.metadata === 'object' ? audit.metadata : null) as Record<string, unknown> | null
    const completionId = meta?.completionEventId || meta?.eventId
    if (completionId && typeof completionId === 'string') {
      // Keep most recent if multiple
      if (!ineligibleByCompletionId.has(completionId)) {
        ineligibleByCompletionId.set(completionId, audit)
      }
    }
  }

  // 3. Project each completion
  const items: LiveActivityItem[] = []

  for (const comp of completions) {
    const req = requestByCompletionId.get(comp.id)
    const audit = ineligibleByCompletionId.get(comp.id)
    const cust = customerMap[comp.customer_id]
    const customerName = cust
      ? `${cust.first_name} ${cust.last_name || ''}`.trim() || 'Customer'
      : 'Customer'

    let stage: LiveActivityStage = 'RECEIVED'
    let policyReason: string | undefined
    let requestId: string | undefined
    let updatedAt: string = comp.created_at

    const auditMeta = (audit?.metadata && typeof audit.metadata === 'object' ? audit.metadata : null) as Record<string, unknown> | null

    if (req) {
      requestId = req.id
      updatedAt = req.updated_at || req.created_at || comp.created_at

      if (['SENT', 'DELIVERED', 'CLICKED'].includes(req.status)) {
        stage = 'SENT'
      } else if (req.status === 'FAILED') {
        stage = 'FAILED'
      } else if (['CANCELLED', 'SUPPRESSED'].includes(req.status)) {
        stage = 'BYPASSED'
        if (auditMeta) {
          policyReason = formatPolicyReason(
            typeof auditMeta.reason === 'string' ? auditMeta.reason : undefined,
            typeof auditMeta.decision === 'string' ? auditMeta.decision : undefined
          )
        }
      } else {
        // SCHEDULED, SENDING, or other in-flight status
        stage = 'PREPARING'
      }
    } else if (audit) {
      stage = 'BYPASSED'
      updatedAt = audit.created_at || comp.created_at
      if (auditMeta) {
        policyReason = formatPolicyReason(
          typeof auditMeta.reason === 'string' ? auditMeta.reason : undefined,
          typeof auditMeta.decision === 'string' ? auditMeta.decision : undefined
        )
      }
    } else {
      stage = 'RECEIVED'
    }

    items.push({
      completionEventId: comp.id,
      requestId,
      customerName,
      stage,
      policyReason,
      createdAt: comp.created_at,
      updatedAt,
    })
  }

  return items
}
