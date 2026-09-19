import type { ReviewRequestEmailInput, ComposedReviewRequestEmail } from './types'
import { formatSenderIdentity, sanitizeDisplayName } from './sender'
import { sanitizeReplyToEmail } from './reply-to'
import { renderReviewRequestHtml } from './template-html'
import { renderReviewRequestText } from './template-text'

/**
 * Extracts and sanitizes the customer's first name for neutral email greeting.
 * Strips HTML, quotes, control characters, and limits length to 40 chars.
 * Returns null if unavailable, empty, or invalid.
 */
export function extractCustomerFirstName(fullName?: string | null): string | null {
  if (!fullName || typeof fullName !== 'string') return null
  const cleaned = fullName.replace(/[\r\n\t\0<>"'\\]/g, ' ').trim()
  if (!cleaned) return null
  const firstWord = cleaned.split(/\s+/)[0]
  if (!firstWord || firstWord.length > 40) return null
  return firstWord
}

/**
 * Pure domain composition function:
 * Converts business and customer inputs into a fully composed, neutral review solicitation email.
 * Transport-agnostic: does NOT access the database or make network calls.
 */
export function composeReviewRequestEmail(input: ReviewRequestEmailInput): ComposedReviewRequestEmail {
  const { businessName, customerFirstName, reviewUrl, unsubscribeUrl, replyToEmail, fromAddress } = input

  const cleanBusiness = sanitizeDisplayName(businessName)
  const firstName = extractCustomerFirstName(customerFirstName)

  const subject = cleanBusiness
    ? `Share your experience with ${cleanBusiness}`
    : 'Share your experience'

  const sender = formatSenderIdentity({
    businessName: cleanBusiness,
    fromAddress,
  })

  const validatedReplyTo = sanitizeReplyToEmail(replyToEmail)

  const headers: Record<string, string> = {}
  if (unsubscribeUrl) {
    // Sanitize unsubscribeUrl to prevent CR/LF injection
    const cleanUnsub = unsubscribeUrl.replace(/[\r\n\t\0<>"']/g, '').trim()
    if (cleanUnsub) {
      headers['List-Unsubscribe'] = `<${cleanUnsub}>`
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
    }
  }

  const html = renderReviewRequestHtml({
    businessName: cleanBusiness || 'MPG Reputation',
    customerFirstName: firstName,
    reviewUrl,
    unsubscribeUrl,
  })

  const text = renderReviewRequestText({
    businessName: cleanBusiness || 'MPG Reputation',
    customerFirstName: firstName,
    reviewUrl,
    unsubscribeUrl,
  })

  return {
    subject,
    html,
    text,
    fromDisplayName: sender.displayName,
    formattedFrom: sender.formattedFrom,
    replyTo: validatedReplyTo || undefined,
    headers,
  }
}
