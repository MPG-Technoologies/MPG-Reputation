import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getOrganizationUsageSummary } from '@/actions/usage'
import { UsageClient } from './client'
import { PageShell, PageHeader } from '@/components/layout/page-shell'
import { ChartBarIcon } from '@/components/ui/icons'
import { selectSingleUsageMembership } from '@/domain/workspace/single-usage-membership'

export default async function UsageSettingsPage() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user || user.is_anonymous) redirect('/login')

  const { data: userOrgs, error: membershipsError } = await supabase
    .from('organization_users')
    .select('organization_id, role')
    .eq('user_id', user.id)

  // The app shell currently defaults to first membership; Usage & Trial
  // must not show another business's entitlement or usage by accident.
  // No query param, browser state or unverified selector is accepted here.
  const selection = selectSingleUsageMembership(membershipsError ? null :
    userOrgs?.map(membership => ({
      organizationId: membership.organization_id,
      role: membership.role,
    })))

  if (selection.outcome !== 'SELECTED') {
    const message = selection.outcome === 'AMBIGUOUS_ORGANIZATION'
      ? 'Multiple businesses detected. Usage & Trial is unavailable until secure business selection is supported.'
      : selection.outcome === 'NO_MEMBERSHIP'
        ? 'No business membership found. Complete onboarding before reviewing usage.'
        : 'Usage organization could not be verified. No usage or trial details were accessed.'
    return (
      <PageShell>
        <PageHeader title="Usage & Trial" subtitle="Business-specific usage and trial information." />
        <div role="alert" className="p-8 text-center text-amber-200">{message}</div>
        {selection.outcome === 'AMBIGUOUS_ORGANIZATION' && (
          <Link href="/workspace/organizations"
            className="mx-8 text-sm text-blue-300 hover:text-white underline">
            Choose a business
          </Link>
        )}
      </PageShell>
    )
  }

  const orgId = selection.organizationId
  const userRole = selection.role
  const usageRes = await getOrganizationUsageSummary(orgId)
  if (!usageRes.success || !usageRes.data || usageRes.data.organizationId !== orgId) {
    return (
      <PageShell>
        <PageHeader title="Usage & Trial" subtitle="Business-specific usage and trial information." />
        <div role="alert" className="p-8 text-center text-amber-200">
          Usage details could not be verified. No trial actions are available.
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <ChartBarIcon className="w-5 h-5 text-blue-400" />
            <span>Usage &amp; Trial</span>
          </span>
        }
        subtitle="Server-authoritative entitlement status and factual messaging usage accounting."
      />

      <div className="w-full flex-1 flex flex-col min-w-0">
        <UsageClient
          organizationId={orgId}
          userRole={userRole}
          initialUsage={usageRes.data}
        />
      </div>
    </PageShell>
  )
}
