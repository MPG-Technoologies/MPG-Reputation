import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { hashSuppressionContact } from '@/domain/suppression'

const harness = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => harness.client }))

import { executeReviewRequestHandler, type ReviewRequestEventData } from '@/inngest/functions/review-request'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient<Database>(url, key, clientOptions)
const stop = new Error('Test boundary: eligibility succeeded; do not dispatch')
const initial = 'evaluate-initial-eligibility'
const postDelay = 'evaluate-post-delay-eligibility'
const preReminder = 'evaluate-pre-reminder-eligibility'
const lookups = [
  ['organizations', 'organization'],
  ['locations', 'location'],
  ['customers', 'customer'],
  ['review_destinations', 'review destination'],
  ['suppressions', 'suppression'],
  ['review_requests', 'recent request'],
] as const

let event: { data: ReviewRequestEventData }
let orgId: string
let locId: string
let customerId: string
let requestId: string
let currentStep: string
let failureStep: string
let failureTable: string | null
let remainingFailures: number
let queryLog: { table: string; params: URLSearchParams }[]
let checks: { name: string; result: unknown }[]

async function must<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const result = await query
  expect(result.error).toBeNull()
  return result.data!
}

beforeEach(async () => {
  // Never run these mutation-based fixtures against hosted Supabase.
  expect(new URL(url).hostname).toBe('127.0.0.1')
  orgId = randomUUID()
  locId = randomUUID()
  customerId = randomUUID()
  requestId = randomUUID()
  currentStep = ''
  failureStep = initial
  failureTable = null
  remainingFailures = Infinity
  queryLog = []
  checks = []
  const eventId = randomUUID()
  event = { data: { organizationId: orgId, locationId: locId, customerId, eventId, sourceEventId: eventId } }
  await must(admin.from('organizations').insert({ id: orgId, name: 'Synthetic Query Failure QA', slug: `query-failure-${orgId}` }))
  await must(admin.from('locations').insert({ id: locId, organization_id: orgId, name: 'Synthetic Location', status: 'ACTIVE' }))
  await must(admin.from('customers').insert({ id: customerId, organization_id: orgId, location_id: locId, first_name: 'Synthetic', email: 'query-test@example.test', permission_email: 'allowed' }))
  const destination = await must(admin.from('review_destinations').insert({ organization_id: orgId, location_id: locId, url: 'https://g.page/r/synthetic/review', canonical_url: 'https://g.page/r/synthetic/review', status: 'CONFIRMED' }).select('id').single())
  await must(admin.from('customer_completion_events').insert({ id: eventId, organization_id: orgId, location_id: locId, customer_id: customerId, source: 'quick_complete', source_event_id: eventId }))
  // An existing SENT request lets us exercise reminder rechecks without sending.
  // It belongs to this event and must be excluded from the cooldown lookup.
  await must(admin.from('review_requests').insert({ id: requestId, organization_id: orgId, location_id: locId, customer_id: customerId, completion_event_id: eventId, destination_id: destination.id, status: 'SENT', token: randomUUID(), token_hash: randomUUID() }))

  harness.client = createClient<Database>(url, key, {
    ...clientOptions,
    global: {
      fetch: async (input, init) => {
        const requestUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        expect(requestUrl.origin).toBe(new URL(url).origin)
        const table = requestUrl.pathname.split('/').at(-1)!
        const isLookup = (init?.method ?? 'GET') === 'GET'
        if (isLookup) queryLog.push({ table, params: requestUrl.searchParams })
        // Restrict review_requests fault injection to the cooldown existence read.
        const isEligibilityLookup = table !== 'review_requests' || requestUrl.searchParams.get('select') === 'id'
        if (isLookup && isEligibilityLookup && table === failureTable && currentStep === failureStep && remainingFailures > 0) {
          remainingFailures--
          return new Response(JSON.stringify({ code: '42703', message: 'private database detail: missing column; synthetic-secret' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          })
        }
        return fetch(input, init)
      },
    },
  })
})

afterEach(async () => {
  if (orgId) await must(admin.from('organizations').delete().eq('id', orgId))
})

function runner({ reminder = false, retry = false } = {}) {
  const attempts: Record<string, number> = {}
  return {
    attempts,
    step: {
      run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        currentStep = name
        if (name === 'create-or-resolve-review-request') {
          if (!reminder) throw stop
          return { id: requestId, token: 'synthetic', unsubscribeToken: 'synthetic', status: 'SENT', blocked: false } as T
        }
        if (name === 'dispatch-review-email') return { success: true, provider: 'test' } as T
        if (name === 'dispatch-review-reminder') throw stop
        // Model Inngest's existing two retries, without retrying completed steps.
        for (let attempt = 0; ; attempt++) {
          attempts[name] = (attempts[name] ?? 0) + 1
          try {
            const result = await fn()
            if ([initial, postDelay, preReminder].includes(name)) checks.push({ name, result })
            return result
          } catch (error) {
            if (!retry || attempt >= 2) throw error
          }
        }
      },
      sleep: async () => {},
    },
  }
}

async function expectNoFalseBypassOrDispatch() {
  const audits = await must(admin.from('audit_events').select('event_type').eq('organization_id', orgId))
  expect(audits.map(row => row.event_type)).toEqual(['review_request.checking'])
  const requests = await must(admin.from('review_requests').select('id').eq('organization_id', orgId))
  expect(requests.map(row => row.id)).toEqual([requestId])
  const messages = await must(admin.from('message_events').select('id').eq('organization_id', orgId))
  expect(messages).toEqual([])
}

describe('Eligibility query failures remain operational and retryable', () => {
  for (const stage of [initial, postDelay, preReminder]) {
    it.each(lookups)(`${stage}: %s errors propagate without a policy bypass`, async (table, label) => {
      failureTable = table
      failureStep = stage
      const { step } = runner({ reminder: stage === preReminder })
      await expect(executeReviewRequestHandler({ event, step })).rejects.toThrow(`Eligibility ${label} lookup failed`)
      expect(checks.find(check => check.name === stage)).toBeUndefined()
      await expectNoFalseBypassOrDispatch()
    })
  }

  it.each([initial, postDelay, preReminder])('recovers a transient location read failure at %s without redoing completed steps', async stage => {
    failureTable = 'locations'
    failureStep = stage
    remainingFailures = 1
    const { step, attempts } = runner({ retry: true, reminder: stage === preReminder })
    await expect(executeReviewRequestHandler({ event, step })).rejects.toBe(stop)
    expect(attempts[stage]).toBe(2)
    expect(attempts['record-eligibility-check-started']).toBe(1)
    expect(checks.find(check => check.name === stage)?.result).toMatchObject({ eligible: true })
    await expectNoFalseBypassOrDispatch()
  })

  it('remains failed after retry exhaustion and exposes no raw database detail', async () => {
    failureTable = 'locations'
    const { step, attempts } = runner({ retry: true })
    await expect(executeReviewRequestHandler({ event, step })).rejects.toEqual(new Error('Eligibility location lookup failed'))
    expect(attempts[initial]).toBe(3)
    await expectNoFalseBypassOrDispatch()
  })
})

describe('Successful reads preserve business decisions and tenant boundaries', () => {
  it('passes both eligibility checks for an active location and preserves tenant filters', async () => {
    await expect(executeReviewRequestHandler({ event, step: runner().step })).rejects.toBe(stop)
    expect(checks).toEqual([
      { name: initial, result: expect.objectContaining({ eligible: true, decision: 'ELIGIBLE' }) },
      { name: postDelay, result: expect.objectContaining({ eligible: true, decision: 'ELIGIBLE' }) },
    ])
    for (const table of ['locations', 'customers', 'review_destinations', 'suppressions', 'review_requests']) {
      const reads = queryLog.filter(query => query.table === table)
      expect(reads.length).toBeGreaterThan(0)
      expect(reads.every(query => query.params.get('organization_id') === `eq.${orgId}`)).toBe(true)
    }
    expect(queryLog.filter(query => query.table === 'customers').every(query => query.params.get('location_id') === `eq.${locId}`)).toBe(true)
    await expectNoFalseBypassOrDispatch()
  })

  it.each([
    ['organizations', 'ORGANIZATION_INACTIVE'],
    ['locations', 'LOCATION_INACTIVE'],
    ['review_destinations', 'NO_REVIEW_DESTINATION'],
  ] as const)('keeps the existing decision for successfully verified inactive %s', async (table, decision) => {
    if (table === 'organizations') {
      await must(admin.from(table).update({ status: 'INACTIVE' }).eq('id', orgId))
    } else {
      await must(admin.from(table).update({ status: 'INACTIVE' }).eq('organization_id', orgId))
    }
    const result = await executeReviewRequestHandler({ event, step: runner().step })
    expect(result).toMatchObject({ processed: false, stage: 'initial', decision })
    const audits = await must(admin.from('audit_events').select('metadata').eq('organization_id', orgId).eq('event_type', 'review_request.ineligible'))
    expect(audits).toHaveLength(1)
    expect(audits[0].metadata).toMatchObject({ decision })
  })

  it('retains the existing missing-location decision only on a successful absent-row read', async () => {
    event.data.locationId = randomUUID()
    expect(await executeReviewRequestHandler({ event, step: runner().step })).toMatchObject({ decision: 'LOCATION_INACTIVE', reason: 'Location status is NOT_FOUND' })
  })

  it('retains NO_CONTACT for a successfully verified absent customer', async () => {
    event.data.customerId = randomUUID()
    expect(await executeReviewRequestHandler({ event, step: runner().step })).toMatchObject({ decision: 'NO_CONTACT', reason: 'Customer not found' })
  })

  it('does not use a customer belonging to another location', async () => {
    const otherLocation = randomUUID()
    await must(admin.from('locations').insert({ id: otherLocation, organization_id: orgId, name: 'Other Synthetic Location' }))
    event.data.locationId = otherLocation
    expect(await executeReviewRequestHandler({ event, step: runner().step })).toMatchObject({ decision: 'NO_CONTACT' })
  })

  it.each(['location', 'customer'] as const)('does not use an existing %s from another organization', async resource => {
    const otherOrg = randomUUID()
    const otherLoc = randomUUID()
    const otherCustomer = randomUUID()
    await must(admin.from('organizations').insert({ id: otherOrg, name: 'Other Synthetic Tenant', slug: `other-query-${otherOrg}` }))
    try {
      await must(admin.from('locations').insert({ id: otherLoc, organization_id: otherOrg, name: 'Other Tenant Location' }))
      await must(admin.from('customers').insert({ id: otherCustomer, organization_id: otherOrg, location_id: otherLoc, first_name: 'Other Synthetic', email: 'other@example.test', permission_email: 'allowed' }))
      if (resource === 'location') event.data.locationId = otherLoc
      else event.data.customerId = otherCustomer
      const result = await executeReviewRequestHandler({ event, step: runner().step })
      expect(result).toMatchObject({ processed: false, decision: resource === 'location' ? 'LOCATION_INACTIVE' : 'NO_CONTACT' })
      const otherAudits = await must(admin.from('audit_events').select('id').eq('organization_id', otherOrg))
      expect(otherAudits).toEqual([])
    } finally {
      await must(admin.from('organizations').delete().eq('id', otherOrg))
    }
  })

  it('preserves a successful suppression match', async () => {
    await must(admin.from('suppressions').insert({ organization_id: orgId, channel: 'email', contact_hash: hashSuppressionContact('email', 'query-test@example.test') }))
    expect(await executeReviewRequestHandler({ event, step: runner().step })).toMatchObject({ decision: 'SUPPRESSED' })
  })

  it('treats multiple recent requests as an existence match, not a cardinality error', async () => {
    for (let i = 0; i < 2; i++) {
      const completionId = randomUUID()
      await must(admin.from('customer_completion_events').insert({ id: completionId, organization_id: orgId, location_id: locId, customer_id: customerId, source: 'quick_complete', source_event_id: completionId }))
      await must(admin.from('review_requests').insert({ organization_id: orgId, location_id: locId, customer_id: customerId, completion_event_id: completionId, status: 'SENT', token: randomUUID(), token_hash: randomUUID() }))
    }
    expect(await executeReviewRequestHandler({ event, step: runner().step })).toMatchObject({ decision: 'RECENT_REQUEST' })
  })
})
