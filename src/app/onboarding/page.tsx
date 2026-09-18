import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createOrganizationAndLocation } from '@/actions/onboarding'

export default async function OnboardingPage(props: {
  searchParams: Promise<{ error?: string }>
}) {
  const searchParams = await props.searchParams
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login')
  }

  // Check if user already has an organization
  const { data: memberships } = await supabase
    .from('organization_users')
    .select('organization_id')
    .eq('user_id', user.id)

  const hasExistingOrg = memberships && memberships.length > 0

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="text-center text-3xl font-bold tracking-tight text-white">
          Welcome to MPG Reputation
        </h2>
        <p className="mt-2 text-center text-sm text-slate-400">
          Set up your business organization and primary location to start.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 py-8 px-6 shadow-xl border border-slate-800 sm:rounded-lg sm:px-10 space-y-6">
          {hasExistingOrg && (
            <div className="p-3 rounded-md bg-blue-950/40 border border-blue-800 text-blue-200 text-sm flex items-center justify-between">
              <span>Active organization already exists.</span>
              <Link
                href="/app/dashboard"
                className="font-medium underline hover:text-white transition-colors text-xs"
              >
                Go to Dashboard →
              </Link>
            </div>
          )}

          {searchParams.error && (
            <div
              role="alert"
              className="p-3 rounded-md bg-rose-950/50 border border-rose-800 text-rose-200 text-sm flex items-start gap-2"
            >
              <span className="text-rose-400 font-bold">✕</span>
              <div>
                <strong className="font-semibold">Setup Error: </strong>
                {searchParams.error}
              </div>
            </div>
          )}

          <form action={createOrganizationAndLocation} className="space-y-6">
            <div>
              <label htmlFor="orgName" className="block text-sm font-medium text-slate-300">
                Organization / Business Name
              </label>
              <div className="mt-1">
                <input
                  id="orgName"
                  name="orgName"
                  type="text"
                  required
                  placeholder="e.g. Northstar Dental"
                  className="appearance-none block w-full px-3 py-2 border border-slate-700 rounded-md shadow-sm bg-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="locName" className="block text-sm font-medium text-slate-300">
                Primary Location Name
              </label>
              <div className="mt-1">
                <input
                  id="locName"
                  name="locName"
                  type="text"
                  required
                  placeholder="e.g. Main Clinic"
                  className="appearance-none block w-full px-3 py-2 border border-slate-700 rounded-md shadow-sm bg-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="address" className="block text-sm font-medium text-slate-300">
                Location Address (optional)
              </label>
              <div className="mt-1">
                <input
                  id="address"
                  name="address"
                  type="text"
                  placeholder="123 Example Street, Suite 100"
                  className="appearance-none block w-full px-3 py-2 border border-slate-700 rounded-md shadow-sm bg-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent sm:text-sm"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors cursor-pointer"
              >
                Continue to Review Setup
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
