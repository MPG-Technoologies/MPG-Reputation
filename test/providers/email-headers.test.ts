import { describe, it, expect, vi } from 'vitest'
import { composeReviewRequestEmail } from '../../src/domain/email'
import { ResendEmailProvider, ConsoleEmailProvider } from '../../src/providers/email'

describe('Email Headers & Provider Forwarding (MR-1B Section 22)', () => {
  it('1. Generates RFC 8058 List-Unsubscribe and List-Unsubscribe-Post headers when unsubscribe URL is present', () => {
    const email = composeReviewRequestEmail({
      businessName: 'Northstar Dental',
      reviewUrl: 'https://app.test/r/token-123',
      unsubscribeUrl: 'https://app.test/unsubscribe/unsub-456',
      fromAddress: 'reviews@updates.example.com',
    })

    expect(email.headers).toEqual({
      'List-Unsubscribe': '<https://app.test/unsubscribe/unsub-456>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('2. Neutralizes CR/LF injection in unsubscribe header URL', () => {
    const email = composeReviewRequestEmail({
      businessName: 'Northstar Dental',
      reviewUrl: 'https://app.test/r/token-123',
      unsubscribeUrl: 'https://app.test/unsubscribe/unsub\r\nBcc: evil@attacker.com',
      fromAddress: 'reviews@updates.example.com',
    })

    expect(email.headers['List-Unsubscribe']).not.toContain('\r')
    expect(email.headers['List-Unsubscribe']).not.toContain('\n')
    expect(email.headers['List-Unsubscribe']).toBe('<https://app.test/unsubscribe/unsubBcc: evil@attacker.com>')
  })

  it('3. Omits Reply-To if not configured or empty', () => {
    const email1 = composeReviewRequestEmail({
      businessName: 'Northstar Dental',
      reviewUrl: 'https://app.test/r/token-123',
      unsubscribeUrl: 'https://app.test/unsubscribe/unsub-456',
      fromAddress: 'reviews@updates.example.com',
      replyToEmail: null,
    })
    expect(email1.replyTo).toBeUndefined()

    const email2 = composeReviewRequestEmail({
      businessName: 'Northstar Dental',
      reviewUrl: 'https://app.test/r/token-123',
      unsubscribeUrl: 'https://app.test/unsubscribe/unsub-456',
      fromAddress: 'reviews@updates.example.com',
      replyToEmail: '',
    })
    expect(email2.replyTo).toBeUndefined()
  })

  it('4. Omits Reply-To if configured address contains header injection or is malformed', () => {
    const email = composeReviewRequestEmail({
      businessName: 'Northstar Dental',
      reviewUrl: 'https://app.test/r/token-123',
      unsubscribeUrl: 'https://app.test/unsubscribe/unsub-456',
      fromAddress: 'reviews@updates.example.com',
      replyToEmail: 'office@northstar.test\r\nCc: victim@test.com',
    })
    expect(email.replyTo).toBeUndefined()
  })

  it('5. Forwards configured safe Reply-To and headers to ResendEmailProvider', async () => {
    const provider = new ResendEmailProvider('re_test_key', 'feedback@updates.example.com')

    let capturedPayload: unknown

    ;(provider as unknown as { client: { emails: { send: unknown } } }).client = {
      emails: {
        send: vi.fn().mockImplementation(async (payload: unknown) => {
          capturedPayload = payload
          return { data: { id: 're_mock_msg_999' }, error: null }
        }),
      },
    }

    const email = composeReviewRequestEmail({
      businessName: 'Northstar Dental',
      customerFirstName: 'Jane',
      reviewUrl: 'https://app.test/r/token-123',
      unsubscribeUrl: 'https://app.test/unsubscribe/unsub-456',
      replyToEmail: 'office@northstar.test',
      fromAddress: 'feedback@updates.example.com',
    })

    const result = await provider.send({
      to: 'patient@example.test',
      recipientName: 'Jane',
      businessName: 'Northstar Dental',
      trackingUrl: 'https://app.test/r/token-123',
      unsubscribeUrl: 'https://app.test/unsubscribe/unsub-456',
      subject: email.subject,
      html: email.html,
      text: email.text,
      fromDisplayName: email.fromDisplayName,
      replyTo: email.replyTo,
      headers: email.headers,
    })

    expect(result.success).toBe(true)
    const payload = capturedPayload as {
      from: string
      replyTo?: string
      headers?: Record<string, string>
      html?: string
      text?: string
    }

    expect(payload.from).toBe('"Northstar Dental via MPG Reputation" <feedback@updates.example.com>')
    expect(payload.replyTo).toBe('office@northstar.test')
    expect(payload.headers).toEqual({
      'List-Unsubscribe': '<https://app.test/unsubscribe/unsub-456>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
    expect(payload.html).toContain('Leave a review')
    expect(payload.text).toContain('Leave a review')
  })

  it('6. ConsoleEmailProvider logs display name and Reply-To without crashing or leaking sensitive data', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const provider = new ConsoleEmailProvider()

    const result = await provider.send({
      to: 'patient@example.test',
      businessName: 'Northstar Dental',
      trackingUrl: 'https://app.test/r/token-123',
      fromDisplayName: 'Northstar Dental via MPG Reputation',
      replyTo: 'office@northstar.test',
    })

    expect(result.success).toBe(true)
    expect(consoleSpy).toHaveBeenCalledWith('From: "Northstar Dental via MPG Reputation"')
    expect(consoleSpy).toHaveBeenCalledWith('Reply-To: office@northstar.test')
    consoleSpy.mockRestore()
  })
})
