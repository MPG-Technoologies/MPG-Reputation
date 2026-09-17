'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function createOrganizationAndLocation(formData: FormData): Promise<void> {
  const orgName = (formData.get('orgName') as string)?.trim()
  const locName = (formData.get('locName') as string)?.trim()
  const address = (formData.get('address') as string)?.trim() || null

  if (!orgName || !locName) {
    redirect('/onboarding?error=Organization%20name%20and%20location%20name%20are%20required')
  }

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login?error=Authentication%20required')
  }

  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `org-${Date.now()}`

  // Create organization
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name: orgName,
      slug,
      status: 'ACTIVE',
    })
    .select('id')
    .single()

  if (orgError || !org) {
    redirect(`/onboarding?error=${encodeURIComponent(orgError?.message || 'Failed to create organization')}`)
  }

  // Link user as OWNER in organization_users
  const adminClient = createAdminClient()
  const { error: memberError } = await adminClient
    .from('organization_users')
    .insert({
      organization_id: org.id,
      user_id: user.id,
      role: 'OWNER',
    })

  if (memberError) {
    redirect(`/onboarding?error=${encodeURIComponent(memberError.message)}`)
  }

  // Create primary location
  const { error: locError } = await supabase
    .from('locations')
    .insert({
      organization_id: org.id,
      name: locName,
      address,
      status: 'ACTIVE',
    })

  if (locError) {
    redirect(`/onboarding?error=${encodeURIComponent(locError.message)}`)
  }

  // Record audit
  await adminClient.from('audit_events').insert({
    organization_id: org.id,
    actor_type: 'user',
    actor_id: user.id,
    event_type: 'organization.created',
    entity_type: 'organization',
    entity_id: org.id,
    metadata: { name: orgName, slug },
  })

  redirect('/app/settings/review-destination')
}
