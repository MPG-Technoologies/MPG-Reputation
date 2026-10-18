import type { BillingEnvironment, BillingNormalizedStatus } from '@/domain/billing'
import type { StripeSubscriptionOrganizationResolution } from './stripe-subscription-truth'

type ResolvedStripeSubscription = Extract<
  StripeSubscriptionOrganizationResolution,
  { outcome: 'RESOLVED' }
>

/**
 * Provider-truth shape needed for a subscription projection candidate.
 * Only a freshly retrieved Stripe subscription may be supplied here.
 * The caller must first authenticate the webhook, resolve the real customer
 * via the existing billing account mapping, and enforce TEST/LIVE gating.
 */
export interface StripeSubscriptionProjectionTruth {
  id: string
  livemode: boolean
  customer: string | { id: string }
  status: string
  cancel_at_period_end: boolean
  canceled_at: number | null
  items: {
    data: readonly {
      price: { id: string }
      current_period_start?: number | null
      current_period_end?: number | null
    }[]
    has_more: boolean
  }
  // Legacy API versions may expose the period on the subscription itself.
  current_period_start?: number | null
  current_period_end?: number | null
}

export interface StripeSubscriptionProjectionCandidate {
  readonly provider: 'stripe'
  readonly environment: BillingEnvironment
  readonly organizationId: string
  readonly billingAccountId: string
  readonly providerSubscriptionId: string
  readonly providerPriceId: string
  readonly providerStatus: string
  readonly normalizedStatus: BillingNormalizedStatus
  readonly currentPeriodStart: string | null
  readonly currentPeriodEnd: string | null
  readonly cancelAtPeriodEnd: boolean
  readonly canceledAt: string | null
  /**
   * Stripe Subscription has no monotonic state-updated timestamp.
   * Event.created is not a safe substitute. The future transactional
   * reconciler must use current provider truth and serialization locks.
   */
  readonly providerStateUpdatedAt: null
}

export type StripeSubscriptionProjectionDecision =
  | { readonly outcome: 'READY'; readonly candidate: StripeSubscriptionProjectionCandidate }
  | {
      readonly outcome: 'BLOCKED'
      readonly reason:
        | 'IDENTITY_INVALID'
        | 'SUBSCRIPTION_MISMATCH'
        | 'CUSTOMER_MISMATCH'
        | 'ENVIRONMENT_MISMATCH'
        | 'STATUS_UNSUPPORTED'
        | 'ITEMS_AMBIGUOUS'
        | 'PRICE_INVALID'
        | 'PERIOD_INVALID'
        | 'CANCELLATION_INVALID'
    }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PRICE_ID = /^price_[A-Za-z0-9]+$/

const PROVIDER_STATUS: Readonly<Record<string, BillingNormalizedStatus>> = {
  incomplete: 'PENDING',
  incomplete_expired: 'ENDED',
  trialing: 'PENDING',
  active: 'ACTIVE',
  past_due: 'SUSPENDED',
  canceled: 'ENDED',
  unpaid: 'SUSPENDED',
  paused: 'SUSPENDED',
}

function formatStripeEpoch(value: unknown): string | null | undefined {
  if (value === null) return null
  // Reject floats, invalid values and timestamps outside ISO 8601 range.
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 253402300799
  ) return undefined
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function getCustomerId(customer: StripeSubscriptionProjectionTruth['customer']): string | null {
  const id = typeof customer === 'string' ? customer : customer?.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

function reject(reason: Extract<StripeSubscriptionProjectionDecision, { outcome: 'BLOCKED' }>['reason']): StripeSubscriptionProjectionDecision {
  return { outcome: 'BLOCKED', reason }
}

/**
 * Build a storage candidate from trusted provider truth.
 *
 * Does NOT write to Supabase, settle an invoice, approve dunning/grace policy,
 * grant paid entitlement, activate messaging, or mutate a Stripe subscription.
 * READY is a projection *candidate*, never proof of payment.
 */
export function prepareStripeSubscriptionProjection(args: {
  resolved: ResolvedStripeSubscription
  subscription: StripeSubscriptionProjectionTruth
}): StripeSubscriptionProjectionDecision {
  const { resolved, subscription } = args

  if (
    !UUID.test(resolved.organizationId) ||
    !UUID.test(resolved.billingAccountId) ||
    !resolved.providerSubscriptionId ||
    !resolved.providerCustomerId ||
    !subscription ||
    typeof subscription !== 'object'
  ) return reject('IDENTITY_INVALID')

  if (subscription.id !== resolved.providerSubscriptionId) {
    return reject('SUBSCRIPTION_MISMATCH')
  }

  if (getCustomerId(subscription.customer) !== resolved.providerCustomerId) {
    return reject('CUSTOMER_MISMATCH')
  }

  if (
    typeof subscription.livemode !== 'boolean' ||
    (subscription.livemode ? 'LIVE' : 'TEST') !== resolved.environment
  ) return reject('ENVIRONMENT_MISMATCH')

  if (typeof subscription.status !== 'string' ||
      !Object.prototype.hasOwnProperty.call(PROVIDER_STATUS, subscription.status)) {
    return reject('STATUS_UNSUPPORTED')
  }
  const normalizedStatus = PROVIDER_STATUS[subscription.status]

  const items = subscription.items
  if (!items || items.has_more !== false || !Array.isArray(items.data) ||
      items.data.length !== 1) return reject('ITEMS_AMBIGUOUS')

  const item = items.data[0]
  const providerPriceId = item?.price?.id
  if (typeof providerPriceId !== 'string' || !PRICE_ID.test(providerPriceId)) {
    return reject('PRICE_INVALID')
  }

  // Modern Stripe API versions expose billing periods on subscription items.
  // Older pinned versions may expose them on the parent subscription instead.
  // Do not splice one timestamp from each source.
  const itemPeriodAvailable = item.current_period_start !== undefined &&
    item.current_period_end !== undefined
  const start = itemPeriodAvailable
    ? item.current_period_start
    : subscription.current_period_start
  const end = itemPeriodAvailable
    ? item.current_period_end
    : subscription.current_period_end

  if (start === undefined || end === undefined) return reject('PERIOD_INVALID')

  const currentPeriodStart = formatStripeEpoch(start)
  const currentPeriodEnd = formatStripeEpoch(end)
  if (currentPeriodStart === undefined || currentPeriodEnd === undefined ||
      (currentPeriodStart === null) !== (currentPeriodEnd === null) ||
      (currentPeriodStart !== null && currentPeriodEnd !== null &&
        currentPeriodStart >= currentPeriodEnd) ||
      (subscription.status === 'active' &&
        (currentPeriodStart === null || currentPeriodEnd === null))) {
    return reject('PERIOD_INVALID')
  }

  if (typeof subscription.cancel_at_period_end !== 'boolean') {
    return reject('CANCELLATION_INVALID')
  }
  const canceledAt = formatStripeEpoch(subscription.canceled_at)
  if (canceledAt === undefined) return reject('CANCELLATION_INVALID')

  return {
    outcome: 'READY',
    candidate: {
      provider: 'stripe',
      environment: resolved.environment,
      organizationId: resolved.organizationId,
      billingAccountId: resolved.billingAccountId,
      providerSubscriptionId: resolved.providerSubscriptionId,
      providerPriceId,
      providerStatus: subscription.status,
      normalizedStatus,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt,
      providerStateUpdatedAt: null,
    },
  }
}
