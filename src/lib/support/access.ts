import 'server-only'

import { createClient } from '@/lib/supabase/server'

const verifiedSupportAccess: unique symbol = Symbol('verifiedSupportAccess')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SupportAccess {
  readonly [verifiedSupportAccess]: true
  readonly actorId: string
  readonly organizationId: string
  readonly supabase: Awaited<ReturnType<typeof createClient>>
}

/** No cached authorization and no caller-supplied actor or privileged client. */
export async function authorizeSupportAccess(
  organizationId: string
): Promise<SupportAccess | null> {
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) return null

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user || user.is_anonymous) return null

    const target = organizationId.toLowerCase()
    const { data: membership, error: membershipError } = await supabase
      .from('organization_users')
      .select('organization_id, user_id, role')
      .eq('organization_id', target)
      .eq('user_id', user.id)
      .maybeSingle()

    if (
      membershipError || !membership ||
      membership.organization_id !== target || membership.user_id !== user.id ||
      !['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'].includes(membership.role)
    ) return null

    const { data: grant, error: grantError } = await supabase
      .from('support_access_grants')
      .select('organization_id, user_id, support_role, expires_at, revoked_at')
      .eq('organization_id', target)
      .eq('user_id', user.id)
      .eq('support_role', 'MPG_ADMIN')
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    // Explicit validation supplements (and never replaces) database RLS.
    if (
      grantError || !grant || grant.organization_id !== target ||
      grant.user_id !== user.id || grant.support_role !== 'MPG_ADMIN' ||
      grant.revoked_at !== null || !(Date.parse(grant.expires_at) > Date.now())
    ) return null

    return { [verifiedSupportAccess]: true, actorId: user.id, organizationId: target, supabase }
  } catch {
    // Same denial for missing target, missing grant, failed auth and failed lookup.
    return null
  }
}
