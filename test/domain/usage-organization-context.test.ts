import { describe, expect, it } from 'vitest'
import { selectSingleUsageMembership } from '../../src/domain/workspace/single-usage-membership'

const a = { organizationId: '11111111-1111-4111-8111-111111111111', role: 'OWNER' }
const b = { organizationId: '22222222-2222-4222-8222-222222222222', role: 'VIEWER' }

describe('MR-5I4J Usage & Trial organization-context safety', () => {
  it('selects exactly one valid membership for each approved member role', () => {
    for (const role of ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] as const) {
      expect(selectSingleUsageMembership([{ ...a, role }])).toEqual({
        outcome: 'SELECTED', organizationId: a.organizationId, role,
      })
    }
  })
  it('refuses any two memberships regardless of ordering or privilege', () => {
    for (const rows of [[a,b], [b,a], [a,a],
      [{ ...a, role: 'VIEWER' }, { ...b, role: 'OWNER' }]]) {
      expect(selectSingleUsageMembership(rows))
        .toEqual({ outcome: 'AMBIGUOUS_ORGANIZATION' })
    }
  })
  it('does not leak arbitrary selected tenant or role on ambiguity', () => {
    const output = JSON.stringify(selectSingleUsageMembership([a,b]))
    expect(output).not.toContain(a.organizationId)
    expect(output).not.toContain(b.organizationId)
    expect(output).not.toContain('OWNER')
  })
  it('distinguishes unavailable membership read from a genuinely empty list', () => {
    expect(selectSingleUsageMembership(null)).toEqual({ outcome: 'UNAVAILABLE' })
    expect(selectSingleUsageMembership(undefined)).toEqual({ outcome: 'UNAVAILABLE' })
    expect(selectSingleUsageMembership([])).toEqual({ outcome: 'NO_MEMBERSHIP' })
  })
  it('refuses invalid identities and fabricated roles', () => {
    for (const patch of [
      { organizationId: 'not-a-uuid' },
      { organizationId: '11111111-1111-4111-8111-11111111111x' },
      { organizationId: null }, { organizationId: 7 },
      { role: 'owner' }, { role: 'BILLING_ADMIN' }, { role: null },
    ]) {
      expect(selectSingleUsageMembership([{...a,...patch}]))
        .toEqual({outcome:'INVALID_MEMBERSHIP'})
    }
  })
  it('does not accept a user-selected organization override from a row', () => {
    expect(selectSingleUsageMembership([{
      ...a, selectedOrganizationId: b.organizationId, userRole: 'OWNER',
    }])).toEqual({outcome:'SELECTED',organizationId:a.organizationId,role:'OWNER'})
  })
  it('never authorizes a trial mutation or asserts entitlement from membership', () => {
    const output = selectSingleUsageMembership([a])
    expect(output).toEqual({outcome:'SELECTED',organizationId:a.organizationId,role:'OWNER'})
    expect(JSON.stringify(output)).not.toMatch(/(?:PAID|ACTIVATED|PROCESSED)/)
  })
})
