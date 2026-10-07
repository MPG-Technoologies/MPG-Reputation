/**
 * MR-7B.2: Postal Address Normalization & Sanitization
 *
 * Enforces bounded, safe normalization of business/location postal addresses
 * used in review-request email footers.
 *
 * Rules:
 * - Accept string | null | undefined
 * - Strip NUL and ASCII control injection (\x00-\x08, \x0B-\x0C, \x0E-\x1F, \x7F)
 * - Safely normalize CR, LF, and tab whitespace sequences to spaces
 * - Collapse repeated whitespace to a single space
 * - Trim leading and trailing whitespace
 * - Bounded maximum length of 300 characters
 * - Return null for empty, whitespace-only, or non-string inputs
 * - International-address compatible (does NOT attempt US/Canada-specific parsing)
 * - Does NOT invent missing address pieces
 * - HTML escaping is performed at template rendering time, not here.
 */
export function sanitizePostalAddress(address?: string | null): string | null {
  if (!address || typeof address !== 'string') {
    return null
  }

  // 1. Remove NUL and control characters (excluding tab, LF, CR which get normalized)
  const stripped = address.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

  // 2. Normalize CR, LF, and tabs to a single space
  const normalizedNewlines = stripped.replace(/[\r\n\t]+/g, ' ')

  // 3. Collapse repeated whitespace and trim
  const collapsed = normalizedNewlines.replace(/\s+/g, ' ').trim()

  if (!collapsed) {
    return null
  }

  // 4. Bounded max length: 300 characters
  const bounded = collapsed.slice(0, 300).trim()

  return bounded || null
}
