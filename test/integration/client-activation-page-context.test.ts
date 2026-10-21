import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error('TEST_REDIRECT:' + path) },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/domain/activation', () => ({
  deriveActivationReadiness: () => ({
    ready: true,
    readyLocationIds: ['11111111-1111-4111-8111-111111111111'],
    activeLocationCount: 1,
    locationsNeedingDestinationCount: 0,
  }),
}))
vi.mock('@/domain/entitlement', () => ({
  deriveTrialLifecycle: () => ({ effectiveStatus: 'ACTIVE' }),
}))
vi.mock('@/components/ui/icons', async () => {
  const { createElement } = await import('react')
  return {
    PlusCircleIcon: () => createElement('span', null, 'plus'),
    LinkIcon: () => createElement('span', null, 'link'),
  }
})
vi.mock('../../src/app/app/quick-complete/form', async () => {
  const { createElement } = await import('react')
  return {
    QuickCompleteForm: (p: {organizationId: string}) =>
      createElement('div', {'data-test': 'quick-form'}, p.organizationId),
  }
})
vi.mock('../../src/app/app/settings/review-destination/form', async () => {
  const { createElement } = await import('react')
  return {
    DestinationForm: (p: {organizationId: string}) =>
      createElement('div', {'data-test': 'destination-form'}, p.organizationId),
  }
})
vi.mock('../../src/app/app/settings/review-destination/ready-banner', async () => {
  const { createElement } = await import('react')
  return { DestinationReadyBanner: () => createElement('div', null, 'Destination ready') }
})

import { createClient } from '../../src/lib/supabase/server'
import QuickCompletePage from '../../src/app/app/quick-complete/page'
import ReviewDestinationPage from '../../src/app/app/settings/review-destination/page'

const orgA = '11111111-1111-4111-8111-111111111111'
const orgB = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
type PageKind = 'quick' | 'destination'
type Config = {
  rows?: unknown
  role?: string
  user?: boolean
  anonymous?: boolean
  authError?: boolean
  membershipError?: boolean
  setupError?: boolean
}

function fixture(input: Config = {}) {
  const rows = Object.prototype.hasOwnProperty.call(input, 'rows')
    ? input.rows : [{ organization_id: orgA, role: input.role ?? 'OWNER' }]
  const queryLog: {table:string,filter:string,value:unknown}[] = []
  const from = vi.fn((table: string) => ({
    select: (_columns: string) => {
      const isMember = table === 'organization_users'
      const result = () => {
        if (isMember) return {
          data: rows, error: input.membershipError ? { message: 'Synthetic DB outage' } : null,
        }
        if (input.setupError && (table === 'locations' || table === 'review_destinations')) {
          return { data: null, error: { message: 'Synthetic setup outage' } }
        }
        if (table === 'locations') return {
          data: [{ id: orgA, name: 'Synthetic Location', status: 'ACTIVE' }], error: null,
        }
        if (table === 'review_destinations') return {
          data: [{location_id:orgA, canonical_url:'https://example.test/review',status:'CONFIRMED'}], error: null,
        }
        if (table === 'organization_entitlements') return {
          data: { status:'ACTIVE', allocated_requests:30, consumed_requests:0, expires_at:null },
          error: null,
        }
        throw new Error('UNEXPECTED_TABLE:' + table)
      }
      const q = {
        eq: (filter: string, value: unknown) => {
          queryLog.push({table,filter,value})
          return q
        },
        maybeSingle: async () => result(),
        then: (resolve: (value:unknown)=>unknown, reject?: (error:unknown)=>unknown) =>
          Promise.resolve(result()).then(resolve,reject),
      }
      return q
    },
  }))
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({
      data: { user: input.user === false ? null : { id:userId, is_anonymous: input.anonymous ?? false } },
      error: input.authError ? { message:'Synthetic auth outage' } : null,
    })) },
    from,
  } as never)
  return { from, queryLog }
}
async function render(kind: PageKind) {
  const content = kind === 'quick' ? await QuickCompletePage() : await ReviewDestinationPage()
  return renderToStaticMarkup(createElement('div', null, content))
}

describe('Operational client journey — real Quick Complete and review-link server pages', () => {
  afterEach(() => vi.clearAllMocks())

  it.each(['quick','destination'] as PageKind[])(
    '%s redirects missing, failed, or anonymous sessions before memberships',
    async kind => {
      for (const cfg of [{user:false},{anonymous:true},{authError:true}]) {
        const db = fixture(cfg)
        await expect(render(kind)).rejects.toThrow('TEST_REDIRECT:/login')
        expect(db.from).not.toHaveBeenCalled()
        vi.clearAllMocks()
      }
    },
  )

  it.each(['quick','destination'] as PageKind[])(
    '%s refuses multi-business membership regardless of row ordering before tenant reads',
    async kind => {
      const a = {organization_id:orgA,role:'OWNER'}
      const b = {organization_id:orgB,role:'ADMIN'}
      for (const rows of [[a,b],[b,a],[a,a]]) {
        const db = fixture({rows})
        const html = await render(kind)
        expect(html).toContain('Multiple business memberships detected')
        expect(html).not.toContain('data-test="quick-form"')
        expect(html).not.toContain('data-test="destination-form"')
        expect(db.from).toHaveBeenCalledTimes(1)
        expect(db.queryLog).toEqual([{table:'organization_users',filter:'user_id',value:userId}])
        vi.clearAllMocks()
      }
    },
  )

  it.each(['quick','destination'] as PageKind[])(
    '%s keeps failed, missing and invalid memberships blocked',
    async kind => {
      for (const cfg of [
        {rows:null}, {membershipError:true},
        {rows:[{organization_id:'bad',role:'OWNER'}]},
        {rows:[{organization_id:orgA,role:'MADE_UP'}]},
      ]) {
        const db = fixture(cfg)
        const html = await render(kind)
        expect(html).toContain('membership could not be verified')
        expect(db.from).toHaveBeenCalledTimes(1)
        vi.clearAllMocks()
      }
    },
  )

  it.each(['quick','destination'] as PageKind[])(
    '%s offers onboarding for genuinely missing business membership',
    async kind => {
      fixture({rows:[]})
      const html=await render(kind)
      expect(html).toContain('href="/onboarding"')
      expect(html).not.toContain('data-test="quick-form"')
      expect(html).not.toContain('data-test="destination-form"')
    },
  )

  it('Quick Complete VIEWER cannot access an operational form or setup data',async()=>{
    const db=fixture({role:'VIEWER'})
    const html=await render('quick')
    expect(html).toContain('VIEWER (read-only)')
    expect(html).not.toContain('data-test="quick-form"')
    expect(db.from).toHaveBeenCalledTimes(1)
  })

  it('Review Destination VIEWER gets a read-only page without an editing form',async()=>{
    const db=fixture({role:'VIEWER'})
    const html=await render('destination')
    expect(html).toContain('VIEWER (read-only)')
    expect(html).not.toContain('data-test="destination-form"')
    expect(db.queryLog.filter(q=>q.filter==='organization_id').map(q=>q.value)).toEqual([orgA,orgA,orgA])
  })

  it.each(['OWNER','ADMIN','OPERATOR'] as const)(
    'single verified %s can use both setup and recording forms only for own org',
    async role=>{
      for (const kind of ['quick','destination'] as PageKind[]) {
        const db=fixture({role})
        const html=await render(kind)
        expect(html).toContain(orgA)
        expect(html).toContain(kind==='quick'?'data-test="quick-form"':'data-test="destination-form"')
        expect(db.queryLog.filter(q=>q.filter==='organization_id').every(q=>q.value===orgA)).toBe(true)
        expect(html).not.toContain(orgB)
        vi.clearAllMocks()
      }
    },
  )

  it.each(['quick','destination'] as PageKind[])(
    '%s keeps forms disabled when location/review-link data fails',
    async kind=>{
      fixture({setupError:true})
      const html=await render(kind)
      expect(html).toContain('could not be loaded')
      expect(html).not.toContain('data-test="quick-form"')
      expect(html).not.toContain('data-test="destination-form"')
    },
  )
})
