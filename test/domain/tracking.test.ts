import { describe, it, expect } from 'vitest'
import { generateTrackingToken, hashTrackingToken, isValidTokenFormat, buildTrackedReviewUrl } from '../../src/domain/tracking'

describe('Tracking token utilities', () => {
  it('generates high entropy unique tokens and hashes', () => {
    const item1 = generateTrackingToken()
    const item2 = generateTrackingToken()

    expect(item1.token).not.toBe(item2.token)
    expect(item1.tokenHash).not.toBe(item2.tokenHash)
    expect(isValidTokenFormat(item1.token)).toBe(true)
    expect(item1.token.length).toBeGreaterThanOrEqual(40)
  })

  it('produces deterministic SHA-256 hashes', () => {
    const token = 'sample-token-string-with-sufficient-length-123456'
    const hash1 = hashTrackingToken(token)
    const hash2 = hashTrackingToken(token)
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })

  it('validates token format strictly', () => {
    expect(isValidTokenFormat('')).toBe(false)
    expect(isValidTokenFormat('short')).toBe(false)
    expect(isValidTokenFormat('token-with-illegal-characters!@#$%^&*()')).toBe(false)

    const valid = generateTrackingToken()
    expect(isValidTokenFormat(valid.token)).toBe(true)
  })

  it('builds clean tracked URL without trailing slashes', () => {
    const url = buildTrackedReviewUrl('https://example.test/', 'my-token-123456789012345678901234567890')
    expect(url).toBe('https://example.test/r/my-token-123456789012345678901234567890')
  })
})
