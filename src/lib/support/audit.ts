import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { SupportAccess } from './access'

/** The only privileged support operation: a fixed, minimal audit insert. */
export async function recordSupportInspection(
  access: SupportAccess,
  outcome: 'AVAILABLE' | 'UNAVAILABLE'
): Promise<boolean> {
  try {
    const { error } = await createAdminClient().from('audit_events').insert({
      organization_id: access.organizationId,
      actor_type: 'user',
      actor_id: access.actorId,
      event_type: 'support.organization_inspection',
      entity_type: 'organization',
      entity_id: access.organizationId,
      metadata: { outcome },
    })
    return !error
  } catch {
    return false
  }
}
