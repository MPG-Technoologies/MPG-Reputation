import { isValidEmailAddress } from '@/providers/email'

export interface SenderIdentityOptions {
  businessName?: string | null
  fromAddress?: string | null
}

export interface SenderIdentity {
  displayName: string
  fromAddress?: string
  formattedFrom?: string
}

/**
 * Sanitizes a display name to prevent email header injection and malformed RFC 5322 tokens.
 * Enforces length bounding, strips newlines (\r, \n), double quotes, angle brackets, and backslashes.
 */
export function sanitizeDisplayName(name?: string | null): string {
  if (!name || typeof name !== 'string') return ''
  // Strip control characters and header injection vectors
  let cleaned = name.replace(/[\r\n\t\0"\\<>]/g, ' ')
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  // Sensible length bound (max 64 characters for the business portion)
  if (cleaned.length > 64) {
    cleaned = cleaned.slice(0, 64).trim()
  }
  return cleaned
}

/**
 * Deterministic sender identity formatter:
 * "{Business Name} via MPG Reputation" <{fromAddress}>
 * Fallback when business name is unavailable:
 * "MPG Reputation" <{fromAddress}>
 *
 * When fromAddress is omitted, produces displayName without inventing
 * a fabricated sender mailbox or domain.
 */
export function formatSenderIdentity(options: SenderIdentityOptions): SenderIdentity {
  const { businessName, fromAddress } = options
  const cleanBusiness = sanitizeDisplayName(businessName)
  const displayName = cleanBusiness ? `${cleanBusiness} via MPG Reputation` : 'MPG Reputation'

  const trimmedFrom = (fromAddress || '').trim().replace(/[\r\n]/g, '')
  if (!trimmedFrom) {
    return { displayName }
  }

  if (!isValidEmailAddress(trimmedFrom)) {
    throw new Error('Valid fromAddress is required for sender identity')
  }

  const formattedFrom = `"${displayName}" <${trimmedFrom}>`

  return {
    displayName,
    fromAddress: trimmedFrom,
    formattedFrom,
  }
}
