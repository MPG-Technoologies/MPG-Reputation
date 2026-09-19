import { createAdminClient } from '@/lib/supabase/admin'
import { inngest } from '@/inngest/client'
import type {
  ActivationDestination,
  ActivationLocation,
} from '../activation/readiness'
import type {
  CompletionApiCredential,
  CompletionApiStore,
  CompletionIngestionClaim,
  CompletionIngestionFinalize,
  SystemCompletionResult,
  SystemCompletionSubmission,
} from './api-handler'

export class PostgresCompletionApiStore implements CompletionApiStore {
  async getCredential(
    credentialId: string
  ): Promise<CompletionApiCredential | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('completion_api_credentials')
      .select('id, organization_id, secret_hash, status')
      .eq('id', credentialId)
      .maybeSingle()

    if (error || !data) {
      return null
    }

    return {
      id: data.id,
      organizationId: data.organization_id,
      secretHash: data.secret_hash,
      status: data.status,
    }
  }

  async claimIngestion(input: {
    organizationId: string
    credentialId: string
    nonce: string
    requestTimestamp: string
    requestBodyHash: string
  }): Promise<CompletionIngestionClaim> {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc(
      'claim_completion_ingestion',
      {
        p_org_id: input.organizationId,
        p_credential_id: input.credentialId,
        p_nonce: input.nonce,
        p_request_timestamp: input.requestTimestamp,
        p_request_body_hash: input.requestBodyHash,
      }
    )

    if (error || !data) {
      throw new Error(
        `Failed to claim ingestion: ${error?.message || 'unknown error'}`
      )
    }

    return data as unknown as CompletionIngestionClaim
  }

  async getActivationContext(
    organizationId: string,
    locationId: string
  ): Promise<{
    location: ActivationLocation | null
    destination: ActivationDestination | null
  }> {
    const supabase = createAdminClient()
    const [locRes, destRes] = await Promise.all([
      supabase
        .from('locations')
        .select('id, status')
        .eq('id', locationId)
        .eq('organization_id', organizationId)
        .maybeSingle(),
      supabase
        .from('review_destinations')
        .select('location_id, status, canonical_url')
        .eq('location_id', locationId)
        .eq('organization_id', organizationId)
        .eq('provider', 'google')
        .maybeSingle(),
    ])

    return {
      location: locRes.data
        ? { id: locRes.data.id, status: locRes.data.status }
        : null,
      destination: destRes.data
        ? {
            location_id: destRes.data.location_id,
            status: destRes.data.status,
            canonical_url: destRes.data.canonical_url,
          }
        : null,
    }
  }

  async submitCompletion(
    input: SystemCompletionSubmission
  ): Promise<SystemCompletionResult> {
    const supabase = createAdminClient()

    const { data, error } = await supabase.rpc(
      'submit_completion_system_atomic',
      {
        p_org_id: input.organizationId,
        p_loc_id: input.locationId,
        p_first_name: input.firstName,
        p_last_name: input.lastName,
        p_email: input.email,
        p_phone: input.phone,
        p_permission_email: input.permissionEmail,
        p_permission_sms: input.permissionSms,
        p_permission_source: input.permissionSource,
        p_source: input.source,
        p_source_event_id: input.sourceEventId,
        p_source_customer_id: input.sourceCustomerId,
        p_source_transaction_id: input.sourceTransactionId,
        p_completed_at: input.completedAt,
        p_country: input.country,
      }
    )

    if (error || !data) {
      throw new Error(
        `Failed to submit system completion: ${error?.message || 'unknown error'}`
      )
    }

    const res = data as unknown as {
      duplicate: boolean
      customer_id: string
      completion_event_id: string
      outbox_id: string | null
      source_event_id: string
    }

    if (!res.duplicate && res.outbox_id) {
      const eventPayload = {
        eventId: res.completion_event_id,
        organizationId: input.organizationId,
        locationId: input.locationId,
        customerId: res.customer_id,
        sourceEventId: res.source_event_id,
        completedAt: input.completedAt,
        country: input.country,
        contact: {
          email: input.email,
          phone: input.phone,
        },
        permission: {
          email: input.permissionEmail,
          sms: input.permissionSms,
          source: input.permissionSource,
        },
        source: input.source,
        sourceCustomerId: input.sourceCustomerId,
        sourceTransactionId: input.sourceTransactionId,
      }

      try {
        await inngest.send({
          id: res.outbox_id,
          name: 'customer.completed',
          data: eventPayload,
        })

        await supabase
          .from('domain_event_outbox')
          .update({
            status: 'DISPATCHED',
            dispatched_at: new Date().toISOString(),
            attempt_count: 1,
          })
          .eq('id', res.outbox_id)
      } catch (inngestErr: unknown) {
        const errorMsg =
          inngestErr instanceof Error
            ? inngestErr.message
            : 'Inngest send failed'
        console.error(
          '[CompletionAPI] Inngest immediate dispatch failure (durable event in outbox):',
          inngestErr
        )
        await supabase
          .from('domain_event_outbox')
          .update({
            status: 'PENDING',
            attempt_count: 1,
            last_error: errorMsg.slice(0, 500),
          })
          .eq('id', res.outbox_id)
      }

      const period = new Date().toISOString().slice(0, 7)
      try {
        await supabase.rpc('increment_organization_usage', {
          p_org_id: input.organizationId,
          p_period: period,
          p_metric: 'completed_customers',
          p_amount: 1,
        })
      } catch (usageErr) {
        console.error(
          '[CompletionAPI] Usage counter increment warning:',
          usageErr
        )
      }

      try {
        await supabase.from('audit_events').insert({
          organization_id: input.organizationId,
          actor_type: 'system',
          actor_id: null,
          event_type: 'customer.completed',
          entity_type: 'customer_completion_event',
          entity_id: res.completion_event_id,
          metadata: {
            source: input.source,
            source_event_id: res.source_event_id,
            customer_id: res.customer_id,
          },
        })
      } catch (auditErr) {
        console.error('[CompletionAPI] Audit event warning:', auditErr)
      }
    }

    return {
      duplicate: res.duplicate,
      customerId: res.customer_id,
      completionEventId: res.completion_event_id,
      outboxId: res.outbox_id,
      sourceEventId: res.source_event_id,
    }
  }

  async finalizeIngestion(
    input: CompletionIngestionFinalize
  ): Promise<void> {
    const supabase = createAdminClient()
    await supabase
      .from('completion_ingestion_requests')
      .update({
        status: input.status,
        http_status: input.httpStatus,
        error_code: input.errorCode || null,
        source_event_id: input.sourceEventId || null,
        location_id: input.locationId || null,
        completion_event_id: input.completionEventId || null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', input.ingestionId)
      .eq('organization_id', input.organizationId)
  }
}
