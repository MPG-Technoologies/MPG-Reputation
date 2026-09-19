import { describe, it, expect } from 'vitest'
import { sanitizeProviderError } from '../../src/domain/review-request/sanitizer'

describe('Provider Error Sanitizer (MR-1A.1 Section 7)', () => {
  it('returns null for null, undefined, empty, or whitespace-only inputs', () => {
    expect(sanitizeProviderError(null)).toBeNull()
    expect(sanitizeProviderError(undefined)).toBeNull()
    expect(sanitizeProviderError('')).toBeNull()
    expect(sanitizeProviderError('   \t\n  ')).toBeNull()
  })

  it('preserves clean diagnostic text', () => {
    const error = '550 5.1.1 Mailbox does not exist'
    expect(sanitizeProviderError(error)).toBe('550 5.1.1 Mailbox does not exist')
  })

  it('strips CR, LF, tabs and collapses whitespace', () => {
    const error = 'Line 1\r\nLine 2\t\twith   spaces\nLine 3'
    expect(sanitizeProviderError(error)).toBe('Line 1 Line 2 with spaces Line 3')
  })

  it('redacts explicit recipient email address', () => {
    const error = 'Failed to deliver to patient@example.test because domain rejected'
    const sanitized = sanitizeProviderError(error, { recipientEmail: 'patient@example.test' })
    expect(sanitized).toBe('Failed to deliver to [REDACTED_EMAIL] because domain rejected')
    expect(sanitized).not.toContain('patient@example.test')
  })

  it('redacts generic email addresses', () => {
    const error = 'Relay access denied for bounce-handler@resend.dev to target@clinic.local'
    const sanitized = sanitizeProviderError(error)
    expect(sanitized).toBe('Relay access denied for [REDACTED_EMAIL] to [REDACTED_EMAIL]')
    expect(sanitized).not.toContain('@')
  })

  it('redacts URLs and tracking links', () => {
    const error = 'See details at https://resend.com/errors/550?token=secret123 and http://internal.net/err'
    const sanitized = sanitizeProviderError(error)
    expect(sanitized).toBe('See details at [REDACTED_URL] and [REDACTED_URL]')
    expect(sanitized).not.toContain('https://')
    expect(sanitized).not.toContain('secret123')
  })

  it('bounds maximum length to 500 characters', () => {
    const longError = 'Error: ' + 'A'.repeat(600)
    const sanitized = sanitizeProviderError(longError)
    expect(sanitized).not.toBeNull()
    expect(sanitized!.length).toBe(500)
    expect(sanitized!.endsWith('...')).toBe(true)
  })

  it('extracts message property from objects and Error instances', () => {
    expect(sanitizeProviderError(new Error('Connection timeout 408'))).toBe('Connection timeout 408')
    expect(sanitizeProviderError({ message: 'SMTP 452 storage limit' })).toBe('SMTP 452 storage limit')
    expect(sanitizeProviderError({ error: 'Upstream refused' })).toBe('Upstream refused')
    expect(sanitizeProviderError({ foo: 'bar' })).toBeNull()
  })
})
