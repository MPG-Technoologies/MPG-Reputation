import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { deriveActivationReadiness } from '@/domain/activation'
import { deriveTrialLifecycle, type TrialStatus } from '@/domain/entitlement'
import { PageShell, PageHeader } from '@/components/layout/page-shell'
import { DestinationReadyBanner } from './ready-banner'
import { DestinationForm } from './form'
import { LinkIcon } from '@/components/ui/icons'
import { DataLoadError } from '@/components/ui/data-load-error'
import { resolveOperationalPageContext } from '@/domain/workspace/operational-page-context'

export default async function ReviewDestinationPage() {
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
      ? 'Multiple business memberships detected. Review-link setup needs a verified business context; business switching is not yet available.'
      : context.outcome === 'NO_MEMBERSHIP'
        ? 'No business workspace found. Complete onboarding to configure a review link.'
        : 'Your business membership could not be verified. Review-link settings were not accessed.'
    return (
      <PageShell>
        <PageHeader title="Google Review Destination" subtitle="Configure your business review link." />
        <div role="alert" className="rounded-xl border border-amber-800 bg-amber-950/30 p-5 text-sm text-amber-100">
          <p>{message}</p>
          {context.outcome === 'NO_MEMBERSHIP' && (
            <Link href="/onboarding" className="mt-3 inline-block font-semibold underline">Start onboarding</Link>
          )}
        </div>
      </PageShell>
    )
  }

  const orgId = context.organizationId

  // Parallelize locations and destinations queries
  const [{ data: locations, error: locationsError }, { data: destinations, error: destinationsError }] = await Promise.all([
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

  if (locationsError || destinationsError || !locations || !destinations) {
    return <PageShell><DataLoadError title="Review destination setup could not be loaded" /></PageShell>
  }

  const readiness = deriveActivationReadiness(
    locations || [],
    destinations || []
  )

  // Google destination readiness and review-request entitlement are separate.
  // Query only when ready; failed reads must never imply that the trial is active.
  const trialResult = readiness.ready
    ? await supabase
        .from('organization_entitlements')
        .select('status, allocated_requests, consumed_requests, expires_at')
        .eq('organization_id', orgId)
        .maybeSingle()
    : null

  const trialStatus: TrialStatus | 'UNKNOWN' =
    !trialResult || trialResult.error
      ? 'UNKNOWN'
      : deriveTrialLifecycle(trialResult.data).effectiveStatus

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
        {readiness.ready ? (
          <DestinationReadyBanner trialStatus={trialStatus} />
        ) : (
          <section
            aria-labelledby="google-link-setup-title"
            className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-5 space-y-3"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              Setup · Step 2 of 2
            </p>
            <h2 id="google-link-setup-title" className="text-lg font-semibold text-white">
              Add and confirm your Google review link
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              Every active location needs its own confirmed Google review link.
              Until that link is saved, tested, and confirmed, the location cannot
              send automated review requests.
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-300">
              <li>Get the review link for the correct business location using the guide below.</li>
              <li>Paste it into the form and select Save Destination.</li>
              <li>Select Test Link, check the Google page opens for the right location, then confirm the saved link.</li>
            </ol>
          </section>
        )}

        <section
          aria-labelledby="find-google-review-link-title"
          className="rounded-xl border border-[#1C2846] bg-[#0E172B] p-5 space-y-3"
        >
          <h2 id="find-google-review-link-title" className="text-base font-semibold text-white">
            Don&apos;t have your Google review link?
          </h2>
          <ol className="list-decimal pl-5 space-y-2 text-sm leading-relaxed text-slate-300">
            <li>Sign in to the Google account that manages your Google Business Profile.</li>
            <li>Open the correct business location on Google Search or Maps. Select Read reviews, then Get more reviews (sometimes shown as Ask for reviews).</li>
            <li>Choose Copy link, return here, and paste the link into the Google Review URL field below.</li>
          </ol>
          <p className="text-xs text-slate-400">
            Use the link for this specific location, not a general Google search or your Google account sign-in page.
            If you don&apos;t see the review-link option, check that you&apos;re managing the correct Business Profile.
          </p>
          <div className="flex flex-wrap gap-4 text-xs font-medium">
            <a
              href="https://business.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-300 underline underline-offset-4 hover:text-blue-200"
            >
              Open Google Business Profile ↗
            </a>
            <a
              href="https://support.google.com/business/answer/16816815?hl=en"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-300 underline underline-offset-4 hover:text-blue-200"
            >
              Google&apos;s official link instructions ↗
            </a>
          </div>
        </section>

        {context.canEdit ? (
          <DestinationForm
            organizationId={orgId}
            locations={locations}
            destinations={destinations}
          />
        ) : (
          <div role="status" className="rounded-xl border border-slate-700 bg-slate-900/50 p-5 text-sm text-slate-300">
            Your workspace role is VIEWER (read-only). An owner, administrator or operator must configure and confirm the business review link.
          </div>
        )}
      </div>
    </PageShell>
  )
}
