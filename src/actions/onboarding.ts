'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
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

  // Atomic server-side RPC (Prompt Correction 4)
  // Executes organization creation, owner membership, and primary location creation in a single transaction
  const { data: rawResult, error: rpcError } = await supabase.rpc('create_org_with_owner_and_location', {
    p_org_name: orgName,
    p_slug: slug,
    p_loc_name: locName,
    p_address: address,
  })

  const rpcResult = rawResult as { organization_id: string; location_id: string } | null

  if (rpcError || !rpcResult) {
    redirect(`/onboarding?error=${encodeURIComponent(rpcError?.message || 'Failed to initialize organization')}`)
  }

  const orgId = rpcResult.organization_id

  // Record audit event
  try {
    const adminClient = createAdminClient()
    await adminClient.from('audit_events').insert({
      organization_id: orgId,
      actor_type: 'user',
      actor_id: user.id,
      event_type: 'organization.created',
      entity_type: 'organization',
      entity_id: orgId,
      metadata: { name: orgName, slug, location_id: rpcResult.location_id },
    })
  } catch (auditErr) {
    console.error('Audit event record warning:', auditErr)
  }

  revalidatePath('/app', 'layout')
  revalidatePath('/app/settings/review-destination')
  revalidatePath('/onboarding')
  redirect('/app/settings/review-destination')
}
