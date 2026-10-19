/**
 * MR-5I4J — single-business Usage & Trial context guard.
 *
 * Expected input is a server-side, authenticated, RLS-scoped membership read.
 * This pure classifier does not authenticate the source or authorize reads,
 * changes to trials or tenant mutations. Never pass user-submitted membership
 * collections to this function as proof of access.
 *
 * Until the shared app shell has an accepted, revalidated active organization
 * selector, usage and billing must not silently choose memberships[0].
 */
export interface UsageMembershipCandidate {
  readonly organizationId: unknown
  readonly role: unknown
}

export type UsageMembershipSelection =
  | { readonly outcome: 'UNAVAILABLE' }
  | { readonly outcome: 'NO_MEMBERSHIP' }
  | { readonly outcome: 'AMBIGUOUS_ORGANIZATION' }
  | { readonly outcome: 'INVALID_MEMBERSHIP' }
  | {
      readonly outcome: 'SELECTED'
      readonly organizationId: string
      readonly role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER'
    }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function selectSingleUsageMembership(
  memberships: readonly UsageMembershipCandidate[] | null | undefined,
): UsageMembershipSelection {
  if (!Array.isArray(memberships)) return { outcome: 'UNAVAILABLE' }
  if (memberships.length === 0) return { outcome: 'NO_MEMBERSHIP' }
  // Refuse ambiguous data BEFORE touching any tenant ID, including when the
  // first membership is OWNER or when duplicate rows appear.
  if (memberships.length !== 1) return { outcome: 'AMBIGUOUS_ORGANIZATION' }

  const row = memberships[0]
  if (!row || typeof row.organizationId !== 'string' ||
      !UUID.test(row.organizationId) ||
      (row.role !== 'OWNER' && row.role !== 'ADMIN' &&
       row.role !== 'OPERATOR' && row.role !== 'VIEWER')) {
    return { outcome: 'INVALID_MEMBERSHIP' }
  }

  return {
    outcome: 'SELECTED',
    organizationId: row.organizationId,
    role: row.role,
  }
}
