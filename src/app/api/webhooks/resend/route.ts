import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashSuppressionContact } from '@/domain/suppression'
import { determineReviewRequestTransition } from '@/domain/review-request/transitions'
import type { Database } from '@/types/database'

interface ResendWebhookPayload {
  type: string
  created_at?: string
  data?: {
    email_id?: string
    message_id?: string
    to?: string[]
    bounce?: {
      type?: string
      message?: string
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

  // 5. Event Deduplication: check if svixId was already processed (Section 11)
  try {
    const { data: existingEvent, error: dedupErr } = await supabase
      .from('message_events')
      .select('id')
      .eq('provider', 'resend')
      .eq('provider_event_id', svixId)
      .maybeSingle()

    if (dedupErr) {
      console.error('[ResendWebhook] Database error checking event deduplication:', dedupErr.message)
      return new Response('Database error', { status: 500 })
    }

    if (existingEvent) {
      // Already processed idempotently
      return Response.json({ received: true, duplicate: true }, { status: 200 })
    }
  } catch (err) {
    console.error('[ResendWebhook] Unexpected error during deduplication:', err)
    return new Response('Database error', { status: 500 })
  }

  // 6. Provider Correlation (Section 10)
  const eventData = eventPayload.data || {}
  const emailId = eventData.email_id || eventData.message_id
  let organizationId: string | null = null
  let reviewRequestId: string | null = null

  try {
    // Primary lookup: Resend email_id -> message_events.provider_message_id
    if (emailId) {
      const { data: priorEvents, error: corrErr } = await supabase
        .from('message_events')
        .select('organization_id, review_request_id')
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

    // 7. Review Request State Transition Evaluation (Section 12)
    const { data: currentReq, error: reqFetchErr } = await supabase
      .from('review_requests')
      .select('id, status')
      .eq('id', reviewRequestId)
      .single()

    if (reqFetchErr || !currentReq) {
      console.error('[ResendWebhook] Failed to fetch review request:', reviewRequestId, reqFetchErr?.message)
      return new Response('Review request lookup failure', { status: 500 })
    }

    const transition = determineReviewRequestTransition({
      currentStatus: currentReq.status,
      eventType: eventPayload.type,
      bounceType: eventData.bounce?.type,
    })

    // 8. Update review_request if status transitioned or delivery timestamp should be recorded
    if (transition.statusChanged || transition.shouldSetDeliveredAt) {
      const updateData: Database['public']['Tables']['review_requests']['Update'] = {
        status: transition.nextStatus,
        updated_at: new Date().toISOString(),
      }

      if (transition.shouldSetDeliveredAt) {
        updateData.delivered_at = eventPayload.created_at || new Date().toISOString()
      }

      if (transition.nextStatus === 'FAILED') {
        updateData.failed_at = new Date().toISOString()
        if (eventData.bounce?.message) {
          updateData.error_message = String(eventData.bounce.message).slice(0, 500)
        }
      }

      const { error: updateErr } = await supabase
        .from('review_requests')
        .update(updateData)
        .eq('id', reviewRequestId)

      if (updateErr) {
        console.error('[ResendWebhook] Error updating review request:', updateErr.message)
        return new Response('Database update error', { status: 500 })
      }
    }

    // 9. Contact Suppression Handling (Section 13, 14, 15)
    // Permanent bounce, spam complaint, or provider suppression triggers suppression
    if (transition.shouldSuppressContact) {
      const rawRecipient = Array.isArray(eventData.to) ? eventData.to[0] : eventData.to
      if (rawRecipient && typeof rawRecipient === 'string') {
        const contactHash = hashSuppressionContact('email', rawRecipient)
        const suppressionReason = transition.suppressionReason || 'PROVIDER_HARD_BOUNCE'

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
          console.error('[ResendWebhook] Error recording suppression:', suppErr.message)
          // Do not fail the whole webhook if suppression upsert was duplicate or transient
        }
      }
    }

    // 10. Record message_event (Privacy Hardened: Section 6, 11)
    // NEVER duplicate recipient email, customer name, tracking token, tracking URL, or review destination
    const sanitizedError =
      eventData.bounce?.message
        ? String(eventData.bounce.message).slice(0, 500)
        : null

    const { error: insertEventErr } = await supabase.from('message_events').insert({
      organization_id: organizationId,
      review_request_id: reviewRequestId,
      provider: 'resend',
      provider_message_id: emailId || null,
      provider_event_id: svixId,
      event_type: eventPayload.type,
      status: transition.nextStatus,
      event_occurred_at: eventPayload.created_at || new Date().toISOString(),
      sanitized_error: sanitizedError,
      metadata: {
        messageKind: 'initial_review_request',
        ...(eventData.bounce?.type ? { bounceType: eventData.bounce.type } : {}),
      },
    })

    if (insertEventErr) {
      console.error('[ResendWebhook] Error persisting message_event:', insertEventErr.message)
      return new Response('Database insert error', { status: 500 })
    }

    return Response.json({ received: true }, { status: 200 })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[ResendWebhook] Unhandled error processing webhook:', errMsg)
    return new Response('Internal error', { status: 500 })
  }
}
