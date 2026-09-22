import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { SupportAccess } from './access'

type SupportAuditEvent =
  | 'support.organization_inspection'
  | 'support.exception_queue_inspection'
  | 'support.health_snapshot_inspection'

async function recordSupportAudit(
  access: SupportAccess,
  eventType: SupportAuditEvent,
  outcome: 'AVAILABLE' | 'UNAVAILABLE'
): Promise<boolean> {
  try {
    const { error } = await createAdminClient().from('audit_events').insert({
      organization_id: access.organizationId,
      actor_type: 'user',
      actor_id: access.actorId,
      event_type: eventType,
      entity_type: 'organization',
      entity_id: access.organizationId,
      metadata: { outcome },
    })

    return !error
  } catch {
    return false
  }
}

/** Fixed, minimal audit for the MR-6A organization inspection. */
export async function recordSupportInspection(
  access: SupportAccess,
  outcome: 'AVAILABLE' | 'UNAVAILABLE'
): Promise<boolean> {
  return recordSupportAudit(
    access,
    'support.organization_inspection',
    outcome
  )
}

/** Fixed, minimal audit for the MR-6B operational exception queue. */
export async function recordSupportExceptionQueueInspection(
  access: SupportAccess,
  outcome: 'AVAILABLE' | 'UNAVAILABLE'
): Promise<boolean> {
  return recordSupportAudit(
    access,
    'support.exception_queue_inspection',
    outcome
  )
}
/** Fixed, minimal audit for the MR-6C health snapshot. */
export async function recordSupportHealthSnapshotInspection(
  access: SupportAccess,
  outcome: 'AVAILABLE' | 'UNAVAILABLE'
): Promise<boolean> {
  return recordSupportAudit(
    access,
    'support.health_snapshot_inspection',
    outcome
  )
}
