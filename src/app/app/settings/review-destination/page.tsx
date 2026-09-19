import { createClient } from '@/lib/supabase/server'
import { deriveActivationReadiness } from '@/domain/activation'
import { PageShell, PageHeader } from '@/components/layout/page-shell'
import { DestinationReadyBanner } from './ready-banner'
import { DestinationForm } from './form'
import { LinkIcon } from '@/components/ui/icons'

export default async function ReviewDestinationPage() {
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
    return (
      <PageShell>
        <div className="p-8 text-center text-slate-400">No organization found.</div>
      </PageShell>
    )
  }

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
    <PageShell>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <LinkIcon className="w-5 h-5 text-blue-400" />
            <span>Google Review Destination</span>
          </span>
        }
        subtitle="Configure and explicitly confirm the official Google review destination URL for each active location."
      />

      {/* Focused Form Container (max-w-3xl) to maintain optimal readability */}
      <div className="max-w-3xl space-y-6">
        {readiness.ready && <DestinationReadyBanner />}

        <DestinationForm
          organizationId={orgId}
          locations={locations || []}
          destinations={destinations || []}
        />
      </div>
    </PageShell>
  )
}
