/**
 * MR-5E3C3B — a PRIVATE append-only support-intake hint, NOT a support action.
 *
 * Keep distinct from existing Customer/Checkout recovery reviews, which have
 * different case kinds, source checks, and per-organization deduplication.
 * Only usable against disposable Supabase. There is no route or scheduled job.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { SyntheticReconciliationResult } from '@/domain/billing/synthetic-exception-reconciliation'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT_ID = /^evt_[A-Za-z0-9]+$/
const SUB_ID = /^sub_[A-Za-z0-9]+$/
const REVIEW_REASONS = [
  'HISTORY_INVALID_OR_AMBIGUOUS',
  'EVENT_FINGERPRINT_CONFLICT',
  'OLDER_OR_EQUAL_TIME',
  'INITIAL_SUBSCRIPTION_REQUIRES_REVIEW',
  'UNSUPPORTED_TRANSITION',
  'PAID_PERIOD_NOT_ADVANCED',
  'PAID_PERIOD_INVALID',
  'FAILED_PAYMENT_PERIOD_MISMATCH',
  'REPEATED_PAYMENT_FAILURE',
  'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW',
  'DISPUTE_OR_REFUND_HOLD',
  'CANCELLATION_HOLD',
  'TERMINAL_SUBSCRIPTION_HOLD',
  'END_BEFORE_PAID_PERIOD',
  'REFUND_OR_DISPUTE_REQUIRES_REVIEW',
] as const

type ReviewReason = (typeof REVIEW_REASONS)[number]
export type SyntheticExceptionReviewIntake =
  | { readonly outcome: 'DISABLED' | 'INVALID_INPUT' | 'SOURCE_MISMATCH' | 'REVIEW_CONFLICT' }
  | { readonly outcome: 'CASE_OPENED' | 'ALREADY_OPEN'; readonly caseId: string }

function localOnly(): boolean {
  return process.env.ENABLE_LOCAL_SYNTHETIC_EXCEPTION_REVIEW === 'true' &&
    process.env.MPG_SYNTHETIC_EXCEPTION_REVIEW_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    ['http://127.0.0.1:54331','http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

function isReason(value: unknown): value is ReviewReason {
  return typeof value === 'string' &&
    REVIEW_REASONS.some(reason => reason === value)
}

function matchingCase(
  row: Database['public']['Tables']['billing_synthetic_subscription_exception_reviews']['Row'],
  organizationId: string,
  subscriptionRecordId: string,
  webhookEventRecordId: string,
  reason: ReviewReason,
): boolean {
  return row.organization_id === organizationId &&
    row.subscription_record_id === subscriptionRecordId &&
    row.webhook_event_record_id === webhookEventRecordId &&
    row.review_reason === reason &&
    row.provider === 'stripe' && row.environment === 'TEST' &&
    row.review_state === 'OPEN' &&
    row.source_kind === 'SYNTHETIC' &&
    row.verification_status === 'UNVERIFIED' &&
    row.access_authorized === false
}

/**
 * The caller's RECONCILIATION result is synthetic and NOT authenticated
 * payment evidence. Use only in an isolated engineering test harness.
 * An owner-authorized support actor/grant workflow remains future work.
 */
export async function requestLocalSyntheticSubscriptionExceptionReview(args: {
  readonly trustedBillingSupabase: SupabaseClient<Database>
  readonly organizationId: unknown
  readonly subscriptionRecordId: unknown
  readonly webhookEventRecordId: unknown
  readonly assessment: SyntheticReconciliationResult
}): Promise<SyntheticExceptionReviewIntake> {
  if (!localOnly()) return { outcome: 'DISABLED' }
  const { organizationId, subscriptionRecordId, webhookEventRecordId, assessment } = args
  const audit = assessment?.audit
  if (typeof organizationId !== 'string' || !UUID.test(organizationId) ||
      typeof subscriptionRecordId !== 'string' || !UUID.test(subscriptionRecordId) ||
      typeof webhookEventRecordId !== 'string' || !UUID.test(webhookEventRecordId) ||
      assessment?.outcome !== 'REVIEW_REQUIRED' || !audit ||
      audit.organizationId !== organizationId ||
      audit.subscriptionRecordId !== subscriptionRecordId ||
      audit.incomingWebhookRecordId !== webhookEventRecordId ||
      audit.environment !== 'TEST' ||
      audit.sourceKind !== 'SYNTHETIC' ||
      audit.evidenceVerified !== false ||
      audit.accessAuthorized !== false ||
      audit.durableAuditRecorded !== false ||
      !EVENT_ID.test(audit.incomingEventId) ||
      !SUB_ID.test(audit.providerSubscriptionId) ||
      !isReason(audit.reason)) {
    return { outcome: 'INVALID_INPUT' }
  }
  const reason = audit.reason
  const db = args.trustedBillingSupabase
  const {data: subscription, error: subscriptionError} = await db
    .from('organization_subscriptions')
    .select('id, provider_subscription_id')
    .eq('id', subscriptionRecordId)
    .eq('organization_id', organizationId)
    .eq('provider', 'stripe')
    .eq('environment', 'TEST')
    .maybeSingle()
  if (subscriptionError) throw new Error('BILLING_EXCEPTION_SUBSCRIPTION_READ_FAILED')
  if (!subscription || subscription.provider_subscription_id !== audit.providerSubscriptionId) {
    return { outcome: 'SOURCE_MISMATCH' }
  }

  const {data: source, error: sourceError} = await db
    .from('billing_webhook_events')
    .select('id, organization_id, provider, environment, provider_event_id, payload_hash')
    .eq('id', webhookEventRecordId)
    .eq('provider', 'stripe')
    .eq('environment', 'TEST')
    .maybeSingle()
  if (sourceError) throw new Error('BILLING_EXCEPTION_EVENT_READ_FAILED')
  if (!source || source.organization_id !== organizationId ||
      source.provider_event_id !== audit.incomingEventId ||
      !/^[a-f0-9]{64}$/.test(source.payload_hash)) {
    return { outcome: 'SOURCE_MISMATCH' }
  }

  async function existing() {
    const {data, error} = await db.from('billing_synthetic_subscription_exception_reviews')
      .select('*')
      .eq('webhook_event_record_id', webhookEventRecordId as string)
      .maybeSingle()
    if (error) throw new Error('BILLING_EXCEPTION_REPLAY_READ_FAILED')
    return data
  }
  const prior = await existing()
  if (prior) return matchingCase(prior, organizationId, subscriptionRecordId,
    webhookEventRecordId, reason)
    ? { outcome: 'ALREADY_OPEN', caseId: prior.id }
    : { outcome: 'REVIEW_CONFLICT' }

  const {data: opened, error: insertError} = await db
    .from('billing_synthetic_subscription_exception_reviews')
    .insert({
      organization_id: organizationId,
      subscription_record_id: subscriptionRecordId,
      webhook_event_record_id: webhookEventRecordId,
      provider: 'stripe',
      environment: 'TEST',
      review_reason: reason,
      review_state: 'OPEN',
      source_kind: 'SYNTHETIC',
      verification_status: 'UNVERIFIED',
      access_authorized: false,
    })
    .select('id')
    .single()
  if (insertError?.code === '23505') {
    // Concurrency-safe replay arbitration by the database UNIQUE event key.
    const found = await existing()
    return found && matchingCase(found, organizationId, subscriptionRecordId,
      webhookEventRecordId, reason)
      ? { outcome: 'ALREADY_OPEN', caseId: found.id }
      : { outcome: 'REVIEW_CONFLICT' }
  }
  if (insertError || !opened) throw new Error('BILLING_EXCEPTION_CASE_CREATE_FAILED')
  return { outcome: 'CASE_OPENED', caseId: opened.id }
}
