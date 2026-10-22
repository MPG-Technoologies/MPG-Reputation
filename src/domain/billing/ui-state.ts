import { isBillingNormalizedStatus, type BillingNormalizedStatus } from './policy'

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

/** Validate untrusted timestamp strings without Date.parse's day-overflow normalization. */
function isValidRecordedPeriodEnd(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string') return false
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!parts) return false
  const instant = Date.parse(value)
  if (!Number.isFinite(instant)) return false
  const hours = parts[9] ? Number(parts[10]) : 0
  const minutes = parts[9] ? Number(parts[11]) : 0
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return false
  const offsetMinutes = parts[9] === '+' ? hours * 60 + minutes
    : parts[9] === '-' ? -(hours * 60 + minutes) : 0
  const atLocalOffset = new Date(instant + offsetMinutes * 60_000)
  if (!Number.isFinite(atLocalOffset.getTime())) return false
  // E.g. 2026-02-30 otherwise silently becomes March 2 in JavaScript.
  return atLocalOffset.toISOString().slice(0, 19) ===
    `${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}`
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
  // Orphan provider projections must not display ACTIVE without an account.
  if (current && !args.hasTestAccount) {
    return {
      status: 'UNAVAILABLE',
      headline: 'Billing status unavailable',
      description: 'The subscription cannot be matched to a verified billing account. No payment or plan change has been made.',
      supportRequired: true,
      periodEnd: null,
    }
  }
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
  // PostgREST/SQL results are untrusted at runtime despite generated TS types.
  // Unknown states must never crash the customer page or appear as ACTIVE.
  // An invalid date could throw in the scoped server view's toISOString().
  const end = current.current_period_end
  const validPeriodEnd = isValidRecordedPeriodEnd(end)
  if (!isBillingNormalizedStatus(current.normalized_status) ||
      typeof current.cancel_at_period_end !== 'boolean' || !validPeriodEnd) {
    return {
      status: 'UNAVAILABLE',
      headline: 'Billing status unavailable',
      description: 'The TEST subscription record could not be validated. No payment, plan change or paid access is confirmed.',
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

/**
 * Shared read-only billing snapshot boundary for legacy + org-scoped pages.
 * PostgREST data is runtime-untrusted; a duplicate, orphan or malformed
 * account/subscription must not generate checkout controls or an ACTIVE label.
 * This never authorizes payments or entitlements.
 */
export function resolveTestBillingSnapshot(args: {
  readonly account: unknown
  readonly subscriptions: unknown
  readonly queryFailed?: boolean
}): {
  readonly summary: BillingWorkspaceSummary
  readonly hasTestAccount: boolean
  readonly hasOngoingSubscription: boolean
} {
  const account = args.account
  const accountId = account && typeof account === 'object' &&
    !Array.isArray(account) && 'id' in account &&
    typeof account.id === 'string' && account.id.trim() !== ''
      ? account.id : null
  const accountMalformed = account !== null && accountId === null
  const rows = args.subscriptions
  const validRows = Array.isArray(rows) && rows.length <= 1
  const row = validRows && rows.length === 1 ? rows[0] : null
  const rowValid = row === null || (typeof row === 'object' &&
    !Array.isArray(row) && row !== undefined &&
    'billing_account_id' in row && typeof row.billing_account_id === 'string' &&
    row.billing_account_id === accountId &&
    'normalized_status' in row && 'current_period_end' in row &&
    'cancel_at_period_end' in row && 'environment' in row)
  const unavailable = Boolean(args.queryFailed || account === undefined ||
    accountMalformed || !validRows || !rowValid)
  const candidate = !unavailable && row !== null ? row as unknown as BillingPreviewSubscription : null
  const summary = getBillingWorkspaceSummary({
    subscription: candidate,
    hasTestAccount: accountId !== null,
    dataUnavailable: unavailable,
  })
  return {
    summary,
    hasTestAccount: accountId !== null && !unavailable,
    hasOngoingSubscription: summary.status !== 'UNAVAILABLE' &&
      candidate !== null && summary.status !== 'ENDED',
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
