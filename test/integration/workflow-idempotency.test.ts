import { describe, it, expect } from 'vitest'
import { normalizeQuickCompleteInput } from '../../src/domain/completion'
import { generateTrackingToken } from '../../src/domain/tracking'

interface StoredCompletionEvent {
  id: string
  organizationId: string
  source: string
  sourceEventId: string
  customerId: string
}

interface StoredReviewRequest {
  id: string
  completionEventId: string
  channel: string
  status: string
  token: string
}

class CompletionRepository {
  private events: StoredCompletionEvent[] = []
  private requests: StoredReviewRequest[] = []

  recordCompletion(input: {
    organizationId: string
    source: string
    sourceEventId: string
    customerId: string
  }): { duplicate: boolean; event: StoredCompletionEvent } {
    const existing = this.events.find(
      (e) =>
        e.organizationId === input.organizationId &&
        e.source === input.source &&
        e.sourceEventId === input.sourceEventId
    )

    if (existing) {
      return { duplicate: true, event: existing }
    }

    const newEvent: StoredCompletionEvent = {
      id: `cce-${this.events.length + 1}`,
      ...input,
    }
    this.events.push(newEvent)
    return { duplicate: false, event: newEvent }
  }

  createOrResolveReviewRequest(completionEventId: string, channel: string): { isNew: boolean; request: StoredReviewRequest } {
    const existing = this.requests.find(
      (r) => r.completionEventId === completionEventId && r.channel === channel
    )

    if (existing) {
      return { isNew: false, request: existing }
    }

    const { token } = generateTrackingToken()
    const newReq: StoredReviewRequest = {
      id: `rr-${this.requests.length + 1}`,
      completionEventId,
      channel,
      status: 'SENT',
      token,
    }
    this.requests.push(newReq)
    return { isNew: true, request: newReq }
  }
}

describe('Workflow & Completion Idempotency', () => {
  it('deduplicates identical completion submissions safely', () => {
    const repo = new CompletionRepository()
    const orgId = 'org-123'
    const locationId = 'loc-456'

    const norm = normalizeQuickCompleteInput({
      organizationId: orgId,
      locationId: locationId,
      firstName: 'Alice',
      email: 'alice@example.test',
      sourceEventId: 'stable-event-101',
    })

    expect(norm.valid).toBe(true)

    // First submission
    const res1 = repo.recordCompletion({
      organizationId: orgId,
      source: norm.canonical!.source,
      sourceEventId: norm.canonical!.source_event_id,
      customerId: 'cust-1',
    })

    expect(res1.duplicate).toBe(false)
    expect(res1.event.id).toBe('cce-1')

    // Second submission (user double-clicks "Complete Customer")
    const res2 = repo.recordCompletion({
      organizationId: orgId,
      source: norm.canonical!.source,
      sourceEventId: norm.canonical!.source_event_id,
      customerId: 'cust-1',
    })

    expect(res2.duplicate).toBe(true)
    expect(res2.event.id).toBe('cce-1') // References identical canonical completion event
  })

  it('ensures only one review request is produced across multiple workflow runs', () => {
    const repo = new CompletionRepository()
    const completionEventId = 'cce-1'

    // First workflow execution step
    const run1 = repo.createOrResolveReviewRequest(completionEventId, 'email')
    expect(run1.isNew).toBe(true)
    expect(run1.request.status).toBe('SENT')

    // Second workflow execution step (retry or double invocation)
    const run2 = repo.createOrResolveReviewRequest(completionEventId, 'email')
    expect(run2.isNew).toBe(false)
    expect(run2.request.id).toBe(run1.request.id)
    expect(run2.request.token).toBe(run1.request.token)
  })
})
