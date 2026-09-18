import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/actions/auth'
import { AppNav } from './nav'
import { NavigationProvider } from './nav-context'
import { TopProgressBar } from './progress-bar'
import { SubmitButton } from '@/components/ui/submit-button'

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
  const orgData = activeMembership.organizations as { id: string; name: string; slug: string } | null
  const orgName = orgData?.name || 'My Business'

  return (
    <NavigationProvider>
      <TopProgressBar />
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <header className="border-b border-slate-800 bg-slate-900 sticky top-0 z-20">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-8">
              <Link href="/app/dashboard" className="flex items-center gap-2">
                <span className="font-bold text-lg text-white bg-blue-600 px-2 py-0.5 rounded">
                  MPG
                </span>
                <span className="font-semibold text-slate-200">Reputation</span>
              </Link>

              <AppNav />
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden sm:flex flex-col text-right text-xs">
                <span className="font-medium text-slate-200">{orgName}</span>
                <span className="text-slate-400 capitalize">{activeMembership.role.toLowerCase()}</span>
              </div>
              <form action={signOut}>
                <SubmitButton
                  pendingText="Signing out…"
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded border border-slate-700 cursor-pointer"
                >
                  Sign Out
                </SubmitButton>
              </form>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        <footer className="border-t border-slate-900 bg-slate-950 py-4 text-center text-xs text-slate-500">
          MPG Reputation V0.2 — Controlled Staging &amp; Founder Experience — Synthetic Test Data Only
        </footer>
      </div>
    </NavigationProvider>
  )
}
