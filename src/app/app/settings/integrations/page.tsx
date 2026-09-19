import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  listCompletionCredentials,
  listIngestionLogs,
} from '@/actions/completion-credentials'
import { IntegrationsClient } from './client'
import { PageShell, PageHeader } from '@/components/layout/page-shell'
import { CodeIcon } from '@/components/ui/icons'

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
    return (
      <PageShell>
        <div className="p-8 text-center text-slate-400">No organization found.</div>
      </PageShell>
    )
  }

  const [credentials, logs] = await Promise.all([
    listCompletionCredentials(orgId),
    listIngestionLogs(orgId, 50),
  ])

  return (
    <PageShell>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <CodeIcon className="w-5 h-5 text-blue-400" />
            <span>API &amp; Webhooks</span>
          </span>
        }
        subtitle="Manage secure API credentials, audit ingestion history, and connect external completion sources."
      />

      <div className="w-full flex-1 flex flex-col min-w-0">
        <IntegrationsClient
          organizationId={orgId}
          initialCredentials={credentials}
          initialLogs={logs}
          userRole={userRole}
        />
      </div>
    </PageShell>
  )
}
