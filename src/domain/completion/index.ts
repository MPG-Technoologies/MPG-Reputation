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
  source: string
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
    source: string
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
    permission_source: string
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


export interface UniversalCompletionInput {
  event_id: string
  location_id: string
  completed_at: string
  country: string
  customer: {
    first_name: string
    last_name?: string | null
    email: string
    phone?: string | null
    source_customer_id?: string | null
  }
  transaction_id?: string | null
  permission?: {
    email?: PermissionState
    sms?: PermissionState
  }
}

export interface CompletionAdapter<TInput> {
  readonly source: string
  normalize(
    organizationId: string,
    input: TInput
  ): NormalizationResult
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SOURCE_EVENT_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/

export function normalizeUniversalCompletionInput(
  organizationId: string,
  input: UniversalCompletionInput
): NormalizationResult {
  const errors: Record<string, string> = {}

  if (!organizationId) {
    errors.organizationId = 'Organization ID is required'
  }

  const eventId = input?.event_id?.trim()

  if (!eventId || !SOURCE_EVENT_ID_PATTERN.test(eventId)) {
    errors.event_id =
      'event_id must be 1-200 safe identifier characters'
  }

  const locationId = input?.location_id?.trim()

  if (!locationId || !UUID_PATTERN.test(locationId)) {
    errors.location_id = 'A valid location UUID is required'
  }

  const firstName = input?.customer?.first_name?.trim()

  if (!firstName) {
    errors.first_name = 'Customer first name is required'
  }

  const email = input?.customer?.email
    ?.trim()
    .toLowerCase()

  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    errors.email = 'A valid customer email is required'
  }

  const completedAtRaw = input?.completed_at?.trim()
  const completedAt = completedAtRaw
    ? new Date(completedAtRaw)
    : null

  if (
    !completedAt ||
    Number.isNaN(completedAt.getTime())
  ) {
    errors.completed_at =
      'A valid completed_at timestamp is required'
  }

  const country = input?.country
    ?.trim()
    .toUpperCase()

  if (!country || !/^[A-Z]{2}$/.test(country)) {
    errors.country =
      'A two-character country code is required'
  }

  const permissionEmail =
    input?.permission?.email ?? 'unknown'

  const permissionSms =
    input?.permission?.sms ?? 'unknown'

  const validPermissions: PermissionState[] = [
    'allowed',
    'unknown',
    'denied',
  ]

  if (!validPermissions.includes(permissionEmail)) {
    errors.permission_email =
      'Invalid email permission state'
  }

  if (!validPermissions.includes(permissionSms)) {
    errors.permission_sms =
      'Invalid SMS permission state'
  }

  if (Object.keys(errors).length > 0) {
    return {
      valid: false,
      errors,
    }
  }

  const lastName =
    input.customer.last_name?.trim() || null

  const phone =
    input.customer.phone?.trim() || null

  const sourceCustomerId =
    input.customer.source_customer_id?.trim() || null

  const sourceTransactionId =
    input.transaction_id?.trim() || null

  const canonical: CanonicalCompletionEvent = {
    organization_id: organizationId,
    location_id: locationId!,
    source: 'api_v1',
    source_event_id: eventId!,
    source_customer_id: sourceCustomerId,
    source_transaction_id: sourceTransactionId,
    completed_at: completedAt!.toISOString(),
    country: country!,
    contact: {
      email: email!,
      phone,
    },
    permission: {
      email: permissionEmail,
      sms: permissionSms,
      source: 'api_v1',
    },
  }

  return {
    valid: true,
    canonical,
    customerPayload: {
      organization_id: organizationId,
      location_id: locationId!,
      first_name: firstName!,
      last_name: lastName,
      email: email!,
      phone,
      permission_email: permissionEmail,
      permission_sms: permissionSms,
      permission_source: 'api_v1',
    },
  }
}

export const universalCompletionAdapter: CompletionAdapter<UniversalCompletionInput> =
  {
    source: 'api_v1',

    normalize(organizationId, input) {
      return normalizeUniversalCompletionInput(
        organizationId,
        input
      )
    },
  }
