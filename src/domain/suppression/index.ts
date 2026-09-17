import { createHash } from 'crypto'

export function normalizeEmail(email: string): string {
  if (!email || typeof email !== 'string') return ''
  return email.trim().toLowerCase()
}

export function normalizePhone(phone: string): string {
  if (!phone || typeof phone !== 'string') return ''
  return phone.trim().replace(/[^\d+]/g, '')
}

/**
 * Standardized suppression hashing function.
 * Both creating and looking up suppressions MUST use this exact function.
 */
export function hashSuppressionContact(channel: 'email' | 'sms', contact: string): string {
  const normalized = channel === 'email' ? normalizeEmail(contact) : normalizePhone(contact)
  return createHash('sha256').update(`${channel}:${normalized}`).digest('hex')
}
