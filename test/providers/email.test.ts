import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ConsoleEmailProvider,
  ResendEmailProvider,
  getEmailProvider,
  renderNeutralReviewEmail,
} from '../../src/providers/email'

describe('Email Providers', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
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
    delete process.env.EMAIL_FROM_ADDRESS
    delete process.env.ENABLE_LIVE_EMAIL

    const provider = getEmailProvider()
    expect(provider.name).toBe('console')
  })

  it('getEmailProvider ignores resend if RESEND_API_KEY is not set', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    delete process.env.RESEND_API_KEY
    process.env.EMAIL_FROM_ADDRESS = 'feedback@updates.example.com'
    process.env.ENABLE_LIVE_EMAIL = 'true'

    const provider = getEmailProvider()
    expect(provider.name).toBe('console')
  })

  it('getEmailProvider stays on Console if ENABLE_LIVE_EMAIL is missing (Section 17 Safety Switch)', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test_key_12345'
    process.env.EMAIL_FROM_ADDRESS = 'feedback@updates.example.com'
    delete process.env.ENABLE_LIVE_EMAIL

    const provider = getEmailProvider()
    expect(provider.name).toBe('console')
  })

  it('getEmailProvider stays on Console if ENABLE_LIVE_EMAIL is false (Section 17 Safety Switch)', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test_key_12345'
    process.env.EMAIL_FROM_ADDRESS = 'feedback@updates.example.com'
    process.env.ENABLE_LIVE_EMAIL = 'false'

    const provider = getEmailProvider()
    expect(provider.name).toBe('console')
  })

  it('getEmailProvider fails closed if EMAIL_FROM_ADDRESS is missing (Section 4 & 17)', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test_key_12345'
    delete process.env.EMAIL_FROM_ADDRESS
    process.env.ENABLE_LIVE_EMAIL = 'true'

    const provider = getEmailProvider()
    expect(provider.name).toBe('console')
  })

  it('getEmailProvider fails closed if EMAIL_FROM_ADDRESS is invalid (Section 4 & 17)', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test_key_12345'
    process.env.EMAIL_FROM_ADDRESS = 'invalid-address-without-at'
    process.env.ENABLE_LIVE_EMAIL = 'true'

    const provider = getEmailProvider()
    expect(provider.name).toBe('console')
  })

  it('getEmailProvider selects ResendEmailProvider only when ALL FOUR conditions are true', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test_key_12345'
    process.env.EMAIL_FROM_ADDRESS = 'feedback@updates.example.com'
    process.env.ENABLE_LIVE_EMAIL = 'true'

    const provider = getEmailProvider()
    expect(provider.name).toBe('resend')
  })

  it('ResendEmailProvider constructor throws if EMAIL_FROM_ADDRESS is missing or invalid', () => {
    delete process.env.EMAIL_FROM_ADDRESS

    expect(() => new ResendEmailProvider('re_test_key')).toThrow(
      /requires an explicitly configured, valid EMAIL_FROM_ADDRESS/
    )

    expect(() => new ResendEmailProvider('re_test_key', '')).toThrow(
      /requires an explicitly configured, valid EMAIL_FROM_ADDRESS/
    )

    expect(() => new ResendEmailProvider('re_test_key', 'notanemail')).toThrow(
      /requires an explicitly configured, valid EMAIL_FROM_ADDRESS/
    )
  })

  it('ResendEmailProvider passes idempotencyKey and safe correlation tag without PII', async () => {
    const provider = new ResendEmailProvider('re_test_key', 'feedback@updates.example.com')

    let capturedPayload: { tags?: { name: string; value: string }[] } | undefined
    let capturedOptions: { idempotencyKey?: string } | undefined

    // Mock client.emails.send directly
    ;(provider as unknown as { client: { emails: { send: unknown } } }).client = {
      emails: {
        send: vi.fn().mockImplementation(async (payload: { tags?: { name: string; value: string }[] }, options: { idempotencyKey?: string }) => {
          capturedPayload = payload
          capturedOptions = options
          return { data: { id: 're_mock_msg_id_123' }, error: null }
        }),
      },
    }

    const testCorrelationId = 'b694b7dc-8d99-4d6d-8954-20a232f012b1'
    const testIdempotencyKey = `review-request/${testCorrelationId}/initial-v1`

    const result = await provider.send({
      to: 'patient@example.test',
      recipientName: 'Jane Doe',
      businessName: 'Northstar Dental',
      trackingUrl: 'https://example.test/r/token-abc',
      correlationId: testCorrelationId,
      idempotencyKey: testIdempotencyKey,
    })

    expect(result.success).toBe(true)
    expect(result.provider).toBe('resend')
    expect(result.messageId).toBe('re_mock_msg_id_123')

    // Verify idempotencyKey is passed in options
    expect(capturedOptions).toEqual({ idempotencyKey: testIdempotencyKey })

    // Verify safe correlation tag is attached
    expect(capturedPayload?.tags).toEqual([
      { name: 'review_request_id', value: testCorrelationId },
    ])

    // Verify NO PII exists anywhere in tags
    const tagsString = JSON.stringify(capturedPayload?.tags || [])
    expect(tagsString).not.toContain('patient@example.test')
    expect(tagsString).not.toContain('Jane Doe')
    expect(tagsString).not.toContain('Northstar Dental')
    expect(tagsString).not.toContain('token-abc')
    expect(tagsString).not.toContain('https://')
  })
})
