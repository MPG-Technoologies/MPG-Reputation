import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConsoleEmailProvider, getEmailProvider, renderNeutralReviewEmail } from '../../src/providers/email'

describe('Email Providers', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('renders neutral review copy without rating bias or gating', () => {
    const rendered = renderNeutralReviewEmail({
      recipientName: 'Jane',
      businessName: 'Northstar Dental',
      trackingUrl: 'https://example.test/r/token-123',
    })

    expect(rendered.subject).toContain('Northstar Dental')
    expect(rendered.body).toContain('Hi Jane,')
    expect(rendered.body).toContain('honest feedback')
    expect(rendered.body).toContain('https://example.test/r/token-123')
    expect(rendered.body).not.toContain('5 star')
    expect(rendered.body).not.toContain('positive')
  })

  it('ConsoleEmailProvider sends synthetic email safely', async () => {
    const provider = new ConsoleEmailProvider()
    const result = await provider.send({
      to: 'customer@example.test',
      recipientName: 'Jane',
      businessName: 'Northstar Dental',
      trackingUrl: 'https://example.test/r/token-123',
    })

    expect(result.success).toBe(true)
    expect(result.provider).toBe('console')
    expect(result.messageId).toContain('console_')
    expect(result.renderedBody).toContain('honest feedback')
  })

  it('getEmailProvider defaults to ConsoleEmailProvider', () => {
    delete process.env.EMAIL_PROVIDER
    delete process.env.RESEND_API_KEY

    const provider = getEmailProvider()
    expect(provider.name).toBe('console')
  })

  it('getEmailProvider ignores resend if RESEND_API_KEY is not set', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    delete process.env.RESEND_API_KEY

    const provider = getEmailProvider()
    expect(provider.name).toBe('console')
  })

  it('getEmailProvider selects ResendEmailProvider when explicitly configured', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test_key_12345'

    const provider = getEmailProvider()
    expect(provider.name).toBe('resend')
  })
})
