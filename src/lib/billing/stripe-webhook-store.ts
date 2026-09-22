import { createHash } from 'node:crypto'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type {
  BillingEnvironment,
  BillingWebhookProcessingStatus,
} from '@/domain/billing'
import { assertStripeEventEnvironmentAllowed } from './stripe'

type VerifiedStripeEventIdentity = Pick<
  Stripe.Event,
  'id' | 'type' | 'created' | 'livemode'
>

interface StripeWebhookClaimRecord {
  recordId: string
  environment: BillingEnvironment
  payloadHash: string
  processingStatus: BillingWebhookProcessingStatus
  organizationId: string | null
  processedAt: string | null
}

export type StripeWebhookClaimResult =
  | ({ outcome: 'CLAIMED' } & StripeWebhookClaimRecord)
  | ({ outcome: 'EXISTING_FINAL' } & StripeWebhookClaimRecord)
  | ({ outcome: 'EXISTING_INCOMPLETE' } & StripeWebhookClaimRecord)
  | ({ outcome: 'PAYLOAD_CONFLICT' } & StripeWebhookClaimRecord)

export function hashStripeWebhookPayload(
  rawBody: string | Buffer
): string {
  return createHash('sha256').update(rawBody).digest('hex')
}

function classifyExistingClaim(
  row: Database['public']['Tables']['billing_webhook_events']['Row'],
  payloadHash: string
): StripeWebhookClaimResult {
  const base: StripeWebhookClaimRecord = {
    recordId: row.id,
    environment: row.environment,
    payloadHash: row.payload_hash,
    processingStatus: row.processing_status,
    organizationId: row.organization_id,
    processedAt: row.processed_at,
  }

  if (row.payload_hash !== payloadHash) {
    return {
      outcome: 'PAYLOAD_CONFLICT',
      ...base,
    }
  }

  if (
    row.processing_status === 'PROCESSED' ||
    row.processing_status === 'IGNORED'
  ) {
    return {
      outcome: 'EXISTING_FINAL',
      ...base,
    }
  }

  return {
    outcome: 'EXISTING_INCOMPLETE',
    ...base,
  }
}

/**
 * Atomically claims an already signature-verified Stripe Event.
 *
 * Trust boundary:
 * - event MUST already have passed Stripe signature verification.
 * - TEST/LIVE is derived from verified event.livemode.
 * - LIVE remains blocked unless ENABLE_LIVE_BILLING is exactly "true".
 * - the database uniqueness constraint is the concurrency primitive.
 * - raw webhook payloads are never persisted; only SHA-256 hashes are stored.
 */
export async function claimVerifiedStripeWebhookEvent(args: {
  supabase: SupabaseClient<Database>
  event: VerifiedStripeEventIdentity
  rawBody: string | Buffer
}): Promise<StripeWebhookClaimResult> {
  const { supabase, event, rawBody } = args

  const environment = assertStripeEventEnvironmentAllowed(event)
  const payloadHash = hashStripeWebhookPayload(rawBody)
  const providerCreatedAt = new Date(event.created * 1000).toISOString()

  const { data: inserted, error: insertError } = await supabase
    .from('billing_webhook_events')
    .insert({
      provider: 'stripe',
      environment,
      provider_event_id: event.id,
      event_type: event.type,
      processing_status: 'RECEIVED',
      payload_hash: payloadHash,
      provider_created_at: providerCreatedAt,
    })
    .select(
      'id, environment, payload_hash, processing_status, organization_id, processed_at'
    )
    .single()

  if (!insertError && inserted) {
    return {
      outcome: 'CLAIMED',
      recordId: inserted.id,
      environment: inserted.environment,
      payloadHash: inserted.payload_hash,
      processingStatus: inserted.processing_status,
      organizationId: inserted.organization_id,
      processedAt: inserted.processed_at,
    }
  }

  if (insertError?.code !== '23505') {
    throw new Error('BILLING_WEBHOOK_EVENT_CLAIM_FAILED')
  }

  const { data: existing, error: lookupError } = await supabase
    .from('billing_webhook_events')
    .select(
      'id, provider, environment, provider_event_id, event_type, processing_status, payload_hash, organization_id, provider_created_at, received_at, processed_at, error_code, created_at'
    )
    .eq('provider', 'stripe')
    .eq('environment', environment)
    .eq('provider_event_id', event.id)
    .maybeSingle()

  if (lookupError || !existing) {
    throw new Error('BILLING_WEBHOOK_EVENT_CLAIM_LOOKUP_FAILED')
  }

  return classifyExistingClaim(existing, payloadHash)
}