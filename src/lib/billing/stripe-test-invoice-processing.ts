/**
 * MR-5E2D2 — local synthetic-only durable TEST event lease facade.
 * Caller MUST use a privileged, server-side billing inbox client; no HTTP route
 * and no entitlement/PROCESSED/payment path exists in this module.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json, Database } from '@/types/database'

const EVENT_ID = /^evt_[A-Za-z0-9]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ERROR_CODES = new Set([
  'PROVIDER_UNAVAILABLE', 'PROVIDER_MISMATCH', 'TENANT_UNRESOLVED',
  'EVIDENCE_CONFLICT', 'WORKER_ERROR',
])

export type InvoiceLeaseClaimResult =
  | { readonly outcome: 'DISABLED' | 'INVALID_INPUT' | 'NOT_FOUND' |
      'NOT_ELIGIBLE' | 'MANUAL_REVIEW' | 'IN_FLIGHT' }
  | { readonly outcome: 'CLAIMED'; readonly leaseToken: string; readonly attempts: number }

export type InvoiceLeaseFailureResult = {
  readonly outcome: 'DISABLED' | 'INVALID_INPUT' | 'STALE_OR_NOT_CLAIMED' |
    'FAILED_REQUIRES_REVIEW'
}

function localSyntheticOnly(): boolean {
  return process.env.ENABLE_STRIPE_TEST_INVOICE_PROCESSING === 'true' &&
    process.env.MPG_STRIPE_TEST_INVOICE_PROCESSING_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    ['http://127.0.0.1:54331', 'http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

function record(raw: Json): Record<string, Json | undefined> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('BILLING_INVOICE_LEASE_RESPONSE_INVALID')
  }
  return raw
}

export async function claimStripeTestInvoiceLease(args: {
  readonly trustedBillingSupabase: SupabaseClient<Database>
  readonly providerEventId: unknown
}): Promise<InvoiceLeaseClaimResult> {
  if (!localSyntheticOnly()) return { outcome: 'DISABLED' }
  if (typeof args.providerEventId !== 'string' || !EVENT_ID.test(args.providerEventId)) {
    return { outcome: 'INVALID_INPUT' }
  }
  const { data, error } = await args.trustedBillingSupabase
    .rpc('claim_stripe_test_invoice_processing', {
      p_provider_event_id: args.providerEventId,
    })
  if (error) throw new Error('BILLING_INVOICE_LEASE_CLAIM_FAILED')
  const value = record(data)
  if (value.outcome === 'CLAIMED') {
    if (typeof value.lease_token !== 'string' || !UUID.test(value.lease_token) ||
        typeof value.attempts !== 'number' || !Number.isInteger(value.attempts) ||
        value.attempts < 1 || value.attempts > 3) {
      throw new Error('BILLING_INVOICE_LEASE_RESPONSE_INVALID')
    }
    return { outcome: 'CLAIMED', leaseToken: value.lease_token, attempts: value.attempts }
  }
  if (typeof value.outcome === 'string' &&
      ['INVALID_INPUT','NOT_FOUND','NOT_ELIGIBLE','MANUAL_REVIEW','IN_FLIGHT']
        .includes(value.outcome)) {
    return { outcome: value.outcome as Exclude<InvoiceLeaseClaimResult['outcome'], 'CLAIMED' | 'DISABLED'> }
  }
  throw new Error('BILLING_INVOICE_LEASE_RESPONSE_INVALID')
}

/**
 * Fenced, manually reviewable FAILED outcome only.
 * This does NOT mean provider payment failed; it records worker investigation
 * failure and has no paid entitlement or automatic retry effects.
 */
export async function failStripeTestInvoiceLease(args: {
  readonly trustedBillingSupabase: SupabaseClient<Database>
  readonly providerEventId: unknown
  readonly leaseToken: unknown
  readonly errorCode: unknown
}): Promise<InvoiceLeaseFailureResult> {
  if (!localSyntheticOnly()) return { outcome: 'DISABLED' }
  if (typeof args.providerEventId !== 'string' || !EVENT_ID.test(args.providerEventId) ||
      typeof args.leaseToken !== 'string' || !UUID.test(args.leaseToken) ||
      typeof args.errorCode !== 'string' || !ERROR_CODES.has(args.errorCode)) {
    return { outcome: 'INVALID_INPUT' }
  }
  const { data, error } = await args.trustedBillingSupabase
    .rpc('fail_stripe_test_invoice_processing', {
      p_provider_event_id: args.providerEventId,
      p_lease_token: args.leaseToken,
      p_error_code: args.errorCode,
    })
  if (error) throw new Error('BILLING_INVOICE_LEASE_FAILURE_RECORD_FAILED')
  const value = record(data)
  if (value.outcome === 'STALE_OR_NOT_CLAIMED' ||
      value.outcome === 'FAILED_REQUIRES_REVIEW' ||
      value.outcome === 'INVALID_INPUT') {
    return { outcome: value.outcome }
  }
  throw new Error('BILLING_INVOICE_LEASE_RESPONSE_INVALID')
}
