import { describe, expect, it } from 'vitest'
import {
  deriveActivationReadiness,
  deriveDashboardSystemStatus,
} from '../../src/domain/activation'

describe('MR-2 activation readiness', () => {
  it('blocks activation when there are no active locations', () => {
    const readiness = deriveActivationReadiness([], [])

    expect(readiness.ready).toBe(false)
    expect(readiness.activeLocationCount).toBe(0)
    expect(readiness.locationsNeedingDestinationCount).toBe(0)

    expect(
      deriveDashboardSystemStatus({
        readiness,
        failedCount: 0,
        outboxFailedCount: 0,
        sentCount: 0,
      }).systemStatus
    ).toBe('SETUP_REQUIRED')
  })

  it('requires a confirmed destination with a canonical URL', () => {
    const locations = [{ id: 'loc-1', status: 'ACTIVE' }]

    const pending = deriveActivationReadiness(locations, [
      {
        location_id: 'loc-1',
        status: 'PENDING_CONFIRMATION',
        canonical_url: 'https://g.page/r/test/review',
      },
    ])

    expect(pending.ready).toBe(false)
    expect(pending.locationsNeedingDestinationCount).toBe(1)

    const missingUrl = deriveActivationReadiness(locations, [
      {
        location_id: 'loc-1',
        status: 'CONFIRMED',
        canonical_url: '',
      },
    ])

    expect(missingUrl.ready).toBe(false)
  })

  it('marks an active location ready only after destination confirmation', () => {
    const readiness = deriveActivationReadiness(
      [{ id: 'loc-1', status: 'ACTIVE' }],
      [
        {
          location_id: 'loc-1',
          status: 'CONFIRMED',
          canonical_url: 'https://g.page/r/test/review',
        },
      ]
    )

    expect(readiness.ready).toBe(true)
    expect(readiness.readyLocationIds).toEqual(['loc-1'])
    expect(readiness.locationsNeedingDestinationCount).toBe(0)
  })

  it('does not make inactive locations block active-location readiness', () => {
    const readiness = deriveActivationReadiness(
      [
        { id: 'loc-active', status: 'ACTIVE' },
        { id: 'loc-inactive', status: 'INACTIVE' },
      ],
      [
        {
          location_id: 'loc-active',
          status: 'CONFIRMED',
          canonical_url: 'https://g.page/r/test/review',
        },
      ]
    )

    expect(readiness.ready).toBe(true)
    expect(readiness.inactiveLocationCount).toBe(1)
    expect(readiness.locationsNeedingDestinationCount).toBe(0)
  })

  it('separates activation readiness from operational failures', () => {
    const readiness = deriveActivationReadiness(
      [{ id: 'loc-1', status: 'ACTIVE' }],
      [
        {
          location_id: 'loc-1',
          status: 'CONFIRMED',
          canonical_url: 'https://g.page/r/test/review',
        },
      ]
    )

    expect(
      deriveDashboardSystemStatus({
        readiness,
        failedCount: 1,
        outboxFailedCount: 0,
        sentCount: 4,
      }).systemStatus
    ).toBe('NEEDS_ATTENTION')

    expect(
      deriveDashboardSystemStatus({
        readiness,
        failedCount: 0,
        outboxFailedCount: 0,
        sentCount: 0,
      }).systemStatus
    ).toBe('READY_FOR_SYNTHETIC_TEST')
  })
})
