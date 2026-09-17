import { describe, it, expect } from 'vitest'
import { normalizeEmail, normalizePhone, hashSuppressionContact } from '../../src/domain/suppression'

describe('Suppression Hashing and Normalization', () => {
  it('normalizes email by trimming and converting to lowercase', () => {
    expect(normalizeEmail('  Alice.Smith@Example.COM  ')).toBe('alice.smith@example.com')
    expect(normalizeEmail('')).toBe('')
  })

  it('normalizes phone number', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567')
  })

  it('produces identical SHA-256 hash regardless of case and surrounding whitespace', () => {
    const hash1 = hashSuppressionContact('email', 'Alice.Smith@Example.com')
    const hash2 = hashSuppressionContact('email', '  alice.smith@example.com  ')
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64) // SHA-256 hex string
  })

  it('produces different hashes for different channels or addresses', () => {
    const emailHash = hashSuppressionContact('email', 'test@example.com')
    const smsHash = hashSuppressionContact('sms', 'test@example.com')
    const otherHash = hashSuppressionContact('email', 'other@example.com')

    expect(emailHash).not.toBe(smsHash)
    expect(emailHash).not.toBe(otherHash)
  })
})
