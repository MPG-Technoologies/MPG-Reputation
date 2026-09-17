export type PermissionState = 'allowed' | 'unknown' | 'denied'

export interface QuickCompleteInput {
  organizationId: string
  locationId: string
  firstName: string
  lastName?: string | null
  email: string
  phone?: string | null
  permissionEmail?: PermissionState
  permissionPhone?: PermissionState
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
    email: PermissionState
    sms: PermissionState
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
    permission_email: PermissionState
    permission_sms: PermissionState
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

  // Conservative consent default: 'unknown' unless explicitly provided
  const permissionEmail: PermissionState = input.permissionEmail || 'unknown'
  const permissionPhone: PermissionState = input.permissionPhone || 'unknown'

  let completedAt: string
  if (input.completedAt) {
    const parsed = new Date(input.completedAt)
    completedAt = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
  } else {
    completedAt = new Date().toISOString()
  }

  // Stable source_event_id for idempotency (Prompt 8: unique per submission intent, not derived solely from date)
  const sourceEventId = input.sourceEventId?.trim() || `qc_${crypto.randomUUID()}`

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
      email: permissionEmail,
      sms: permissionPhone,
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
    permission_email: permissionEmail,
    permission_sms: permissionPhone,
    permission_source: 'quick_complete' as const,
  }

  return {
    valid: true,
    canonical,
    customerPayload,
  }
}
