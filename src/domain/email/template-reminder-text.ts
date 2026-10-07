import type { TextTemplateOptions } from './template-text'

/**
 * Renders an equivalent, neutral plain-text review request REMINDER email.
 * Includes complete tracked review URL, destination disclosure, and unsubscribe URL.
 */
export function renderReviewReminderText(options: TextTemplateOptions): string {
  const { businessName, businessPostalAddress, customerFirstName, reviewUrl, unsubscribeUrl } = options

  const cleanBusiness = businessName.trim() || 'our business'
  const cleanPostalAddress = businessPostalAddress ? businessPostalAddress.trim() : null
  const greeting = customerFirstName && customerFirstName.trim()
    ? `Hi ${customerFirstName.trim()},`
    : 'Hello,'

  const footer = cleanPostalAddress
    ? `This review request was sent on behalf of ${cleanBusiness}.
Business address:
${cleanPostalAddress}

Delivered using MPG Reputation.

To stop future review-request emails from ${cleanBusiness}:
${unsubscribeUrl}`
    : `This review request was sent on behalf of ${cleanBusiness} using MPG Reputation.

To stop future review-request emails from ${cleanBusiness}:
${unsubscribeUrl}`

  return `${greeting}

This is a reminder that ${cleanBusiness} invited you to share your experience following your recent service.

If you'd like to leave a review, use the link below.

Leave a review:
${reviewUrl}

The link takes you to ${cleanBusiness}'s review page.

${footer}`.trim()
}
