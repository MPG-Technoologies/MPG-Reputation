export interface ActivationLocation {
  id: string
  status: string
}

export interface ActivationDestination {
  location_id: string
  status: string
  canonical_url?: string | null
}

export interface SetupChecklistItem {
  id: string
  label: string
  complete: boolean
  description: string
}

export interface ActivationReadiness {
  ready: boolean
  activeLocationCount: number
  inactiveLocationCount: number
  locationsNeedingDestinationCount: number
  readyLocationIds: string[]
  checklist: SetupChecklistItem[]
}

export type ActivationSystemStatus =
  | 'SETUP_REQUIRED'
  | 'READY_FOR_SYNTHETIC_TEST'
  | 'RUNNING'
  | 'NEEDS_ATTENTION'

export function deriveActivationReadiness(
  locations: ActivationLocation[],
  destinations: ActivationDestination[]
): ActivationReadiness {
  const activeLocations = locations.filter(
    (location) => location.status === 'ACTIVE'
  )

  const inactiveLocationCount =
    locations.length - activeLocations.length

  const confirmedLocationIds = new Set(
    destinations
      .filter(
        (destination) =>
          destination.status === 'CONFIRMED' &&
          Boolean(destination.canonical_url?.trim())
      )
      .map((destination) => destination.location_id)
  )

  const readyLocationIds = activeLocations
    .filter((location) => confirmedLocationIds.has(location.id))
    .map((location) => location.id)

  const locationsNeedingDestinationCount =
    activeLocations.length - readyLocationIds.length

  const hasActiveLocation = activeLocations.length > 0
  const allActiveLocationsConfirmed =
    hasActiveLocation && locationsNeedingDestinationCount === 0

  const ready =
    hasActiveLocation &&
    allActiveLocationsConfirmed

  return {
    ready,
    activeLocationCount: activeLocations.length,
    inactiveLocationCount,
    locationsNeedingDestinationCount,
    readyLocationIds,
    checklist: [
      {
        id: 'active-location',
        label: 'Active location configured',
        complete: hasActiveLocation,
        description: hasActiveLocation
          ? `${activeLocations.length} active location(s) available.`
          : 'Create or activate at least one business location.',
      },
      {
        id: 'confirmed-destination',
        label: 'Google review destination confirmed',
        complete: allActiveLocationsConfirmed,
        description: allActiveLocationsConfirmed
          ? 'Every active location has a confirmed Google review destination.'
          : hasActiveLocation
            ? `${locationsNeedingDestinationCount} active location(s) still require confirmation.`
            : 'A review destination can be activated after a location exists.',
      },
      {
        id: 'activation-gate',
        label: 'Local automation activation gate',
        complete: ready,
        description: ready
          ? 'Configured locations are eligible for the local review workflow.'
          : 'Automation remains blocked until required setup is complete.',
      },
    ],
  }
}

export function deriveDashboardSystemStatus({
  readiness,
  failedCount,
  outboxFailedCount,
  sentCount,
}: {
  readiness: ActivationReadiness
  failedCount: number
  outboxFailedCount: number
  sentCount: number
}): {
  systemStatus: ActivationSystemStatus
  statusDescription: string
} {
  if (readiness.activeLocationCount === 0) {
    return {
      systemStatus: 'SETUP_REQUIRED',
      statusDescription:
        'Initial setup required: No active locations are configured.',
    }
  }

  if (readiness.locationsNeedingDestinationCount > 0) {
    return {
      systemStatus: 'SETUP_REQUIRED',
      statusDescription:
        `${readiness.locationsNeedingDestinationCount} active location(s) require a confirmed Google review destination.`,
    }
  }

  if (failedCount > 0 || outboxFailedCount > 0) {
    return {
      systemStatus: 'NEEDS_ATTENTION',
      statusDescription:
        'Operational issues detected in recent dispatches or background events.',
    }
  }

  if (sentCount === 0) {
    return {
      systemStatus: 'READY_FOR_SYNTHETIC_TEST',
      statusDescription:
        'Local activation requirements are complete. Ready for synthetic validation.',
    }
  }

  return {
    systemStatus: 'RUNNING',
    statusDescription:
      'Review request workflow actively processing completions.',
  }
}
