import { Resend } from 'resend'
import type { EmailProvider, ResendRecipientPolicy, SendEmailInput, SendEmailResult } from './types'
import { renderNeutralReviewEmail } from './types'

export const RESEND_SYNTHETIC_RECIPIENTS = Object.freeze([
  'delivered@resend.dev',
  'bounced@resend.dev',
  'complained@resend.dev',
] as const)

const RESEND_SYNTHETIC_SET = new Set<string>(RESEND_SYNTHETIC_RECIPIENTS)

export function isResendSyntheticRecipient(address: string | undefined | null): boolean {
  if (!address || typeof address !== 'string') return false
  const normalized = address.trim().toLowerCase()
  return RESEND_SYNTHETIC_SET.has(normalized)
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend' as const
  readonly recipientPolicy: ResendRecipientPolicy
  private client: Resend
  private fromAddress: string

  constructor(
    apiKey: string,
    fromAddress?: string,
    recipientPolicy: ResendRecipientPolicy = 'unrestricted'
  ) {
    const configuredFrom = (fromAddress || process.env.EMAIL_FROM_ADDRESS || '').trim()
    if (!configuredFrom || !configuredFrom.includes('@')) {
      throw new Error(
        'ResendEmailProvider requires an explicitly configured, valid EMAIL_FROM_ADDRESS. Unsafe fallback domains are strictly prohibited.'
      )
    }
    this.client = new Resend(apiKey)
    this.fromAddress = configuredFrom
    this.recipientPolicy = recipientPolicy
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (this.recipientPolicy === 'resend_test_only' && !isResendSyntheticRecipient(input.to)) {
      throw new Error('SYNTHETIC_RECIPIENT_REQUIRED')
    }

    const fallback = renderNeutralReviewEmail({
      recipientName: input.recipientName,
      businessName: input.businessName,
      trackingUrl: input.trackingUrl,
      unsubscribeUrl: input.unsubscribeUrl,
    })

    const finalSubject = input.subject || fallback.subject
    const textBody = input.text || fallback.body

    // Format envelope/from with display name if provided
    // e.g. "Northstar Dental via MPG Reputation <reviews@configured-mpg-domain>"
    const from = input.fromDisplayName
      ? `"${input.fromDisplayName.replace(/[\r\n\t\0"\\<>]/g, '').trim()}" <${this.fromAddress}>`
      : this.fromAddress

    try {
      // Build safe tags strictly for internal system correlation
      // NEVER attach customer name, email, tracking URL, review destination, or organization name
      const tags: { name: string; value: string }[] = []
      if (input.correlationId) {
        tags.push({ name: 'review_request_id', value: input.correlationId })
      }

      // Provider-level idempotency key defense in depth
      const requestOptions = input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey }
        : undefined

      const payload: Parameters<Resend['emails']['send']>[0] = {
        from,
        to: input.to,
        subject: finalSubject,
        text: textBody,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
        ...(tags.length > 0 ? { tags } : {}),
      }

      const response = await this.client.emails.send(payload, requestOptions)

      if (response.error) {
        const isRateLimit = response.error.name === 'rate_limit_exceeded'
        return {
          success: false,
          provider: 'resend',
          messageId: '',
          error: isRateLimit ? 'RATE_LIMIT_EXCEEDED' : 'EMAIL_DISPATCH_FAILED',
        }
      }

      return {
        success: true,
        provider: 'resend',
        messageId: response.data?.id || '',
      }
    } catch {
      return {
        success: false,
        provider: 'resend',
        messageId: '',
        error: 'EMAIL_DISPATCH_FAILED',
      }
    }
  }
}
