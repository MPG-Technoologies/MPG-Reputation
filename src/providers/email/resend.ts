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
    const { subject, body } = renderNeutralReviewEmail({
      recipientName: input.recipientName,
      businessName: input.businessName,
      trackingUrl: input.trackingUrl,
    })

    const finalSubject = input.subject || subject

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

      const response = await this.client.emails.send(
        {
          from: this.fromAddress,
          to: input.to,
          subject: finalSubject,
          text: body,
          tags: tags.length > 0 ? tags : undefined,
        },
        requestOptions
      )

      if (response.error) {
        return {
          success: false,
          provider: 'resend',
          messageId: '',
          error: response.error.message,
          renderedSubject: finalSubject,
          renderedBody: body,
        }
      }

      return {
        success: true,
        provider: 'resend',
        messageId: response.data?.id || '',
        renderedSubject: finalSubject,
        renderedBody: body,
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        provider: 'resend',
        messageId: '',
        error: errorMessage,
        renderedSubject: finalSubject,
        renderedBody: body,
      }
    }
  }
}
