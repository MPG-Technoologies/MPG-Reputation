'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateGoogleReviewUrl } from '@/domain/destination'

export interface DestinationResult {
  success: boolean
  error?: string
  canonicalUrl?: string
}

export async function saveAndConfirmDestination(formData: FormData): Promise<DestinationResult> {
  const organizationId = formData.get('organizationId') as string
  const locationId = formData.get('locationId') as string
  const url = (formData.get('url') as string)?.trim()

  if (!organizationId || !locationId || !url) {
    return { success: false, error: 'Organization, location, and destination URL are required' }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Check role: must be OWNER or ADMIN
  const { data: membership, error: memError } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .single()

  if (memError || !membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    return { success: false, error: 'Only owners and administrators can configure review destinations' }
  }

  // Validate URL against Google strict rules
  const validation = validateGoogleReviewUrl(url)
  if (!validation.valid || !validation.canonicalUrl) {
    return { success: false, error: validation.error || 'Invalid Google review URL' }
  }

  // Check if destination exists
  const { data: existing } = await supabase
    .from('review_destinations')
    .select('id')
    .eq('location_id', locationId)
    .eq('provider', 'google')
    .maybeSingle()

  let destinationId: string

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from('review_destinations')
      .update({
        url,
        canonical_url: validation.canonicalUrl,
        status: 'CONFIRMED',
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id')
      .single()

    if (updateError || !updated) {
      return { success: false, error: `Failed to update destination: ${updateError?.message || 'unknown'}` }
    }
    destinationId = updated.id
  } else {
    const { data: created, error: createError } = await supabase
      .from('review_destinations')
      .insert({
        organization_id: organizationId,
        location_id: locationId,
        provider: 'google',
        url,
        canonical_url: validation.canonicalUrl,
        status: 'CONFIRMED',
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (createError || !created) {
      return { success: false, error: `Failed to create destination: ${createError?.message || 'unknown'}` }
    }
    destinationId = created.id
  }

  // Audit event
  const adminClient = createAdminClient()
  await adminClient.from('audit_events').insert({
    organization_id: organizationId,
    actor_type: 'user',
    actor_id: user.id,
    event_type: 'review_destination.updated',
    entity_type: 'review_destination',
    entity_id: destinationId,
    metadata: { canonical_url: validation.canonicalUrl },
  })

  return {
    success: true,
    canonicalUrl: validation.canonicalUrl,
  }
}
