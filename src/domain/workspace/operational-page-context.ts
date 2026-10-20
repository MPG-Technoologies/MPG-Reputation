/**
 * Server-side operational page context from a CURRENT authenticated,
 * user-scoped, RLS-protected organization_users membership query.
 *
 * A membership is not a mutation authorization. Server actions/RPCs must
 * independently recheck the actual user, organization, role and tenant.
 * Until an app-wide organization selector is owner-approved, never infer a
 * writable business from first-row order, a query string or browser state.
 */
export type OperationalMembership = {
  readonly organization_id: unknown
  readonly role: unknown
}

export type OperationalPageContext =
  | { readonly outcome: 'UNAVAILABLE' }
  | { readonly outcome: 'NO_MEMBERSHIP' }
  | { readonly outcome: 'MULTIPLE_BUSINESSES' }
  | { readonly outcome: 'INVALID_MEMBERSHIP' }
  | {
      readonly outcome: 'SELECTED'
      readonly organizationId: string
      readonly role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER'
      readonly canEdit: boolean
    }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function resolveOperationalPageContext(
  memberships: readonly OperationalMembership[] | null | undefined,
): OperationalPageContext {
  if (!Array.isArray(memberships)) return { outcome: 'UNAVAILABLE' }
  if (memberships.length === 0) return { outcome: 'NO_MEMBERSHIP' }
  // Refuse arbitrary membership ordering, even when both rows refer to one
  // business. No implicit switcher has been accepted for these pages.
  if (memberships.length !== 1) return { outcome: 'MULTIPLE_BUSINESSES' }
  const membership = memberships[0]
  if (!membership ||
      typeof membership.organization_id !== 'string' ||
      !uuid.test(membership.organization_id) ||
      (membership.role !== 'OWNER' && membership.role !== 'ADMIN' &&
       membership.role !== 'OPERATOR' && membership.role !== 'VIEWER')) {
    return { outcome: 'INVALID_MEMBERSHIP' }
  }
  return {
    outcome: 'SELECTED',
    organizationId: membership.organization_id,
    role: membership.role,
    canEdit: membership.role !== 'VIEWER',
  }
}
