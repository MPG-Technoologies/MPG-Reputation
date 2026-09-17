import { randomBytes, createHash } from 'node:crypto'

export interface GeneratedToken {
  token: string
  tokenHash: string
}

/**
 * Generates a cryptographically strong, URL-safe tracking token with 256 bits of entropy.
 * Token contains zero identifiable customer or organization information.
 */
export function generateTrackingToken(): GeneratedToken {
  // 32 random bytes = 256 bits of entropy
  const buffer = randomBytes(32)
  const token = buffer.toString('base64url')
  const tokenHash = hashTrackingToken(token)

  return { token, tokenHash }
}

/**
 * Computes a standard SHA-256 digest for safe constant-time indexed lookup.
 */
export function hashTrackingToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex')
}

/**
 * Validates whether the incoming token matches expected format and entropy requirements.
 */
export function isValidTokenFormat(token: string): boolean {
  if (!token || typeof token !== 'string') return false
  const trimmed = token.trim()
  // base64url string for 32 bytes is ~43 characters, accept 32 to 64 chars
  return /^[A-Za-z0-9_-]{32,64}$/.test(trimmed)
}

/**
 * Assembles the tracked review redirect URL.
 */
export function buildTrackedReviewUrl(baseUrl: string, token: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  return `${cleanBase}/r/${encodeURIComponent(token.trim())}`
}
