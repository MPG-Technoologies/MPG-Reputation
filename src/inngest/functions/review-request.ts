import { inngest } from '../client'
import { evaluateReviewEligibility } from '@/domain/eligibility'
import { generateTrackingToken, buildTrackedReviewUrl } from '@/domain/tracking'
import { getEmailProvider } from '@/providers/email'
import { hashSuppressionContact } from '@/domain/suppression'
import { createAdminClient } from '@/lib/supabase/admin'

export const processReviewRequestWorkflow = inngest.createFunction(
  {
    id: 'process-customer-completion',
    name: 'Process Customer Completion & Trigger Review Solicitation',
    retries: 2,
    triggers: [{ event: 'customer.completed' }],
  },
  async ({ event, step }) => {
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

      // 6. Check Recent Request (within 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data: recentRequest } = await supabase
        .from('review_requests')
        .select('id')
        .eq('customer_id', customerId)
        .gte('created_at', thirtyDaysAgo)
        .maybeSingle()

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

    // Step 5: Provider Send Guarded by Atomic State Transition (Prompt Correction 8)
    // One completion event + channel = at most one initial customer send
    const sendResult = await step.run('dispatch-review-email', async () => {
      // Atomic guard: atomically transition from SCHEDULED -> SENDING
      const { data: claim } = await supabase
        .from('review_requests')
        .update({
          status: 'SENDING',
          updated_at: new Date().toISOString(),
        })
        .eq('id', reviewRequest.id)
        .eq('status', 'SCHEDULED')
        .select('id')
        .maybeSingle()

      // If cannot claim SCHEDULED, another execution already sent or is sending
      if (!claim) {
        return {
          success: true,
          alreadySent: true,
          provider: 'idempotent_skip',
          messageId: 'skipped_duplicate_dispatch',
        }
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const trackingUrl = buildTrackedReviewUrl(appUrl, reviewRequest.token)
      const emailProvider = getEmailProvider()

      const result = await emailProvider.send({
        to: postDelayCheck.customerEmail!,
        recipientName: postDelayCheck.customerName || 'there',
        businessName: postDelayCheck.businessName || 'our business',
        trackingUrl,
      })

      if (result.success) {
        await supabase
          .from('review_requests')
          .update({
            status: 'SENT',
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', reviewRequest.id)

        // Record message_event
        await supabase.from('message_events').insert({
          organization_id: organizationId,
          review_request_id: reviewRequest.id,
          provider: result.provider,
          provider_message_id: result.messageId,
          event_type: 'sent',
          status: 'success',
          metadata: { to: postDelayCheck.customerEmail },
        })

        // Atomic usage increment (Prompt Correction 19)
        const period = new Date().toISOString().slice(0, 7)
        await supabase.rpc('increment_organization_usage', {
          p_org_id: organizationId,
          p_period: period,
          p_metric: 'review_requests_sent',
          p_amount: 1,
        })
      } else {
        await supabase
          .from('review_requests')
          .update({
            status: 'FAILED',
            failed_at: new Date().toISOString(),
            error_message: result.error || 'Provider send failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', reviewRequest.id)
      }

      return result
    })

    return {
      processed: true,
      reviewRequestId: reviewRequest.id,
      emailSent: sendResult.success,
      provider: sendResult.provider,
    }
  }
)
