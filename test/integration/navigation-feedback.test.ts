import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import React from 'react'
import { renderToString } from 'react-dom/server'

// Mock react-dom useFormStatus
let mockFormStatus = { pending: false, action: null as unknown }
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    useFormStatus: () => mockFormStatus,
  }
})

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/dashboard',
}))

import { SubmitButton } from '../../src/components/ui/submit-button'
import { TopProgressBar } from '../../src/app/app/progress-bar'
import AppTemplate from '../../src/app/app/template'
import DashboardLoading from '../../src/app/app/dashboard/loading'
import QuickCompleteLoading from '../../src/app/app/quick-complete/loading'
import LocationSettingsLoading from '../../src/app/app/settings/location/loading'
import ReviewDestinationLoading from '../../src/app/app/settings/review-destination/loading'

describe('Navigation Feedback, Loading Skeletons & Transitions (Section 10)', () => {
  describe('1. CSS Transitions & Reduced Motion Safety', () => {
    it('defines page-enter and nav-progress keyframes and classes in globals.css', () => {
      const cssPath = path.resolve(__dirname, '../../src/app/globals.css')
      const css = fs.readFileSync(cssPath, 'utf8')

      expect(css).toContain('@keyframes page-enter')
      expect(css).toContain('@keyframes nav-progress')
      expect(css).toContain('.animate-page-enter')
      expect(css).toContain('.animate-nav-progress')
    })

    it('enforces prefers-reduced-motion overrides in globals.css', () => {
      const cssPath = path.resolve(__dirname, '../../src/app/globals.css')
      const css = fs.readFileSync(cssPath, 'utf8')

      expect(css).toContain('@media (prefers-reduced-motion: reduce)')
      expect(css).toContain('animation: none !important')
    })
  })

  describe('2. SubmitButton Feedback & Pending States', () => {
    it('renders idle text and enabled state when not pending', () => {
      mockFormStatus = { pending: false, action: null }
      const html = renderToString(
        React.createElement(SubmitButton, { pendingText: 'Saving…', children: 'Save Settings' })
      )

      expect(html).toContain('Save Settings')
      expect(html).not.toContain('Saving…')
      expect(html).not.toContain('animate-spin')
      expect(html).not.toContain('disabled=""')
      expect(html).toContain('aria-busy="false"')
    })

    it('renders spinner, pending text, and disabled attribute when pending', () => {
      mockFormStatus = { pending: true, action: null }
      const html = renderToString(
        React.createElement(SubmitButton, { pendingText: 'Saving…', children: 'Save Settings' })
      )

      expect(html).toContain('Saving…')
      expect(html).toContain('animate-spin')
      expect(html).toContain('disabled=""')
      expect(html).toContain('aria-busy="true"')
    })
  })

  describe('3. App Template Page Transition Wrapper', () => {
    it('wraps route content in animate-page-enter class for smooth route transitions', () => {
      const html = renderToString(
        React.createElement(AppTemplate, { children: React.createElement('p', null, 'Route Content') })
      )

      expect(html).toContain('animate-page-enter')
      expect(html).toContain('Route Content')
    })
  })

  describe('4. Loading Skeletons', () => {
    it('renders DashboardLoading with metric and activity skeleton placeholders', () => {
      const html = renderToString(React.createElement(DashboardLoading))
      expect(html).toContain('animate-pulse')
      expect(html).toContain('motion-reduce:animate-none')
    })

    it('renders QuickCompleteLoading with form input skeletons', () => {
      const html = renderToString(React.createElement(QuickCompleteLoading))
      expect(html).toContain('animate-pulse')
      expect(html).toContain('motion-reduce:animate-none')
    })

    it('renders LocationSettingsLoading with location list skeletons', () => {
      const html = renderToString(React.createElement(LocationSettingsLoading))
      expect(html).toContain('animate-pulse')
      expect(html).toContain('motion-reduce:animate-none')
    })

    it('renders ReviewDestinationLoading with destination URL skeletons', () => {
      const html = renderToString(React.createElement(ReviewDestinationLoading))
      expect(html).toContain('animate-pulse')
      expect(html).toContain('motion-reduce:animate-none')
    })
  })
})
