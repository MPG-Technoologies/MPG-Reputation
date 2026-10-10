import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ConsoleEmailProvider,
  ResendEmailProvider,
  getEmailProvider,
  renderNeutralReviewEmail,
  isResendSyntheticRecipient,
  RESEND_SYNTHETIC_RECIPIENTS,
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
    expect((result as unknown as Record<string, unknown>).renderedBody).toBeUndefined()
    expect((result as unknown as Record<string, unknown>).renderedSubject).toBeUndefined()
  })

  it('ConsoleEmailProvider throws fail-closed error before logging in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const consoleSpy = vi.spyOn(console, 'log')
    const provider = new ConsoleEmailProvider()

    await expect(
      provider.send({
        to: 'customer@example.test',
        recipientName: 'Jane',
        businessName: 'Northstar Dental',
        trackingUrl: 'https://example.test/r/token-123',
      })
    ).rejects.toThrow('CONSOLE_EMAIL_PROVIDER_DISABLED_IN_PRODUCTION')

    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('ConsoleEmailProvider remains usable in test/development environments', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const provider = new ConsoleEmailProvider()
    const result = await provider.send({
      to: 'customer@example.test',
      recipientName: 'Jane',
      businessName: 'Northstar Dental',
      trackingUrl: 'https://example.test/r/token-123',
    })

    expect(result.success).toBe(true)
    expect(result.provider).toBe('console')
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

  describe('MR-1B-H Safe Hosted Synthetic Resend Validation', () => {
    it('verifies exact Resend synthetic recipient allowlist contents', () => {
      expect(RESEND_SYNTHETIC_RECIPIENTS).toEqual([
        'delivered@resend.dev',
        'bounced@resend.dev',
        'complained@resend.dev',
      ])
    })

    // 1. synthetic validation flag defaults disabled
    it('1. synthetic validation flag defaults disabled', () => {
      process.env.EMAIL_PROVIDER = 'resend'
      process.env.RESEND_API_KEY = 're_test_key_12345'
      process.env.EMAIL_FROM_ADDRESS = 'feedback@updates.example.com'
      process.env.ENABLE_LIVE_EMAIL = 'false'
      delete process.env.ENABLE_SYNTHETIC_EMAIL_VALIDATION

      const provider = getEmailProvider()
      expect(provider.name).toBe('console')
    })

    // 2. live=false + synthetic=false => Console
    it('2. live=false + synthetic=false => Console', () => {
      process.env.EMAIL_PROVIDER = 'resend'
      process.env.RESEND_API_KEY = 're_test_key_12345'
      process.env.EMAIL_FROM_ADDRESS = 'feedback@updates.example.com'
      process.env.ENABLE_LIVE_EMAIL = 'false'
      process.env.ENABLE_SYNTHETIC_EMAIL_VALIDATION = 'false'

      const provider = getEmailProvider()
      expect(provider.name).toBe('console')
    })

    // 3. live=false + synthetic=true + complete Resend config => Resend synthetic mode
    it('3. live=false + synthetic=true + complete Resend config => Resend synthetic mode', () => {
      process.env.EMAIL_PROVIDER = 'resend'
      process.env.RESEND_API_KEY = 're_test_key_12345'
      process.env.EMAIL_FROM_ADDRESS = 'feedback@updates.example.com'
      process.env.ENABLE_LIVE_EMAIL = 'false'
      process.env.ENABLE_SYNTHETIC_EMAIL_VALIDATION = 'true'

      const provider = getEmailProvider()
      expect(provider.name).toBe('resend')
      expect((provider as ResendEmailProvider).recipientPolicy).toBe('resend_test_only')
    })

    // 4. delivered@resend.dev allowed
    it('4. delivered@resend.dev allowed', async () => {
      expect(isResendSyntheticRecipient('delivered@resend.dev')).toBe(true)

      const provider = new ResendEmailProvider('re_test_key', 'feedback@updates.example.com', 'resend_test_only')
      let sentPayload: unknown = null
      ;(provider as unknown as { client: { emails: { send: unknown } } }).client = {
        emails: {
          send: vi.fn().mockImplementation(async (payload: unknown) => {
            sentPayload = payload
            return { data: { id: 're_delivered_123' }, error: null }
          }),
        },
      }

      const result = await provider.send({
        to: 'delivered@resend.dev',
        businessName: 'Northstar Dental',
        trackingUrl: 'https://example.test/r/token-123',
      })

      expect(result.success).toBe(true)
      expect(result.messageId).toBe('re_delivered_123')
      expect((sentPayload as { to: string })?.to).toBe('delivered@resend.dev')
    })

    // 5. bounced@resend.dev allowed
    it('5. bounced@resend.dev allowed', async () => {
      expect(isResendSyntheticRecipient('bounced@resend.dev')).toBe(true)

      const provider = new ResendEmailProvider('re_test_key', 'feedback@updates.example.com', 'resend_test_only')
      const sendSpy = vi.fn().mockResolvedValue({ data: { id: 're_bounced_123' }, error: null })
      ;(provider as unknown as { client: { emails: { send: unknown } } }).client = {
        emails: { send: sendSpy },
      }

      const result = await provider.send({
        to: 'bounced@resend.dev',
        businessName: 'Northstar Dental',
        trackingUrl: 'https://example.test/r/token-123',
      })

      expect(result.success).toBe(true)
      expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    // 6. complained@resend.dev allowed
    it('6. complained@resend.dev allowed', async () => {
      expect(isResendSyntheticRecipient('complained@resend.dev')).toBe(true)

      const provider = new ResendEmailProvider('re_test_key', 'feedback@updates.example.com', 'resend_test_only')
      const sendSpy = vi.fn().mockResolvedValue({ data: { id: 're_complained_123' }, error: null })
      ;(provider as unknown as { client: { emails: { send: unknown } } }).client = {
        emails: { send: sendSpy },
      }

      const result = await provider.send({
        to: 'complained@resend.dev',
        businessName: 'Northstar Dental',
        trackingUrl: 'https://example.test/r/token-123',
      })

      expect(result.success).toBe(true)
      expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    // 7. arbitrary@example.com rejected before API call
    it('7. arbitrary@example.com rejected before API call', async () => {
      expect(isResendSyntheticRecipient('arbitrary@example.com')).toBe(false)

      const provider = new ResendEmailProvider('re_test_key', 'feedback@updates.example.com', 'resend_test_only')
      const sendSpy = vi.fn()
      ;(provider as unknown as { client: { emails: { send: unknown } } }).client = {
        emails: { send: sendSpy },
      }

      await expect(
        provider.send({
          to: 'arbitrary@example.com',
          businessName: 'Northstar Dental',
          trackingUrl: 'https://example.test/r/token-123',
        })
      ).rejects.toThrow('SYNTHETIC_RECIPIENT_REQUIRED')

      expect(sendSpy).not.toHaveBeenCalled()
    })

    // 8. attacker@resend.dev rejected
    it('8. attacker@resend.dev rejected', async () => {
      expect(isResendSyntheticRecipient('attacker@resend.dev')).toBe(false)

      const provider = new ResendEmailProvider('re_test_key', 'feedback@updates.example.com', 'resend_test_only')
      const sendSpy = vi.fn()
      ;(provider as unknown as { client: { emails: { send: unknown } } }).client = {
        emails: { send: sendSpy },
      }

      await expect(
        provider.send({
          to: 'attacker@resend.dev',
          businessName: 'Northstar Dental',
          trackingUrl: 'https://example.test/r/token-123',
        })
      ).rejects.toThrow('SYNTHETIC_RECIPIENT_REQUIRED')

      expect(sendSpy).not.toHaveBeenCalled()
    })

    // 9. delivered@resend.dev.attacker.com rejected
    it('9. delivered@resend.dev.attacker.com rejected', async () => {
      expect(isResendSyntheticRecipient('delivered@resend.dev.attacker.com')).toBe(false)

      const provider = new ResendEmailProvider('re_test_key', 'feedback@updates.example.com', 'resend_test_only')
      const sendSpy = vi.fn()
      ;(provider as unknown as { client: { emails: { send: unknown } } }).client = {
        emails: { send: sendSpy },
      }

      await expect(
        provider.send({
          to: 'delivered@resend.dev.attacker.com',
          businessName: 'Northstar Dental',
          trackingUrl: 'https://example.test/r/token-123',
        })
      ).rejects.toThrow('SYNTHETIC_RECIPIENT_REQUIRED')

      expect(sendSpy).not.toHaveBeenCalled()
    })

    // 10. case-normalized official address behaves correctly
    it('10. case-normalized official address behaves correctly', async () => {
      expect(isResendSyntheticRecipient('  DELIVERED@RESEND.DEV  ')).toBe(true)
      expect(isResendSyntheticRecipient('  Bounced@Resend.Dev  ')).toBe(true)
      expect(isResendSyntheticRecipient('  COMPLAINED@resend.dev  ')).toBe(true)

      const provider = new ResendEmailProvider('re_test_key', 'feedback@updates.example.com', 'resend_test_only')
      const sendSpy = vi.fn().mockResolvedValue({ data: { id: 're_case_norm_123' }, error: null })
      ;(provider as unknown as { client: { emails: { send: unknown } } }).client = {
        emails: { send: sendSpy },
      }

      const result = await provider.send({
        to: '  DELIVERED@RESEND.DEV  ',
        businessName: 'Northstar Dental',
        trackingUrl: 'https://example.test/r/token-123',
      })

      expect(result.success).toBe(true)
      expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    // 11. rejected address is NOT present in error/log output
    it('11. rejected address is NOT present in error/log output', async () => {
      const sensitiveRecipient = 'sensitive-patient-12345@private-clinic.org'
      const provider = new ResendEmailProvider('re_test_key', 'feedback@updates.example.com', 'resend_test_only')
      const errorLogSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warnLogSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const infoLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      let thrownErr: Error | null = null
      try {
        await provider.send({
          to: sensitiveRecipient,
          businessName: 'Northstar Dental',
          trackingUrl: 'https://example.test/r/token-123',
        })
      } catch (err) {
        thrownErr = err as Error
      }

      expect(thrownErr).not.toBeNull()
      expect(thrownErr!.message).toBe('SYNTHETIC_RECIPIENT_REQUIRED')
      expect(thrownErr!.message).not.toContain(sensitiveRecipient)
      expect(thrownErr!.stack).not.toContain(sensitiveRecipient)

      for (const call of [...errorLogSpy.mock.calls, ...warnLogSpy.mock.calls, ...infoLogSpy.mock.calls]) {
        const text = call.map(String).join(' ')
        expect(text).not.toContain(sensitiveRecipient)
      }
    })

    // 12. Resend client send method is not called for rejected address
    it('12. Resend client send method is not called for rejected address', async () => {
      const provider = new ResendEmailProvider('re_test_key', 'feedback@updates.example.com', 'resend_test_only')
      const sendSpy = vi.fn()
      ;(provider as unknown as { client: { emails: { send: unknown } } }).client = {
        emails: { send: sendSpy },
      }

      await expect(
        provider.send({
          to: 'unauthorized-user@example.com',
          businessName: 'Northstar Dental',
          trackingUrl: 'https://example.test/r/token-123',
        })
      ).rejects.toThrow('SYNTHETIC_RECIPIENT_REQUIRED')

      expect(sendSpy).not.toHaveBeenCalled()
    })

    // 13. ENABLE_LIVE_EMAIL=true preserves existing unrestricted provider behavior
    it('13. ENABLE_LIVE_EMAIL=true preserves existing unrestricted provider behavior', async () => {
      process.env.EMAIL_PROVIDER = 'resend'
      process.env.RESEND_API_KEY = 're_test_key_12345'
      process.env.EMAIL_FROM_ADDRESS = 'feedback@updates.example.com'
      process.env.ENABLE_LIVE_EMAIL = 'true'
      process.env.ENABLE_SYNTHETIC_EMAIL_VALIDATION = 'true'

      const provider = getEmailProvider() as ResendEmailProvider
      expect(provider.name).toBe('resend')
      expect(provider.recipientPolicy).toBe('unrestricted')

      const sendSpy = vi.fn().mockResolvedValue({ data: { id: 're_live_msg_123' }, error: null })
      ;(provider as unknown as { client: { emails: { send: unknown } } }).client = {
        emails: { send: sendSpy },
      }

      const result = await provider.send({
        to: 'customer@example.com',
        businessName: 'Northstar Dental',
        trackingUrl: 'https://example.test/r/token-123',
      })

      expect(result.success).toBe(true)
      expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    // 14. missing API key remains fail-closed
    it('14. missing API key remains fail-closed', () => {
      process.env.EMAIL_PROVIDER = 'resend'
      delete process.env.RESEND_API_KEY
      process.env.EMAIL_FROM_ADDRESS = 'feedback@updates.example.com'
      process.env.ENABLE_LIVE_EMAIL = 'false'
      process.env.ENABLE_SYNTHETIC_EMAIL_VALIDATION = 'true'

      expect(getEmailProvider().name).toBe('console')

      process.env.RESEND_API_KEY = '   '
      expect(getEmailProvider().name).toBe('console')
    })

    // 15. missing/invalid from address remains fail-closed
    it('15. missing/invalid from address remains fail-closed', () => {
      process.env.EMAIL_PROVIDER = 'resend'
      process.env.RESEND_API_KEY = 're_test_key_12345'
      delete process.env.EMAIL_FROM_ADDRESS
      process.env.ENABLE_LIVE_EMAIL = 'false'
      process.env.ENABLE_SYNTHETIC_EMAIL_VALIDATION = 'true'

      expect(getEmailProvider().name).toBe('console')

      process.env.EMAIL_FROM_ADDRESS = 'invalid-from-without-at'
      expect(getEmailProvider().name).toBe('console')
    })
  })
})
