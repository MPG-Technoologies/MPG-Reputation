import { describe, expect, it } from 'vitest'
import { selectSingleBillingMembership } from '../../src/domain/billing/workspace-organization-selection'

const a = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  organizationName: 'Synthetic Plumbing',
  role: 'OWNER',
}
const b = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  organizationName: 'Synthetic Services',
  role: 'ADMIN',
}

describe('MR-5I4I billing org context selection is fail-closed', () => {
  it('does not pick first, OWNER, or ADMIN of multiple unrelated memberships', () => {
    for (const rows of [
      [a, b], [b, a],
      [{ ...a, role: 'VIEWER' }, b],
      [a, { ...b, role: 'VIEWER' }],
      [a, a],
    ]) {
      expect(selectSingleBillingMembership(rows))
        .toEqual({ outcome: 'AMBIGUOUS_ORGANIZATION' })
    }
  })

  it('does not return a tenant ID or billing role in ambiguous cases', () => {
    const result = selectSingleBillingMembership([a, b])
    expect(JSON.stringify(result)).not.toContain(a.organizationId)
    expect(JSON.stringify(result)).not.toContain(b.organizationId)
    expect(JSON.stringify(result)).not.toContain(a.organizationName)
  })

  it('allows exactly one authorized OWNER or ADMIN with validated ID and name', () => {
    expect(selectSingleBillingMembership([a])).toEqual({
      outcome: 'SELECTED', organizationId: a.organizationId,
      organizationName: a.organizationName,
    })
    expect(selectSingleBillingMembership([b])).toEqual({
      outcome: 'SELECTED', organizationId: b.organizationId,
      organizationName: b.organizationName,
    })
  })

  it('denies viewer/operator or unknown role for a single membership', () => {
    for (const role of ['VIEWER', 'OPERATOR', 'BILLING_ADMIN', '', 'owner']) {
      expect(selectSingleBillingMembership([{ ...a, role }]))
        .toEqual({ outcome: 'ROLE_RESTRICTED' })
    }
  })

  it('redirects missing organization, but treats failed/invalid responses differently', () => {
    expect(selectSingleBillingMembership([])).toEqual({ outcome: 'NO_MEMBERSHIP' })
    expect(selectSingleBillingMembership(null)).toEqual({ outcome: 'INVALID_MEMBERSHIP' })
    expect(selectSingleBillingMembership(undefined)).toEqual({ outcome: 'INVALID_MEMBERSHIP' })
  })

  it('fails closed on invalid foreign identifiers and malformed names', () => {
    const invalid = [
      { organizationId: 'not-a-uuid' },
      { organizationId: '00000000-0000-0000-0000-000000000000x' },
      { organizationId: 100 },
      { organizationId: null },
      { role: null },
      { organizationName: null },
      { organizationName: '' },
      { organizationName: '  ' },
      { organizationName: 7 },
    ]
    for (const patch of invalid) {
      expect(selectSingleBillingMembership([{ ...a, ...patch }]))
        .toEqual({ outcome: 'INVALID_MEMBERSHIP' })
    }
  })

  it('never allows a privileged role to override a second unauthorized org', () => {
    expect(selectSingleBillingMembership([
      a, { ...b, role: 'VIEWER' },
    ])).toEqual({ outcome: 'AMBIGUOUS_ORGANIZATION' })
  })

  it('never accepts an organization from caller-provided query or checkout data', () => {
    // The context resolver exposes no user-supplied org ID selector or
    // override; only the actual (RLS-scoped) membership array is considered.
    const forged = { ...a, selectedOrganizationId: b.organizationId, role: 'OWNER' }
    expect(selectSingleBillingMembership([forged])).toEqual({
      outcome: 'SELECTED', organizationId: a.organizationId,
      organizationName: a.organizationName,
    })
  })
})
