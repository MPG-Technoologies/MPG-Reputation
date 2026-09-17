import { createClient } from '@/lib/supabase/server'
import { QuickCompleteForm } from './form'

export default async function QuickCompletePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data: userOrgs } = await supabase
    .from('organization_users')
    .select('organization_id')
    .eq('user_id', user.id)

  const orgId = userOrgs?.[0]?.organization_id
  if (!orgId) return <div>No organization found.</div>

  const { data: locations } = await supabase
    .from('locations')
    .select('id, name')
    .eq('organization_id', orgId)
    .eq('status', 'ACTIVE')

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Quick Complete</h1>
        <p className="text-sm text-slate-400 mt-1">
          Record a genuine completed customer interaction to initiate the neutral review workflow.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 p-6 sm:p-8 rounded-lg shadow-xl">
        <QuickCompleteForm
          organizationId={orgId}
          locations={locations || []}
        />
      </div>
    </div>
  )
}
