import { Inngest } from 'inngest'
import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'

export interface OutboxDispatchResult {
  processed: number
  dispatched: number
  failed: number
  errors: Array<{ id: string; error: string }>
}

export interface OutboxDispatchOptions {
  batchSize?: number
  organizationId?: string
  eventId?: string
}

/**
 * Dispatch pending domain outbox events to Inngest with retry and deduplication.
 * Prompt Correction 2: A PENDING outbox record must not remain pending forever.
 *
 * MR-6D: eventId may narrow an authorized support recovery to one exact event.
 */
export async function dispatchPendingOutboxEvents(
  supabase: SupabaseClient<Database>,
  inngestClient: Inngest,
  options: OutboxDispatchOptions = {}
): Promise<OutboxDispatchResult> {
  const batchSize = options.batchSize || 25

  let query = supabase
    .from('domain_event_outbox')
    .select(
      'id, organization_id, event_type, aggregate_type, aggregate_id, payload, attempt_count'
    )
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (options.organizationId) {
    query = query.eq(
      'organization_id',
      options.organizationId
    )
  }

  if (options.eventId) {
    query = query.eq(
      'id',
      options.eventId
    )
  }

  const {
    data: pendingEvents,
    error: fetchErr,
  } = await query

  if (
    fetchErr ||
    !pendingEvents ||
    pendingEvents.length === 0
  ) {
    return {
      processed: 0,
      dispatched: 0,
      failed: 0,
      errors: [],
    }
  }

  let dispatched = 0
  let failed = 0

  const errors:
    Array<{ id: string; error: string }> = []

  for (const event of pendingEvents) {
    try {
      // Stable outbox ID is also the Inngest event
      // deduplication ID.
      await inngestClient.send({
        id: event.id,
        name:
          event.event_type as
            'customer.completed',
        data:
          event.payload as
            Record<string, unknown>,
      })

      await supabase
        .from('domain_event_outbox')
        .update({
          status: 'DISPATCHED',
          dispatched_at:
            new Date().toISOString(),
          attempt_count:
            event.attempt_count + 1,
          last_error: null,
        })
        .eq('id', event.id)

      dispatched++
    } catch (err: unknown) {
      failed++

      const sanitized = (
        err instanceof Error
          ? err.message
          : 'Inngest dispatch failed'
      ).slice(0, 500)

      errors.push({
        id: event.id,
        error: sanitized,
      })

      await supabase
        .from('domain_event_outbox')
        .update({
          status: 'PENDING',
          attempt_count:
            event.attempt_count + 1,
          last_error: sanitized,
        })
        .eq('id', event.id)
    }
  }

  return {
    processed: pendingEvents.length,
    dispatched,
    failed,
    errors,
  }
}
