import { createClient } from '@/lib/supabase/server'
import {
  resolveProposedActiveOrganization,
  type ActiveOrganizationResolution,
  type CurrentWorkspaceMembership,
} from '@/domain/workspace/active-organization-policy'

/**
 * MR-5I4L — UNWIRED authenticated membership read boundary.
 *
 * This function must run in a Next.js server context, with the existing
 * cookie-backed *user* Supabase client. No service-role client, privileged
 * RPC, user-metadata permission, stateful preference, or cached membership.
 *
 * A caller-supplied proposed ID is an untrusted *hint*. The returned
 * selection is only view context, never proof of an action permission:
 * every later operation must independently check fresh auth/role/RLS.
 *
 * Do not mount this behind an unauthenticated endpoint exposing choice
 * lists. No route, layout, cookie or mutation calls this yet.
 */
export type ServerActiveOrganizationResolution =
  | { readonly outcome: 'AUTH_REQUIRED' }
  | ActiveOrganizationResolution

export async function resolveCurrentServerOrganization(
  proposedOrganizationId?: unknown,
): Promise<ServerActiveOrganizationResolution> {
  // A fresh client request/session is required; no cross-request memoization.
  const supabase = await createClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user || auth.user.is_anonymous) {
    return { outcome: 'AUTH_REQUIRED' }
  }

  const { data: rows, error } = await supabase
    .from('organization_users')
    .select('organization_id, role, organizations(id, name)')
    .eq('user_id', auth.user.id)

  // A failed membership join cannot be mistaken for an empty account.
  if (error || !rows) return { outcome: 'UNAVAILABLE' }

  // Reject null, foreign, missing or malformed joined organization records.
  // Membership row is authoritative only for the authenticated user; the
  // joined organization must agree with its exact organization_id.
  const memberships: CurrentWorkspaceMembership[] = []
  for (const row of rows) {
    const related = row.organizations as {
      id?: unknown
      name?: unknown
    } | null
    if (!related ||
        typeof related.id !== 'string' ||
        typeof row.organization_id !== 'string' ||
        related.id.toLowerCase() !== row.organization_id.toLowerCase()) {
      return { outcome: 'INVALID_MEMBERSHIPS' }
    }
    memberships.push({
      organizationId: row.organization_id,
      organizationName: related.name,
      role: row.role,
    })
  }

  return resolveProposedActiveOrganization(
    memberships,
    proposedOrganizationId,
  )
}
