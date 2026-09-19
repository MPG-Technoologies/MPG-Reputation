import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { deriveActivationReadiness } from '@/domain/activation'
import { QuickCompleteForm } from './form'

export default async function QuickCompletePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: userOrgs } = await supabase
    .from('organization_users')
    .select('organization_id')
    .eq('user_id', user.id)

  const orgId = userOrgs?.[0]?.organization_id

  if (!orgId) {
    return <div>No organization found.</div>
  }

  const [{ data: locations }, { data: destinations }] =
    await Promise.all([
      supabase
        .from('locations')
        .select('id, name, status')
        .eq('organization_id', orgId),
      supabase
        .from('review_destinations')
        .select('location_id, status, canonical_url')
        .eq('organization_id', orgId),
    ])

  const readiness = deriveActivationReadiness(
    locations || [],
    destinations || []
  )

  const readyLocationIds = new Set(readiness.readyLocationIds)

  const readyLocations = (locations || [])
    .filter((location) => readyLocationIds.has(location.id))
    .map((location) => ({
      id: location.id,
      name: location.name,
    }))

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Quick Complete
        </h1>

        <p className="text-sm text-slate-400 mt-1">
          Record a genuine completed customer interaction to initiate the
          neutral review workflow.
        </p>
      </div>

      {!readiness.ready && readyLocations.length === 0 ? (
        <div className="bg-amber-950/40 border border-amber-800 p-6 rounded-lg space-y-3">
          <div className="text-sm font-semibold text-amber-200">
            Setup required before Quick Complete can run
          </div>

          <p className="text-sm text-amber-100/80">
            An active location must have a tested and confirmed Google review
            destination before a completion can enter the automation workflow.
          </p>

          <Link
            href={
              readiness.activeLocationCount === 0
                ? '/app/settings/location'
                : '/app/settings/review-destination'
            }
            className="inline-flex px-3 py-2 rounded-md text-sm font-medium bg-amber-900/70 hover:bg-amber-800 text-amber-100 border border-amber-700"
          >
            Complete setup →
          </Link>
        </div>
      ) : (
        <>
          {readiness.locationsNeedingDestinationCount > 0 && (
            <div className="bg-amber-950/30 border border-amber-900/60 p-4 rounded-lg text-xs text-amber-200">
              {readiness.locationsNeedingDestinationCount} active location(s)
              are hidden because their Google destination is not yet confirmed.
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 p-6 sm:p-8 rounded-lg shadow-xl">
            <QuickCompleteForm
              organizationId={orgId}
              locations={readyLocations}
            />
          </div>
        </>
      )}
    </div>
  )
}
