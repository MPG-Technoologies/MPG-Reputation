import { randomUUID } from 'node:crypto'
import type { EmailProvider, SendEmailInput, SendEmailResult } from './types'
import { renderNeutralReviewEmail } from './types'

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console' as const

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const { subject, body } = renderNeutralReviewEmail({
      recipientName: input.recipientName,
      businessName: input.businessName,
      trackingUrl: input.trackingUrl,
    })

    const finalSubject = input.subject || subject
    const messageId = `console_${randomUUID()}`

    // Safe development console logger
    console.log(`[ConsoleEmailProvider] Sending synthetic email:`)
    console.log(`To: ${input.to}`)
    console.log(`Subject: ${finalSubject}`)
    console.log(`MessageId: ${messageId}`)
    console.log(`Body:\n${body}\n----------------------------------`)

    return {
      success: true,
      provider: 'console',
      messageId,
      renderedSubject: finalSubject,
      renderedBody: body,
    }
  }
}
