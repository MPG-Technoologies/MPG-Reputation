import { inngest } from '../client'
import { evaluateReviewEligibility } from '@/domain/eligibility'
import { generateTrackingToken, buildTrackedReviewUrl } from '@/domain/tracking'
import { getEmailProvider } from '@/providers/email'
import { hashSuppressionContact } from '@/domain/suppression'
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
        }
      }

      // 2. Fetch Location
      const { data: loc } = await supabase
        .from('locations')
        .select('id, name, status')
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
    const initialDelay = process.env.WORKFLOW_INITIAL_DELAY || '2s'
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
          .select('id, token, status')
          .eq('completion_event_id', completionEventId)
          .eq('channel', 'email')
          .maybeSingle()

        if (existing) {
          return { id: existing.id, token: existing.token, isNew: false, status: existing.status }
        }
      }

      const { token, tokenHash } = generateTrackingToken()

      const { data: created, error } = await supabase
        .from('review_requests')
        .insert({
          organization_id: organizationId,
          location_id: locationId,
          customer_id: customerId,
          completion_event_id: completionEventId!,
          destination_id: postDelayCheck.destinationId,
          channel: 'email',
          status: 'SCHEDULED',
          token,
          token_hash: tokenHash,
        })
        .select('id, token')
        .single()

      if (error || !created) {
        throw new Error(`Failed to create review request: ${error?.message || 'unknown error'}`)
      }

      return { id: created.id, token: created.token, isNew: true, status: 'SCHEDULED' }
    })

    // Step 5: Provider Send Guarded by Atomic State Machine (Prompt Correction 5 & 8)
    // One completion event + channel = at most one initial customer send
    const sendResult = await step.run('dispatch-review-email', async () => {
      // 1. Fetch current status of review_request from source of truth
      const { data: currentReq } = await supabase
        .from('review_requests')
        .select('id, status, updated_at')
        .eq('id', reviewRequest.id)
        .single()

      if (!currentReq) {
        throw new Error(`Review request not found: ${reviewRequest.id}`)
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
        .eq('id', reviewRequest.id)
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
      const trackingUrl = buildTrackedReviewUrl(appUrl, reviewRequest.token)
      const emailProvider = getEmailProvider()

      try {
        const result = await emailProvider.send({
          to: postDelayCheck.customerEmail!,
          recipientName: postDelayCheck.customerName || 'there',
          businessName: postDelayCheck.businessName || 'our business',
          trackingUrl,
          idempotencyKey: `review-request/${reviewRequest.id}/initial-v1`,
          correlationId: reviewRequest.id,
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
          .eq('id', reviewRequest.id)

        // Record message_event (privacy hardened: minimal operational metadata)
        await supabase.from('message_events').insert({
          organization_id: organizationId,
          review_request_id: reviewRequest.id,
          provider: result.provider,
          provider_message_id: result.messageId,
          event_type: 'sent',
          status: 'SENT',
          metadata: { messageKind: 'initial_review_request' },
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

        // Durably record FAILED state so it does not remain stranded in SENDING
        await supabase
          .from('review_requests')
          .update({
            status: 'FAILED',
            failed_at: new Date().toISOString(),
            error_message: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', reviewRequest.id)

        // Record failure event (privacy hardened)
        await supabase.from('message_events').insert({
          organization_id: organizationId,
          review_request_id: reviewRequest.id,
          provider: 'email',
          event_type: 'failed',
          status: 'FAILED',
          sanitized_error: errorMsg,
          metadata: { messageKind: 'initial_review_request' },
        })

        // Rethrow for Inngest retry mechanism
        throw sendErr
      }
    })

    return {
      processed: true,
      reviewRequestId: reviewRequest.id,
      emailSent: sendResult.success,
      provider: sendResult.provider,
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
