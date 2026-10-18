import type { BillingNormalizedStatus } from './policy'

/**
 * Presentation-only interpretation of a verified local billing projection.
 * These labels never authorize product access or assert payment settlement.
 */
export interface BillingPreviewSubscription {
  readonly normalized_status: BillingNormalizedStatus
  readonly current_period_end: string | null
  readonly cancel_at_period_end: boolean
  readonly environment: 'TEST' | 'LIVE'
}

export type BillingDisplayStatus =
  | 'NOT_CONFIGURED' | 'PENDING' | 'ACTIVE' | 'SUSPENDED'
  | 'ENDED' | 'GRACE' | 'UNAVAILABLE'

export interface BillingWorkspaceSummary {
  readonly status: BillingDisplayStatus
  readonly headline: string
  readonly description: string
  readonly supportRequired: boolean
  readonly periodEnd: string | null
}

export function getBillingWorkspaceSummary(args: {
  readonly subscription: BillingPreviewSubscription | null
  readonly hasTestAccount: boolean
  readonly dataUnavailable?: boolean
}): BillingWorkspaceSummary {
  if (args.dataUnavailable) {
    return {
      status: 'UNAVAILABLE',
      headline: 'Billing status unavailable',
      description: 'We could not verify the subscription record. No payment or plan change has been made.',
      supportRequired: true,
      periodEnd: null,
    }
  }
  const current = args.subscription
  if (!current) {
    return {
      status: 'NOT_CONFIGURED',
      headline: args.hasTestAccount ? 'No TEST subscription recorded' : 'Payment account not set up',
      description: args.hasTestAccount
        ? 'A TEST billing account exists, but no subscription is recorded. Checkout is not yet available.'
        : 'The organization needs a secure Stripe TEST billing account before checkout can begin. Account setup is not yet enabled.',
      supportRequired: !args.hasTestAccount,
      periodEnd: null,
    }
  }
  // This UI uses only local, server-read TEST projections. Never merge in
  // provider LIVE state or convert an ACTIVE row to a paid entitlement.
  if (current.environment !== 'TEST') {
    return {
      status: 'UNAVAILABLE',
      headline: 'Billing environment not available',
      description: 'This workspace only previews TEST billing records.',
      supportRequired: true,
      periodEnd: null,
    }
  }
  const details: Record<BillingNormalizedStatus, {
    headline: string; description: string; supportRequired: boolean
  }> = {
    PENDING: {
      headline: 'Subscription verification pending',
      description: 'A TEST subscription is recorded. Provider verification and billing acceptance are still required.',
      supportRequired: false,
    },
    ACTIVE: {
      headline: 'Provider reports active (TEST)',
      description: 'The local TEST subscription projection is active. This does not confirm payment settlement or grant paid access.',
      supportRequired: false,
    },
    GRACE: {
      headline: 'Grace review required (TEST)',
      description: 'A grace state is recorded. Access and grace-period policy are not enabled.',
      supportRequired: true,
    },
    SUSPENDED: {
      headline: 'Subscription requires attention (TEST)',
      description: 'The provider state indicates an issue. Check TEST billing records before retrying checkout.',
      supportRequired: true,
    },
    ENDED: {
      headline: 'Subscription ended (TEST)',
      description: 'The TEST subscription has ended. A new checkout is not available until recovery and setup are approved.',
      supportRequired: false,
    },
  }
  const chosen = details[current.normalized_status]
  return {
    status: current.normalized_status,
    headline: chosen.headline,
    description: current.cancel_at_period_end && current.normalized_status !== 'ENDED'
      ? chosen.description + ' The provider also records cancellation at period end.'
      : chosen.description,
    supportRequired: chosen.supportRequired,
    periodEnd: current.current_period_end,
  }
}

/** Never treat a checkout return query parameter as payment confirmation. */
export function getCheckoutReturnMessage(kind: 'success' | 'cancel'): {
  title: string; description: string
} {
  if (kind === 'success') {
    return {
      title: 'Checkout returned — verification pending',
      description: 'Returning from Stripe does not confirm payment. Your business subscription will be updated only after verified provider processing.',
    }
  }
  return {
    title: 'Checkout not completed',
    description: 'You returned from checkout. No subscription or paid access is confirmed by this page. Review your billing status before trying again.',
  }
}
