import { headers } from 'next/headers'
import { getOrganizationInspection } from '@/lib/support/organization-inspection'
import {
  AdminEmpty, AdminFacts, AdminFailure, AdminNotice, AdminSection,
  AdminStatus, AdminTable, OrganizationHeader, adminStyles as ui,
} from '@/components/admin/admin-ui'

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
    return <AdminFailure>This inspection is not available to you.</AdminFailure>
  }
  if (result.status === 'UNAVAILABLE') {
    return <AdminFailure unavailable>Inspection is temporarily unavailable. No snapshot is displayed.</AdminFailure>
  }

  const { organization, locations, truncated, snapshotAt } = result.snapshot
  return (
    <>
      <OrganizationHeader organizationId={organizationId} active="inspection"
        title="Organization inspection" snapshotAt={snapshotAt} />
      <AdminFacts items={[
        { label: 'Organization', value: organization.name },
        { label: 'Status', value: <AdminStatus>{organization.status}</AdminStatus> },
        { label: 'Organization ID', value: <span className={ui.id}>{organization.id}</span> },
      ]} />
      <AdminSection title="Locations" description="Destination confirmation reflects the stored state, not overall automation readiness.">
        {truncated && <AdminNotice tone="warning">Showing the first 50 locations by ID. More locations exist.</AdminNotice>}
        {locations.length === 0 ? <AdminEmpty>No locations are configured.</AdminEmpty> : (
          <AdminTable caption="Organization locations and stored review-destination confirmation"
            headings={['Location', 'Location ID', 'Status', 'Destination confirmation']}>
            {locations.map((location) => <tr key={location.id}>
              <th scope="row">{location.name}</th>
              <td><span className={ui.id}>{location.id}</span></td>
              <td>{location.status}</td>
              <td><AdminStatus tone={location.destinationState === 'PENDING_CONFIRMATION' ? 'warning' : 'neutral'}>
                {destinationLabels[location.destinationState]}
              </AdminStatus></td>
            </tr>)}
          </AdminTable>
        )}
      </AdminSection>
    </>
  )
}
