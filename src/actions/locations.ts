'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function createLocation(formData: FormData): Promise<void> {
  const organizationId = formData.get('organizationId') as string
  const name = (formData.get('name') as string)?.trim()
  const address = (formData.get('address') as string)?.trim() || null

  if (!organizationId || !name) {
    redirect('/app/settings/location?error=Location%20name%20is%20required')
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  const { data: loc, error } = await supabase
    .from('locations')
    .insert({
      organization_id: organizationId,
      name,
      address,
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
    metadata: { name },
  })

  redirect('/app/settings/location?success=Location%20created')
}
