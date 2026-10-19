/**
 * MR-5E2D1 — private, read-only preflight for a durable TEST invoice event.
 * No route, scheduler, provider credentials, event mutation, or entitlement grant.
 *
 * This reads service-role-only billing_webhook_events; callers must hold a
 * narrowly trusted server-side client, never a browser or tenant RPC client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  resolveStripeInvoiceReferenceOrganization,
  type StripeInvoiceRetriever,
} from './stripe-invoice-truth'

const EVENT_ID = /^evt_[A-Za-z0-9]+$/
const INVOICE_ID = /^in_[A-Za-z0-9]+$/
const HASH = /^[0-9a-f]{64}$/
const INVOICE_EVENTS = new Set(['invoice.paid', 'invoice.payment_failed'])

type EventRecord = Pick<Database['public']['Tables']['billing_webhook_events']['Row'],
  'id' | 'provider_event_id' | 'provider' | 'environment' | 'event_type' |
  'provider_invoice_id' | 'processing_status' | 'payload_hash' |
  'processed_at' | 'organization_id'>

export type InvoiceInboxPreflight =
  | { readonly outcome: 'DISABLED' }
  | { readonly outcome: 'INVALID_EVENT_ID' }
  | { readonly outcome: 'NOT_READY'; readonly reason:
      'MISSING' | 'UNSUPPORTED' | 'INCOMPLETE_REFERENCE' |
      'NOT_UNPROCESSED' | 'CHANGED_DURING_READ' }
  | { readonly outcome: 'UNRESOLVED_IDENTITY' }
  | { readonly outcome: 'MATCHED_IDENTITY_ONLY'; readonly organizationId: string }

/** Explicitly local and synthetic; LIVE/hosted use is not authorized. */
function localSyntheticOnly(): boolean {
  return process.env.ENABLE_STRIPE_TEST_INVOICE_PREFLIGHT === 'true' &&
    process.env.MPG_STRIPE_TEST_INVOICE_PREFLIGHT_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    ['http://127.0.0.1:54331', 'http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

function candidate(record: EventRecord | null): InvoiceInboxPreflight | null {
  if (!record) return { outcome: 'NOT_READY', reason: 'MISSING' }
  if (record.provider !== 'stripe' || record.environment !== 'TEST' ||
      !INVOICE_EVENTS.has(record.event_type)) {
    return { outcome: 'NOT_READY', reason: 'UNSUPPORTED' }
  }
  if (!record.provider_invoice_id || !INVOICE_ID.test(record.provider_invoice_id) ||
      !HASH.test(record.payload_hash)) {
    return { outcome: 'NOT_READY', reason: 'INCOMPLETE_REFERENCE' }
  }
  if (record.processing_status !== 'RECEIVED' ||
      record.processed_at !== null || record.organization_id !== null) {
    return { outcome: 'NOT_READY', reason: 'NOT_UNPROCESSED' }
  }
  return null
}

function unchanged(a: EventRecord, b: EventRecord | null): boolean {
  if (!b) return false
  const fields: readonly (keyof EventRecord)[] = [
    'id', 'provider_event_id', 'provider', 'environment', 'event_type',
    'provider_invoice_id', 'processing_status', 'payload_hash',
    'processed_at', 'organization_id',
  ]
  return fields.every(field => a[field] === b[field])
}

export async function inspectStripeTestInvoiceInbox(args: {
  readonly trustedBillingSupabase: SupabaseClient<Database>
  readonly providerEventId: unknown
  readonly retrieveInvoice: StripeInvoiceRetriever
}): Promise<InvoiceInboxPreflight> {
  if (!localSyntheticOnly()) return { outcome: 'DISABLED' }
  if (typeof args.providerEventId !== 'string' ||
      !EVENT_ID.test(args.providerEventId)) {
    return { outcome: 'INVALID_EVENT_ID' }
  }

  async function read(): Promise<EventRecord | null> {
    const { data, error } = await args.trustedBillingSupabase
      .from('billing_webhook_events')
      .select('id, provider_event_id, provider, environment, event_type, provider_invoice_id, processing_status, payload_hash, processed_at, organization_id')
      .eq('provider', 'stripe')
      .eq('environment', 'TEST')
      .eq('provider_event_id', args.providerEventId as string)
      .maybeSingle()
    if (error) throw new Error('BILLING_INVOICE_INBOX_READ_FAILED')
    return data
  }

  const before = await read()
  const blocked = candidate(before)
  if (blocked) return blocked
  if (!before?.provider_invoice_id) {
    return { outcome: 'NOT_READY', reason: 'INCOMPLETE_REFERENCE' }
  }

  const resolved = await resolveStripeInvoiceReferenceOrganization({
    supabase: args.trustedBillingSupabase,
    invoiceId: before.provider_invoice_id,
    environment: 'TEST',
    retrieveInvoice: args.retrieveInvoice,
  })

  // A second snapshot cannot replace future transactional locking, but detects
  // in-flight event transitions during this non-mutating inspection.
  const after = await read()
  if (!unchanged(before, after)) {
    return { outcome: 'NOT_READY', reason: 'CHANGED_DURING_READ' }
  }
  if (resolved.outcome !== 'RESOLVED_IDENTITY_ONLY') {
    return { outcome: 'UNRESOLVED_IDENTITY' }
  }
  return { outcome: 'MATCHED_IDENTITY_ONLY', organizationId: resolved.organizationId }
}
