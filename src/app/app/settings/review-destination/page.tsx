import { createClient } from '@/lib/supabase/server'
import { DestinationForm } from './form'

export default async function ReviewDestinationPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data: userOrgs } = await supabase
    .from('organization_users')
    .select('organization_id')
    .eq('user_id', user.id)

  const orgId = userOrgs?.[0]?.organization_id
  if (!orgId) return <div>No organization found.</div>

  const { data: locations } = await supabase
    .from('locations')
    .select('id, name')
    .eq('organization_id', orgId)
    .eq('status', 'ACTIVE')

  const { data: destinations } = await supabase
    .from('review_destinations')
    .select('id, location_id, url, canonical_url, status, confirmed_at')
    .eq('organization_id', orgId)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Google Review Destination</h1>
        <p className="text-sm text-slate-400 mt-1">
          Configure and confirm the official Google review destination URL for each location.
        </p>
      </div>

      <DestinationForm
        organizationId={orgId}
        locations={locations || []}
        destinations={destinations || []}
      />
    </div>
  )
}
