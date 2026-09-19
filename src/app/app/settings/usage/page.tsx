import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOrganizationUsageSummary } from '@/actions/usage'
import { UsageClient } from './client'

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
    return <div>No organization found.</div>
  }

  const usageRes = await getOrganizationUsageSummary(orgId)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Usage &amp; Trial
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Server-authoritative entitlement status and factual messaging usage accounting.
        </p>
      </div>

      <UsageClient
        organizationId={orgId}
        userRole={userRole}
        initialUsage={usageRes.data || null}
      />
    </div>
  )
}
