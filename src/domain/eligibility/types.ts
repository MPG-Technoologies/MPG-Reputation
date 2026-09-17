export type EligibilityDecision =
  | 'ELIGIBLE'
  | 'NO_CONTACT'
  | 'EMAIL_PERMISSION_UNKNOWN'
  | 'EMAIL_PERMISSION_DENIED'
  | 'SUPPRESSED'
  | 'DUPLICATE_EVENT'
  | 'RECENT_REQUEST'
  | 'NO_REVIEW_DESTINATION'
  | 'LOCATION_INACTIVE'
  | 'ORGANIZATION_INACTIVE'
  | 'TRIAL_LIMIT_REACHED'

export interface OrganizationFact {
  id: string
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
}

export interface LocationFact {
  id: string
  status: 'ACTIVE' | 'INACTIVE'
}

export interface CustomerFact {
  id: string
  email?: string | null
  phone?: string | null
  permission_email: 'allowed' | 'unknown' | 'denied'
  permission_sms?: 'allowed' | 'unknown' | 'denied'
}

export interface ReviewDestinationFact {
  id: string
  status: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'INACTIVE'
  canonical_url: string
}

export interface EligibilityInput {
  organization: OrganizationFact
  location: LocationFact
  customer: CustomerFact
  destination?: ReviewDestinationFact | null
  isSuppressed?: boolean
  isDuplicateEvent?: boolean
  hasRecentRequestWithinWindow?: boolean
  isTrialLimitReached?: boolean
}

export interface EligibilityResult {
  decision: EligibilityDecision
  eligible: boolean
  reason: string
}
