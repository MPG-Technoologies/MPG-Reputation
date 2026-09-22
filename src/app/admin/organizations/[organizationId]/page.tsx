import { headers } from 'next/headers'
import { getOrganizationInspection } from '@/lib/support/organization-inspection'

// This project does not enable Cache Components. In its installed Next.js model,
// force-dynamic disables the shared route cache and forces no-store fetches.
export const dynamic = 'force-dynamic'

const destinationLabels = {
  CONFIRMED: 'Confirmed',
  PENDING_CONFIRMATION: 'Pending confirmation',
  INACTIVE: 'Inactive',
  NOT_CONFIGURED: 'Not configured',
}

export default async function OrganizationInspectionPage({ params }: {
  params: Promise<{ organizationId: string }>
}) {
  const requestHeaders = await headers()
  // Speculative requests must not retrieve a snapshot or create inspection audit.
  if (
    requestHeaders.has('next-router-prefetch') ||
    requestHeaders.has('next-router-segment-prefetch') ||
    /prefetch/i.test(requestHeaders.get('purpose') ?? '') ||
    /prefetch/i.test(requestHeaders.get('sec-purpose') ?? '')
  ) return <p>Open this page directly to inspect an organization.</p>

  const { organizationId } = await params
  const result = await getOrganizationInspection(organizationId)
  if (result.status === 'DENIED') {
    return <p role="alert">This inspection is not available to you.</p>
  }
  if (result.status === 'UNAVAILABLE') {
    return <p role="alert">Inspection is temporarily unavailable. No snapshot is displayed.</p>
  }

  const { organization, locations, truncated, snapshotAt } = result.snapshot
  return (
    <>
      <h1 className="text-2xl font-semibold">Organization inspection</h1>
      <dl className="mt-6 grid gap-4 rounded-lg border border-slate-800 p-5 sm:grid-cols-2">
        <div><dt className="text-sm text-slate-400">Organization</dt><dd>{organization.name}</dd></div>
        <div><dt className="text-sm text-slate-400">Status</dt><dd>{organization.status}</dd></div>
        <div><dt className="text-sm text-slate-400">Organization ID</dt><dd className="break-all font-mono text-sm">{organization.id}</dd></div>
        <div><dt className="text-sm text-slate-400">Snapshot (UTC)</dt><dd><time dateTime={snapshotAt}>{snapshotAt}</time></dd></div>
      </dl>
      <h2 className="mt-8 text-lg font-semibold">Locations</h2>
      <p className="mt-2 text-sm text-slate-400">Destination confirmation reflects the stored state, not overall automation readiness.</p>
      {truncated && <p className="mt-4 text-amber-300" role="status">Showing the first 50 locations by ID. More locations exist.</p>}
      {locations.length === 0 ? <p className="mt-4">No locations are configured.</p> : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Organization locations and stored review-destination confirmation</caption>
            <thead className="bg-slate-900 text-slate-300"><tr>
              <th scope="col" className="p-4">Location</th>
              <th scope="col" className="p-4">Location ID</th>
              <th scope="col" className="p-4">Status</th>
              <th scope="col" className="p-4">Destination confirmation</th>
            </tr></thead>
            <tbody>{locations.map((location) => <tr key={location.id} className="border-t border-slate-800">
              <th scope="row" className="p-4 font-medium">{location.name}</th>
              <td className="p-4 font-mono text-xs">{location.id}</td>
              <td className="p-4">{location.status}</td>
              <td className="p-4">{destinationLabels[location.destinationState]}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  )
}
