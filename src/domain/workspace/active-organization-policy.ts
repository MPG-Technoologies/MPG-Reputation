/**
 * MR-5I4K — domain contract for a FUTURE app-wide active organization.
 *
 * Caller must first authenticate a non-anonymous server session and load
 * CURRENT organization_users rows for that exact user under normal tenant
 * RLS. These rows must NOT come from a browser, editable user metadata,
 * stale cached claims or a privileged client. This pure policy is not an
 * authorization check and is intentionally NOT wired to AppLayout/actions.
 *
 * A proposed organization ID (future route/session preference) is a HINT,
 * never a source of membership or billing/entitlement authority.
 */
export interface CurrentWorkspaceMembership {
  readonly organizationId: unknown
  readonly organizationName: unknown
  readonly role: unknown
}

export type WorkspaceMemberRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER'

export interface WorkspaceOrganizationChoice {
  readonly organizationId: string
  readonly organizationName: string
  readonly role: WorkspaceMemberRole
}

export type ActiveOrganizationResolution =
  | { readonly outcome: 'UNAVAILABLE' }
  | { readonly outcome: 'NO_MEMBERSHIP' }
  | { readonly outcome: 'INVALID_MEMBERSHIPS' }
  | { readonly outcome: 'SELECTION_DENIED' }
  | { readonly outcome: 'SELECTION_REQUIRED'; readonly choices: readonly WorkspaceOrganizationChoice[] }
  | { readonly outcome: 'SELECTED'; readonly organization: WorkspaceOrganizationChoice }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRole(role: unknown): role is WorkspaceMemberRole {
  return role === 'OWNER' || role === 'ADMIN' ||
    role === 'OPERATOR' || role === 'VIEWER'
}

/**
 * No navigation, cookie, database access, or state mutation occurs here.
 * An app-wide caller must authorize every API/RPC mutation separately.
 *
 * - A single valid membership can be selected only if no contrary hint exists.
 * - Multiple memberships require an explicit revalidated choice.
 * - Stale, forged or revoked organization hints fail closed; never fall back.
 * - Malformed source rows or duplicate identities fail closed.
 * - A denied choice never returns a tenant ID, role or name.
 */
export function resolveProposedActiveOrganization(
  memberships: readonly CurrentWorkspaceMembership[] | null | undefined,
  proposedOrganizationId?: unknown,
): ActiveOrganizationResolution {
  if (!Array.isArray(memberships)) return { outcome: 'UNAVAILABLE' }
  if (memberships.length === 0) return { outcome: 'NO_MEMBERSHIP' }

  const choices: WorkspaceOrganizationChoice[] = []
  const seen = new Set<string>()
  for (const membership of memberships) {
    if (!membership ||
        typeof membership.organizationId !== 'string' ||
        !UUID.test(membership.organizationId) ||
        typeof membership.organizationName !== 'string' ||
        membership.organizationName.trim().length === 0 ||
        !isRole(membership.role)) {
      return { outcome: 'INVALID_MEMBERSHIPS' }
    }
    const organizationId = membership.organizationId.toLowerCase()
    if (seen.has(organizationId)) {
      return { outcome: 'INVALID_MEMBERSHIPS' }
    }
    seen.add(organizationId)
    choices.push({
      organizationId,
      organizationName: membership.organizationName.trim(),
      role: membership.role,
    })
  }

  if (proposedOrganizationId === undefined || proposedOrganizationId === null) {
    return choices.length === 1
      ? { outcome: 'SELECTED', organization: choices[0] }
      : {
          outcome: 'SELECTION_REQUIRED',
          choices: choices.sort((a, b) =>
            a.organizationId.localeCompare(b.organizationId)),
        }
  }

  // Invalid and nonmember hints intentionally return the SAME response to
  // avoid turning this resolver into an organization identity probe.
  if (typeof proposedOrganizationId !== 'string' ||
      !UUID.test(proposedOrganizationId)) {
    return { outcome: 'SELECTION_DENIED' }
  }
  const selected = choices.find(
    item => item.organizationId === proposedOrganizationId.toLowerCase(),
  )
  return selected
    ? { outcome: 'SELECTED', organization: selected }
    : { outcome: 'SELECTION_DENIED' }
}
