import { describe, it, expect } from 'vitest'
import { validateGoogleReviewUrl } from '../../src/domain/destination'

describe('validateGoogleReviewUrl', () => {
  it('accepts valid g.page review links', () => {
    const result = validateGoogleReviewUrl('https://g.page/r/CWd814KXYZ123/review')
    expect(result.valid).toBe(true)
    expect(result.canonicalUrl).toBe('https://g.page/r/CWd814KXYZ123/review')
  })

  it('accepts valid search.google.com writereview links', () => {
    const result = validateGoogleReviewUrl('https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4')
    expect(result.valid).toBe(true)
    expect(result.canonicalUrl).toContain('placeid=ChIJN1t_tDeuEmsRUsoyG83frY4')
  })

  it('accepts valid maps.google.com cid links', () => {
    const result = validateGoogleReviewUrl('https://maps.google.com/?cid=1029384756102938475')
    expect(result.valid).toBe(true)
    expect(result.canonicalUrl).toBe('https://maps.google.com/?cid=1029384756102938475')
  })

  it('rejects plain HTTP links', () => {
    const result = validateGoogleReviewUrl('http://g.page/r/CWd814KXYZ123/review')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('HTTPS')
  })

  it('rejects untrusted domains and potential phishing URLs', () => {
    const evil1 = validateGoogleReviewUrl('https://evil.com/review')
    expect(evil1.valid).toBe(false)
    expect(evil1.error).toContain('Invalid host')

    const evil2 = validateGoogleReviewUrl('https://g.page.attacker.com/review')
    expect(evil2.valid).toBe(false)
    expect(evil2.error).toContain('Invalid host')

    const evil3 = validateGoogleReviewUrl('https://google.com.attacker.com/local/writereview?placeid=123')
    expect(evil3.valid).toBe(false)
    expect(evil3.error).toContain('Invalid host')
  })

  it('rejects URLs with embedded credentials', () => {
    const result = validateGoogleReviewUrl('https://user:password@google.com/maps/place/123')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Credentials')
  })

  it('rejects search.google.com writereview missing placeid', () => {
    const result = validateGoogleReviewUrl('https://search.google.com/local/writereview')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('placeid')
  })

  it('rejects generic Google homepage and generic search (Prompt Correction 16)', () => {
    const home1 = validateGoogleReviewUrl('https://www.google.com')
    expect(home1.valid).toBe(false)
    expect(home1.error).toContain('homepage')

    const home2 = validateGoogleReviewUrl('https://google.com')
    expect(home2.valid).toBe(false)
    expect(home2.error).toContain('homepage')

    const search1 = validateGoogleReviewUrl('https://maps.google.com/?q=dentist')
    expect(search1.valid).toBe(false)
    expect(search1.error).toContain('search')

    const search2 = validateGoogleReviewUrl('https://www.google.com/maps/search/dentist')
    expect(search2.valid).toBe(false)
    expect(search2.error).toContain('search')
  })

  it('rejects arbitrary g.page paths without /review (Prompt Correction 16)', () => {
    const arbitrary = validateGoogleReviewUrl('https://g.page/attacker')
    expect(arbitrary.valid).toBe(false)
    expect(arbitrary.error).toContain('review path')
  })
})

describe('MR-2 destination activation safety', () => {
  it('canonicalizes valid review URLs without implying confirmation', () => {
    const result = validateGoogleReviewUrl(
      'https://g.page/r/CWd814KXYZ123/review#fragment'
    )

    expect(result.valid).toBe(true)
    expect(result.canonicalUrl).toBe(
      'https://g.page/r/CWd814KXYZ123/review'
    )
  })

  it('rejects attacker-controlled lookalike Google hosts', () => {
    expect(
      validateGoogleReviewUrl(
        'https://g.page.example.com/r/abc/review'
      ).valid
    ).toBe(false)

    expect(
      validateGoogleReviewUrl(
        'https://www.google.com.example.com/maps/place/test'
      ).valid
    ).toBe(false)
  })
})
