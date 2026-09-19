'use server'

import { randomBytes, randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashCompletionApiSecret } from '@/domain/completion/api-auth'

export interface CreatedCredentialResult {
  id: string
  name: string
  apiKey: string
  rateLimitPerMinute: number
  createdAt: string
}

export interface CredentialListItem {
  id: string
  name: string
  status: 'ACTIVE' | 'REVOKED'
  rateLimitPerMinute: number
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface IngestionLogItem {
  id: string
  credentialId: string
  nonce: string
  requestTimestamp: string
  requestBodyHash: string
  sourceEventId: string | null
  locationId: string | null
  completionEventId: string | null
  status: 'CLAIMED' | 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' | 'FAILED'
  httpStatus: number | null
  errorCode: string | null
  processedAt: string | null
  createdAt: string
}

export async function createCompletionCredential(input: {
  organizationId: string
  name?: string
  rateLimitPerMinute?: number
}): Promise<{
  success: boolean
  error?: string
  credential?: CreatedCredentialResult
}> {
  const organizationId = input.organizationId?.trim()
  if (!organizationId) {
    return { success: false, error: 'Organization ID is required' }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Strict role check: Only OWNER and ADMIN can manage API credentials
  const { data: membership, error: memError } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (
    memError ||
    !membership ||
    !['OWNER', 'ADMIN'].includes(membership.role)
  ) {
    return {
      success: false,
      error: 'Access denied: Only owners and administrators can create credentials',
    }
  }

  const name = input.name?.trim() || 'Completion API Key'
  const rateLimit = Math.max(
    1,
    Math.min(10000, Number(input.rateLimitPerMinute) || 60)
  )

  const credentialId = randomUUID()
  const secret = randomBytes(32).toString('base64url')
  const secretHash = hashCompletionApiSecret(secret)
  const fullApiKey = `mpg_v1.${credentialId}.${secret}`

  const adminClient = createAdminClient()
  const { error: insertError } = await adminClient
    .from('completion_api_credentials')
    .insert({
      id: credentialId,
      organization_id: organizationId,
      name,
      secret_hash: secretHash,
      status: 'ACTIVE',
      rate_limit_per_minute: rateLimit,
    })

  if (insertError) {
    console.error(
      '[CompletionCredentials] Failed to insert credential:',
      insertError
    )
    return {
      success: false,
      error: 'Failed to create completion credential',
    }
  }

  try {
    await adminClient.from('audit_events').insert({
      organization_id: organizationId,
      actor_type: 'user',
      actor_id: user.id,
      event_type: 'completion_credential.created',
      entity_type: 'completion_api_credential',
      entity_id: credentialId,
      metadata: {
        name,
        rate_limit_per_minute: rateLimit,
      },
    })
  } catch (auditErr) {
    console.error('[CompletionCredentials] Audit log warning:', auditErr)
  }

  revalidatePath('/app/settings/integrations')

  return {
    success: true,
    credential: {
      id: credentialId,
      name,
      apiKey: fullApiKey,
      rateLimitPerMinute: rateLimit,
      createdAt: new Date().toISOString(),
    },
  }
}

export async function revokeCompletionCredential(input: {
  organizationId: string
  credentialId: string
}): Promise<{
  success: boolean
  error?: string
}> {
  const organizationId = input.organizationId?.trim()
  const credentialId = input.credentialId?.trim()

  if (!organizationId || !credentialId) {
    return { success: false, error: 'Missing required parameters' }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  const { data: membership, error: memError } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (
    memError ||
    !membership ||
    !['OWNER', 'ADMIN'].includes(membership.role)
  ) {
    return {
      success: false,
      error: 'Access denied: Only owners and administrators can revoke credentials',
    }
  }

  const adminClient = createAdminClient()
  const { error: updateError } = await adminClient
    .from('completion_api_credentials')
    .update({
      status: 'REVOKED',
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', credentialId)
    .eq('organization_id', organizationId)

  if (updateError) {
    console.error(
      '[CompletionCredentials] Failed to revoke credential:',
      updateError
    )
    return { success: false, error: 'Failed to revoke credential' }
  }

  try {
    await adminClient.from('audit_events').insert({
      organization_id: organizationId,
      actor_type: 'user',
      actor_id: user.id,
      event_type: 'completion_credential.revoked',
      entity_type: 'completion_api_credential',
      entity_id: credentialId,
    })
  } catch (auditErr) {
    console.error('[CompletionCredentials] Audit log warning:', auditErr)
  }

  revalidatePath('/app/settings/integrations')

  return { success: true }
}

export async function listCompletionCredentials(
  organizationId: string
): Promise<CredentialListItem[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return []
  }

  const { data: membership } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return []
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('completion_api_credentials')
    .select(
      'id, name, status, rate_limit_per_minute, last_used_at, revoked_at, created_at'
    )
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  if (error || !data) {
    return []
  }

  return data.map((item) => ({
    id: item.id,
    name: item.name,
    status: item.status as 'ACTIVE' | 'REVOKED',
    rateLimitPerMinute: item.rate_limit_per_minute,
    lastUsedAt: item.last_used_at,
    revokedAt: item.revoked_at,
    createdAt: item.created_at,
  }))
}

export async function listIngestionLogs(
  organizationId: string,
  limit = 50
): Promise<IngestionLogItem[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return []
  }

  const { data: membership } = await supabase
    .from('organization_users')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return []
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('completion_ingestion_requests')
    .select(
      'id, credential_id, nonce, request_timestamp, request_body_hash, source_event_id, location_id, completion_event_id, status, http_status, error_code, processed_at, created_at'
    )
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    return []
  }

  return data.map((row) => ({
    id: row.id,
    credentialId: row.credential_id,
    nonce: row.nonce,
    requestTimestamp: row.request_timestamp,
    requestBodyHash: row.request_body_hash,
    sourceEventId: row.source_event_id,
    locationId: row.location_id,
    completionEventId: row.completion_event_id,
    status: row.status as IngestionLogItem['status'],
    httpStatus: row.http_status,
    errorCode: row.error_code,
    processedAt: row.processed_at,
    createdAt: row.created_at,
  }))
}
