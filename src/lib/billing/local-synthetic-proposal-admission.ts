/**
 * MR-5E3C1: local-synthetic-only append of a subscription lifecycle PROPOSAL.
 *
 * This file must NEVER be connected to an HTTP handler, paid-access check or
 * production scheduler. The input proposal is not trusted financial evidence.
 * It may only stage an UNVERIFIED, non-authorizing record in disposable tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { SubscriptionLifecycleProposal } from '@/domain/billing/subscription-lifecycle-proposals'

type Candidate = Extract<SubscriptionLifecycleProposal, { outcome: 'PROPOSAL_ONLY' }>
type Action = Candidate['action']
type Status = Candidate['candidate']['status']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT_ID = /^evt_[A-Za-z0-9]+$/
const SUB_ID = /^sub_[A-Za-z0-9]+$/
const FINGERPRINT = /^[a-f0-9]{64}$/
const EVENT_TYPES: Record<Action, readonly string[]> = {
  INITIAL_ACTIVATION: ['invoice.paid'],
  RENEWAL: ['invoice.paid'],
  PAYMENT_DUE: ['invoice.payment_failed'],
  SCHEDULE_CANCELLATION: ['customer.subscription.updated'],
  END_AT_PERIOD: ['customer.subscription.deleted'],
  ESCALATE_FOR_REVIEW: [
    'charge.refunded', 'charge.dispute.created', 'invoice.payment_failed',
  ],
}
const ACTION_STATUSES: Record<Action, Status> = {
  INITIAL_ACTIVATION: 'ACTIVE',
  RENEWAL: 'ACTIVE',
  PAYMENT_DUE: 'PAST_DUE',
  SCHEDULE_CANCELLATION: 'CANCEL_AT_PERIOD_END',
  END_AT_PERIOD: 'ENDED',
  ESCALATE_FOR_REVIEW: 'REVIEW_REQUIRED',
}
const ACTIONS = Object.keys(EVENT_TYPES) as Action[]

export type SyntheticProposalAdmission =
  | { readonly outcome: 'DISABLED' | 'INVALID_INPUT' | 'SOURCE_MISMATCH' | 'REPLAY_CONFLICT' | 'STALE_OR_AMBIGUOUS' | 'REVIEW_HOLD' }
  | { readonly outcome: 'RECORDED_PROPOSAL_ONLY' | 'ALREADY_RECORDED'; readonly recordId: string }

function enabled(): boolean {
  return process.env.ENABLE_LOCAL_SYNTHETIC_PROPOSAL_ADMISSION === 'true' &&
    process.env.MPG_PROPOSAL_ADMISSION_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    ['http://127.0.0.1:54331', 'http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

function validTime(value: unknown): number | null {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sameCandidate(row: Database['public']['Tables']['billing_paid_entitlement_proposals']['Row'],
  proposal: Candidate, orgId: string, subscriptionId: string): boolean {
  return row.organization_id === orgId &&
    row.subscription_record_id === subscriptionId &&
    row.proposed_action === proposal.action &&
    row.candidate_status === proposal.candidate.status &&
    Date.parse(row.candidate_period_end) === Date.parse(proposal.candidate.periodEnd) &&
    row.source_kind === 'SYNTHETIC' &&
    row.verification_status === 'UNVERIFIED' &&
    row.access_authorized === false
}

/**
 * Caller supplies a trusted SERVER-ONLY client only to disposable Supabase,
 * and a policy proposal derived from synthetic fixtures, NEVER user input.
 * This facade is intentionally NOT a proof verifier or authorization path.
 */
export async function recordLocalSyntheticLifecycleProposal(args: {
  readonly trustedBillingSupabase: SupabaseClient<Database>
  readonly organizationId: unknown
  readonly subscriptionRecordId: unknown
  readonly webhookEventRecordId: unknown
  readonly proposal: SubscriptionLifecycleProposal
}): Promise<SyntheticProposalAdmission> {
  if (!enabled()) return { outcome: 'DISABLED' }

  const { organizationId, subscriptionRecordId, webhookEventRecordId, proposal } = args
  if (typeof organizationId !== 'string' || !UUID.test(organizationId) ||
      typeof subscriptionRecordId !== 'string' || !UUID.test(subscriptionRecordId) ||
      typeof webhookEventRecordId !== 'string' || !UUID.test(webhookEventRecordId) ||
      !proposal || proposal.outcome !== 'PROPOSAL_ONLY') {
    return { outcome: 'INVALID_INPUT' }
  }

  const { candidate, action } = proposal
  if (!candidate || !ACTIONS.includes(action) ||
      candidate.organizationId !== organizationId ||
      candidate.environment !== 'TEST' || !SUB_ID.test(candidate.subscriptionId) ||
      !EVENT_ID.test(candidate.lastEventId) ||
      !FINGERPRINT.test(candidate.lastEventFingerprint) ||
      ACTION_STATUSES[action] !== candidate.status ||
      validTime(candidate.periodEnd) === null ||
      validTime(candidate.lastEventAt) === null) {
    return { outcome: 'INVALID_INPUT' }
  }

  const db = args.trustedBillingSupabase
  const { data: subscription, error: subscriptionError } = await db
    .from('organization_subscriptions')
    .select('id, provider_subscription_id')
    .eq('id', subscriptionRecordId)
    .eq('organization_id', organizationId)
    .eq('provider', 'stripe')
    .eq('environment', 'TEST')
    .maybeSingle()
  if (subscriptionError) throw new Error('BILLING_PROPOSAL_SUBSCRIPTION_READ_FAILED')
  if (!subscription || subscription.provider_subscription_id !== candidate.subscriptionId) {
    return { outcome: 'SOURCE_MISMATCH' }
  }

  const { data: event, error: eventError } = await db
    .from('billing_webhook_events')
    .select('id, organization_id, provider, environment, provider_event_id, event_type, provider_invoice_id, processing_status, processed_at, provider_created_at, payload_hash')
    .eq('id', webhookEventRecordId)
    .eq('provider', 'stripe')
    .eq('environment', 'TEST')
    .maybeSingle()
  if (eventError) throw new Error('BILLING_PROPOSAL_WEBHOOK_READ_FAILED')
  if (!event || event.organization_id !== organizationId ||
      event.provider_event_id !== candidate.lastEventId ||
      event.payload_hash !== candidate.lastEventFingerprint ||
      !event.provider_created_at ||
      Date.parse(event.provider_created_at) !== validTime(candidate.lastEventAt) ||
      event.processing_status !== 'PROCESSED' ||
      !event.processed_at ||
      !EVENT_TYPES[action].includes(event.event_type) ||
      (['INITIAL_ACTIVATION','RENEWAL'].includes(action) &&
        (typeof event.provider_invoice_id !== 'string' ||
         !/^in_[A-Za-z0-9]+$/.test(event.provider_invoice_id)))) {
    return { outcome: 'SOURCE_MISMATCH' }
  }

  const validatedEventRecordId: string = webhookEventRecordId

  async function prior() {
    const { data, error } = await db.from('billing_paid_entitlement_proposals')
      .select('*')
      .eq('webhook_event_record_id', validatedEventRecordId)
      .maybeSingle()
    if (error) throw new Error('BILLING_PROPOSAL_REPLAY_READ_FAILED')
    return data
  }

  const existing = await prior()
  if (existing) {
    return sameCandidate(existing, proposal, organizationId, subscriptionRecordId)
      ? { outcome: 'ALREADY_RECORDED', recordId: existing.id }
      : { outcome: 'REPLAY_CONFLICT' }
  }

  const { data: inserted, error: insertError } = await db
    .from('billing_paid_entitlement_proposals')
    .insert({
      organization_id: organizationId,
      subscription_record_id: subscriptionRecordId,
      webhook_event_record_id: webhookEventRecordId,
      provider: 'stripe',
      environment: 'TEST',
      proposed_action: action,
      candidate_status: candidate.status,
      candidate_period_end: candidate.periodEnd,
      source_kind: 'SYNTHETIC',
      verification_status: 'UNVERIFIED',
      access_authorized: false,
    })
    .select('id')
    .single()

  if (insertError?.message?.includes('BILLING_PROPOSAL_STALE_OR_AMBIGUOUS_EVENT') ||
      insertError?.message?.includes('BILLING_PROPOSAL_SOURCE_ORDER_UNKNOWN')) {
    return { outcome: 'STALE_OR_AMBIGUOUS' }
  }
  if (insertError?.message?.includes('BILLING_PROPOSAL_REVIEW_HOLD')) {
    return { outcome: 'REVIEW_HOLD' }
  }
  if (insertError?.code === '23505') {
    // Unique event key resolves concurrent identical replays without UPSERT:
    // no second write, no mutation of immutable proposal or source event.
    const stored = await prior()
    return stored && sameCandidate(stored, proposal, organizationId, subscriptionRecordId)
      ? { outcome: 'ALREADY_RECORDED', recordId: stored.id }
      : { outcome: 'REPLAY_CONFLICT' }
  }
  if (insertError || !inserted) throw new Error('BILLING_PROPOSAL_RECORD_FAILED')
  return { outcome: 'RECORDED_PROPOSAL_ONLY', recordId: inserted.id }
}
