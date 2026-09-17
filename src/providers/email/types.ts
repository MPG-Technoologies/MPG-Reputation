export interface SendEmailInput {
  to: string
  recipientName: string
  businessName: string
  trackingUrl: string
  subject?: string
  idempotencyKey?: string
}

export interface SendEmailResult {
  success: boolean
  provider: 'console' | 'resend'
  messageId: string
  error?: string
  renderedSubject: string
  renderedBody: string
}

export interface EmailProvider {
  readonly name: 'console' | 'resend'
  send(input: SendEmailInput): Promise<SendEmailResult>
}

/**
 * Standard neutral review email renderer.
 * Strictly neutral: no positive bias, no star ratings, no incentives.
 */
export function renderNeutralReviewEmail(input: {
  recipientName: string
  businessName: string
  trackingUrl: string
}): { subject: string; body: string } {
  const subject = `How was your experience with ${input.businessName}?`
  const body = `Hi ${input.recipientName},

Thanks for choosing ${input.businessName}.

If you'd like to share your experience, we'd appreciate your honest feedback.

Leave a review:
${input.trackingUrl}

Thank you,
${input.businessName}`

  return { subject, body }
}
