import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashSuppressionContact } from '@/domain/suppression'
import { applyProviderReviewRequestTransition } from '@/domain/review-request/cas'
import { sanitizeProviderError } from '@/domain/review-request/sanitizer'

interface ResendWebhookPayload {
  type: string
  created_at?: string
  data?: {
    email_id?: string
    message_id?: string
    to?: string[] | string
    error?: unknown
    message?: unknown
    bounce?: {
      type?: string
      message?: unknown
    }
    tags?: Record<string, string>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export async function POST(req: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET

  // 1. Fail closed if webhook secret is not configured
  if (!webhookSecret) {
    console.error('[ResendWebhook] RESEND_WEBHOOK_SECRET is not configured on server.')
    return new Response('Server configuration error', { status: 500 })
  }

  // 2. Read raw request body as text BEFORE any JSON parsing (Section 8)
  const rawBody = await req.text()

  // 3. Extract Svix signature headers
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Missing required webhook signature headers', { status: 400 })
  }

  // 4. Cryptographic signature verification using Resend SDK / Svix helper
  let eventPayload: ResendWebhookPayload
  try {
    const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy_key')
    eventPayload = resend.webhooks.verify({
      payload: rawBody,
      headers: {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature,
      },
      webhookSecret,
    }) as unknown as ResendWebhookPayload
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.warn('[ResendWebhook] Cryptographic signature verification failed:', errMsg)
    return new Response('Invalid webhook signature', { status: 400 })
  }

  if (!eventPayload || !eventPayload.type) {
    return new Response('Invalid webhook payload structure', { status: 400 })
  }

  const supabase = createAdminClient()

  // 5. Pre-check for duplicate or resumable events (MR-1A.2 Section 4)
  // If event exists AND processed_at IS NOT NULL: fully processed duplicate -> return 200 immediately.
  // If event exists BUT processed_at IS NULL: incomplete processing -> resume required effects!
  let existingEventRecordId: string | null = null
  try {
    const { data: existingEvents, error: dedupErr } = await supabase
      .from('message_events')
      .select('id, processed_at')
      .eq('provider', 'resend')
      .eq('provider_event_id', svixId)
      .limit(1)

    if (dedupErr) {
      console.error('[ResendWebhook] Database error checking event deduplication:', dedupErr.message)
      return new Response('Database error', { status: 500 })
    }

    const existing = existingEvents?.[0]
    if (existing) {
      if (existing.processed_at) {
        // Fully processed previously; exit safely
        return Response.json({ received: true, duplicate: true }, { status: 200 })
      }
      // Unprocessed / incomplete claim exists: resume downstream effects
      existingEventRecordId = existing.id
    }
  } catch (err) {
    console.error('[ResendWebhook] Unexpected error during deduplication pre-check:', err)
    return new Response('Database error', { status: 500 })
  }

  // 6. Provider Correlation (Section 10)
  const eventData = eventPayload.data || {}
  const emailId = eventData.email_id || eventData.message_id
  let organizationId: string | null = null
  let reviewRequestId: string | null = null

  let correlatedMessageKind = 'initial_review_request'

  try {
    // Primary lookup: Resend email_id -> message_events.provider_message_id
    if (emailId) {
      const { data: priorEvents, error: corrErr } = await supabase
        .from('message_events')
        .select('organization_id, review_request_id, metadata')
        .eq('provider_message_id', emailId)
        .limit(1)

      if (corrErr) {
        console.error('[ResendWebhook] Error correlating provider_message_id:', corrErr.message)
        return new Response('Database correlation error', { status: 500 })
      }

      const priorEvent = priorEvents?.[0]
      if (priorEvent) {
        organizationId = priorEvent.organization_id
        reviewRequestId = priorEvent.review_request_id
        if (
          priorEvent.metadata &&
          typeof priorEvent.metadata === 'object' &&
          'messageKind' in (priorEvent.metadata as Record<string, unknown>)
        ) {
          correlatedMessageKind = String(
            (priorEvent.metadata as Record<string, unknown>).messageKind
          )
        }
      }
    }

    // Fallback lookup: verified Resend tag review_request_id -> review_requests.id
    if (!reviewRequestId && eventData.tags?.review_request_id) {
      const tagReviewRequestId = eventData.tags.review_request_id
      // Basic UUID regex validation
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (uuidRegex.test(tagReviewRequestId)) {
        const { data: reqRecord, error: tagErr } = await supabase
          .from('review_requests')
          .select('id, organization_id')
          .eq('id', tagReviewRequestId)
          .maybeSingle()

        if (tagErr) {
          console.error('[ResendWebhook] Error querying review_requests by tag:', tagErr.message)
          return new Response('Database correlation error', { status: 500 })
        }

        if (reqRecord) {
          organizationId = reqRecord.organization_id
          reviewRequestId = reqRecord.id
        }
      }
    }

    // Uncorrelated event handling (Section 10)
    if (!reviewRequestId || !organizationId) {
      console.warn('[ResendWebhook] Authenticated event could not be correlated:', eventPayload.type, emailId || 'no-id')
      return Response.json({ received: true, correlated: false }, { status: 200 })
    }

    // 7. Error Sanitization (MR-1A.1 Section 7)
    const rawRecipient = Array.isArray(eventData.to) ? eventData.to[0] : eventData.to
    const recipientEmail = typeof rawRecipient === 'string' ? rawRecipient : undefined

    const rawErrorSource = eventData.bounce?.message || eventData.error || eventData.message
    const sanitizedError = sanitizeProviderError(rawErrorSource, { recipientEmail })

    // 8. Claim & Persist provider_event_id in message_events FIRST if not already claimed (MR-1A.1 Section 8 & MR-1A.2 Section 3)
    let eventRecordId: string | null = existingEventRecordId

    if (!eventRecordId) {
      const { data: insertedEvent, error: insertEventErr } = await supabase
        .from('message_events')
        .insert({
          organization_id: organizationId,
          review_request_id: reviewRequestId,
          provider: 'resend',
          provider_message_id: emailId || null,
          provider_event_id: svixId,
          event_type: eventPayload.type,
          status: 'SENDING', // Initial recorded status, updated on successful completion
          event_occurred_at: eventPayload.created_at || new Date().toISOString(),
          sanitized_error: sanitizedError,
          processed_at: null, // explicitly NULL until all side effects succeed (MR-1A.2 Section 3)
          metadata: {
            messageKind: correlatedMessageKind,
            ...(eventData.bounce?.type ? { bounceType: eventData.bounce.type } : {}),
          },
        })
        .select('id')
        .single()

      if (insertEventErr) {
        // Concurrent race on (provider, provider_event_id)
        const isUniqueViolation =
          insertEventErr.code === '23505' ||
          insertEventErr.message?.includes('idx_me_provider_event_unique') ||
          insertEventErr.message?.includes('unique constraint')

        if (isUniqueViolation) {
          // Another request claimed this event concurrently (MR-1A.3 Section 2)
          // Re-query the existing claimed event to inspect completion state
          const { data: raceRows, error: raceErr } = await supabase
            .from('message_events')
            .select('id, processed_at')
            .eq('provider', 'resend')
            .eq('provider_event_id', svixId)
            .limit(1)

          if (raceErr) {
            console.error('[ResendWebhook] Error querying concurrent message_event:', raceErr.message)
            return new Response('Webhook event processing in progress', { status: 503 })
          }

          const raceEvent = raceRows?.[0]
          if (!raceEvent) {
            // Unique violation occurred but claimed row cannot yet be read (MR-1A.3 Section 2C)
            return new Response('Webhook event processing in progress', { status: 503 })
          }

          if (raceEvent.processed_at) {
            // Event is fully complete (MR-1A.3 Section 2A)
            return Response.json({ received: true, duplicate: true }, { status: 200 })
          }

          // Another request claimed the event but completion is not yet durable (MR-1A.3 Section 2B)
          return new Response('Webhook event processing in progress', { status: 503 })
        } else {
          console.error('[ResendWebhook] Error persisting message_event:', insertEventErr.message)
          return new Response('Database insert error', { status: 500 })
        }
      } else {
        eventRecordId = insertedEvent.id
      }
    }

    // 9. Concurrency-Safe Status Application (MR-1A.2 Section 6 & 7)
    // Optimistic compare-and-set ensures stale reads do NOT regress newer states (e.g. CLICKED)
    const casResult = await applyProviderReviewRequestTransition({
      supabase,
      reviewRequestId,
      eventType: eventPayload.type,
      bounceType: eventData.bounce?.type,
      eventOccurredAt: eventPayload.created_at,
      sanitizedError,
    })

    if (!casResult.success) {
      console.error('[ResendWebhook] Compare-and-set status update failed:', casResult.error)
      // Leave processed_at NULL so provider can retry
      return new Response('Review request update failure', { status: 500 })
    }

    // 10. Contact Suppression Handling (MR-1A.2 Section 9)
    // Permanent bounce, spam complaint, or provider suppression triggers suppression
    if (casResult.transition.shouldSuppressContact && recipientEmail) {
      const contactHash = hashSuppressionContact('email', recipientEmail)
      const suppressionReason = casResult.transition.suppressionReason || 'PROVIDER_HARD_BOUNCE'

      const { error: suppErr } = await supabase.from('suppressions').upsert(
        {
          organization_id: organizationId,
          channel: 'email',
          contact_hash: contactHash,
          reason: suppressionReason,
        },
        {
          onConflict: 'organization_id,channel,contact_hash',
          ignoreDuplicates: true,
        }
      )

      if (suppErr) {
        console.error('[ResendWebhook] Critical error recording suppression:', suppErr.message)
        // SECTION 9: Suppression failures MUST NOT be swallowed!
        // Return 500 and leave processed_at NULL to allow provider retry to complete suppression
        return new Response('Suppression recording failure', { status: 500 })
      }
    }

    // 11. Mark Event Processed ONLY AT THE END (MR-1A.2 Section 10)
    // Only after ALL side-effects succeed, stamp processed_at and finalize event status
    if (eventRecordId) {
      const { error: markErr } = await supabase
        .from('message_events')
        .update({
          status: casResult.finalStatus,
          processed_at: new Date().toISOString(),
        })
        .eq('id', eventRecordId)

      if (markErr) {
        console.error('[ResendWebhook] Error marking message_event processed:', markErr.message)
        return new Response('Database completion error', { status: 500 })
      }
    }

    return Response.json({ received: true }, { status: 200 })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[ResendWebhook] Unhandled error processing webhook:', errMsg)
    return new Response('Internal error', { status: 500 })
  }
}
