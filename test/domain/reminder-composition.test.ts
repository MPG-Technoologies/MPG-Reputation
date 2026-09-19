import { describe, it, expect } from 'vitest'
import { composeReviewReminderEmail } from '../../src/domain/email'

describe('MR-1C Reminder Email Composition & Neutrality', () => {
  const validInput = {
    businessName: 'Northstar Dental',
    customerFirstName: 'Jane',
    reviewUrl: 'https://mpg-reputation.vercel.app/r/synthetic-token-12345678',
    unsubscribeUrl: 'https://mpg-reputation.vercel.app/unsubscribe/synthetic-unsub-token-12345678',
    fromAddress: 'reviews@reputation.withmpg.com',
    replyToEmail: 'support@northstardental.test',
  }

  it('generates the exact neutral reminder subject', () => {
    const email = composeReviewReminderEmail(validInput)
    expect(email.subject).toBe('Reminder: Share your experience with Northstar Dental')
  })

  it('falls back to generic subject if business name is missing', () => {
    const email = composeReviewReminderEmail({
      ...validInput,
      businessName: '',
    })
    expect(email.subject).toBe('Reminder: Share your experience')
  })

  it('formats sender display name with MPG Reputation attribution', () => {
    const email = composeReviewReminderEmail(validInput)
    expect(email.fromDisplayName).toBe('Northstar Dental via MPG Reputation')
    expect(email.formattedFrom).toBe('"Northstar Dental via MPG Reputation" <reviews@reputation.withmpg.com>')
  })

  it('includes List-Unsubscribe and List-Unsubscribe-Post RFC 8058 headers', () => {
    const email = composeReviewReminderEmail(validInput)
    expect(email.headers['List-Unsubscribe']).toBe(
      `<${validInput.unsubscribeUrl}>`
    )
    expect(email.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('renders neutral reminder HTML containing greeting, review URL, and destination disclosure', () => {
    const email = composeReviewReminderEmail(validInput)
    expect(email.html).toContain('Hi Jane,')
    expect(email.html).toContain(
      'This is a reminder that Northstar Dental invited you to share your experience following your recent service.'
    )
    expect(email.html).toContain('If you&#39;d like to leave a review, use the link below.')
    expect(email.html).toContain('Leave a review')
    expect(email.html).toContain(validInput.reviewUrl)
    expect(email.html).toContain('The button takes you to Northstar Dental&#39;s review page.')
    expect(email.html).toContain(validInput.unsubscribeUrl)
    expect(email.html).toContain('opt out of future review-request emails')
  })

  it('renders equivalent neutral plain-text email with full URLs', () => {
    const email = composeReviewReminderEmail(validInput)
    expect(email.text).toContain('Hi Jane,')
    expect(email.text).toContain(
      'This is a reminder that Northstar Dental invited you to share your experience following your recent service.'
    )
    expect(email.text).toContain('If you\'d like to leave a review, use the link below.')
    expect(email.text).toContain(validInput.reviewUrl)
    expect(email.text).toContain('The link takes you to Northstar Dental\'s review page.')
    expect(email.text).toContain(validInput.unsubscribeUrl)
    expect(email.text).toContain('To stop future review-request emails from Northstar Dental:')
  })

  it('strictly prohibits rating, sentiment gating, or guilt language', () => {
    const email = composeReviewReminderEmail(validInput)
    const combined = (email.subject + ' ' + email.html + ' ' + email.text).toLowerCase()

    const prohibitedPhrases = [
      'haven\'t left a review',
      'noticed you didn\'t',
      '5 star',
      'five star',
      'positive review',
      'help us improve our rating',
      'happy with your service',
      'tell google how great',
      'give us 5',
    ]

    for (const phrase of prohibitedPhrases) {
      expect(combined).not.toContain(phrase)
    }
  })

  it('does not contain tracking pixels or external images', () => {
    const email = composeReviewReminderEmail(validInput)
    expect(email.html).not.toContain('<img')
    expect(email.html).not.toContain('pixel')
    expect(email.html).not.toContain('track')
  })

  it('validates and attaches safe reply-to email', () => {
    const email = composeReviewReminderEmail(validInput)
    expect(email.replyTo).toBe('support@northstardental.test')
  })

  it('handles customer without first name gracefully', () => {
    const email = composeReviewReminderEmail({
      ...validInput,
      customerFirstName: null,
    })
    expect(email.html).toContain('Hello,')
    expect(email.text).toContain('Hello,')
  })

  it('escapes HTML special characters in business name and customer name', () => {
    const email = composeReviewReminderEmail({
      ...validInput,
      businessName: 'Tom & Jerry Dental <script>',
      customerFirstName: 'Jane<script>alert(1)</script>',
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('Tom &amp; Jerry Dental')
    expect(email.html).toContain('Hi Jane,')
  })
})
