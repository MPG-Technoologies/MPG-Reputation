import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOrganizationUsageSummary } from '@/actions/usage'
import { UsageClient } from './client'
import { PageShell, PageHeader } from '@/components/layout/page-shell'
import { ChartBarIcon } from '@/components/ui/icons'

export default async function UsageSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: userOrgs } = await supabase
    .from('organization_users')
    .select('organization_id, role')
    .eq('user_id', user.id)

  const activeOrg = userOrgs?.[0]
  const orgId = activeOrg?.organization_id
  const userRole = activeOrg?.role || 'VIEWER'

  if (!orgId) {
    return (
      <PageShell>
        <div className="p-8 text-center text-slate-400">No organization found.</div>
      </PageShell>
    )
  }

  const usageRes = await getOrganizationUsageSummary(orgId)

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
          initialUsage={usageRes.data || null}
        />
      </div>
    </PageShell>
  )
}
