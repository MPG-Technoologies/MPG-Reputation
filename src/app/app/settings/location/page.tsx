import { createClient } from '@/lib/supabase/server'
import { createLocation } from '@/actions/locations'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageShell, PageHeader } from '@/components/layout/page-shell'
import { Panel, PanelHeader } from '@/components/layout/panels'
import { MapPinIcon } from '@/components/ui/icons'
import { DataLoadError } from '@/components/ui/data-load-error'

import { LocationItem } from './location-item'

export default async function LocationSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: userOrgs, error: membershipError } = await supabase
    .from('organization_users')
    .select('organization_id, role')
    .eq('user_id', user.id)

  if (membershipError) {
    return <PageShell><DataLoadError title="Locations could not be loaded" /></PageShell>
  }

  const activeOrg = userOrgs?.[0]
  const orgId = activeOrg?.organization_id
  if (!orgId) {
    return (
      <PageShell>
        <div className="p-8 text-center text-slate-400">No active organization found.</div>
      </PageShell>
    )
  }

  const { data: locations, error: locationsError } = await supabase
    .from('locations')
    .select('id, name, address, country, timezone, status, review_reply_to_email, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  if (locationsError || !locations) {
    return <PageShell><DataLoadError title="Locations could not be loaded" /></PageShell>
  }

  const canManage = ['OWNER', 'ADMIN'].includes(activeOrg.role)

  return (
    <PageShell>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <MapPinIcon className="w-5 h-5 text-blue-400" />
            <span>Locations</span>
          </span>
        }
        subtitle="Manage physical and operational locations for your business. Multi-location review collection is supported."
      />

      <div
        className={`grid grid-cols-1 ${
          canManage ? 'lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]' : ''
        } gap-6 items-start`}
      >
        {/* Active Locations List */}
        <Panel className="min-w-0">
          <PanelHeader
            title="Active Locations"
            subtitle={`${locations.length} configured location(s)`}
          />
          <div className="divide-y divide-[#1C2846]/70">
            {locations.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No locations configured yet. Add your first location to activate review workflows.
              </div>
            ) : (
              locations.map((loc) => (
                <LocationItem
                  key={loc.id}
                  organizationId={orgId}
                  location={loc}
                  canManage={canManage}
                />
              ))
            )}
          </div>
        </Panel>

        {/* Add Location Form (Focused container, ~380-420px) */}
        {canManage && (
          <Panel className="min-w-0">
            <PanelHeader
              title="Add New Location"
              subtitle="Register another operational business site"
            />
            <form action={createLocation} className="p-5 space-y-4 text-xs">
              <input type="hidden" name="organizationId" value={orgId} />

              <div>
                <label htmlFor="name" className="block font-medium text-slate-300">
                  Location Name <span className="text-rose-400">*</span>
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  placeholder="e.g. West End Branch"
                  className="mt-1 block w-full px-3 py-2 bg-[#0A1020] border border-[#1C2846] text-white rounded-lg placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors text-xs"
                />
              </div>

              <div>
                <label htmlFor="address" className="block font-medium text-slate-300">
                  Business Mailing Address
                </label>
                <input
                  id="address"
                  name="address"
                  type="text"
                  maxLength={300}
                  placeholder="456 Secondary Blvd, Suite 100, City, ST 12345"
                  className="mt-1 block w-full px-3 py-2 bg-[#0A1020] border border-[#1C2846] text-white rounded-lg placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors text-xs"
                />
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Used in review-request email footers. Enter the complete business mailing address for this location. Required before live review emails can be sent.
                </p>
              </div>

              <div>
                <label htmlFor="reviewReplyToEmail" className="block font-medium text-slate-300">
                  Review Request Reply-To Email{' '}
                  <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <input
                  id="reviewReplyToEmail"
                  name="reviewReplyToEmail"
                  type="email"
                  placeholder="reviews@business.com"
                  className="mt-1 block w-full px-3 py-2 bg-[#0A1020] border border-[#1C2846] text-white rounded-lg placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors text-xs font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Customer email replies will be directed here. If omitted, no Reply-To header is set.
                </p>
              </div>

              <div className="pt-2">
                <SubmitButton
                  pendingText="Adding location..."
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg shadow-sm shadow-blue-900/30 text-xs transition-colors"
                >
                  Add Location
                </SubmitButton>
              </div>
            </form>
          </Panel>
        )}
      </div>
    </PageShell>
  )
}
