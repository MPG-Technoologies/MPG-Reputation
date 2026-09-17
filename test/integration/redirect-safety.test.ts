import { describe, it, expect } from 'vitest'
import { generateTrackingToken, isValidTokenFormat, hashTrackingToken } from '../../src/domain/tracking'
import { validateGoogleReviewUrl } from '../../src/domain/destination'

interface DestinationRecord {
  id: string
  canonicalUrl: string
  status: 'CONFIRMED' | 'INACTIVE'
}

interface ReviewRequestRecord {
  id: string
  tokenHash: string
  destinationId: string
  status: 'SENT' | 'CLICKED'
  clickedAt?: string | null
}

class RedirectResolver {
  private requests: ReviewRequestRecord[] = []
  private destinations: DestinationRecord[] = []
  public clickEventCount = 0

  addDestination(dest: DestinationRecord) {
    this.destinations.push(dest)
  }

  addRequest(req: ReviewRequestRecord) {
    this.requests.push(req)
  }

  resolveRedirect(rawToken: string, _attackerRedirectParam?: string): {
    status: number
    redirectUrl?: string
    error?: string
  } {
    void _attackerRedirectParam; // 1. Validate token format
    if (!isValidTokenFormat(rawToken)) {
      return { status: 404, error: 'Invalid token format' }
    }

    // 2. Hash token for indexed lookup
    const tokenHash = hashTrackingToken(rawToken)
    const request = this.requests.find((r) => r.tokenHash === tokenHash)
    if (!request) {
      return { status: 404, error: 'Token not found' }
    }

    // 3. Resolve destination strictly from stored database record (ignore attacker query param)
    const dest = this.destinations.find((d) => d.id === request.destinationId)
    if (!dest || dest.status !== 'CONFIRMED') {
      return { status: 404, error: 'Destination inactive or unconfirmed' }
    }

    // 4. Validate URL security
    const validated = validateGoogleReviewUrl(dest.canonicalUrl)
    if (!validated.valid || !validated.canonicalUrl) {
      return { status: 500, error: 'Invalid destination record' }
    }

    // 5. Record click idempotently
    if (request.status !== 'CLICKED') {
      request.status = 'CLICKED'
      request.clickedAt = new Date().toISOString()
      this.clickEventCount++
    }

    // 6. Return 302 redirect strictly to confirmed URL
    return {
      status: 302,
      redirectUrl: validated.canonicalUrl,
    }
  }
}

describe('Tracked Redirect Safety & Click Recording', () => {
  it('resolves valid token, records click, and issues 302 to stored Google review URL', () => {
    const resolver = new RedirectResolver()
    const { token, tokenHash } = generateTrackingToken()

    resolver.addDestination({
      id: 'dest-1',
      canonicalUrl: 'https://g.page/r/NorthstarDental/review',
      status: 'CONFIRMED',
    })

    resolver.addRequest({
      id: 'req-1',
      tokenHash,
      destinationId: 'dest-1',
      status: 'SENT',
    })

    // First click
    const res1 = resolver.resolveRedirect(token)
    expect(res1.status).toBe(302)
    expect(res1.redirectUrl).toBe('https://g.page/r/NorthstarDental/review')
    expect(resolver.clickEventCount).toBe(1)

    // Repeat click (idempotent tracking)
    const res2 = resolver.resolveRedirect(token)
    expect(res2.status).toBe(302)
    expect(res2.redirectUrl).toBe('https://g.page/r/NorthstarDental/review')
    expect(resolver.clickEventCount).toBe(1) // Still 1, didn't double count
  })

  it('rejects invalid or unknown token with 404 without exposing redirect', () => {
    const resolver = new RedirectResolver()
    const result = resolver.resolveRedirect('invalid-token-short')
    expect(result.status).toBe(404)
    expect(result.redirectUrl).toBeUndefined()
  })

  it('ignores attacker query parameter and never open redirects', () => {
    const resolver = new RedirectResolver()
    const { token, tokenHash } = generateTrackingToken()

    resolver.addDestination({
      id: 'dest-1',
      canonicalUrl: 'https://g.page/r/NorthstarDental/review',
      status: 'CONFIRMED',
    })

    resolver.addRequest({
      id: 'req-1',
      tokenHash,
      destinationId: 'dest-1',
      status: 'SENT',
    })

    const attackerAttempt = resolver.resolveRedirect(token, 'https://attacker.com/malicious-phishing')
    expect(attackerAttempt.status).toBe(302)
    expect(attackerAttempt.redirectUrl).toBe('https://g.page/r/NorthstarDental/review')
    expect(attackerAttempt.redirectUrl).not.toContain('attacker.com')
  })
})
