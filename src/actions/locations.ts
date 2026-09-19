'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeReplyToEmail } from '@/domain/email'
import type { Database } from '@/types/database'

export async function createLocation(formData: FormData): Promise<void> {
  const organizationId = formData.get('organizationId') as string
  const name = (formData.get('name') as string)?.trim()
  const address = (formData.get('address') as string)?.trim() || null
  const rawReplyTo = (formData.get('reviewReplyToEmail') as string) || null

  if (!organizationId || !name) {
    redirect('/app/settings/location?error=Location%20name%20is%20required')
  }

  let reviewReplyToEmail: string | null = null
  if (rawReplyTo && rawReplyTo.trim() !== '') {
    reviewReplyToEmail = sanitizeReplyToEmail(rawReplyTo)
    if (!reviewReplyToEmail) {
      redirect('/app/settings/location?error=Invalid%20Reply-To%20email%20address')
    }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  // Strict role check: Only OWNER and ADMIN can create locations
  const { data: membership, error: memError } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (memError || !membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    redirect('/app/settings/location?error=Access%20denied%3A%20Only%20owners%20and%20administrators%20can%20create%20locations')
  }

  const { data: loc, error } = await supabase
    .from('locations')
    .insert({
      organization_id: organizationId,
      name,
      address,
      review_reply_to_email: reviewReplyToEmail,
      status: 'ACTIVE',
    })
    .select('id')
    .single()

  if (error || !loc) {
    redirect(`/app/settings/location?error=${encodeURIComponent(error?.message || 'Failed to create location')}`)
  }

  const adminClient = createAdminClient()
  await adminClient.from('audit_events').insert({
    organization_id: organizationId,
    actor_type: 'user',
    actor_id: user.id,
    event_type: 'location.created',
    entity_type: 'location',
    entity_id: loc.id,
    metadata: { name, reviewReplyToEmail },
  })

  revalidatePath('/app/settings/location')
  revalidatePath('/app/settings/review-destination')
  revalidatePath('/app/quick-complete')
  revalidatePath('/app', 'layout')
  redirect('/app/settings/location?success=Location%20created')
}

export interface UpdateLocationSettingsResult {
  success: boolean
  error?: string
}

export async function updateLocationSettings(
  formData: FormData
): Promise<UpdateLocationSettingsResult> {
  const organizationId = formData.get('organizationId') as string
  const locationId = formData.get('locationId') as string
  const rawReplyTo = formData.get('reviewReplyToEmail') !== null
    ? (formData.get('reviewReplyToEmail') as string)
    : null
  const name = formData.get('name') !== null
    ? (formData.get('name') as string).trim()
    : null
  const address = formData.get('address') !== null
    ? (formData.get('address') as string).trim()
    : null

  if (!organizationId || !locationId) {
    return { success: false, error: 'Organization ID and Location ID are required' }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Strict role check: Only OWNER and ADMIN can configure location settings
  const { data: membership, error: memError } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (memError || !membership) {
    return { success: false, error: 'Access denied: You are not a member of this organization' }
  }

  if (!['OWNER', 'ADMIN'].includes(membership.role)) {
    return { success: false, error: 'Access denied: Only owners and administrators can configure location settings' }
  }

  // Cross-tenant verification: location must belong to organization
  const { data: loc } = await supabase
    .from('locations')
    .select('id')
    .eq('id', locationId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!loc) {
    return { success: false, error: 'Location does not belong to this organization' }
  }

  let reviewReplyToEmail: string | null = null
  if (rawReplyTo !== null && rawReplyTo.trim() !== '') {
    reviewReplyToEmail = sanitizeReplyToEmail(rawReplyTo)
    if (!reviewReplyToEmail) {
      return { success: false, error: 'Invalid Reply-To email address' }
    }
  }

  const updatePayload: Database['public']['Tables']['locations']['Update'] = {}
  if (formData.has('reviewReplyToEmail')) {
    updatePayload.review_reply_to_email = reviewReplyToEmail
  }
  if (name) {
    updatePayload.name = name
  }
  if (formData.has('address')) {
    updatePayload.address = address || null
  }

  if (Object.keys(updatePayload).length > 0) {
    const { error: updateError } = await supabase
      .from('locations')
      .update(updatePayload)
      .eq('id', locationId)
      .eq('organization_id', organizationId)

    if (updateError) {
      return { success: false, error: updateError.message }
    }
  }

  const adminClient = createAdminClient()
  await adminClient.from('audit_events').insert({
    organization_id: organizationId,
    actor_type: 'user',
    actor_id: user.id,
    event_type: 'location.updated',
    entity_type: 'location',
    entity_id: locationId,
    metadata: { reviewReplyToEmail },
  })

  revalidatePath('/app/settings/location')
  revalidatePath('/app', 'layout')

  return { success: true }
}
