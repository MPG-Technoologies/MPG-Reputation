'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateGoogleReviewUrl } from '@/domain/destination'

export interface DestinationResult {
  success: boolean
  error?: string
  canonicalUrl?: string
  status?: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'INACTIVE'
}

async function requireDestinationManager(
  organizationId: string,
  locationId: string
) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      ok: false as const,
      error: 'Authentication required',
    }
  }

  const { data: membership, error: membershipError } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (
    membershipError ||
    !membership ||
    !['OWNER', 'ADMIN'].includes(membership.role)
  ) {
    return {
      ok: false as const,
      error:
        'Only owners and administrators can configure review destinations',
    }
  }

  const { data: location } = await supabase
    .from('locations')
    .select('id')
    .eq('id', locationId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!location) {
    return {
      ok: false as const,
      error: 'Location does not belong to this organization',
    }
  }

  return {
    ok: true as const,
    supabase,
    user,
  }
}

export async function saveDestination(
  formData: FormData
): Promise<DestinationResult> {
  const organizationId = formData.get('organizationId') as string
  const locationId = formData.get('locationId') as string
  const url = (formData.get('url') as string)?.trim()

  if (!organizationId || !locationId || !url) {
    return {
      success: false,
      error: 'Organization, location, and destination URL are required',
    }
  }

  const access = await requireDestinationManager(organizationId, locationId)

  if (!access.ok) {
    return { success: false, error: access.error }
  }

  const validation = validateGoogleReviewUrl(url)

  if (!validation.valid || !validation.canonicalUrl) {
    return {
      success: false,
      error: validation.error || 'Invalid Google review URL',
    }
  }

  const { supabase, user } = access

  const { data: existing } = await supabase
    .from('review_destinations')
    .select('id')
    .eq('location_id', locationId)
    .eq('provider', 'google')
    .maybeSingle()

  let destinationId: string

  if (existing) {
    const { data: updated, error } = await supabase
      .from('review_destinations')
      .update({
        url,
        canonical_url: validation.canonicalUrl,
        status: 'PENDING_CONFIRMATION',
        confirmed_by: null,
        confirmed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('organization_id', organizationId)
      .select('id')
      .single()

    if (error || !updated) {
      return {
        success: false,
        error: `Failed to update destination: ${error?.message || 'unknown'}`,
      }
    }

    destinationId = updated.id
  } else {
    const { data: created, error } = await supabase
      .from('review_destinations')
      .insert({
        organization_id: organizationId,
        location_id: locationId,
        provider: 'google',
        url,
        canonical_url: validation.canonicalUrl,
        status: 'PENDING_CONFIRMATION',
        confirmed_by: null,
        confirmed_at: null,
      })
      .select('id')
      .single()

    if (error || !created) {
      return {
        success: false,
        error: `Failed to create destination: ${error?.message || 'unknown'}`,
      }
    }

    destinationId = created.id
  }

  const admin = createAdminClient()

  await admin.from('audit_events').insert({
    organization_id: organizationId,
    actor_type: 'user',
    actor_id: user.id,
    event_type: 'review_destination.updated',
    entity_type: 'review_destination',
    entity_id: destinationId,
    metadata: {
      status: 'PENDING_CONFIRMATION',
    },
  })

  revalidatePath('/app/settings/review-destination')
  revalidatePath('/app/dashboard')
  revalidatePath('/app/quick-complete')

  return {
    success: true,
    canonicalUrl: validation.canonicalUrl,
    status: 'PENDING_CONFIRMATION',
  }
}

export async function deactivateDestination(
  formData: FormData
): Promise<DestinationResult> {
  const organizationId = formData.get('organizationId') as string
  const locationId = formData.get('locationId') as string

  if (!organizationId || !locationId) {
    return {
      success: false,
      error: 'Organization and location are required',
    }
  }

  const access = await requireDestinationManager(
    organizationId,
    locationId
  )

  if (!access.ok) {
    return {
      success: false,
      error: access.error,
    }
  }

  const { supabase, user } = access

  const { data: destination, error: destinationError } =
    await supabase
      .from('review_destinations')
      .select('id, status')
      .eq('organization_id', organizationId)
      .eq('location_id', locationId)
      .eq('provider', 'google')
      .maybeSingle()

  if (destinationError || !destination) {
    return {
      success: false,
      error: 'No Google review destination exists for this location',
    }
  }

  if (destination.status === 'INACTIVE') {
    return {
      success: true,
      status: 'INACTIVE',
    }
  }

  const { data: deactivated, error: deactivateError } =
    await supabase
      .from('review_destinations')
      .update({
        status: 'INACTIVE',
        confirmed_by: null,
        confirmed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', destination.id)
      .eq('organization_id', organizationId)
      .select('id')
      .single()

  if (deactivateError || !deactivated) {
    return {
      success: false,
      error: `Failed to pause destination: ${
        deactivateError?.message || 'unknown'
      }`,
    }
  }

  const admin = createAdminClient()

  await admin.from('audit_events').insert({
    organization_id: organizationId,
    actor_type: 'user',
    actor_id: user.id,
    event_type: 'review_destination.deactivated',
    entity_type: 'review_destination',
    entity_id: destination.id,
    metadata: {
      status: 'INACTIVE',
    },
  })

  revalidatePath('/app/settings/review-destination')
  revalidatePath('/app/dashboard')
  revalidatePath('/app/quick-complete')

  return {
    success: true,
    status: 'INACTIVE',
  }
}

export async function confirmDestination(
  formData: FormData
): Promise<DestinationResult> {
  const organizationId = formData.get('organizationId') as string
  const locationId = formData.get('locationId') as string
  const explicitlyTested = formData.get('explicitlyTested') === 'true'

  if (!organizationId || !locationId) {
    return {
      success: false,
      error: 'Organization and location are required',
    }
  }

  if (!explicitlyTested) {
    return {
      success: false,
      error:
        'Test the Google review link and confirm that it opens the correct business review destination before activation',
    }
  }

  const access = await requireDestinationManager(organizationId, locationId)

  if (!access.ok) {
    return { success: false, error: access.error }
  }

  const { supabase, user } = access

  const { data: destination, error: destinationError } = await supabase
    .from('review_destinations')
    .select('id, canonical_url, status')
    .eq('organization_id', organizationId)
    .eq('location_id', locationId)
    .eq('provider', 'google')
    .maybeSingle()

  if (destinationError || !destination) {
    return {
      success: false,
      error: 'Save a valid Google review destination before confirming it',
    }
  }

  const validation = validateGoogleReviewUrl(destination.canonical_url)

  if (!validation.valid || !validation.canonicalUrl) {
    return {
      success: false,
      error:
        validation.error ||
        'Stored Google review destination is no longer valid',
    }
  }

  const { data: confirmed, error: confirmError } = await supabase
    .from('review_destinations')
    .update({
      canonical_url: validation.canonicalUrl,
      status: 'CONFIRMED',
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', destination.id)
    .eq('organization_id', organizationId)
    .select('id')
    .single()

  if (confirmError || !confirmed) {
    return {
      success: false,
      error: `Failed to confirm destination: ${
        confirmError?.message || 'unknown'
      }`,
    }
  }

  const admin = createAdminClient()

  await admin.from('audit_events').insert({
    organization_id: organizationId,
    actor_type: 'user',
    actor_id: user.id,
    event_type: 'review_destination.confirmed',
    entity_type: 'review_destination',
    entity_id: destination.id,
    metadata: {
      status: 'CONFIRMED',
    },
  })

  revalidatePath('/app/settings/review-destination')
  revalidatePath('/app/dashboard')
  revalidatePath('/app/quick-complete')

  return {
    success: true,
    canonicalUrl: validation.canonicalUrl,
    status: 'CONFIRMED',
  }
}
