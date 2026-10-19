/**
 * MR-5E1 — deterministic evidence assessment ONLY.
 * This is not an entitlement decision, Stripe adapter or webhook handler.
 * Calling code MUST NOT unlock paid features from this result alone.
 */
export interface PaymentEvidenceSnapshot {
  readonly provider: 'stripe'
  readonly environment: 'TEST' | 'LIVE'
  readonly organizationId: string
  readonly subscriptionId: string
  readonly invoiceId: string
  readonly invoiceSubscriptionId: string
  readonly invoicePaid: boolean
  readonly invoiceAmountRemainingMinor: number
  readonly invoiceCurrency: string
  readonly invoiceEnvironment: 'TEST' | 'LIVE'
  readonly invoiceOrganizationId: string
  readonly paymentStatus: 'succeeded' | 'pending' | 'failed' | 'unknown'
  readonly subscriptionStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete'
  readonly periodEnd: string
  readonly verifiedAt: string
}

export type PaymentEvidenceAssessment =
  | { readonly outcome: 'VERIFIED_PAYMENT_EVIDENCE' }
  | { readonly outcome: 'INSUFFICIENT_EVIDENCE'; readonly reason:
      'MISSING_OR_INVALID' | 'TENANT_MISMATCH' | 'ENVIRONMENT_MISMATCH' |
      'SUBSCRIPTION_MISMATCH' | 'CURRENCY_MISMATCH' | 'UNPAID_INVOICE' | 'PAYMENT_NOT_SUCCEEDED' |
      'SUBSCRIPTION_NOT_ACTIVE' | 'EXPIRED_PERIOD' | 'STALE_EVIDENCE' }

/**
 * A conservative prerequisite, not proof of webhook processing, settlement,
 * recurring renewal or an active paid entitlement.
 * Caller supplies trusted, independently fetched provider facts; browser
 * or database projection data must never be treated as independently verified.
 */
export function assessPaymentEvidence(
  value: PaymentEvidenceSnapshot | null,
  context: { organizationId: string; environment: 'TEST' | 'LIVE'; now: string;
    maxEvidenceAgeMs: number; expectedCurrency: string }
): PaymentEvidenceAssessment {
  const fail = (reason: Extract<PaymentEvidenceAssessment, {outcome: 'INSUFFICIENT_EVIDENCE'}>['reason']): PaymentEvidenceAssessment =>
    ({ outcome: 'INSUFFICIENT_EVIDENCE', reason })
  if (!value || value.provider !== 'stripe' ||
      !Number.isFinite(Date.parse(context.now)) ||
      !Number.isFinite(context.maxEvidenceAgeMs) || context.maxEvidenceAgeMs <= 0 ||
      !/^sub_[A-Za-z0-9]+$/.test(value.subscriptionId) ||
      !/^in_[A-Za-z0-9]+$/.test(value.invoiceId) ||
      !/^[A-Z]{3}$/.test(context.expectedCurrency) ||
      !/^[A-Za-z]{3}$/.test(value.invoiceCurrency) ||
      !Number.isSafeInteger(value.invoiceAmountRemainingMinor) ||
      value.invoiceAmountRemainingMinor < 0 ||
      !Number.isFinite(Date.parse(value.verifiedAt)) ||
      !Number.isFinite(Date.parse(value.periodEnd))) return fail('MISSING_OR_INVALID')
  if (value.organizationId !== context.organizationId ||
      value.invoiceOrganizationId !== context.organizationId) return fail('TENANT_MISMATCH')
  if (value.environment !== context.environment ||
      value.invoiceEnvironment !== context.environment) return fail('ENVIRONMENT_MISMATCH')
  if (value.subscriptionId !== value.invoiceSubscriptionId) return fail('SUBSCRIPTION_MISMATCH')
  if (value.invoiceCurrency.toUpperCase() !== context.expectedCurrency) return fail('CURRENCY_MISMATCH')
  if (!value.invoicePaid || value.invoiceAmountRemainingMinor !== 0) return fail('UNPAID_INVOICE')
  if (value.paymentStatus !== 'succeeded') return fail('PAYMENT_NOT_SUCCEEDED')
  if (value.subscriptionStatus !== 'active') return fail('SUBSCRIPTION_NOT_ACTIVE')
  const now = Date.parse(context.now)
  if (Date.parse(value.periodEnd) <= now) return fail('EXPIRED_PERIOD')
  const age = now - Date.parse(value.verifiedAt)
  if (age < 0 || age > context.maxEvidenceAgeMs) return fail('STALE_EVIDENCE')
  return { outcome: 'VERIFIED_PAYMENT_EVIDENCE' }
}
