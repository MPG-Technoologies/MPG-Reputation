'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeQuickCompleteInput, PermissionState } from '@/domain/completion'
import { inngest } from '@/inngest/client'

export interface QuickCompleteResult {
  success: boolean
  duplicate?: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
  customerId?: string
}

export async function submitQuickComplete(formData: FormData): Promise<QuickCompleteResult> {
  const organizationId = formData.get('organizationId') as string
  const locationId = formData.get('locationId') as string
  const firstName = formData.get('firstName') as string
  const lastName = (formData.get('lastName') as string) || null
  const email = formData.get('email') as string
  const phone = (formData.get('phone') as string) || null
  const completedAt = (formData.get('completedAt') as string) || null
  const sourceEventId = (formData.get('sourceEventId') as string) || undefined
  const permissionEmailRaw = (formData.get('permissionEmail') as string) || 'unknown'
  const permissionEmail: PermissionState = ['allowed', 'unknown', 'denied'].includes(permissionEmailRaw)
    ? (permissionEmailRaw as PermissionState)
    : 'unknown'

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Verify user is a member and has an operational role (OWNER, ADMIN, OPERATOR)
  const { data: membership, error: memError } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (memError || !membership) {
    return { success: false, error: 'Access denied: You are not a member of this organization' }
  }

  if (membership.role === 'VIEWER') {
    return { success: false, error: 'Access denied: Viewers have read-only permissions' }
  }

  // Cross-tenant integrity: verify location belongs to organization
  const { data: loc } = await supabase
    .from('locations')
    .select('id')
    .eq('id', locationId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!loc) {
    return { success: false, error: 'Location does not belong to this organization' }
  }

  // Normalize inputs with explicit conservative permission
  const norm = normalizeQuickCompleteInput({
    organizationId,
    locationId,
    firstName,
    lastName,
    email,
    phone,
    completedAt,
    sourceEventId,
    permissionEmail,
  })

  if (!norm.valid || !norm.canonical || !norm.customerPayload) {
    return { success: false, fieldErrors: norm.errors || {}, error: 'Validation failed' }
  }

  const { canonical } = norm

  // Check for duplicate completion event to enforce strict idempotency
  const { data: existingEvent } = await supabase
    .from('customer_completion_events')
    .select('id, customer_id')
    .eq('organization_id', organizationId)
    .eq('source', canonical.source)
    .eq('source_event_id', canonical.source_event_id)
    .maybeSingle()

  if (existingEvent) {
    return {
      success: true,
      duplicate: true,
      customerId: existingEvent.customer_id,
      message: 'This completion was already recorded previously. Duplicate downstream request avoided.',
    }
  }

  // Prompt 1: Transactional Outbox via PostgreSQL RPC
  // Atomically resolves customer, creates completion event, and records outbox entry
  const { data: atomicResult, error: atomicErr } = await supabase.rpc('submit_quick_complete_atomic', {
    p_org_id: organizationId,
    p_loc_id: locationId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_email: email,
    p_phone: phone,
    p_permission_email: permissionEmail,
    p_permission_sms: 'unknown',
    p_permission_source: 'quick_complete',
    p_source: canonical.source,
    p_source_event_id: canonical.source_event_id,
    p_country: canonical.country,
  })

  if (atomicErr || !atomicResult) {
    return { success: false, error: `Failed to record completion transactionally: ${atomicErr?.message || 'unknown error'}` }
  }

  const atomicData = atomicResult as {
    customer_id: string
    completion_event_id: string
    outbox_id: string
    source_event_id: string
  }

  const customerId = atomicData.customer_id
  const eventPayload = {
    eventId: atomicData.completion_event_id,
    organizationId,
    locationId,
    customerId,
    sourceEventId: atomicData.source_event_id,
    completedAt: canonical.completed_at,
    country: canonical.country,
    contact: canonical.contact,
    permission: canonical.permission,
  }

  // Attempt immediate Inngest dispatch using stable domain-event identifier
  try {
    await inngest.send({
      id: atomicData.outbox_id,
      name: 'customer.completed',
      data: eventPayload,
    })

    await supabase
      .from('domain_event_outbox')
      .update({
        status: 'DISPATCHED',
        dispatched_at: new Date().toISOString(),
        attempt_count: 1,
      })
      .eq('id', atomicData.outbox_id)
  } catch (inngestErr: unknown) {
    const errorMsg = inngestErr instanceof Error ? inngestErr.message : 'Inngest send failed'
    console.error('Inngest immediate dispatch failure (durable event safely in outbox):', inngestErr)
    await supabase
      .from('domain_event_outbox')
      .update({
        status: 'PENDING',
        attempt_count: 1,
        last_error: errorMsg.slice(0, 500),
      })
      .eq('id', atomicData.outbox_id)
  }

  // Atomic usage counter increment via Admin Client (service_role only)
  const period = new Date().toISOString().slice(0, 7)
  try {
    const admin = createAdminClient()
    await admin.rpc('increment_organization_usage', {
      p_org_id: organizationId,
      p_period: period,
      p_metric: 'completed_customers',
      p_amount: 1,
    })
  } catch (usageErr) {
    console.error('Usage counter increment warning:', usageErr)
  }

  // Audit event
  try {
    const adminClient = createAdminClient()
    await adminClient.from('audit_events').insert({
      organization_id: organizationId,
      actor_type: 'user',
      actor_id: user.id,
      event_type: 'customer.completed',
      entity_type: 'customer_completion_event',
      entity_id: atomicData.completion_event_id,
      metadata: { source_event_id: atomicData.source_event_id, customer_id: customerId },
    })
  } catch (auditErr) {
    console.error('Audit event warning:', auditErr)
  }

  revalidatePath('/app/dashboard')

  return {
    success: true,
    duplicate: false,
    customerId,
    message: 'Customer completion recorded and review workflow scheduled.',
  }
}
