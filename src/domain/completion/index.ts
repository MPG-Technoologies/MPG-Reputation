export interface QuickCompleteInput {
  organizationId: string
  locationId: string
  firstName: string
  lastName?: string | null
  email: string
  phone?: string | null
  completedAt?: string | null
  country?: string
  sourceEventId?: string
}

export interface CanonicalCompletionEvent {
  event_id?: string
  organization_id: string
  location_id: string
  customer_id?: string
  source: 'quick_complete'
  source_event_id: string
  source_customer_id: string | null
  source_transaction_id: string | null
  completed_at: string
  country: string
  contact: {
    email: string
    phone: string | null
  }
  permission: {
    email: 'allowed' | 'unknown' | 'denied'
    sms: 'allowed' | 'unknown' | 'denied'
    source: 'quick_complete'
  }
}

export interface NormalizationResult {
  valid: boolean
  errors?: Record<string, string>
  canonical?: CanonicalCompletionEvent
  customerPayload?: {
    organization_id: string
    location_id: string
    first_name: string
    last_name: string | null
    email: string
    phone: string | null
    permission_email: 'allowed'
    permission_sms: 'unknown'
    permission_source: 'quick_complete'
  }
}

export function normalizeQuickCompleteInput(input: QuickCompleteInput): NormalizationResult {
  const errors: Record<string, string> = {}

  const firstName = input.firstName?.trim()
  if (!firstName) {
    errors.firstName = 'First name is required'
  }

  const email = input.email?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'A valid email address is required'
  }

  if (!input.organizationId) {
    errors.organizationId = 'Organization ID is required'
  }

  if (!input.locationId) {
    errors.locationId = 'Location ID is required'
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors }
  }

  const lastName = input.lastName?.trim() || null
  const phone = input.phone?.trim() || null
  const country = (input.country?.trim().toUpperCase() || 'CA').slice(0, 2)

  let completedAt: string
  if (input.completedAt) {
    const parsed = new Date(input.completedAt)
    completedAt = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
  } else {
    completedAt = new Date().toISOString()
  }

  // Stable source_event_id for idempotency
  const sourceEventId = input.sourceEventId?.trim() || `qc_${input.locationId}_${encodeURIComponent(email!)}_${completedAt.slice(0, 10)}`

  const canonical: CanonicalCompletionEvent = {
    organization_id: input.organizationId,
    location_id: input.locationId,
    source: 'quick_complete',
    source_event_id: sourceEventId,
    source_customer_id: null,
    source_transaction_id: null,
    completed_at: completedAt,
    country,
    contact: {
      email: email!,
      phone,
    },
    permission: {
      email: 'allowed',
      sms: 'unknown',
      source: 'quick_complete',
    },
  }

  const customerPayload = {
    organization_id: input.organizationId,
    location_id: input.locationId,
    first_name: firstName!,
    last_name: lastName,
    email: email!,
    phone,
    permission_email: 'allowed' as const,
    permission_sms: 'unknown' as const,
    permission_source: 'quick_complete' as const,
  }

  return {
    valid: true,
    canonical,
    customerPayload,
  }
}
