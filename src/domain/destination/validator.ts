export interface ValidationResult {
  valid: boolean
  canonicalUrl?: string
  error?: string
}

/**
 * Validated Google Review Destination Patterns:
 * 1. g.page review links: https://g.page/r/{placeId}/review or https://g.page/{business}/review
 * 2. Search writereview: https://search.google.com/local/writereview?placeid={placeid}
 * 3. Maps place: https://maps.google.com/maps/place/{placeName}/... or https://www.google.com/maps/place/...
 * 4. Maps CID: https://maps.google.com/?cid={numeric_cid} or https://www.google.com/maps?cid={numeric_cid}
 * 5. goo.gl shortlink: https://goo.gl/maps/{code}
 */

const ALLOWED_EXACT_HOSTS = new Set([
  'g.page',
  'search.google.com',
  'maps.google.com',
  'www.google.com',
  'google.com',
  'goo.gl',
])

export function validateGoogleReviewUrl(inputUrl: string): ValidationResult {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { valid: false, error: 'URL is required' }
  }

  const trimmed = inputUrl.trim()

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }

  // 1. Strict HTTPS protocol requirement
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Review destination must use secure HTTPS protocol' }
  }

  // 2. Disallow credentials
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Credentials are not permitted in review destination URLs' }
  }

  // 3. Strict hostname check (exact match on allowed hosts)
  const hostname = parsed.hostname.toLowerCase()
  if (!ALLOWED_EXACT_HOSTS.has(hostname)) {
    return { valid: false, error: `Invalid host: ${hostname}. Must be a recognized Google domain.` }
  }

  const pathname = parsed.pathname
  const searchParams = parsed.searchParams

  // 4. Pattern validation per host
  if (hostname === 'g.page') {
    if (!pathname.endsWith('/review') || pathname.length <= '/review'.length + 1) {
      return { valid: false, error: 'g.page destination must point to a specific business review path (e.g. /r/{placeId}/review)' }
    }
  } else if (hostname === 'search.google.com') {
    if (!pathname.startsWith('/local/writereview')) {
      return { valid: false, error: 'search.google.com destination must start with /local/writereview' }
    }
    const placeid = searchParams.get('placeid')?.trim()
    if (!placeid || placeid.length < 3) {
      return { valid: false, error: 'search.google.com /local/writereview requires a valid placeid parameter' }
    }
  } else if (hostname === 'maps.google.com' || hostname === 'www.google.com' || hostname === 'google.com') {
    // Explicitly reject generic search queries first
    if (pathname.includes('/search') || (searchParams.has('q') && !searchParams.has('cid'))) {
      return { valid: false, error: 'Generic Google Maps search query cannot be used as a review destination' }
    }

    // Explicitly reject generic homepage
    if (pathname === '/' && !searchParams.has('cid')) {
      return { valid: false, error: 'Generic Google homepage cannot be used as a review destination' }
    }

    const isMapsPlace = pathname.startsWith('/maps/place/') && pathname.length > '/maps/place/'.length + 1
    const hasValidCid = searchParams.has('cid') && /^\d+$/.test(searchParams.get('cid') || '')
    const hasWriteReview = pathname.includes('/writereview')

    if (!isMapsPlace && !hasValidCid && !hasWriteReview) {
      return { valid: false, error: 'Google Maps destination must specify a direct place page (/maps/place/...) or CID' }
    }
  } else if (hostname === 'goo.gl') {
    if (!pathname.startsWith('/maps/') || pathname.length <= '/maps/'.length + 1) {
      return { valid: false, error: 'goo.gl shortlink destination must start with /maps/{code}' }
    }
  }

  // Canonicalize: remove fragment/hash
  parsed.hash = ''
  return {
    valid: true,
    canonicalUrl: parsed.toString(),
  }
}
