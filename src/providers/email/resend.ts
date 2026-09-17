import { Resend } from 'resend'
import type { EmailProvider, SendEmailInput, SendEmailResult } from './types'
import { renderNeutralReviewEmail } from './types'

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend' as const
  private client: Resend

  constructor(apiKey: string) {
    this.client = new Resend(apiKey)
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const { subject, body } = renderNeutralReviewEmail({
      recipientName: input.recipientName,
      businessName: input.businessName,
      trackingUrl: input.trackingUrl,
    })

    const finalSubject = input.subject || subject

    try {
      const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'feedback@updates.techwithmpg.com'
      const response = await this.client.emails.send({
        from: fromAddress,
        to: input.to,
        subject: finalSubject,
        text: body,
      })

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
