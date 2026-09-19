import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { deriveActivationReadiness } from '@/domain/activation'
import { AppShell } from '@/components/ui/app-shell'
import { ModalProvider } from '@/components/ui/modal-system'
import { NavigationProvider } from './nav-context'
import { TopProgressBar } from './progress-bar'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Fetch user organizations and active organization in a single join query
  const { data: memberships } = await supabase
    .from('organization_users')
    .select('organization_id, role, organizations(id, name, slug)')
    .eq('user_id', user.id)

  if (!memberships || memberships.length === 0) {
    redirect('/onboarding')
  }

  // Active organization: default to first membership
  const activeMembership = memberships[0]
  const orgId = activeMembership.organization_id
  const orgData = activeMembership.organizations as { id: string; name: string; slug: string } | null
  const orgName = orgData?.name || 'My Business'

  // Parallelize notifications badge count and Quick Complete readiness queries
  const [{ count: failedRequestsCount }, { data: locations }, { data: destinations }] =
    await Promise.all([
      supabase
        .from('review_requests')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'FAILED'),
      supabase
        .from('locations')
        .select('id, name, status')
        .eq('organization_id', orgId),
      supabase
        .from('review_destinations')
        .select('location_id, status, canonical_url')
        .eq('organization_id', orgId),
    ])

  const readiness = deriveActivationReadiness(locations || [], destinations || [])
  const readyLocationIds = new Set(readiness.readyLocationIds)
  const readyLocations = (locations || [])
    .filter((loc) => readyLocationIds.has(loc.id))
    .map((loc) => ({ id: loc.id, name: loc.name }))

  return (
    <NavigationProvider>
      <TopProgressBar />
      <ModalProvider
        organizationId={orgId}
        readyLocations={readyLocations}
        isReady={readiness.ready}
      >
        <AppShell
          orgName={orgName}
          userRole={activeMembership.role}
          userEmail={user.email}
          attentionCount={failedRequestsCount ?? 0}
        >
          {children}
        </AppShell>
      </ModalProvider>
    </NavigationProvider>
  )
}
