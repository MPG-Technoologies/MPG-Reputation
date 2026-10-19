/**
 * MR-5I4I — Billing workspace organization selection safety.
 *
 * Input is expected from the authenticated user's RLS-scoped membership read;
 * this function is a presentation/context guard, NOT a replacement for DB
 * tenant isolation, user_has_role, request authorization or RLS.
 *
 * The application shell currently uses its first membership. Never silently
 * use that arbitrary order for a financially sensitive billing workspace if
 * multiple organizations are available and no explicit trusted active
 * organization selection exists.
 */
export interface BillingMembershipCandidate {
  readonly organizationId: unknown
  readonly role: unknown
  readonly organizationName: unknown
}

export type BillingMembershipSelection =
  | { readonly outcome: 'NO_MEMBERSHIP' }
  | { readonly outcome: 'AMBIGUOUS_ORGANIZATION' }
  | { readonly outcome: 'INVALID_MEMBERSHIP' }
  | { readonly outcome: 'ROLE_RESTRICTED' }
  | {
      readonly outcome: 'SELECTED'
      readonly organizationId: string
      readonly organizationName: string
    }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function selectSingleBillingMembership(
  candidates: readonly BillingMembershipCandidate[] | null | undefined
): BillingMembershipSelection {
  if (!Array.isArray(candidates)) return { outcome: 'INVALID_MEMBERSHIP' }
  if (candidates.length === 0) return { outcome: 'NO_MEMBERSHIP' }

  // Check cardinality *before* role, name, or ID. No organization may be
  // picked based on ordering, first OWNER privilege, or an unsigned URL.
  if (candidates.length !== 1) return { outcome: 'AMBIGUOUS_ORGANIZATION' }

  const membership = candidates[0]
  if (!membership ||
      typeof membership.organizationId !== 'string' ||
      !UUID.test(membership.organizationId) ||
      typeof membership.role !== 'string') {
    return { outcome: 'INVALID_MEMBERSHIP' }
  }

  if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
    return { outcome: 'ROLE_RESTRICTED' }
  }
  if (typeof membership.organizationName !== 'string' ||
      membership.organizationName.trim().length === 0) {
    return { outcome: 'INVALID_MEMBERSHIP' }
  }

  return {
    outcome: 'SELECTED',
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
  }
}
