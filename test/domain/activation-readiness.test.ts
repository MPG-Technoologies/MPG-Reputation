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

  it('fails closed when a confirmed destination contains an invalid Google URL', () => {
    const readiness = deriveActivationReadiness(
      [{ id: 'loc-1', status: 'ACTIVE' }],
      [
        {
          location_id: 'loc-1',
          status: 'CONFIRMED',
          canonical_url: 'https://evil.example/review',
        },
      ]
    )

    expect(readiness.ready).toBe(false)
    expect(readiness.readyLocationIds).toEqual([])
    expect(readiness.locationsNeedingDestinationCount).toBe(1)

    expect(
      readiness.checklist.find(
        (item) => item.id === 'destination-saved'
      )?.complete
    ).toBe(false)

    expect(
      readiness.checklist.find(
        (item) => item.id === 'destination-tested'
      )?.complete
    ).toBe(false)
  })

  it('accepts a confirmed destination only when the canonical Google URL is valid', () => {
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

  it('exposes the complete MR-2 activation checklist', () => {
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

    expect(readiness.checklist.map((item) => item.id)).toEqual([
      'organization-created',
      'active-location',
      'destination-saved',
      'destination-tested',
      'activation-gate',
    ])

    expect(
      readiness.checklist.every((item) => item.complete)
    ).toBe(true)
  })

  it('keeps test/confirmation and automation incomplete for a pending destination', () => {
    const readiness = deriveActivationReadiness(
      [{ id: 'loc-1', status: 'ACTIVE' }],
      [
        {
          location_id: 'loc-1',
          status: 'PENDING_CONFIRMATION',
          canonical_url: 'https://g.page/r/test/review',
        },
      ]
    )

    expect(
      readiness.checklist.find(
        (item) => item.id === 'destination-saved'
      )?.complete
    ).toBe(true)

    expect(
      readiness.checklist.find(
        (item) => item.id === 'destination-tested'
      )?.complete
    ).toBe(false)

    expect(
      readiness.checklist.find(
        (item) => item.id === 'activation-gate'
      )?.complete
    ).toBe(false)
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
