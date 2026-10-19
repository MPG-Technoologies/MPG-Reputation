import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveProposedActiveOrganization } from '../../src/domain/workspace/active-organization-policy'
import { selectSingleBillingMembership } from '../../src/domain/billing/workspace-organization-selection'
import { selectSingleUsageMembership } from '../../src/domain/workspace/single-usage-membership'

const a = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  organizationName: 'Synthetic Plumbing',
  role: 'OWNER',
} as const
const b = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  organizationName: 'Synthetic Services',
  role: 'VIEWER',
} as const
const c = {
  organizationId: '33333333-3333-4333-8333-333333333333',
  organizationName: 'Synthetic Works',
  role: 'ADMIN',
} as const

describe('MR-5I4K future active organization membership policy', () => {
  it('retains existing one-business default for all recognized member roles', () => {
    for (const role of ['OWNER','ADMIN','OPERATOR','VIEWER'] as const) {
      expect(resolveProposedActiveOrganization([{...a,role}]))
        .toEqual({outcome:'SELECTED',organization:{...a,role}})
    }
  })

  it('requires an explicit choice for multiple businesses regardless of ordering', () => {
    const first=resolveProposedActiveOrganization([a,b,c])
    const second=resolveProposedActiveOrganization([c,a,b])
    expect(first).toEqual(second)
    expect(first).toEqual({outcome:'SELECTION_REQUIRED',choices:[a,b,c]})
  })

  it('selects only current, listed membership for an exact proposed organization', () => {
    expect(resolveProposedActiveOrganization([a,b],b.organizationId))
      .toEqual({outcome:'SELECTED',organization:b})
    expect(resolveProposedActiveOrganization([b,a],a.organizationId))
      .toEqual({outcome:'SELECTED',organization:a})
  })

  it('normalizes UUID letter case without changing membership authority', () => {
    const mixed={...a,organizationId:'ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF'}
    const result=resolveProposedActiveOrganization([mixed],'abcdefab-abcd-4abc-8abc-abcdefabcdef')
    expect(result).toEqual({outcome:'SELECTED',organization:{
      ...a,organizationId:'abcdefab-abcd-4abc-8abc-abcdefabcdef',
    }})
  })

  it('denies a forged foreign or formerly authorized tenant with no fallback', () => {
    const forged='44444444-4444-4444-8444-444444444444'
    for (const current of [[a,b],[a]]) {
      expect(resolveProposedActiveOrganization(current,forged))
        .toEqual({outcome:'SELECTION_DENIED'})
    }
    // A removed membership must not authorize a stale preference.
    expect(resolveProposedActiveOrganization([a,b],c.organizationId))
      .toEqual({outcome:'SELECTION_DENIED'})
  })

  it('returns no IDs or names when a selection is denied', () => {
    const denied=resolveProposedActiveOrganization([a,b],c.organizationId)
    const encoded=JSON.stringify(denied)
    for (const secret of [a.organizationId,b.organizationId,c.organizationId,
      a.organizationName,b.organizationName]) {
      expect(encoded).not.toContain(secret)
    }
  })

  it('rejects malformed hints identically to a foreign-member hint', () => {
    const denied=resolveProposedActiveOrganization([a,b],c.organizationId)
    for (const hint of ['',123,{},[],true,'not-a-uuid',
      ' 11111111-1111-4111-8111-111111111111',
    ]) expect(resolveProposedActiveOrganization([a,b],hint)).toEqual(denied)
  })

  it('never treats an explicit invalid hint as absent even for a single org', () => {
    expect(resolveProposedActiveOrganization([a],''))
      .toEqual({outcome:'SELECTION_DENIED'})
  })

  it('distinguishes unavailability, no memberships and multi-business ambiguity', () => {
    expect(resolveProposedActiveOrganization(null)).toEqual({outcome:'UNAVAILABLE'})
    expect(resolveProposedActiveOrganization(undefined)).toEqual({outcome:'UNAVAILABLE'})
    expect(resolveProposedActiveOrganization([])).toEqual({outcome:'NO_MEMBERSHIP'})
    expect(resolveProposedActiveOrganization([a,b]))
      .toHaveProperty('outcome','SELECTION_REQUIRED')
  })

  it('refuses even one corrupted membership without exposing an otherwise valid business', () => {
    for(const patch of [
      {organizationId:'wrong'}, {organizationId:7}, {role:'BILLING_ADMIN'},
      {role:'owner'}, {role:null}, {organizationName:''},
      {organizationName:'  '}, {organizationName:null},
    ]) {
      expect(resolveProposedActiveOrganization([a,{...b,...patch}]))
        .toEqual({outcome:'INVALID_MEMBERSHIPS'})
    }
  })

  it('fails closed when current membership data repeats an organization', () => {
    expect(resolveProposedActiveOrganization([a,{...a}]))
      .toEqual({outcome:'INVALID_MEMBERSHIPS'})
    expect(resolveProposedActiveOrganization([a,{
      ...a,organizationName:'A different name',role:'ADMIN',
    }])).toEqual({outcome:'INVALID_MEMBERSHIPS'})
  })

  it('never promotes a VIEWER workspace choice into OWNER-only Billing access', () => {
    expect(resolveProposedActiveOrganization([a,b],b.organizationId))
      .toHaveProperty('organization.role','VIEWER')
    expect(selectSingleBillingMembership([b]))
      .toEqual({outcome:'ROLE_RESTRICTED'})
    expect(selectSingleUsageMembership([b]))
      .toEqual({outcome:'SELECTED',organizationId:b.organizationId,role:'VIEWER'})
  })

  it('does not make an app-wide selection secretly active in this milestone', () => {
    const src=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8')
    const policy=src('src/domain/workspace/active-organization-policy.ts')
    for(const forbidden of [
      'next/headers','next/navigation','service_role','createAdminClient(',
      'cookies()','localStorage','\.rpc(',
    ]) {
      expect(policy).not.toContain(forbidden)
    }
    for (const path of [
      'src/app/app/layout.tsx',
      'src/app/app/settings/billing/page.tsx',
      'src/app/app/settings/usage/page.tsx',
    ]) {
      expect(src(path)).not.toContain('resolveProposedActiveOrganization(')
    }
  })
})
