'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeQuickCompleteInput } from '@/domain/completion'
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

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Verify user is a member of this organization
  const { data: membership, error: memError } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (memError || !membership) {
    return { success: false, error: 'Access denied: You are not a member of this organization' }
  }

  // Normalize inputs
  const norm = normalizeQuickCompleteInput({
    organizationId,
    locationId,
    firstName,
    lastName,
    email,
    phone,
    completedAt,
    sourceEventId,
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

  // Emit Inngest durable event
  try {
    await inngest.send({
      name: 'customer.completed',
      data: {
        eventId: insertedEvent.id,
        organizationId,
        locationId,
        customerId,
        sourceEventId: canonical.source_event_id,
        completedAt: canonical.completed_at,
        country: canonical.country,
        contact: canonical.contact,
        permission: canonical.permission,
      },
    })
  } catch (inngestErr) {
    console.error('Inngest event dispatch warning:', inngestErr)
  }

  // Update usage counter
  const adminClient = createAdminClient()
  const period = new Date().toISOString().slice(0, 7)
  const { data: usageRow } = await supabase
    .from('organization_usage')
    .select('value')
    .eq('organization_id', organizationId)
    .eq('period', period)
    .eq('metric', 'completed_customers')
    .maybeSingle()

  const currentVal = usageRow?.value ? Number(usageRow.value) : 0
  await adminClient.from('organization_usage').upsert({
    organization_id: organizationId,
    period,
    metric: 'completed_customers',
    value: currentVal + 1,
  })

  // Audit event
  await adminClient.from('audit_events').insert({
    organization_id: organizationId,
    actor_type: 'user',
    actor_id: user.id,
    event_type: 'customer.completed',
    entity_type: 'customer_completion_event',
    entity_id: insertedEvent.id,
    metadata: { source_event_id: canonical.source_event_id, customer_id: customerId },
  })

  return {
    success: true,
    duplicate: false,
    customerId,
    message: 'Customer completion recorded and review workflow scheduled.',
  }
}
