import React from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const harness = vi.hoisted(() => ({ client: {}, modalProps: {} as Record<string, unknown> }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => harness.client }))
vi.mock('@/actions/locations', () => ({ createLocation: vi.fn() }))
vi.mock('@/components/ui/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/components/ui/modal-system', () => ({
  ModalProvider: (props: Record<string, unknown>) => { harness.modalProps = props; return props.children },
}))
vi.mock('@/app/app/nav-context', () => ({ NavigationProvider: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/app/app/progress-bar', () => ({ TopProgressBar: () => null }))
vi.mock('@/app/app/dashboard/live-dashboard', () => ({
  LiveDashboard: (props: Record<string, unknown>) => React.createElement('pre', null, JSON.stringify(props)),
}))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`) } }))

import LocationPage from '@/app/app/settings/location/page'
import DestinationPage from '@/app/app/settings/review-destination/page'
import QuickCompletePage from '@/app/app/quick-complete/page'
import DashboardPage from '@/app/app/dashboard/page'
import AppLayout from '@/app/app/layout'
import AppTemplate from '@/app/app/template'
import { getDashboardSnapshot } from '@/actions/dashboard'
import { SystemStatusPanel } from '@/app/app/dashboard/system-status-panel'
import { ActivityPanel } from '@/app/app/dashboard/activity-panel'

type Row = Record<string, unknown>
type Result = { data: Row[] | Row | null; error: { message: string } | null; count: number }
let rows: Record<string, Row[]>
let failedTable: string | null
let authenticated: boolean
let queries: Query[]

class Query implements PromiseLike<Result> {
  filters: [string, unknown][] = []
  one = false
  constructor(readonly table: string) { queries.push(this) }
  select() { return this }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this }
  in() { return this }
  order() { return this }
  limit() { return this }
  maybeSingle() { this.one = true; return this }
  then<T = Result, U = never>(
    onfulfilled?: ((value: Result) => T | PromiseLike<T>) | null,
    onrejected?: ((reason: unknown) => U | PromiseLike<U>) | null,
  ): PromiseLike<T | U> {
    const data = rows[this.table] ?? []
    return Promise.resolve<Result>(this.table === failedTable
      ? { data: null, error: { message: '42703 private database detail' }, count: 0 }
      : { data: this.one ? data[0] ?? null : data, error: null, count: data.length }
    ).then(onfulfilled, onrejected)
  }
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  queries = []
  failedTable = null
  authenticated = true
  rows = {
    organization_users: [{ organization_id: 'org-a', role: 'OWNER', organizations: { id: 'org-a', name: 'Northstar Synthetic' } }],
    locations: [{ id: 'loc-a', name: 'Main Synthetic Location', status: 'ACTIVE', address: '100 Example Street', country: 'CA', timezone: 'America/Toronto', review_reply_to_email: 'reply@example.test' }],
    review_destinations: [{ location_id: 'loc-a', status: 'CONFIRMED', canonical_url: 'https://g.page/r/synthetic/review' }],
  }
  harness.client = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'user-a' } : null }, error: null }) },
    from: (table: string) => new Query(table),
  }
})

describe('Locations distinguish query failures from empty results', () => {
  it('renders stored location fields and the true count on success', async () => {
    const html = renderToString(await LocationPage())
    for (const text of ['1 configured location(s)', 'Main Synthetic Location', 'ACTIVE', '100 Example Street', 'reply@example.test']) expect(html).toContain(text)
    expect(html).not.toContain('No locations configured yet')
    expect(queries.find(q => q.table === 'organization_users')?.filters).toContainEqual(['user_id', 'user-a'])
    expect(queries.find(q => q.table === 'locations')?.filters).toContainEqual(['organization_id', 'org-a'])
  })

  it('renders a legitimate empty state only after a successful zero-row query', async () => {
    rows.locations = []
    const html = renderToString(await LocationPage())
    expect(html).toContain('0 configured location(s)')
    expect(html).toContain('No locations configured yet')
    expect(html).not.toContain('role="alert"')
  })

  it.each(['locations', 'organization_users'])('renders a safe reload state for failed %s reads', async table => {
    failedTable = table
    const html = renderToString(await LocationPage())
    expect(html).toContain('Locations could not be loaded')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Reload page')
    for (const text of ['0 configured', 'No locations configured', '42703', 'private database detail', 'Add New Location']) expect(html).not.toContain(text)
  })

  it('does not read tenant data without an authenticated user or membership', async () => {
    authenticated = false
    expect(await LocationPage()).toBeNull()
    expect(queries).toHaveLength(0)
    authenticated = true
    rows.organization_users = []
    await LocationPage()
    expect(queries.map(q => q.table)).toEqual(['organization_users'])
  })

  it('keeps the location creation form restricted to owner/admin roles', async () => {
    rows.organization_users[0].role = 'VIEWER'
    const html = renderToString(await LocationPage())
    expect(html).toContain('Main Synthetic Location')
    expect(html).not.toContain('Add New Location')
  })
})

describe('Related readiness consumers do not invent missing setup on query failure', () => {
  for (const [name, page] of [['dashboard', DashboardPage], ['destination', DestinationPage], ['quick complete', QuickCompletePage]] as const) {
    it.each(['locations', 'review_destinations'])(`${name} shows a safe error for failed %s reads`, async table => {
      failedTable = table
      const html = renderToString(await page())
      expect(html).toContain('could not be loaded')
      expect(html).toContain('Reload page')
      expect(html).not.toContain('42703')
      expect(html).not.toContain('No Active Locations Configured')
    })
  }

  it.each(['locations', 'review_destinations'])('returns no replacement dashboard snapshot when %s fails', async table => {
    failedTable = table
    expect(await getDashboardSnapshot('org-a')).toBeNull()
  })

  it.each(['locations', 'review_destinations'])('passes explicit readiness failure to the global modal when %s fails', async table => {
    failedTable = table
    renderToString(await AppLayout({ children: React.createElement('p', null, 'Page') }))
    expect(harness.modalProps.readinessError).toBe(true)
    expect(harness.modalProps.organizationId).toBe('org-a')
    expect(harness.modalProps.readyLocations).toEqual([])
  })

  it('retains actual-request-only solicitations and persisted bypasses on page load and reconciliation', async () => {
    rows.customer_completion_events = [{ id: 'completion-a', customer_id: 'customer-a', created_at: '2026-09-20T00:00:00Z' }]
    rows.audit_events = [{ id: 'audit-a', event_type: 'review_request.ineligible', metadata: { completionEventId: 'completion-a', decision: 'LOCATION_INACTIVE', reason: 'Location status is NOT_FOUND' }, created_at: '2026-09-20T00:00:01Z' }]
    rows.review_requests = []
    const page = await DashboardPage()
    const snapshot = await getDashboardSnapshot('org-a')
    expect(page?.props.initialSnapshot.recentRequests).toEqual([])
    expect(page?.props.initialSnapshot.liveActivity[0]).toMatchObject({ stage: 'BYPASSED', policyReason: 'Location inactive' })
    expect(snapshot?.recentRequests).toEqual([])
    expect(snapshot?.liveActivity?.[0]).toMatchObject({ stage: 'BYPASSED', policyReason: 'Location inactive' })
    expect(snapshot?.setupChecklist?.every(item => item.complete)).toBe(true)
    expect(queries.filter(q => q.table === 'review_requests').every(q => q.filters.some(([key, value]) => key === 'organization_id' && value === 'org-a'))).toBe(true)

    rows.review_requests = [{ id: 'actual-request', completion_event_id: 'completion-a', customer_id: 'customer-a', channel: 'email', status: 'SENT', created_at: '2026-09-20T00:00:02Z', sent_at: '2026-09-20T00:00:03Z' }]
    const withRequest = await getDashboardSnapshot('org-a')
    expect(withRequest?.recentRequests.map(request => request.id)).toEqual(['actual-request'])
  })
})

describe('Dashboard desktop height propagation', () => {
  it('uses date-neutral footer copy even when displaying historical activity', () => {
    const html = renderToString(React.createElement(ActivityPanel, {
      liveActivities: [{ completionEventId: 'historical', customerName: 'Synthetic Customer', stage: 'BYPASSED', policyReason: 'Location inactive', createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z' }],
      recentRequests: [], orgName: 'Synthetic Organization',
    }))
    expect(html).toContain('Showing latest activity')
    expect(html).not.toContain('from today')
    expect(html).toContain('Bypassed by policy')
    expect(html).toContain('Location inactive')
    expect(html).toContain('days ago')
  })

  it('passes flex growth through the route template only at desktop widths', () => {
    const template = AppTemplate({ children: 'Dashboard' })
    const classes = template.props.className.split(' ')
    expect(classes).toEqual(expect.arrayContaining(['animate-page-enter', 'xl:flex', 'xl:flex-1', 'xl:flex-col', 'xl:min-w-0']))
    expect(classes).not.toContain('flex-1')
    expect(classes.some((c: string) => /h-screen|h-\[|min-h-screen/.test(c))).toBe(false)
    const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/app/app/dashboard/live-dashboard.tsx'), 'utf8')
    expect(dashboard).toContain('items-stretch xl:flex-1 xl:min-h-0')
    expect(dashboard).toContain('lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_340px]')
  })

  it('fills the status card while keeping its sections top-aligned', () => {
    const html = renderToString(React.createElement(SystemStatusPanel, { status: 'READY_FOR_SYNTHETIC_TEST', statusDescription: 'Ready', attentionItems: [] }))
    const rootClass = html.match(/^<div class="([^"]+)"/)?.[1] ?? ''
    expect(rootClass).toContain('flex flex-col h-full')
    expect(rootClass).not.toContain('justify-between')
    expect(rootClass).toContain('space-y-5')
  })
})
