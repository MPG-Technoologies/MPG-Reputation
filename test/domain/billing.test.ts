import { describe, expect, it } from 'vitest'
import {
  classifyProviderStateFreshness,
  isBillingNormalizedStatus,
  isBillingWebhookProcessingStatus,
  isTerminalBillingStatus,
} from '../../src/domain/billing'

describe('MR-5B Billing Persistence Domain', () => {
  it('recognizes the bounded normalized billing states', () => {
    expect(isBillingNormalizedStatus('PENDING')).toBe(true)
    expect(isBillingNormalizedStatus('ACTIVE')).toBe(true)
    expect(isBillingNormalizedStatus('GRACE')).toBe(true)
    expect(isBillingNormalizedStatus('SUSPENDED')).toBe(true)
    expect(isBillingNormalizedStatus('ENDED')).toBe(true)
    expect(isBillingNormalizedStatus('TRIALING')).toBe(false)
    expect(isBillingNormalizedStatus('PAST_DUE')).toBe(false)
  })

  it('recognizes webhook processing states without provider coupling', () => {
    expect(isBillingWebhookProcessingStatus('RECEIVED')).toBe(true)
    expect(isBillingWebhookProcessingStatus('PROCESSING')).toBe(true)
    expect(isBillingWebhookProcessingStatus('PROCESSED')).toBe(true)
    expect(isBillingWebhookProcessingStatus('IGNORED')).toBe(true)
    expect(isBillingWebhookProcessingStatus('FAILED')).toBe(true)
    expect(isBillingWebhookProcessingStatus('SUCCEEDED')).toBe(false)
  })

  it('classifies newer provider state', () => {
    expect(
      classifyProviderStateFreshness(
        '2026-09-21T10:00:00.000Z',
        '2026-09-21T10:01:00.000Z'
      )
    ).toBe('NEWER')
  })

  it('classifies older provider state', () => {
    expect(
      classifyProviderStateFreshness(
        '2026-09-21T10:01:00.000Z',
        '2026-09-21T10:00:00.000Z'
      )
    ).toBe('OLDER')
  })

  it('classifies identical timestamps as SAME', () => {
    expect(
      classifyProviderStateFreshness(
        '2026-09-21T10:00:00.000Z',
        '2026-09-21T10:00:00.000Z'
      )
    ).toBe('SAME')
  })

  it('returns UNKNOWN when timestamp ordering cannot be established safely', () => {
    expect(classifyProviderStateFreshness(null, null)).toBe('UNKNOWN')
    expect(
      classifyProviderStateFreshness(
        '2026-09-21T10:00:00.000Z',
        null
      )
    ).toBe('UNKNOWN')
    expect(
      classifyProviderStateFreshness(
        'invalid-date',
        '2026-09-21T10:00:00.000Z'
      )
    ).toBe('UNKNOWN')
  })

  it('treats only ENDED as terminal persistence state', () => {
    expect(isTerminalBillingStatus('PENDING')).toBe(false)
    expect(isTerminalBillingStatus('ACTIVE')).toBe(false)
    expect(isTerminalBillingStatus('GRACE')).toBe(false)
    expect(isTerminalBillingStatus('SUSPENDED')).toBe(false)
    expect(isTerminalBillingStatus('ENDED')).toBe(true)
  })
})
