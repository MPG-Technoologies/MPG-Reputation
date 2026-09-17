'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeQuickCompleteInput, type PermissionState } from '@/domain/completion'
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

  const { canonical, customerPayload } = norm

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

  // Create or resolve customer
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('email', customerPayload.email)
    .maybeSingle()

  let customerId = existingCustomer?.id

  if (!customerId) {
    const { data: newCust, error: custError } = await supabase
      .from('customers')
      .insert(customerPayload)
      .select('id')
      .single()

    if (custError || !newCust) {
      return { success: false, error: `Failed to persist customer: ${custError?.message || 'unknown'}` }
    }
    customerId = newCust.id
  } else {
    // Update permission if explicitly recorded
    if (permissionEmail !== 'unknown') {
      await supabase
        .from('customers')
        .update({
          permission_email: permissionEmail,
          permission_source: 'quick_complete',
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerId)
    }
  }

  // Insert canonical completion event
  const { data: insertedEvent, error: eventError } = await supabase
    .from('customer_completion_events')
    .insert({
      organization_id: organizationId,
      location_id: locationId,
      customer_id: customerId,
      source: canonical.source,
      source_event_id: canonical.source_event_id,
      source_customer_id: canonical.source_customer_id,
      source_transaction_id: canonical.source_transaction_id,
      completed_at: canonical.completed_at,
      country: canonical.country,
      contact: canonical.contact,
      permission: canonical.permission,
    })
    .select('id')
    .single()

  if (eventError || !insertedEvent) {
    return { success: false, error: `Failed to persist completion event: ${eventError?.message || 'unknown'}` }
  }

  const eventPayload = {
    eventId: insertedEvent.id,
    organizationId,
    locationId,
    customerId,
    sourceEventId: canonical.source_event_id,
    completedAt: canonical.completed_at,
    country: canonical.country,
    contact: canonical.contact,
    permission: canonical.permission,
  }

  // Transactional Outbox (Prompt Correction 9):
  // Persist domain event in outbox so it cannot be lost if Inngest is temporarily unavailable
  const { data: outboxEntry, error: outboxErr } = await supabase
    .from('domain_event_outbox')
    .insert({
      organization_id: organizationId,
      event_type: 'customer.completed',
      aggregate_type: 'customer_completion_event',
      aggregate_id: insertedEvent.id,
      payload: eventPayload,
      status: 'PENDING',
      attempt_count: 0,
    })
    .select('id')
    .single()

  if (outboxErr) {
    console.error('Failed to record domain event in outbox:', outboxErr)
  }

  // Attempt dispatch to Inngest
  let dispatchSuccess = false
  try {
    await inngest.send({
      name: 'customer.completed',
      data: eventPayload,
    })
    dispatchSuccess = true
  } catch (inngestErr) {
    console.error('Inngest immediate dispatch failure (retained in outbox):', inngestErr)
  }

  // Update outbox status accordingly
  if (outboxEntry) {
    if (dispatchSuccess) {
      await supabase
        .from('domain_event_outbox')
        .update({
          status: 'DISPATCHED',
          dispatched_at: new Date().toISOString(),
          attempt_count: 1,
        })
        .eq('id', outboxEntry.id)
    } else {
      await supabase
        .from('domain_event_outbox')
        .update({
          status: 'PENDING',
          attempt_count: 1,
          last_error: 'Inngest immediate send failed; queued for background dispatch',
        })
        .eq('id', outboxEntry.id)
    }
  }

  // Atomic usage counter increment (Prompt Correction 19)
  const period = new Date().toISOString().slice(0, 7)
  try {
    await supabase.rpc('increment_organization_usage', {
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
      entity_id: insertedEvent.id,
      metadata: { source_event_id: canonical.source_event_id, customer_id: customerId },
    })
  } catch (auditErr) {
    console.error('Audit event warning:', auditErr)
  }

  return {
    success: true,
    duplicate: false,
    customerId,
    message: 'Customer completion recorded and review workflow scheduled.',
  }
}
