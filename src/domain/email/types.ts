export type EmailMessageKind = 'initial_review_request' | 'review_request_reminder'

export interface ReviewRequestEmailInput {
  businessName: string
  customerFirstName?: string | null
  reviewUrl: string
  unsubscribeUrl: string
  replyToEmail?: string | null
  fromAddress?: string | null
}

export type ReviewReminderEmailInput = ReviewRequestEmailInput

export interface ComposedReviewRequestEmail {
  subject: string
  html: string
  text: string
  fromDisplayName: string
  formattedFrom?: string
  replyTo?: string
  headers: Record<string, string>
}
