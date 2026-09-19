import { inngest } from '../client'
import { evaluateReviewEligibility } from '@/domain/eligibility'
import { generateTrackingToken, buildTrackedReviewUrl } from '@/domain/tracking'
import { generateUnsubscribeToken, buildUnsubscribeUrl } from '@/domain/unsubscribe'
import { composeReviewRequestEmail, composeReviewReminderEmail } from '@/domain/email'
import { getEmailProvider } from '@/providers/email'
import { hashSuppressionContact } from '@/domain/suppression'
import { getWorkflowTimingPolicy, isRequestEligibleForReminder } from '@/domain/reminder'
import { ALLOW_REMINDERS_AFTER_EXPIRATION, deriveTrialLifecycle } from '@/domain/entitlement'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ReviewRequestEventData {
  eventId: string
  organizationId: string
  locationId: string
  customerId: string
  sourceEventId: string
  completedAt?: string
  country?: string
  contact?: { email?: string; phone?: string }
  permission?: { email?: string; sms?: string; source?: string }
}

export async function executeReviewRequestHandler({
  event,
  step,
}: {
  event: { data: ReviewRequestEventData }
  step: {
    run: <T>(name: string, fn: () => Promise<T>) => Promise<T>
    sleep: (name: string, duration: string) => Promise<void>
  }
}) {
    const {
      eventId,
      organizationId,
      locationId,
      customerId,
      sourceEventId,
    } = event.data

    const supabase = createAdminClient()
    const { initialDelay, reminderDelay } = getWorkflowTimingPolicy()

    // Helper to evaluate current eligibility from database
    async function checkEligibility() {
      // 1. Fetch Organization
      const { data: org } = await supabase
        .from('organizations')
        .select('id, name, status')
        .eq('id', organizationId)
        .single()

      if (!org || org.status !== 'ACTIVE') {
        return {
          eligible: false,
          reason: `Organization status is ${org?.status || 'NOT_FOUND'}`,
          decision: 'ORGANIZATION_INACTIVE' as const,
          businessName: org?.name || null,
          locationName: null,
          customerName: null,
          customerEmail: null,
          destinationId: null,
          reviewReplyToEmail: null,
        }
      }

      // 2. Fetch Location
      const { data: loc } = await supabase
        .from('locations')
        .select('id, name, status, review_reply_to_email')
        .eq('id', locationId)
        .single()

      if (!loc || loc.status !== 'ACTIVE') {
        return {
          eligible: false,
          reason: `Location status is ${loc?.status || 'NOT_FOUND'}`,
          decision: 'LOCATION_INACTIVE' as const,
          businessName: org.name,
          locationName: null,
          customerName: null,
          customerEmail: null,
          destinationId: null,
          reviewReplyToEmail: null,
        }
      }

      // 3. Fetch Customer
      const { data: cust } = await supabase
        .from('customers')
        .select('id, first_name, email, permission_email')
        .eq('id', customerId)
        .single()

      if (!cust) {
        return {
          eligible: false,
          reason: 'Customer not found',
          decision: 'NO_CONTACT' as const,
          businessName: org.name,
          locationName: loc.name,
          customerName: null,
          customerEmail: null,
          destinationId: null,
          reviewReplyToEmail: null,
        }
      }

      // 4. Fetch Google Review Destination
      const { data: dest } = await supabase
        .from('review_destinations')
        .select('id, status, canonical_url')
        .eq('location_id', locationId)
        .eq('provider', 'google')
        .eq('status', 'CONFIRMED')
        .maybeSingle()

      // 5. Check Suppressions using standardized SHA-256 hash (Prompt Correction 10)
      const email = cust.email?.trim().toLowerCase() || ''
      const suppressionHash = hashSuppressionContact('email', email)
      const { data: suppression } = await supabase
        .from('suppressions')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('channel', 'email')
        .eq('contact_hash', suppressionHash)
        .maybeSingle()

      // 6. Check Recent Request (within 30 days, excluding current event to permit safe retries)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      let recentQuery = supabase
        .from('review_requests')
        .select('id')
        .eq('customer_id', customerId)
        .gte('created_at', thirtyDaysAgo)

      if (eventId) {
        recentQuery = recentQuery.neq('completion_event_id', eventId)
      }
      const { data: recentRequest } = await recentQuery.maybeSingle()

      const decision = evaluateReviewEligibility({
        organization: { id: org.id, status: org.status as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' },
        location: { id: loc.id, status: loc.status as 'ACTIVE' | 'INACTIVE' },
        customer: {
          id: cust.id,
          email: cust.email,
          permission_email: cust.permission_email as 'allowed' | 'unknown' | 'denied',
        },
        destination: dest ? { id: dest.id, status: dest.status as 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'INACTIVE', canonical_url: dest.canonical_url } : null,
        isSuppressed: !!suppression,
        hasRecentRequestWithinWindow: !!recentRequest,
      })

      return {
        decision: decision.decision,
        eligible: decision.eligible,
        reason: decision.reason,
        businessName: org.name,
        locationName: loc.name,
        customerName: cust.first_name,
        customerEmail: cust.email,
        destinationId: dest?.id || null,
        reviewReplyToEmail: loc.review_reply_to_email || null,
      }
    }

    // Step 0: Record Eligibility Check Started Audit Event (Live Activity: CHECKING)
    await step.run('record-eligibility-check-started', async () => {
      await supabase.from('audit_events').insert({
        organization_id: organizationId,
        actor_type: 'system',
        event_type: 'review_request.checking',
        entity_type: 'customer_completion_event',
        entity_id: eventId,
        metadata: {
          completionEventId: eventId,
          sourceEventId,
        },
      })

      // MR-4: Record completion_received in usage_ledger
      await supabase.rpc('record_usage_event', {
        p_org_id: organizationId,
        p_event_type: 'completion_received',
        p_channel: 'email',
        p_units: 1,
        p_entity_type: 'customer_completion_event',
        p_entity_id: eventId,
        p_idempotency_key: `completion-received:${organizationId}:${sourceEventId || eventId}`,
        p_source_event_id: sourceEventId,
      })
    })

    // Step 1: Initial Eligibility Evaluation
    const initialCheck = await step.run('evaluate-initial-eligibility', async () => {
      return checkEligibility()
    })

    if (!initialCheck.eligible) {
      await step.run('record-ineligible-audit', async () => {
        await supabase.from('audit_events').insert({
          organization_id: organizationId,
          actor_type: 'system',
          event_type: 'review_request.ineligible',
          entity_type: 'customer',
          entity_id: customerId,
          metadata: {
            eventId,
            completionEventId: eventId,
            stage: 'initial',
            reason: initialCheck.reason,
            decision: initialCheck.decision,
            sourceEventId,
          },
        })
      })

      return { processed: false, stage: 'initial', reason: initialCheck.reason, decision: initialCheck.decision }
    }

    // Step 2: Configurable Cooldown Delay
    await step.sleep('wait-for-request-delay', initialDelay)

    // Step 3: Post-Delay Eligibility Recheck (Prompt Correction 7)
    // Mandatory recheck immediately before message dispatch
    const postDelayCheck = await step.run('evaluate-post-delay-eligibility', async () => {
      return checkEligibility()
    })

    if (!postDelayCheck.eligible) {
      await step.run('record-post-delay-ineligible-audit', async () => {
        await supabase.from('audit_events').insert({
          organization_id: organizationId,
          actor_type: 'system',
          event_type: 'review_request.ineligible',
          entity_type: 'customer',
          entity_id: customerId,
          metadata: {
            eventId,
            completionEventId: eventId,
            stage: 'post_delay',
            reason: postDelayCheck.reason,
            decision: postDelayCheck.decision,
            sourceEventId,
          },
        })
      })

      return { processed: false, stage: 'post_delay', reason: postDelayCheck.reason, decision: postDelayCheck.decision }
    }

    // Step 4: Create or Resolve Review Request and Tracking Token
    const reviewRequest = await step.run('create-or-resolve-review-request', async () => {
      // Find completion event id
      const { data: completionEvent } = await supabase
        .from('customer_completion_events')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('source_event_id', sourceEventId)
        .single()

      const completionEventId = completionEvent?.id

      if (completionEventId) {
        const { data: existing } = await supabase
          .from('review_requests')
          .select('id, token, unsubscribe_token, status, reminded_at')
          .eq('completion_event_id', completionEventId)
          .eq('channel', 'email')
          .maybeSingle()

        if (existing) {
          let unsubToken = existing.unsubscribe_token
          if (!unsubToken) {
            const generated = generateUnsubscribeToken()
            unsubToken = generated.token
            await supabase
              .from('review_requests')
              .update({
                unsubscribe_token: generated.token,
                unsubscribe_token_hash: generated.tokenHash,
              })
              .eq('id', existing.id)
          }
          return {
            id: existing.id,
            token: existing.token,
            unsubscribeToken: unsubToken,
            isNew: false,
            status: existing.status,
            remindedAt: existing.reminded_at,
            blocked: false,
          }
        }
      }

      // MR-4: Atomic entitlement consumption check before initial request creation
      const newReviewRequestId = crypto.randomUUID()
      const entitlementIdempotencyKey = `review-request-entitlement:${organizationId}:${completionEventId || sourceEventId}`

      const { data: consumeResult, error: consumeError } = await supabase.rpc(
        'consume_trial_entitlement',
        {
          p_org_id: organizationId,
          p_review_request_id: newReviewRequestId,
          p_idempotency_key: entitlementIdempotencyKey,
          p_source_event_id: sourceEventId,
        }
      )

      if (consumeError) {
        throw new Error(`Failed to consume trial entitlement: ${consumeError.message}`)
      }

      const entitlement = (consumeResult || {}) as {
        allowed?: boolean
        reason?: string
        already_consumed?: boolean
        consumed?: number
        remaining?: number
      }

      if (!entitlement.allowed) {
        await supabase.from('audit_events').insert({
          organization_id: organizationId,
          actor_type: 'system',
          event_type: 'review_request.blocked_by_entitlement',
          entity_type: 'customer',
          entity_id: customerId,
          metadata: {
            eventId,
            completionEventId: completionEventId || eventId,
            reason: entitlement.reason || 'TRIAL_LIMIT_REACHED',
            remaining: entitlement.remaining ?? 0,
            sourceEventId,
          },
        })

        return {
          id: null,
          token: null,
          unsubscribeToken: null,
          isNew: false,
          status: 'BLOCKED',
          remindedAt: null,
          blocked: true,
          reason: entitlement.reason || 'TRIAL_LIMIT_REACHED',
        }
      }

      const { token, tokenHash } = generateTrackingToken()
      const { token: unsubToken, tokenHash: unsubTokenHash } = generateUnsubscribeToken()

      const { data: created, error } = await supabase
        .from('review_requests')
        .insert({
          id: newReviewRequestId,
          organization_id: organizationId,
          location_id: locationId,
          customer_id: customerId,
          completion_event_id: completionEventId!,
          destination_id: postDelayCheck.destinationId,
          channel: 'email',
          status: 'SCHEDULED',
          token,
          token_hash: tokenHash,
          unsubscribe_token: unsubToken,
          unsubscribe_token_hash: unsubTokenHash,
        })
        .select('id, token, unsubscribe_token')
        .single()

      if (error || !created) {
        throw new Error(`Failed to create review request: ${error?.message || 'unknown error'}`)
      }

      return {
        id: created.id,
        token: created.token,
        unsubscribeToken: created.unsubscribe_token || unsubToken,
        isNew: true,
        status: 'SCHEDULED',
        remindedAt: null,
        blocked: false,
      }
    })

    if ('blocked' in reviewRequest && reviewRequest.blocked) {
      return {
        processed: false,
        stage: 'entitlement',
        reason: reviewRequest.reason,
      }
    }

    if (!reviewRequest.id || !reviewRequest.token) {
      return {
        processed: false,
        stage: 'entitlement',
        reason: 'Missing review request credentials',
      }
    }

    const reviewRequestId = reviewRequest.id as string
    const reviewRequestToken = reviewRequest.token as string
    const reviewRequestUnsubscribeToken = (reviewRequest.unsubscribeToken || reviewRequest.token) as string

    // Step 5: Provider Send Guarded by Atomic State Machine (Prompt Correction 5 & 8)
    // One completion event + channel = at most one initial customer send
    const sendResult = await step.run('dispatch-review-email', async () => {
      // 1. Fetch current status of review_request from source of truth
      const { data: currentReq } = await supabase
        .from('review_requests')
        .select('id, status, updated_at')
        .eq('id', reviewRequestId)
        .single()

      if (!currentReq) {
        throw new Error(`Review request not found: ${reviewRequestId}`)
      }

      // If already successfully sent, delivered, or clicked: skip safely
      if (['SENT', 'DELIVERED', 'CLICKED'].includes(currentReq.status)) {
        return {
          success: true,
          alreadySent: true,
          provider: 'idempotent_skip',
          messageId: 'skipped_already_sent',
        }
      }

      // If cancelled or suppressed during wait: abort send
      if (['CANCELLED', 'SUPPRESSED'].includes(currentReq.status)) {
        return {
          success: false,
          aborted: true,
          provider: 'abort',
          messageId: 'aborted_due_to_ineligibility',
        }
      }

      // 2. Atomic state transition to SENDING:
      // Claimable if SCHEDULED, FAILED (previous retry failed), or stale SENDING (updated > 5m ago)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const { data: claim } = await supabase
        .from('review_requests')
        .update({
          status: 'SENDING',
          updated_at: new Date().toISOString(),
        })
        .eq('id', reviewRequestId)
        .or(`status.eq.SCHEDULED,status.eq.FAILED,and(status.eq.SENDING,updated_at.lt.${fiveMinutesAgo})`)
        .select('id')
        .maybeSingle()

      if (!claim) {
        // Another active execution claimed the send; skip duplicate dispatch
        return {
          success: true,
          alreadySent: true,
          provider: 'idempotent_skip',
          messageId: 'skipped_concurrent_dispatch',
        }
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const trackingUrl = buildTrackedReviewUrl(appUrl, reviewRequestToken)
      const unsubscribeUrl = buildUnsubscribeUrl(appUrl, reviewRequestUnsubscribeToken)
      const fromAddress = process.env.EMAIL_FROM_ADDRESS?.trim() || undefined

      const composed = composeReviewRequestEmail({
        businessName: postDelayCheck.businessName || 'our business',
        customerFirstName: postDelayCheck.customerName,
        reviewUrl: trackingUrl,
        unsubscribeUrl,
        replyToEmail: postDelayCheck.reviewReplyToEmail,
        fromAddress,
      })

      const emailProvider = getEmailProvider()

      // MR-4: Record provider send attempt usage and cost estimate
      await supabase.rpc('record_usage_event', {
        p_org_id: organizationId,
        p_event_type: 'provider_send_attempt',
        p_channel: 'email',
        p_units: 1,
        p_entity_type: 'review_request',
        p_entity_id: reviewRequest.id!,
        p_idempotency_key: `provider-send-attempt:initial:${reviewRequest.id}`,
        p_source_event_id: sourceEventId,
      })

      try {
        const result = await emailProvider.send({
          to: postDelayCheck.customerEmail!,
          recipientName: postDelayCheck.customerName || 'there',
          businessName: postDelayCheck.businessName || 'our business',
          trackingUrl,
          unsubscribeUrl,
          subject: composed.subject,
          html: composed.html,
          text: composed.text,
          fromDisplayName: composed.fromDisplayName,
          replyTo: composed.replyTo,
          headers: composed.headers,
          idempotencyKey: `review-request/${reviewRequest.id}/initial-v1`,
          correlationId: reviewRequest.id!,
        })

        if (!result.success) {
          throw new Error(result.error || 'Email provider rejected send')
        }

        // Durably mark SENT
        await supabase
          .from('review_requests')
          .update({
            status: 'SENT',
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            error_message: null,
          })
          .eq('id', reviewRequest.id!)

        // Record message_event (privacy hardened: minimal operational metadata)
        await supabase.from('message_events').insert({
          organization_id: organizationId,
          review_request_id: reviewRequest.id!,
          provider: result.provider,
          provider_message_id: result.messageId,
          event_type: 'sent',
          status: 'SENT',
          metadata: {
            messageKind: 'initial_review_request',
            reviewRequestId: reviewRequest.id,
          },
        })

        // MR-4: Record provider send success
        await supabase.rpc('record_usage_event', {
          p_org_id: organizationId,
          p_event_type: 'provider_send_success',
          p_channel: 'email',
          p_units: 1,
          p_entity_type: 'review_request',
          p_entity_id: reviewRequest.id!,
          p_idempotency_key: `provider-send-success:initial:${reviewRequest.id}`,
          p_source_event_id: sourceEventId,
        })

        // Atomic usage increment via service_role admin client (Prompt Correction 19)
        const period = new Date().toISOString().slice(0, 7)
        await supabase.rpc('increment_organization_usage', {
          p_org_id: organizationId,
          p_period: period,
          p_metric: 'review_requests_sent',
          p_amount: 1,
        })

        return result
      } catch (sendErr: unknown) {
        const errorMsg = (sendErr instanceof Error ? sendErr.message : 'Email dispatch failed').slice(0, 500)
        console.error('Email dispatch error; marking review request FAILED for retry:', errorMsg)

        // MR-4: Record provider send failure
        await supabase.rpc('record_usage_event', {
          p_org_id: organizationId,
          p_event_type: 'provider_send_failure',
          p_channel: 'email',
          p_units: 1,
          p_entity_type: 'review_request',
          p_entity_id: reviewRequest.id!,
          p_idempotency_key: `provider-send-failure:initial:${reviewRequest.id}:${Date.now()}`,
          p_source_event_id: sourceEventId,
        })

        // Durably record FAILED state so it does not remain stranded in SENDING
        await supabase
          .from('review_requests')
          .update({
            status: 'FAILED',
            failed_at: new Date().toISOString(),
            error_message: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', reviewRequest.id!)

        // Record failure event (privacy hardened)
        await supabase.from('message_events').insert({
          organization_id: organizationId,
          review_request_id: reviewRequest.id!,
          provider: 'email',
          event_type: 'failed',
          status: 'FAILED',
          sanitized_error: errorMsg,
          metadata: {
            messageKind: 'initial_review_request',
            reviewRequestId: reviewRequest.id,
          },
        })

        // Rethrow for Inngest retry mechanism
        throw sendErr
      }
    })

    // If initial dispatch failed or was aborted due to ineligibility, stop workflow here
    const isAborted = 'aborted' in sendResult && Boolean(sendResult.aborted)
    if (!sendResult.success || isAborted) {
      return {
        processed: false,
        stage: 'initial_dispatch',
        reason: isAborted ? 'aborted_due_to_ineligibility' : 'initial_dispatch_failed',
        sendResult,
      }
    }

    // =========================================================================
    // MR-1C: REMINDER LIFECYCLE (Steps 6, 7, 8)
    // Enforces at most ONE reminder: V1 max = 1 initial request + 1 reminder.
    // Configurable delay via WORKFLOW_REMINDER_DELAY (default 3d, test 1s).
    // Hard stops on CLICKED (by status or clicked_at), CANCELLED, or SUPPRESSED.
    // Pre-reminder eligibility check immediately before reminder dispatch.
    // =========================================================================

    // Step 6: Durable Sleep for Reminder Delay
    await step.sleep('wait-for-reminder-delay', reminderDelay)

    // Step 7: Pre-Reminder Eligibility Recheck
    const preReminderCheck = await step.run('evaluate-pre-reminder-eligibility', async () => {
      // 1. Re-read review_requests row from database source of truth
      const { data: latestReq } = await supabase
        .from('review_requests')
        .select('id, status, reminded_at, clicked_at, cancelled_at')
        .eq('id', reviewRequestId)
        .maybeSingle()

      if (!latestReq) {
        return {
          eligible: false,
          reason: 'Review request not found',
          decision: 'NOT_FOUND',
        }
      }

      // Structural check: click, cancellation, suppression, already reminded
      const structuralCheck = isRequestEligibleForReminder({
        status: latestReq.status,
        reminded_at: latestReq.reminded_at,
        clicked_at: latestReq.clicked_at,
        cancelled_at: latestReq.cancelled_at,
      })

      if (!structuralCheck.eligible) {
        return {
          eligible: false,
          reason: structuralCheck.reason || 'Ineligible for reminder',
          decision: structuralCheck.reason || 'INELIGIBLE',
        }
      }

      // 2. Fresh full eligibility recheck (customer, email, permission, suppressions, org, location, destination)
      const freshEligibility = await checkEligibility()
      if (!freshEligibility.eligible) {
        return {
          eligible: false,
          reason: freshEligibility.reason,
          decision: freshEligibility.decision,
        }
      }

      // 3. Entitlement check: if ALLOW_REMINDERS_AFTER_EXPIRATION is false, ensure trial is not expired
      if (!ALLOW_REMINDERS_AFTER_EXPIRATION) {
        const { data: ent } = await supabase
          .from('organization_entitlements')
          .select('status, allocated_requests, consumed_requests, expires_at')
          .eq('organization_id', organizationId)
          .maybeSingle()

        if (ent) {
          const lifecycle = deriveTrialLifecycle(ent)
          if (!lifecycle.isEligibleForReminder) {
            return {
              eligible: false,
              reason: lifecycle.reason || 'TRIAL_EXPIRED',
              decision: 'TRIAL_EXPIRED',
            }
          }
        }
      }

      return {
        eligible: true,
        reason: 'Customer is eligible for review reminder',
        decision: 'ELIGIBLE_FOR_REMINDER',
        customerEmail: freshEligibility.customerEmail,
        customerName: freshEligibility.customerName,
        businessName: freshEligibility.businessName,
        reviewReplyToEmail: freshEligibility.reviewReplyToEmail,
      }
    })

    // If pre-reminder check failed, record audit log and exit cleanly
    if (!preReminderCheck.eligible) {
      await step.run('record-reminder-skipped', async () => {
        await supabase.from('audit_events').insert({
          organization_id: organizationId,
          actor_type: 'system',
          event_type: 'review_request.reminder_skipped',
          entity_type: 'review_request',
          entity_id: reviewRequestId,
          metadata: {
            reviewRequestId,
            reason: preReminderCheck.reason,
            decision: preReminderCheck.decision,
          },
        })
      })

      return {
        processed: true,
        reviewRequestId,
        emailSent: sendResult.success,
        provider: sendResult.provider,
        reminderSent: false,
        stage: 'reminder_skipped',
        reminderSkippedReason: preReminderCheck.reason,
      }
    }

    // Step 8: Dispatch Review Request Reminder
    // Privacy hardened: metadata contains no PII, tokens, or raw destinations.
    // reminded_at is set ONLY after provider dispatch succeeds.
    // Provider idempotencyKey ensures deterministic retry safety.
    const reminderResult = await step.run('dispatch-review-reminder', async () => {
      // 1. Fetch current status of review_request
      const { data: currentReq } = await supabase
        .from('review_requests')
        .select('id, status, reminded_at, clicked_at')
        .eq('id', reviewRequestId)
        .single()

      if (!currentReq) {
        throw new Error(`Review request not found: ${reviewRequestId}`)
      }

      // Idempotency: if already reminded, return idempotent skip
      if (currentReq.reminded_at) {
        return {
          success: true,
          alreadySent: true,
          provider: 'idempotent_skip',
          messageId: 'skipped_already_reminded',
        }
      }

      // If clicked, cancelled, or suppressed concurrently: abort send
      if (currentReq.status === 'CLICKED' || currentReq.clicked_at) {
        return {
          success: false,
          aborted: true,
          provider: 'abort',
          messageId: 'aborted_due_to_click',
        }
      }

      if (['CANCELLED', 'SUPPRESSED'].includes(currentReq.status)) {
        return {
          success: false,
          aborted: true,
          provider: 'abort',
          messageId: 'aborted_due_to_ineligibility',
        }
      }

      // 2. Compose neutral reminder email
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const trackingUrl = buildTrackedReviewUrl(appUrl, reviewRequestToken)
      const unsubscribeUrl = buildUnsubscribeUrl(appUrl, reviewRequestUnsubscribeToken)
      const fromAddress = process.env.EMAIL_FROM_ADDRESS?.trim() || undefined

      const composed = composeReviewReminderEmail({
        businessName: preReminderCheck.businessName || 'our business',
        customerFirstName: preReminderCheck.customerName,
        reviewUrl: trackingUrl,
        unsubscribeUrl,
        replyToEmail: preReminderCheck.reviewReplyToEmail,
        fromAddress,
      })

      const emailProvider = getEmailProvider()

      // MR-4: Record provider send attempt usage and cost estimate for reminder
      await supabase.rpc('record_usage_event', {
        p_org_id: organizationId,
        p_event_type: 'provider_send_attempt',
        p_channel: 'email',
        p_units: 1,
        p_entity_type: 'review_request',
        p_entity_id: reviewRequestId,
        p_idempotency_key: `provider-send-attempt:reminder:${reviewRequestId}:1`,
        p_source_event_id: sourceEventId,
      })

      try {
        const result = await emailProvider.send({
          to: preReminderCheck.customerEmail!,
          recipientName: preReminderCheck.customerName || 'there',
          businessName: preReminderCheck.businessName || 'our business',
          trackingUrl,
          unsubscribeUrl,
          subject: composed.subject,
          html: composed.html,
          text: composed.text,
          fromDisplayName: composed.fromDisplayName,
          replyTo: composed.replyTo,
          headers: composed.headers,
          idempotencyKey: `review-request/${reviewRequestId}/reminder-1`,
          correlationId: reviewRequestId,
        })

        if (!result.success) {
          throw new Error(result.error || 'Email provider rejected reminder send')
        }

        // 3. Durably mark reminded_at (does NOT regress status: SENT remains SENT, DELIVERED remains DELIVERED)
        // Atomic guard .is('reminded_at', null) ensures exactly one execution claims the reminder
        const { data: updatedReq } = await supabase
          .from('review_requests')
          .update({
            reminded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', reviewRequestId)
          .is('reminded_at', null)
          .select('id')
          .maybeSingle()

        // If another concurrent execution already stamped reminded_at, avoid duplicate events/counters
        if (!updatedReq) {
          return {
            success: true,
            alreadySent: true,
            provider: result.provider,
            messageId: result.messageId,
          }
        }

        // 4. Record message_event for reminder (minimal operational metadata, zero PII/tokens)
        await supabase.from('message_events').insert({
          organization_id: organizationId,
          review_request_id: reviewRequestId,
          provider: result.provider,
          provider_message_id: result.messageId,
          event_type: 'sent',
          status: 'SENT',
          metadata: {
            messageKind: 'review_request_reminder',
            reviewRequestId,
            reminderNumber: 1,
          },
        })

        // MR-4: Record reminder_created in usage_ledger
        await supabase.rpc('record_usage_event', {
          p_org_id: organizationId,
          p_event_type: 'reminder_created',
          p_channel: 'email',
          p_units: 1,
          p_entity_type: 'review_request',
          p_entity_id: reviewRequestId,
          p_idempotency_key: `usage-reminder:${reviewRequestId}:1`,
          p_source_event_id: sourceEventId,
        })

        // MR-4: Record provider send success for reminder
        await supabase.rpc('record_usage_event', {
          p_org_id: organizationId,
          p_event_type: 'provider_send_success',
          p_channel: 'email',
          p_units: 1,
          p_entity_type: 'review_request',
          p_entity_id: reviewRequestId,
          p_idempotency_key: `provider-send-success:reminder:${reviewRequestId}:1`,
          p_source_event_id: sourceEventId,
        })

        // 5. Atomic usage increment for reminders
        const period = new Date().toISOString().slice(0, 7)
        await supabase.rpc('increment_organization_usage', {
          p_org_id: organizationId,
          p_period: period,
          p_metric: 'reminders_sent',
          p_amount: 1,
        })

        // 6. Record audit event
        await supabase.from('audit_events').insert({
          organization_id: organizationId,
          actor_type: 'system',
          event_type: 'review_request.reminder_sent',
          entity_type: 'review_request',
          entity_id: reviewRequestId,
          metadata: {
            reviewRequestId,
          },
        })

        return result
      } catch (sendErr: unknown) {
        const errorMsg = (sendErr instanceof Error ? sendErr.message : 'Reminder dispatch failed').slice(0, 500)
        console.error('Reminder dispatch error:', errorMsg)

        // MR-4: Record provider send failure for reminder
        await supabase.rpc('record_usage_event', {
          p_org_id: organizationId,
          p_event_type: 'provider_send_failure',
          p_channel: 'email',
          p_units: 1,
          p_entity_type: 'review_request',
          p_entity_id: reviewRequestId,
          p_idempotency_key: `provider-send-failure:reminder:${reviewRequestId}:1:${Date.now()}`,
          p_source_event_id: sourceEventId,
        })

        // Record failure in message_events without regressing review_requests status or erasing initial delivery
        // reminded_at remains NULL so Inngest retry can re-attempt dispatch
        await supabase.from('message_events').insert({
          organization_id: organizationId,
          review_request_id: reviewRequestId,
          provider: 'email',
          event_type: 'failed',
          status: 'FAILED',
          sanitized_error: errorMsg,
          metadata: {
            messageKind: 'review_request_reminder',
            reviewRequestId,
            reminderNumber: 1,
          },
        })

        // Record reminder failed audit event
        await supabase.from('audit_events').insert({
          organization_id: organizationId,
          actor_type: 'system',
          event_type: 'review_request.reminder_failed',
          entity_type: 'review_request',
          entity_id: reviewRequestId,
          metadata: {
            reviewRequestId,
            error: errorMsg,
          },
        })

        // Rethrow for Inngest retry mechanism
        throw sendErr
      }
    })

    const isAlreadySent = 'alreadySent' in reminderResult && Boolean(reminderResult.alreadySent)
    return {
      processed: true,
      reviewRequestId,
      emailSent: sendResult.success,
      provider: sendResult.provider,
      reminderSent: reminderResult.success && !isAlreadySent,
    }
}

export const processReviewRequestWorkflow = inngest.createFunction(
  {
    id: 'process-customer-completion',
    name: 'Process Customer Completion & Trigger Review Solicitation',
    retries: 2,
    triggers: [{ event: 'customer.completed' }],
  },
  async ({ event, step }) => {
    return executeReviewRequestHandler({
      event: { data: event.data as unknown as ReviewRequestEventData },
      step: {
        run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
          const res = await step.run(name, fn)
          return res as unknown as T
        },
        sleep: async (name: string, duration: string) => {
          await step.sleep(name, duration)
        },
      },
    })
  }
)
