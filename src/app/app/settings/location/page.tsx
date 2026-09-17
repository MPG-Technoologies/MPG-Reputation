import { createClient } from '@/lib/supabase/server'
import { createLocation } from '@/actions/locations'

export default async function LocationSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data: userOrgs } = await supabase
    .from('organization_users')
    .select('organization_id, role')
    .eq('user_id', user.id)

  const activeOrg = userOrgs?.[0]
  const orgId = activeOrg?.organization_id
  if (!orgId) return <div>No organization found.</div>

  const { data: locations } = await supabase
    .from('locations')
    .select('id, name, address, country, timezone, status, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Location Settings</h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage physical and operational locations for your business. Multi-location support is active.
        </p>
      </div>

      {/* Location List */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="text-base font-semibold text-white">Active Locations</h2>
        </div>
        <div className="divide-y divide-slate-800">
          {locations?.map((loc) => (
            <div key={loc.id} className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white text-base">{loc.name}</h3>
                  <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs px-2 py-0.5 rounded">
                    {loc.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{loc.address || 'No address specified'}</p>
                <span className="text-xs text-slate-500 mt-1 block">
                  {loc.country} • {loc.timezone}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add Location Form */}
      {['OWNER', 'ADMIN'].includes(activeOrg.role) && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <h2 className="text-base font-semibold text-white mb-4">Add New Location</h2>
          <form action={createLocation} className="space-y-4">
            <input type="hidden" name="organizationId" value={orgId} />
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-300">
                Location Name <span className="text-rose-400">*</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                placeholder="e.g. West End Branch"
                className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div>
              <label htmlFor="address" className="block text-sm font-medium text-slate-300">
                Address
              </label>
              <input
                id="address"
                name="address"
                type="text"
                placeholder="456 Secondary Blvd"
                className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <button
              type="submit"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              Add Location
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
