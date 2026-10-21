import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  resolveStripeSubscriptionOrganization,
  type VerifiedStripeSubscriptionEvent,
} from './stripe-subscription-truth'
import {
  prepareStripeSubscriptionProjection,
  type StripeSubscriptionProjectionCandidate,
  type StripeSubscriptionProjectionTruth,
} from './stripe-subscription-candidate'

/**
 * Stripe Event snapshots identify subscriptions; they are never themselves
 * the subscription state that should be applied to MPG.
 */
export interface RetrievedStripeRecoveryEvent extends VerifiedStripeSubscriptionEvent {
  id: string
  object: string
}

export type StripeRecoveryEventRetriever =
  (eventId: string) => Promise<RetrievedStripeRecoveryEvent>

export type StripeRecoverySubscriptionRetriever =
  (subscriptionId: string) => Promise<StripeSubscriptionProjectionTruth>

export type StripeRecoveryPreflightOutcome =
  | { readonly outcome: 'NOT_LEASE_HOLDER' }
  | { readonly outcome: 'IGNORED' }
  | {
      readonly outcome: 'FAILED'
      readonly errorCode:
        | 'PROVIDER_UNAVAILABLE'
        | 'INVALID_PROVIDER_DATA'
        | 'UNRESOLVED_CUSTOMER'
        | 'CORRELATION_FAILED'
    }
  | {
      readonly outcome: 'READY'
      readonly providerCustomerId: string
      readonly candidate: StripeSubscriptionProjectionCandidate
    }

const SUBSCRIPTION_EVENT_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])
const STRIPE_EVENT_ID = /^evt_[A-Za-z0-9]+$/
const STRIPE_SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type StoredLease = Pick<
  Database['public']['Tables']['billing_webhook_events']['Row'],
  'provider' | 'environment' | 'provider_event_id' | 'event_type' |
    'processing_status' | 'processing_lease_token' | 'processing_lease_expires_at'
>

function hasValidLease(
  row: StoredLease | null,
  leaseToken: string,
  now: Date
): row is StoredLease {
  return Boolean(
    row?.provider === 'stripe' &&
    row.environment === 'TEST' &&
    row.processing_status === 'PROCESSING' &&
    row.processing_lease_token === leaseToken &&
    row.processing_lease_expires_at &&
    Number.isFinite(Date.parse(row.processing_lease_expires_at)) &&
    Date.parse(row.processing_lease_expires_at) > now.getTime()
  )
}

async function readLease(
  supabase: SupabaseClient<Database>,
  eventRecordId: string
): Promise<StoredLease | null> {
  const { data, error } = await supabase
    .from('billing_webhook_events')
    .select(
      'provider, environment, provider_event_id, event_type, processing_status, processing_lease_token, processing_lease_expires_at'
    )
    .eq('id', eventRecordId)
    .maybeSingle()

  if (error) {
    // Do not print raw SQL error messages or persisted provider identifiers.
    throw new Error('BILLING_RECOVERY_CLAIM_LOOKUP_FAILED')
  }
  return data
}

function validRecoveryEvent(
  event: RetrievedStripeRecoveryEvent,
  stored: StoredLease
): boolean {
  return Boolean(
    event &&
    event.object === 'event' &&
    event.id === stored.provider_event_id &&
    event.livemode === false &&
    event.type === stored.event_type &&
    event.data &&
    typeof event.data === 'object'
  )
}

/**
 * Prepare a recovered TEST subscription projection from a durably claimed,
 * still-current processing lease, re-fetching Stripe Event identity and the
 * current Stripe Subscription from separate provider API reads.
 *
 * This is a NON-MUTATING preflight. It does not lease events, finalize claims,
 * write subscription rows, or grant paid access. The later worker must guard
 * the provider fetch+write within a per-subscription serialization protocol;
 * an event lease alone DOES NOT prevent stale cross-event projections.
 */
export async function prepareRecoveredStripeSubscription(args: {
  supabase: SupabaseClient<Database>
  eventRecordId: string
  leaseToken: string
  retrieveEvent: StripeRecoveryEventRetriever
  retrieveSubscription: StripeRecoverySubscriptionRetriever
  now?: () => Date
}): Promise<StripeRecoveryPreflightOutcome> {
  const { supabase, eventRecordId, leaseToken, retrieveEvent, retrieveSubscription } = args
  const now = args.now ?? (() => new Date())

  if (!UUID.test(eventRecordId) || !UUID.test(leaseToken)) {
    return { outcome: 'NOT_LEASE_HOLDER' }
  }

  const stored = await readLease(supabase, eventRecordId)
  if (!hasValidLease(stored, leaseToken, now()) ||
      !STRIPE_EVENT_ID.test(stored.provider_event_id)) {
    return { outcome: 'NOT_LEASE_HOLDER' }
  }

  let event: RetrievedStripeRecoveryEvent
  try {
    event = await retrieveEvent(stored.provider_event_id)
  } catch {
    return { outcome: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE' }
  }

  if (!validRecoveryEvent(event, stored)) {
    return { outcome: 'FAILED', errorCode: 'INVALID_PROVIDER_DATA' }
  }

  if (!SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    // Event identity has been recovered and verified against the original
    // signature-verified durable event record. Unsupported type is ignorable.
    if (!hasValidLease(await readLease(supabase, eventRecordId), leaseToken, now())) {
      return { outcome: 'NOT_LEASE_HOLDER' }
    }
    return { outcome: 'IGNORED' }
  }

  const subscriptionId = event.data.object?.id
  if (event.data.object?.object !== 'subscription' ||
      typeof subscriptionId !== 'string' ||
      !STRIPE_SUBSCRIPTION_ID.test(subscriptionId)) {
    return { outcome: 'FAILED', errorCode: 'INVALID_PROVIDER_DATA' }
  }

  let subscription: StripeSubscriptionProjectionTruth
  try {
    subscription = await retrieveSubscription(subscriptionId)
  } catch {
    return { outcome: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE' }
  }

  if (!subscription || subscription.id !== subscriptionId ||
      subscription.livemode !== false) {
    return { outcome: 'FAILED', errorCode: 'INVALID_PROVIDER_DATA' }
  }

  let correlation
  try {
    // Reuse the accepted trusted-customer resolver, avoiding another provider
    // call. Stripe metadata and event.customer are not tenant authority.
    correlation = await resolveStripeSubscriptionOrganization({
      supabase,
      event,
      retrieveSubscription: async () => subscription,
    })
  } catch {
    return { outcome: 'FAILED', errorCode: 'CORRELATION_FAILED' }
  }

  if (correlation.outcome === 'UNRESOLVED_CUSTOMER') {
    return { outcome: 'FAILED', errorCode: 'UNRESOLVED_CUSTOMER' }
  }
  if (correlation.outcome !== 'RESOLVED') {
    return { outcome: 'FAILED', errorCode: 'INVALID_PROVIDER_DATA' }
  }

  const decision = prepareStripeSubscriptionProjection({
    resolved: correlation,
    subscription,
  })
  if (decision.outcome !== 'READY') {
    return { outcome: 'FAILED', errorCode: 'INVALID_PROVIDER_DATA' }
  }

  // A slow external provider request can outlast or lose its processing
  // lease. Never return a candidate for a known-expired/reclaimed lease.
  if (!hasValidLease(await readLease(supabase, eventRecordId), leaseToken, now())) {
    return { outcome: 'NOT_LEASE_HOLDER' }
  }

  return {
    outcome: 'READY',
    providerCustomerId: correlation.providerCustomerId,
    candidate: decision.candidate,
  }
}
