export interface SendEmailInput {
  to: string
  recipientName?: string
  businessName: string
  trackingUrl: string
  unsubscribeUrl?: string
  subject?: string
  html?: string
  text?: string
  fromDisplayName?: string
  replyTo?: string
  headers?: Record<string, string>
  idempotencyKey?: string
  correlationId?: string
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
 * Kept for backwards compatibility and fallback rendering.
 */
export function renderNeutralReviewEmail(input: {
  recipientName?: string
  businessName: string
  trackingUrl: string
  unsubscribeUrl?: string
}): { subject: string; body: string } {
  const name = input.recipientName?.trim() || 'there'
  const business = input.businessName?.trim() || 'our business'
  const subject = `How was your experience with ${business}?`
  const body = `Hi ${name},

Thanks for choosing ${business}.

If you'd like to share your experience, we'd appreciate your honest feedback.

Leave a review:
${input.trackingUrl}

Thank you,
${business}${input.unsubscribeUrl ? `\n\nTo opt out of future review requests:\n${input.unsubscribeUrl}` : ''}`

  return { subject, body }
}
