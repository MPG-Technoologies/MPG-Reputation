import { isValidEmailAddress } from '@/providers/email'

/**
 * Normalizes and syntactically validates a business Reply-To email address.
 * Fails closed (returns null) on header injection attempts, non-string, or invalid email formats.
 */
export function sanitizeReplyToEmail(email?: string | null): string | null {
  if (!email || typeof email !== 'string') return null
  // Header injection defense: reject any CR/LF or control characters
  if (/[\r\n\t\0<>]/.test(email)) {
    return null
  }
  const trimmed = email.trim().toLowerCase()
  if (!isValidEmailAddress(trimmed)) {
    return null
  }
  return trimmed
}
