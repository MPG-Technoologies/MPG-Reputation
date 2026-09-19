import { Resend } from 'resend'
import type { EmailProvider, SendEmailInput, SendEmailResult } from './types'
import { renderNeutralReviewEmail } from './types'

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend' as const
  private client: Resend
  private fromAddress: string

  constructor(apiKey: string, fromAddress?: string) {
    const configuredFrom = (fromAddress || process.env.EMAIL_FROM_ADDRESS || '').trim()
    if (!configuredFrom || !configuredFrom.includes('@')) {
      throw new Error(
        'ResendEmailProvider requires an explicitly configured, valid EMAIL_FROM_ADDRESS. Unsafe fallback domains are strictly prohibited.'
      )
    }
    this.client = new Resend(apiKey)
    this.fromAddress = configuredFrom
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
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
        return {
          success: false,
          provider: 'resend',
          messageId: '',
          error: response.error.message,
          renderedSubject: finalSubject,
          renderedBody: textBody,
        }
      }

      return {
        success: true,
        provider: 'resend',
        messageId: response.data?.id || '',
        renderedSubject: finalSubject,
        renderedBody: textBody,
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        provider: 'resend',
        messageId: '',
        error: errorMessage,
        renderedSubject: finalSubject,
        renderedBody: textBody,
      }
    }
  }
}
