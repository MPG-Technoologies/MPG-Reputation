import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { deriveActivationReadiness } from '@/domain/activation'
import { QuickCompleteForm } from './form'
import { PageShell, PageHeader } from '@/components/layout/page-shell'
import { Panel } from '@/components/layout/panels'
import { PlusCircleIcon } from '@/components/ui/icons'
import { DataLoadError } from '@/components/ui/data-load-error'
import { resolveOperationalPageContext } from '@/domain/workspace/operational-page-context'

export default async function QuickCompletePage() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user || user.is_anonymous) redirect('/login')

  const { data: userOrgs, error: membershipsError } = await supabase
    .from('organization_users')
    .select('organization_id, role')
    .eq('user_id', user.id)

  const context = resolveOperationalPageContext(membershipsError ? null : userOrgs)
  if (context.outcome !== 'SELECTED') {
    const message = context.outcome === 'MULTIPLE_BUSINESSES'
      ? 'Multiple business memberships detected. Recording a completion requires a verified business context; business switching is not yet available.'
      : context.outcome === 'NO_MEMBERSHIP'
        ? 'No business workspace found. Complete onboarding to record your first completion.'
        : 'Your business membership could not be verified. No customer or review-request data was accessed.'
    return (
      <PageShell>
        <PageHeader title="Quick Complete" subtitle="Record a genuine completed service." />
        <div role="alert" className="rounded-xl border border-amber-800 bg-amber-950/30 p-5 text-sm text-amber-100">
          <p>{message}</p>
          {context.outcome === 'NO_MEMBERSHIP' && (
            <Link href="/onboarding" className="mt-3 inline-block font-semibold underline">Start onboarding</Link>
          )}
        </div>
      </PageShell>
    )
  }

  if (!context.canEdit) {
    return (
      <PageShell>
        <PageHeader title="Quick Complete" subtitle="Record a genuine completed service." />
        <div role="alert" className="rounded-xl border border-amber-800 bg-amber-950/30 p-5 text-sm text-amber-100">
          Your workspace role is VIEWER (read-only). Ask a business owner or administrator for operational access to record completions.
        </div>
      </PageShell>
    )
  }

  const orgId = context.organizationId

  const [{ data: locations, error: locationsError }, { data: destinations, error: destinationsError }] = await Promise.all([
    supabase
      .from('locations')
      .select('id, name, status')
      .eq('organization_id', orgId),
    supabase
      .from('review_destinations')
      .select('location_id, status, canonical_url')
      .eq('organization_id', orgId),
  ])

  if (locationsError || destinationsError || !locations || !destinations) {
    return <PageShell><DataLoadError title="Quick Complete setup status could not be loaded" /></PageShell>
  }

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
    <PageShell>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <PlusCircleIcon className="w-5 h-5 text-blue-400" />
            <span>Quick Complete</span>
          </span>
        }
        subtitle="Record a genuine completed customer interaction to initiate the neutral review workflow."
      />

      {/* Focused Form Container (max-w-2xl) */}
      <div className="max-w-2xl space-y-6">
        {!readiness.ready && readyLocations.length === 0 ? (
          <div className="bg-amber-950/40 border border-amber-800 p-6 rounded-xl space-y-3">
            <div className="text-sm font-semibold text-amber-200">
              Setup required before Quick Complete can run
            </div>

            <p className="text-xs sm:text-sm text-amber-100/80 leading-relaxed">
              An active location must have a tested and confirmed Google review destination before a
              completion can enter the automation workflow.
            </p>

            <Link
              href={
                readiness.activeLocationCount === 0
                  ? '/app/settings/location'
                  : '/app/settings/review-destination'
              }
              className="inline-flex px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-colors"
            >
              Complete setup →
            </Link>
          </div>
        ) : (
          <>
            {readiness.locationsNeedingDestinationCount > 0 && (
              <div className="bg-amber-950/30 border border-amber-900/60 p-4 rounded-xl text-xs text-amber-200">
                {readiness.locationsNeedingDestinationCount} active location(s) are hidden because
                their Google destination is not yet confirmed.
              </div>
            )}

            <Panel className="p-6 sm:p-8">
              <QuickCompleteForm organizationId={orgId} locations={readyLocations} />
            </Panel>
          </>
        )}
      </div>
    </PageShell>
  )
}
