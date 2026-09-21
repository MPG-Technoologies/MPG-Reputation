/**
 * Truthful human-readable policy reason formatting.
 * Derives concise explanation for why a review solicitation was bypassed by policy.
 */
export function formatPolicyReason(
  reason?: string | null,
  decision?: string | null
): string {
  if (decision === 'NO_REVIEW_DESTINATION') return 'No review destination configured'
  if (decision === 'EMAIL_PERMISSION_UNKNOWN') return 'Email permission unconfirmed'
  if (decision === 'EMAIL_PERMISSION_DENIED') return 'Customer denied email consent'
  if (decision === 'RECENT_REQUEST') return 'Recent request cooldown'
  if (decision === 'SUPPRESSED') return 'Contact on suppression list'
  if (decision === 'NO_CONTACT') return 'No valid contact email'
  if (decision === 'LOCATION_INACTIVE') return 'Location inactive'
  if (decision === 'ORGANIZATION_INACTIVE') return 'Organization inactive'
  if (decision === 'TRIAL_LIMIT_REACHED') return 'Usage limit reached'
  if (decision === 'DUPLICATE_EVENT') return 'Duplicate completion'

  if (reason) {
    const r = reason.toLowerCase()
    if (r.includes('destination')) return 'No review destination configured'
    if (r.includes('permission') || r.includes('consent')) return 'Email permission unconfirmed'
    if (r.includes('location')) return 'Location inactive'
    if (r.includes('cooldown') || r.includes('recent request')) return 'Recent request cooldown'
    if (r.includes('suppress')) return 'Contact on suppression list'
    if (r.includes('organization')) return 'Organization inactive'
    if (r.includes('contact') || r.includes('email')) return 'No valid contact email'
    if (r.includes('limit')) return 'Usage limit reached'
    if (r.includes('duplicate')) return 'Duplicate completion'
    return reason
  }

  return 'Skipped by policy rules'
}
