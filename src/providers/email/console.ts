import { randomUUID } from 'node:crypto'
import type { EmailProvider, SendEmailInput, SendEmailResult } from './types'
import { renderNeutralReviewEmail } from './types'

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console' as const

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const fallback = renderNeutralReviewEmail({
      recipientName: input.recipientName,
      businessName: input.businessName,
      trackingUrl: input.trackingUrl,
      unsubscribeUrl: input.unsubscribeUrl,
    })

    const finalSubject = input.subject || fallback.subject
    const body = input.text || fallback.body
    const messageId = `console_${randomUUID()}`

    // Safe development console logger
    console.log(`[ConsoleEmailProvider] Sending synthetic email:`)
    console.log(`To: ${input.to}`)
    console.log(`Subject: ${finalSubject}`)
    if (input.fromDisplayName) {
      console.log(`From: "${input.fromDisplayName}"`)
    }
    if (input.replyTo) {
      console.log(`Reply-To: ${input.replyTo}`)
    }
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
