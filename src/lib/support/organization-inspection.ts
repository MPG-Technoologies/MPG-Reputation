import 'server-only'

import type { Database } from '@/types/database'
import { authorizeSupportAccess } from './access'
import { recordSupportInspection } from './audit'

type Tables = Database['public']['Tables']

export interface OrganizationInspectionSnapshot {
  organization: Pick<Tables['organizations']['Row'], 'id' | 'name' | 'status'>
  locations: Array<Pick<Tables['locations']['Row'], 'id' | 'name' | 'status'> & {
    destinationState: Tables['review_destinations']['Row']['status'] | 'NOT_CONFIGURED'
  }>
  truncated: boolean
  snapshotAt: string
}

export type OrganizationInspectionResult =
  | { status: 'DENIED' }
  | { status: 'UNAVAILABLE' }
  | { status: 'AVAILABLE'; snapshot: OrganizationInspectionSnapshot }

export async function getOrganizationInspection(
  organizationId: string
): Promise<OrganizationInspectionResult> {
  const access = await authorizeSupportAccess(organizationId)
  if (!access) return { status: 'DENIED' }

  let snapshot: OrganizationInspectionSnapshot
  try {
    const { supabase, organizationId: target } = access
    const [organizationResult, locationResult] = await Promise.all([
      supabase.from('organizations').select('id, name, status').eq('id', target).maybeSingle(),
      supabase.from('locations').select('id, name, status')
        .eq('organization_id', target).order('id', { ascending: true }).limit(51),
    ])
    if (organizationResult.error || locationResult.error || !locationResult.data) {
      throw new Error('SUPPORT_READ_UNAVAILABLE')
    }
    if (!organizationResult.data) return { status: 'DENIED' }

    const locations = locationResult.data.slice(0, 50)
    const destinationStates = new Map<string, Tables['review_destinations']['Row']['status']>()
    if (locations.length > 0) {
      const { data: destinations, error } = await supabase
        .from('review_destinations')
        .select('location_id, status')
        .eq('organization_id', target)
        .eq('provider', 'google')
        .in('location_id', locations.map((location) => location.id))
        .limit(50)
      if (error || !destinations) throw new Error('SUPPORT_READ_UNAVAILABLE')
      for (const destination of destinations) {
        destinationStates.set(destination.location_id, destination.status)
      }
    }

    const organization = organizationResult.data
    snapshot = {
      organization: { id: organization.id, name: organization.name, status: organization.status },
      locations: locations.map((location) => ({
        id: location.id,
        name: location.name,
        status: location.status,
        destinationState: destinationStates.get(location.id) ?? 'NOT_CONFIGURED',
      })),
      truncated: locationResult.data.length > 50,
      snapshotAt: new Date().toISOString(),
    }
  } catch {
    await recordSupportInspection(access, 'UNAVAILABLE')
    return { status: 'UNAVAILABLE' }
  }

  // Recheck after reads as well, so authorization is not reused for a later request
  // or blindly retained throughout a slow inspection. No cross-request cache.
  const currentAccess = await authorizeSupportAccess(access.organizationId)
  if (!currentAccess || currentAccess.actorId !== access.actorId) return { status: 'DENIED' }
  if (!await recordSupportInspection(currentAccess, 'AVAILABLE')) return { status: 'UNAVAILABLE' }
  return { status: 'AVAILABLE', snapshot }
}
