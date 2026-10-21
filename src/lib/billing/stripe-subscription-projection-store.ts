import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { StripeSubscriptionProjectionCandidate } from './stripe-subscription-candidate'

export type SubscriptionProjectionPersistenceResult =
  | { readonly outcome: 'CREATED' | 'UPDATED' | 'UNCHANGED'; readonly subscriptionId: string }
  | { readonly outcome: 'BLOCKED'; readonly reason: string }
  | { readonly outcome: 'CONFLICT' }

const SUCCESS = new Set(['CREATED', 'UPDATED', 'UNCHANGED'])
const BLOCK_REASONS = new Set([
  'ENVIRONMENT_DISABLED', 'INVALID_INPUT', 'STATUS_MISMATCH',
  'PERIOD_INVALID', 'ACCOUNT_MISMATCH',
])

/**
 * Persist a candidate through the service_role-only SQL transaction.
 *
 * Dependency injection is intentional: this helper never creates a privileged
 * connection and must only be reached by a future server-side verified Stripe
 * processor, not arbitrary authenticated app UI or event-snapshot data.
 *
 * This is not yet called by the durable webhook intake, does not mark webhook
 * processing complete, and does not grant entitlement or send messages.
 */
export async function persistVerifiedStripeSubscriptionCandidate(args: {
  supabase: SupabaseClient<Database>
  candidate: StripeSubscriptionProjectionCandidate
  providerCustomerId: string
}): Promise<SubscriptionProjectionPersistenceResult> {
  const { supabase, candidate, providerCustomerId } = args
  // This legacy standalone helper is callable independently of the newer
  // fenced reconciliation worker. Do not let a future caller accidentally
  // persist synthetic provider projections in hosted/preview/production,
  // even when handed a privileged Supabase client.
  if (candidate.environment !== 'TEST' ||
      process.env.NODE_ENV === 'production' ||
      process.env.VERCEL_ENV !== undefined ||
      process.env.ENABLE_LIVE_BILLING === 'true' ||
      !['http://127.0.0.1:54331', 'http://localhost:54331']
        .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) {
    return { outcome: 'BLOCKED', reason: 'ENVIRONMENT_DISABLED' }
  }

  const { data, error } = await supabase.rpc(
    'reconcile_stripe_subscription_projection',
    {
      p_org_id: candidate.organizationId,
      p_billing_account_id: candidate.billingAccountId,
      p_provider_customer_id: providerCustomerId,
      p_environment: candidate.environment,
      p_provider_subscription_id: candidate.providerSubscriptionId,
      p_provider_price_id: candidate.providerPriceId,
      p_provider_status: candidate.providerStatus,
      p_normalized_status: candidate.normalizedStatus,
      p_current_period_start: candidate.currentPeriodStart,
      p_current_period_end: candidate.currentPeriodEnd,
      p_cancel_at_period_end: candidate.cancelAtPeriodEnd,
      p_canceled_at: candidate.canceledAt,
    }
  )

  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    // Raw database errors can contain sensitive identifiers or SQL fragments.
    throw new Error('BILLING_SUBSCRIPTION_PROJECTION_PERSIST_FAILED')
  }

  const row = data as { outcome?: unknown; reason?: unknown; subscription_id?: unknown }
  if (typeof row.outcome === 'string' && SUCCESS.has(row.outcome)) {
    if (typeof row.subscription_id !== 'string') {
      throw new Error('BILLING_SUBSCRIPTION_PROJECTION_RESPONSE_INVALID')
    }
    return {
      outcome: row.outcome as 'CREATED' | 'UPDATED' | 'UNCHANGED',
      subscriptionId: row.subscription_id,
    }
  }

  if (row.outcome === 'CONFLICT') return { outcome: 'CONFLICT' }
  if (row.outcome === 'BLOCKED' &&
      typeof row.reason === 'string' &&
      BLOCK_REASONS.has(row.reason)) {
    return { outcome: 'BLOCKED', reason: row.reason }
  }
  throw new Error('BILLING_SUBSCRIPTION_PROJECTION_RESPONSE_INVALID')
}
