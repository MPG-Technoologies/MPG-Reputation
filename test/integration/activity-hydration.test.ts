import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { ActivityPanel, formatRelativeTime } from '../../src/app/app/dashboard/activity-panel'
import type { LiveActivityItem, ActivityRequestItem } from '../../src/lib/dashboard/realtime-types'

// Mock next/link to render a plain <a>
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...props }, children),
}))

describe('Recent Activity Hydration & Deterministic Time (Section MR-4)', () => {
  const baseEventTime = '2026-09-21T10:00:00.000Z'
  const twentyFiveMinutesLater = '2026-09-21T10:25:00.000Z'
  const twentySixMinutesLater = '2026-09-21T10:26:00.000Z'

  const mockLiveActivities: LiveActivityItem[] = [
    {
      completionEventId: 'evt-test-1',
      customerName: 'Jane Doe',
      stage: 'RECEIVED',
      createdAt: baseEventTime,
      updatedAt: baseEventTime,
    },
  ]

  const mockRecentRequests: ActivityRequestItem[] = [
    {
      id: 'req-test-1',
      customer_id: 'cust-1',
      channel: 'email',
      status: 'SENT',
      created_at: baseEventTime,
      sent_at: baseEventTime,
      clicked_at: null,
      customerName: 'John Smith',
      recipientEmail: 'john@example.com',
      token: 'test-token',
    },
  ]

  describe('1. Identical event timestamp + identical renderedAt produces identical text', () => {
    it('produces identical output on repeated calls with identical inputs', () => {
      const renderedAtMs = new Date(twentyFiveMinutesLater).getTime()

      const result1 = formatRelativeTime(baseEventTime, renderedAtMs)
      const result2 = formatRelativeTime(baseEventTime, renderedAtMs)
      const result3 = formatRelativeTime(baseEventTime, renderedAtMs)

      expect(result1).toBe('25 minutes ago')
      expect(result2).toBe('25 minutes ago')
      expect(result3).toBe('25 minutes ago')
    })

    it('formats relative times truthfully across all ranges', () => {
      const now = 1700000000000

      // < 60s
      expect(formatRelativeTime(new Date(now - 10_000).toISOString(), now)).toBe('just now')
      expect(formatRelativeTime(new Date(now - 59_000).toISOString(), now)).toBe('just now')

      // Minutes
      expect(formatRelativeTime(new Date(now - 60_000).toISOString(), now)).toBe('1 minute ago')
      expect(formatRelativeTime(new Date(now - 120_000).toISOString(), now)).toBe('2 minutes ago')
      expect(formatRelativeTime(new Date(now - 1500_000).toISOString(), now)).toBe('25 minutes ago')

      // Hours
      expect(formatRelativeTime(new Date(now - 3600_000).toISOString(), now)).toBe('1 hour ago')
      expect(formatRelativeTime(new Date(now - 7200_000).toISOString(), now)).toBe('2 hours ago')
      expect(formatRelativeTime(new Date(now - 3600_000 * 23).toISOString(), now)).toBe('23 hours ago')

      // Days
      expect(formatRelativeTime(new Date(now - 3600_000 * 24).toISOString(), now)).toBe('1 day ago')
      expect(formatRelativeTime(new Date(now - 3600_000 * 72).toISOString(), now)).toBe('3 days ago')

      // Safe fallbacks
      expect(formatRelativeTime('invalid-date', now)).toBe('recently')
      // Future or slight clock skew (diff < 0) yields 'just now'
      expect(formatRelativeTime(new Date(now + 10_000).toISOString(), now)).toBe('just now')
    })
  })

  describe('2. Initial ActivityPanel SSR/hydration reference time is deterministic', () => {
    it('renders identical relative time in SSR HTML regardless of when render is invoked', () => {
      // First render: simulated at 10:25:00
      const html1 = renderToString(
        React.createElement(ActivityPanel, {
          liveActivities: mockLiveActivities,
          recentRequests: mockRecentRequests,
          orgName: 'Acme Health',
          renderedAt: twentyFiveMinutesLater,
        })
      )

      // Both live activity and solicitation should render deterministic 25 minutes ago
      expect(html1).toContain('25 minutes ago')

      // Second render: simulated wall clock advances, but same renderedAt prop is passed
      // (as happens when client receives server HTML and hydrates with same props)
      const html2 = renderToString(
        React.createElement(ActivityPanel, {
          liveActivities: mockLiveActivities,
          recentRequests: mockRecentRequests,
          orgName: 'Acme Health',
          renderedAt: twentyFiveMinutesLater,
        })
      )

      expect(html2).toContain('25 minutes ago')
      expect(html1).toEqual(html2)
    })
  })

  describe('3. Crossing a minute boundary after hydration updates text without requiring a page reload', () => {
    it('transitions text from 25 minutes ago to 26 minutes ago when reference clock advances', () => {
      const clockAt25 = new Date(twentyFiveMinutesLater).getTime()
      const clockAt26 = new Date(twentySixMinutesLater).getTime()

      const textAt25 = formatRelativeTime(baseEventTime, clockAt25)
      const textAt26 = formatRelativeTime(baseEventTime, clockAt26)

      expect(textAt25).toBe('25 minutes ago')
      expect(textAt26).toBe('26 minutes ago')
      expect(textAt25).not.toEqual(textAt26)
    })
  })

  describe('4. No suppressHydrationWarning is used to mask the issue', () => {
    it('verifies activity-panel.tsx, live-dashboard.tsx, and page.tsx do not use suppressHydrationWarning', () => {
      const filesToCheck = [
        path.resolve(__dirname, '../../src/app/app/dashboard/activity-panel.tsx'),
        path.resolve(__dirname, '../../src/app/app/dashboard/live-dashboard.tsx'),
        path.resolve(__dirname, '../../src/app/app/dashboard/page.tsx'),
      ]

      for (const filePath of filesToCheck) {
        const content = fs.readFileSync(filePath, 'utf8')
        expect(content).not.toContain('suppressHydrationWarning')
      }
    })
  })
})
