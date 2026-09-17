export interface ValidationResult {
  valid: boolean
  canonicalUrl?: string
  error?: string
}

const ALLOWED_GOOGLE_HOSTS = new Set([
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

  // 1. Strict HTTPS requirement
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Review destination must use secure HTTPS protocol' }
  }

  // 2. Disallow username or password in URL
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Credentials are not permitted in review destination URLs' }
  }

  // 3. Strict hostname verification (prevent attacker subdomains or open redirects)
  const hostname = parsed.hostname.toLowerCase()
  if (!ALLOWED_GOOGLE_HOSTS.has(hostname)) {
    return { valid: false, error: `Invalid host: ${hostname}. Must be a recognized Google domain.` }
  }

  // 4. Path and query pattern verification
  if (hostname === 'g.page') {
    // Expected pattern: /r/{placeId}/review or /{business}/review
    if (!parsed.pathname.includes('/review') && parsed.pathname.length <= 1) {
      return { valid: false, error: 'g.page destination must point to a review path' }
    }
  } else if (hostname === 'search.google.com') {
    if (!parsed.pathname.startsWith('/local/writereview')) {
      return { valid: false, error: 'search.google.com destination must start with /local/writereview' }
    }
    if (!parsed.searchParams.has('placeid')) {
      return { valid: false, error: 'search.google.com /local/writereview requires a placeid parameter' }
    }
  } else if (hostname === 'maps.google.com' || hostname === 'www.google.com' || hostname === 'google.com') {
    const isMapsPlace = parsed.pathname.includes('/maps/place')
    const hasCid = parsed.searchParams.has('cid')
    const hasWriteReview = parsed.pathname.includes('/writereview')
    if (!isMapsPlace && !hasCid && !hasWriteReview) {
      return { valid: false, error: 'Google Maps destination must specify a place or write-review path' }
    }
  } else if (hostname === 'goo.gl') {
    if (!parsed.pathname.startsWith('/maps/')) {
      return { valid: false, error: 'goo.gl shortlink destination must start with /maps/' }
    }
  }

  // Canonicalize: return clean standard URL without fragment
  parsed.hash = ''
  return {
    valid: true,
    canonicalUrl: parsed.toString(),
  }
}
