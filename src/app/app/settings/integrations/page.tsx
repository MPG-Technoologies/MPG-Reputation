import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  listCompletionCredentials,
  listIngestionLogs,
} from '@/actions/completion-credentials'
import { IntegrationsClient } from './client'

export default async function IntegrationsPage() {
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

  const [credentials, logs] = await Promise.all([
    listCompletionCredentials(orgId),
    listIngestionLogs(orgId, 50),
  ])

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          API &amp; Webhooks
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage API credentials, inspect external completion logs, and integrate your CRM or booking software.
        </p>
      </div>

      <IntegrationsClient
        organizationId={orgId}
        initialCredentials={credentials}
        initialLogs={logs}
        userRole={userRole}
      />
    </div>
  )
}
