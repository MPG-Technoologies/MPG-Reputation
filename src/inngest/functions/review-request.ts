import { inngest } from '../client'
import { evaluateReviewEligibility } from '@/domain/eligibility'
import { generateTrackingToken, buildTrackedReviewUrl } from '@/domain/tracking'
import { getEmailProvider } from '@/providers/email'
import { createAdminClient } from '@/lib/supabase/admin'

export interface CustomerCompletedPayload {
  organizationId: string
  locationId: string
  customerId: string
  sourceEventId: string
  completedAt?: string
  country?: string
  contact: {
    email: string
    phone?: string | null
  }
  permission?: {
    email: 'allowed' | 'unknown' | 'denied'
    sms?: 'allowed' | 'unknown' | 'denied'
    source: string
  }
}

export interface EligibilityStepOutput {
  eligible: boolean
  reason: string
  decision: string
  businessName: string | null
  locationName: string | null
  customerName: string | null
  customerEmail: string | null
  destinationId: string | null
}

export const processReviewRequestWorkflow = inngest.createFunction(
  {
    id: 'process-review-request-workflow',
    name: 'Process Review Request Workflow',
    retries: 2,
    triggers: [{ event: 'customer.completed' }],
  },
  async ({ event, step }) => {
    const data = event.data as CustomerCompletedPayload
    const { organizationId, locationId, customerId, sourceEventId } = data
    const supabase = createAdminClient()

    // Step 1: Evaluate initial eligibility
    const eligibilityCheck = await step.run('evaluate-initial-eligibility', async (): Promise<EligibilityStepOutput> => {
      // 1. Fetch Organization
      const { data: org } = await supabase
        .from('organizations')
        .select('id, name, status')
        .eq('id', organizationId)
        .single()

      if (!org) {
        return {
          eligible: false,
          reason: 'Organization not found',
          decision: 'ORGANIZATION_INACTIVE',
          businessName: null,
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

      if (!loc) {
        return {
          eligible: false,
          reason: 'Location not found',
          decision: 'LOCATION_INACTIVE',
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
          decision: 'NO_CONTACT',
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

      // 5. Check Suppressions
      const email = cust.email?.trim().toLowerCase() || ''
      const { data: suppression } = await supabase
        .from('suppressions')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('contact_hash', email)
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
        organization: { id: org.id, status: org.status },
        location: { id: loc.id, status: loc.status },
        customer: {
          id: cust.id,
          email: cust.email,
          permission_email: cust.permission_email,
        },
        destination: dest ? { id: dest.id, status: dest.status, canonical_url: dest.canonical_url } : null,
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
    })

    if (!eligibilityCheck.eligible) {
      await step.run('record-ineligible-audit', async () => {
        await supabase.from('audit_events').insert({
          organization_id: organizationId,
          actor_type: 'system',
          event_type: 'review_request.ineligible',
          entity_type: 'customer',
          entity_id: customerId,
          metadata: {
            reason: eligibilityCheck.reason,
            decision: eligibilityCheck.decision,
            sourceEventId,
          },
        })
      })

      return { processed: false, reason: eligibilityCheck.reason, decision: eligibilityCheck.decision }
    }

    // Step 2: Configurable Cooldown Delay
    const initialDelay = process.env.WORKFLOW_INITIAL_DELAY || '2s'
    await step.sleep('wait-for-request-delay', initialDelay)

    // Step 3: Create Review Request and Tracking Token
    const reviewRequest = await step.run('create-or-resolve-review-request', async () => {
      // Check if one already exists for this completion event to guarantee idempotency
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
          destination_id: eligibilityCheck.destinationId,
          channel: 'email',
          status: 'SENDING',
          token,
          token_hash: tokenHash,
        })
        .select('id, token')
        .single()

      if (error || !created) {
        throw new Error(`Failed to create review request: ${error?.message || 'unknown error'}`)
      }

      return { id: created.id, token: created.token, isNew: true, status: 'SENDING' }
    })

    // Step 4: Dispatch neutral email
    const sendResult = await step.run('dispatch-review-email', async () => {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const trackingUrl = buildTrackedReviewUrl(appUrl, reviewRequest.token)
      const emailProvider = getEmailProvider()

      const result = await emailProvider.send({
        to: eligibilityCheck.customerEmail!,
        recipientName: eligibilityCheck.customerName || 'there',
        businessName: eligibilityCheck.businessName || 'our business',
        trackingUrl,
      })

      // Update review request status
      if (result.success) {
        await supabase
          .from('review_requests')
          .update({
            status: 'SENT',
            sent_at: new Date().toISOString(),
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
          metadata: { to: eligibilityCheck.customerEmail },
        })

        // Increment usage
        const period = new Date().toISOString().slice(0, 7) // e.g. 2026-09
        const { data: usageRow } = await supabase
          .from('organization_usage')
          .select('value')
          .eq('organization_id', organizationId)
          .eq('period', period)
          .eq('metric', 'review_requests_sent')
          .maybeSingle()

        const currentVal = usageRow?.value ? Number(usageRow.value) : 0
        await supabase.from('organization_usage').upsert({
          organization_id: organizationId,
          period,
          metric: 'review_requests_sent',
          value: currentVal + 1,
        })
      } else {
        await supabase
          .from('review_requests')
          .update({
            status: 'FAILED',
            failed_at: new Date().toISOString(),
            error_message: result.error || 'Provider send failed',
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
