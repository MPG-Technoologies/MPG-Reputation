import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { deriveActivationReadiness } from '@/domain/activation'
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

  // Parallelize locations and destinations queries
  const [{ data: locations }, { data: destinations }] = await Promise.all([
    supabase
      .from('locations')
      .select('id, name, status')
      .eq('organization_id', orgId)
      .eq('status', 'ACTIVE'),
    supabase
      .from('review_destinations')
      .select('id, location_id, url, canonical_url, status, confirmed_at')
      .eq('organization_id', orgId),
  ])

  const readiness = deriveActivationReadiness(
    locations || [],
    destinations || []
  )

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-blue-400 mb-2">
          Setup · Step 2 of 2
        </div>

        <h1 className="text-2xl font-bold text-white tracking-tight">Google Review Destination</h1>
        <p className="text-sm text-slate-400 mt-1">
          Configure and confirm the official Google review destination URL for each location.
        </p>
      </div>

      {readiness.ready && (
        <div className="bg-emerald-950/40 border border-emerald-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-emerald-200">
              Customer activation setup complete
            </div>
            <p className="text-xs text-emerald-300/70 mt-1">
              Active locations have tested and confirmed Google destinations.
              Quick Complete is available for the local synthetic workflow.
            </p>
          </div>

          <Link
            href="/app/quick-complete"
            className="inline-flex shrink-0 justify-center py-2 px-3 rounded-md text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-600"
          >
            Open Quick Complete →
          </Link>
        </div>
      )}

      <DestinationForm
        organizationId={orgId}
        locations={locations || []}
        destinations={destinations || []}
      />
    </div>
  )
}
