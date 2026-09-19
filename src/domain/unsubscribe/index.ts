import { randomBytes, createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { hashSuppressionContact } from '@/domain/suppression'

export interface UnsubscribeToken {
  token: string
  tokenHash: string
}

/**
 * Generates an unguessable, cryptographically secure 256-bit token for unsubscribe links.
 * Token contains zero identifiable customer or organization information.
 */
export function generateUnsubscribeToken(): UnsubscribeToken {
  // 32 random bytes = 256 bits of CSPRNG entropy
  const buffer = randomBytes(32)
  const token = buffer.toString('base64url')
  const tokenHash = hashUnsubscribeToken(token)
  return { token, tokenHash }
}

/**
 * Computes SHA-256 hash of unsubscribe token for constant-time DB lookup.
 */
export function hashUnsubscribeToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex')
}

/**
 * Validates whether the incoming token matches expected format and entropy requirements.
 */
export function isValidUnsubscribeTokenFormat(token: string): boolean {
  if (!token || typeof token !== 'string') return false
  const trimmed = token.trim()
  // base64url string for 32 bytes is ~43 characters, accept 32 to 64 chars
  return /^[A-Za-z0-9_-]{32,64}$/.test(trimmed)
}

/**
 * Builds the canonical public unsubscribe URL.
 */
export function buildUnsubscribeUrl(baseUrl: string, token: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  return `${cleanBase}/unsubscribe/${encodeURIComponent(token.trim())}`
}

export interface ProcessUnsubscribeResult {
  success: boolean
  businessName?: string
  alreadySuppressed?: boolean
  error?: string
}

/**
 * Core domain logic for processing customer unsubscription.
 * Idempotently adds a contact suppression and cancels scheduled review requests.
 *
 * CRITICAL INVARIANTS:
 * 1. Historical delivery truth preserved: NEVER regresses or mutates SENT, DELIVERED, or CLICKED requests.
 * 2. Cross-tenant isolation: Token resolves to explicit organization_id and customer_id in review_requests.
 * 3. Suppression scope: Stores standardized SHA-256 hashed contact for (organization_id, 'email').
 * 4. Idempotent: Repeated unsubscriptions return safe success without creating duplicate suppression records.
 */
export async function processCustomerUnsubscribe({
  token,
  supabase,
}: {
  token: string
  supabase: SupabaseClient<Database>
}): Promise<ProcessUnsubscribeResult> {
  if (!isValidUnsubscribeTokenFormat(token)) {
    return { success: false, error: 'Invalid or expired unsubscribe link.' }
  }

  const tokenHash = hashUnsubscribeToken(token)

  // 1. Resolve review_request by unsubscribe_token_hash
  const { data: request, error: reqError } = await supabase
    .from('review_requests')
    .select('id, organization_id, customer_id, channel, status')
    .eq('unsubscribe_token_hash', tokenHash)
    .maybeSingle()

  if (reqError || !request) {
    return { success: false, error: 'Invalid or expired unsubscribe link.' }
  }

  // 2. Resolve organization details
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, status')
    .eq('id', request.organization_id)
    .single()

  if (!org) {
    return { success: false, error: 'Business not found.' }
  }

  // 3. Resolve customer details explicitly scoped to organization
  const { data: cust } = await supabase
    .from('customers')
    .select('id, email')
    .eq('id', request.customer_id)
    .eq('organization_id', request.organization_id)
    .single()

  if (!cust || !cust.email) {
    return { success: false, error: 'Customer contact not found.' }
  }

  // 4. Create or verify existing suppression using standard hash
  const contactHash = hashSuppressionContact('email', cust.email)

  const { data: existingSupp } = await supabase
    .from('suppressions')
    .select('id')
    .eq('organization_id', request.organization_id)
    .eq('channel', 'email')
    .eq('contact_hash', contactHash)
    .maybeSingle()

  if (!existingSupp) {
    const { error: suppError } = await supabase
      .from('suppressions')
      .insert({
        organization_id: request.organization_id,
        channel: 'email',
        contact_hash: contactHash,
        reason: 'CUSTOMER_UNSUBSCRIBED',
      })

    if (suppError) {
      // Check for concurrent race condition unique constraint
      if (!suppError.message?.includes('duplicate') && suppError.code !== '23505') {
        return { success: false, error: 'Failed to record suppression.' }
      }
    }
  }

  // 5. Cancel any pending/scheduled review requests for this customer/org/email channel
  // CRITICAL INVARIANT: DO NOT regress SENT, DELIVERED, or CLICKED!
  await supabase
    .from('review_requests')
    .update({
      status: 'SUPPRESSED',
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', request.organization_id)
    .eq('customer_id', request.customer_id)
    .eq('channel', 'email')
    .eq('status', 'SCHEDULED')

  return {
    success: true,
    businessName: org.name,
    alreadySuppressed: !!existingSupp,
  }
}
