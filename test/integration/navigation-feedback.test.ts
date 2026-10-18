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
import AppTemplate from '../../src/app/app/template'
import DashboardLoading from '../../src/app/app/dashboard/loading'
import QuickCompleteLoading from '../../src/app/app/quick-complete/loading'
import { QuickCompleteReceipt } from '../../src/app/app/quick-complete/receipt'
import LocationSettingsLoading from '../../src/app/app/settings/location/loading'
import ReviewDestinationLoading from '../../src/app/app/settings/review-destination/loading'

describe('Quick Complete client confirmation feedback', () => {
  it('separates recorded completions from review eligibility and email delivery', () => {
    const html = renderToString(React.createElement(QuickCompleteReceipt, {
      result: { success: true, duplicate: false, message: 'Service completion recorded.' },
      onDone: vi.fn(),
    }))
    expect(html).toContain('Completion recorded')
    expect(html).toContain('Review request:')
    expect(html).toContain('Check Recent Activity for its eligibility and outcome')
    expect(html).toContain('Email delivery:')
    expect(html).toContain('Not confirmed by this receipt')
    expect(html).toContain('href="/app/dashboard"')
    expect(html).toContain('Done')
    expect(html).not.toContain('Invitation sent')
  })

  it('does not misrepresent a duplicate submission as a new completion', () => {
    const html = renderToString(React.createElement(QuickCompleteReceipt, {
      result: { success: true, duplicate: true, message: 'Already recorded.' },
    }))
    expect(html).toContain('Already recorded')
    expect(html).toContain('No second completion was created')
    expect(html).not.toContain('Email delivery:')
    expect(html).not.toContain('Completion recorded</div>')
  })

  it('shows server errors without claiming a completion was recorded', () => {
    const html = renderToString(React.createElement(QuickCompleteReceipt, {
      result: { success: false, error: 'Validation failed' },
    }))
    expect(html).toContain('Could not record completion')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Validation failed')
    expect(html).not.toContain('Review request:')
    expect(html).not.toContain('View Recent Activity')
  })

  it('keeps the receipt visible until dismissed rather than auto-closing the modal', () => {
    const form = fs.readFileSync(
      path.resolve(__dirname, '../../src/app/app/quick-complete/form.tsx'), 'utf8'
    )
    expect(form).toContain('<QuickCompleteReceipt result={result} onDone={onSuccess} />')
    expect(form).not.toContain('setTimeout(')
  })
})

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
        React.createElement(SubmitButton, { pendingText: 'Saving…' }, 'Save Settings')
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
        React.createElement(SubmitButton, { pendingText: 'Saving…' }, 'Save Settings')
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
        React.createElement(AppTemplate, null, React.createElement('p', null, 'Route Content'))
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
