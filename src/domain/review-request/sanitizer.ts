/**
 * Sanitizes provider-originated error and diagnostic strings before persisting
 * to review_requests.error_message, message_events.sanitized_error, or application logs.
 *
 * Requirements (MR-1A.1 Section 7):
 * - Bounded maximum length (500 characters)
 * - Strip CR/LF and control characters
 * - Redact recipient email addresses
 * - Redact tracking URLs, HTTP links, and query tokens
 * - Avoid raw object/payload dumps
 * - Preserve diagnostic meaning (e.g., SMTP 550, mailbox full, DNS reject)
 */
export function sanitizeProviderError(
  rawError: unknown,
  context?: { recipientEmail?: string }
): string | null {
  if (rawError === null || rawError === undefined) {
    return null
  }

  let text: string
  if (typeof rawError === 'string') {
    text = rawError
  } else if (rawError instanceof Error) {
    text = rawError.message
  } else if (typeof rawError === 'object') {
    // Avoid full raw dumps: extract message or error field if present, otherwise ignore
    const obj = rawError as Record<string, unknown>
    if (typeof obj.message === 'string') {
      text = obj.message
    } else if (typeof obj.error === 'string') {
      text = obj.error
    } else {
      return null
    }
  } else {
    text = String(rawError)
  }

  text = text.trim()
  if (!text) {
    return null
  }

  // 1. Redact specific recipient email if supplied
  if (context?.recipientEmail && context.recipientEmail.trim()) {
    const targetEmail = context.recipientEmail.trim()
    text = text.split(targetEmail).join('[REDACTED_EMAIL]')
  }

  // 2. Redact any generic email addresses to prevent PII leakage
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')

  // 3. Redact URLs and web addresses (tokens, tracking links)
  text = text.replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]')

  // 4. Strip CR/LF, tabs, and unprintable control characters to prevent log-injection or formatted display issues
  text = text.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim()

  // 5. Bound maximum length to 500 characters
  if (text.length > 500) {
    text = text.slice(0, 497) + '...'
  }

  return text || null
}
