import { describe, it, expect } from 'vitest'
import {
  composeReviewRequestEmail,
  extractCustomerFirstName,
  sanitizeDisplayName,
  formatSenderIdentity,
  sanitizeReplyToEmail,
} from '../../src/domain/email'

describe('Email Composition & Neutrality (MR-1B Section 20)', () => {
  const baseInput = {
    businessName: 'Northstar Dental',
    customerFirstName: 'Jane',
    reviewUrl: 'https://mpg-reputation.local/r/token_abc_123',
    unsubscribeUrl: 'https://mpg-reputation.local/unsubscribe/unsub_xyz_789',
    fromAddress: 'reviews@updates.example.com',
  }

  it('1. Normal business + first name renders correctly in both formats', () => {
    const email = composeReviewRequestEmail(baseInput)

    expect(email.subject).toBe('Share your experience with Northstar Dental')
    expect(email.fromDisplayName).toBe('Northstar Dental via MPG Reputation')
    expect(email.formattedFrom).toBe('"Northstar Dental via MPG Reputation" <reviews@updates.example.com>')

    // HTML assertions
    expect(email.html).toContain('Hi Jane,')
    expect(email.html).toContain('Thank you for choosing Northstar Dental.')
    expect(email.html).toContain('https://mpg-reputation.local/r/token_abc_123')
    expect(email.html).toContain('https://mpg-reputation.local/unsubscribe/unsub_xyz_789')

    // Text assertions
    expect(email.text).toContain('Hi Jane,')
    expect(email.text).toContain('Thank you for choosing Northstar Dental.')
    expect(email.text).toContain('https://mpg-reputation.local/r/token_abc_123')
    expect(email.text).toContain('https://mpg-reputation.local/unsubscribe/unsub_xyz_789')
  })

  it('2. Missing first name uses neutral fallback greeting "Hello,"', () => {
    const email = composeReviewRequestEmail({
      ...baseInput,
      customerFirstName: null,
    })

    expect(email.html).toContain('Hello,')
    expect(email.html).not.toContain('Hi null')
    expect(email.html).not.toContain('Hi there')
    expect(email.text).toContain('Hello,')
  })

  it('3. Missing or empty business name uses neutral fallback', () => {
    const email = composeReviewRequestEmail({
      ...baseInput,
      businessName: '',
    })

    expect(email.subject).toBe('Share your experience')
    expect(email.fromDisplayName).toBe('MPG Reputation')
    expect(email.formattedFrom).toBe('"MPG Reputation" <reviews@updates.example.com>')
    expect(email.html).toContain('MPG Reputation')
    expect(email.text).toContain('MPG Reputation')
  })

  it('4. HTML contains one primary review CTA button', () => {
    const email = composeReviewRequestEmail(baseInput)

    const ctaMatches = email.html.match(/Leave a review/g)
    expect(ctaMatches).toHaveLength(1)
    expect(email.html).toContain('href="https://mpg-reputation.local/r/token_abc_123"')
  })

  it('5. CTA uses MPG tracked URL and points to /r/[token]', () => {
    const email = composeReviewRequestEmail(baseInput)
    expect(email.html).toContain('https://mpg-reputation.local/r/token_abc_123')
    expect(email.text).toContain('https://mpg-reputation.local/r/token_abc_123')
  })

  it('6. Raw Google destination is NOT rendered in the email body', () => {
    const email = composeReviewRequestEmail(baseInput)

    expect(email.html).not.toContain('google.com/maps')
    expect(email.html).not.toContain('search.google.com/local/writereview')
    expect(email.html).not.toContain('g.page')
    expect(email.text).not.toContain('google.com/maps')
  })

  it('7. Plain text contains complete tracked review URL', () => {
    const email = composeReviewRequestEmail(baseInput)
    expect(email.text).toContain('https://mpg-reputation.local/r/token_abc_123')
    expect(email.text).toMatch(/Leave a review:[\r\n]+https:\/\/mpg-reputation\.local\/r\/token_abc_123/)
  })

  it('8. Plain text contains complete unsubscribe URL', () => {
    const email = composeReviewRequestEmail(baseInput)
    expect(email.text).toContain('https://mpg-reputation.local/unsubscribe/unsub_xyz_789')
    expect(email.text).toMatch(/To stop future review-request emails from Northstar Dental:[\r\n]+https:\/\/mpg-reputation\.local\/unsubscribe\/unsub_xyz_789/)
  })

  it('9. Neutral wording contains no prohibited positivity, rating, or incentive language', () => {
    const email = composeReviewRequestEmail(baseInput)
    const combinedContent = (email.subject + ' ' + email.html + ' ' + email.text).toLowerCase()

    expect(combinedContent).not.toContain('5-star')
    expect(combinedContent).not.toContain('5 star')
    expect(combinedContent).not.toContain('five star')
    expect(combinedContent).not.toContain('positive review')
    expect(combinedContent).not.toContain('great experience')
    expect(combinedContent).not.toContain('happy with')
    expect(combinedContent).not.toContain('help our ranking')
    expect(combinedContent).not.toContain('30 seconds')
    expect(combinedContent).not.toContain('quick favor')
    expect(combinedContent).not.toContain('incentive')
    expect(combinedContent).not.toContain('discount')
  })

  it('10. Business name HTML escaping prevents XSS and malformed tags', () => {
    const email = composeReviewRequestEmail({
      ...baseInput,
      businessName: 'Dr. Smith & <Co> "Elite"',
    })

    expect(email.html).toContain('Dr. Smith &amp; Co Elite')
    expect(email.html).not.toContain('<Co>')
  })

  it('11. Customer name HTML escaping prevents injection', () => {
    const email = composeReviewRequestEmail({
      ...baseInput,
      customerFirstName: 'Jane<script>alert(1)</script>',
    })

    const firstName = extractCustomerFirstName('Jane<script>alert(1)</script>')
    expect(firstName).not.toContain('<script>')
    expect(email.html).not.toContain('<script>')
  })

  it('12. Header injection attempt in business name is neutralized', () => {
    const dirtyName = 'Northstar Dental\r\nBcc: evil@attacker.com\r\nSubject: Hacked'
    const cleanName = sanitizeDisplayName(dirtyName)

    expect(cleanName).not.toContain('\r')
    expect(cleanName).not.toContain('\n')
    expect(cleanName).toBe('Northstar Dental Bcc: evil@attacker.com Subject: Hacked')

    const sender = formatSenderIdentity({
      businessName: dirtyName,
      fromAddress: 'reviews@updates.example.com',
    })

    expect(sender.displayName).not.toContain('\r')
    expect(sender.displayName).not.toContain('\n')
    expect(sender.formattedFrom).not.toContain('\r')
    expect(sender.formattedFrom).not.toContain('\n')
  })

  it('13. Reply-To injection attempt is rejected and returns null', () => {
    expect(sanitizeReplyToEmail('contact@example.com\r\nBcc: evil@attacker.com')).toBeNull()
    expect(sanitizeReplyToEmail('contact@example.com\nSubject: Malicious')).toBeNull()
    expect(sanitizeReplyToEmail('not-an-email')).toBeNull()
    expect(sanitizeReplyToEmail('')).toBeNull()
    expect(sanitizeReplyToEmail(null)).toBeNull()
    expect(sanitizeReplyToEmail('  Valid.Reply@Example.Com  ')).toBe('valid.reply@example.com')
  })

  it('14. Business name length is bounded sensibly', () => {
    const veryLongName = 'A'.repeat(200)
    const sanitized = sanitizeDisplayName(veryLongName)
    expect(sanitized.length).toBeLessThanOrEqual(64)
  })

  it('15. No remote tracking pixel is rendered in HTML email', () => {
    const email = composeReviewRequestEmail(baseInput)
    expect(email.html).not.toContain('<img')
    expect(email.html).not.toContain('pixel')
    expect(email.html).not.toContain('track.gif')
    expect(email.html).not.toContain('width="1" height="1"')
  })

  it('16. No provider open or click tracking parameters are attached', () => {
    const email = composeReviewRequestEmail(baseInput)
    expect(email.html).not.toContain('open_tracking')
    expect(email.html).not.toContain('click_tracking')
    expect(email.headers).not.toHaveProperty('X-Resend-Click-Tracking')
    expect(email.headers).not.toHaveProperty('X-Resend-Open-Tracking')
  })
})
