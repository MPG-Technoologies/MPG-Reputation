/**
 * Billing persistence domain policy (MR-5B)
 *
 * Provider-agnostic billing state types and ordering primitives.
 * This module does NOT grant product entitlement and does NOT implement
 * Stripe transport, checkout, portal, webhooks, pricing, or live billing.
 */

export type BillingProvider = 'stripe'

export type BillingEnvironment = 'TEST' | 'LIVE'

export type BillingNormalizedStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'GRACE'
  | 'SUSPENDED'
  | 'ENDED'

export type BillingWebhookProcessingStatus =
  | 'RECEIVED'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'IGNORED'
  | 'FAILED'

export type ProviderStateFreshness = 'UNKNOWN' | 'OLDER' | 'SAME' | 'NEWER'

export interface BillingSubscriptionProjection {
  provider: BillingProvider
  providerStatus: string
  normalizedStatus: BillingNormalizedStatus
  providerStateUpdatedAt: string | null
}

const BILLING_STATUSES = new Set<BillingNormalizedStatus>([
  'PENDING',
  'ACTIVE',
  'GRACE',
  'SUSPENDED',
  'ENDED',
])

const WEBHOOK_PROCESSING_STATUSES = new Set<BillingWebhookProcessingStatus>([
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'IGNORED',
  'FAILED',
])

export function isBillingNormalizedStatus(
  value: string
): value is BillingNormalizedStatus {
  return BILLING_STATUSES.has(value as BillingNormalizedStatus)
}

export function isBillingWebhookProcessingStatus(
  value: string
): value is BillingWebhookProcessingStatus {
  return WEBHOOK_PROCESSING_STATUSES.has(value as BillingWebhookProcessingStatus)
}

/**
 * Classifies incoming provider state relative to the state already persisted.
 *
 * This is only an ordering primitive. MR-5C must still use provider-event
 * idempotency and provider truth retrieval where required. Timestamp comparison
 * alone must not become the sole webhook ordering guarantee.
 */
export function classifyProviderStateFreshness(
  currentProviderStateUpdatedAt: string | null | undefined,
  incomingProviderStateUpdatedAt: string | null | undefined
): ProviderStateFreshness {
  if (!currentProviderStateUpdatedAt || !incomingProviderStateUpdatedAt) {
    return 'UNKNOWN'
  }

  const current = Date.parse(currentProviderStateUpdatedAt)
  const incoming = Date.parse(incomingProviderStateUpdatedAt)

  if (!Number.isFinite(current) || !Number.isFinite(incoming)) {
    return 'UNKNOWN'
  }

  if (incoming < current) return 'OLDER'
  if (incoming > current) return 'NEWER'
  return 'SAME'
}

/**
 * Terminal here means the local subscription projection has ended.
 * It does not decide product entitlement, retention, refunds, or restart rules.
 */
export function isTerminalBillingStatus(
  status: BillingNormalizedStatus
): boolean {
  return status === 'ENDED'
}
