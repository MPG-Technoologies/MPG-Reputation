import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeSupportAccess } from './access'
import { recordSupportTrialRequestInspection } from './audit'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_REQUESTS = 20
const VALID_TRIAL_STATES = [
  'NOT_STARTED', 'ACTIVE', 'EXHAUSTED', 'EXPIRED', 'ENDED', 'SUSPENDED',
] as const
type TrialState = typeof VALID_TRIAL_STATES[number]

export interface SupportTrialRequest {
  readonly id: string
  readonly status: 'OPEN'
  readonly reason: string
  readonly requestedAt: string
}

export interface SupportTrialContext {
  readonly businessName: string
  readonly businessStatus: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
  readonly trialStatus: TrialState
  readonly allocated: number
  readonly consumed: number
  readonly durationDays: number
  readonly expiresAt: string | null
}

export type SupportTrialRequestResult =
  | { readonly status: 'DISABLED' | 'DENIED' | 'UNAVAILABLE' }
  | {
      readonly status: 'AVAILABLE'
      readonly requests: readonly SupportTrialRequest[]
      readonly context: SupportTrialContext
      readonly truncated: boolean
      readonly snapshotAt: string
    }

/**
 * A local synthetic-only administrative read.
 * No access to hosted Supabase, payment providers, or real customer data.
 */
export function isLocalTrialRequestSupportViewEnabled(): boolean {
  return process.env.ENABLE_LOCAL_TRIAL_REQUEST_SUPPORT_VIEW === 'true' &&
    process.env.MPG_TRIAL_REQUEST_SUPPORT_TARGET === 'LOCAL_SYNTHETIC' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    process.env.ENABLE_LIVE_EMAIL !== 'true' &&
    ['http://127.0.0.1:54331', 'http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

function normalizeRequest(
  row: {
    id: string
    organization_id: string
    requested_by: string
    status: string
    reason: string
    requested_at: string
  },
  org: string
): SupportTrialRequest | null {
  if (!UUID.test(row.id) || row.organization_id !== org ||
      !UUID.test(row.requested_by) ||
      row.status !== 'OPEN' || typeof row.reason !== 'string' ||
      row.reason.trim().length < 20 || row.reason.length > 500 ||
      !Number.isFinite(Date.parse(row.requested_at))) return null
  return {
    id: row.id, status: 'OPEN', reason: row.reason,
    requestedAt: row.requested_at,
  }
}

function normalizeContext(
  orgRow: { id: string; name: string; status: string },
  trialRow: {
    organization_id: string; status: string; allocated_requests: number;
    consumed_requests: number; duration_days: number; expires_at: string | null
  },
  org: string
): SupportTrialContext | null {
  if (orgRow.id !== org || typeof orgRow.name !== 'string' ||
      orgRow.name.length < 1 || orgRow.name.length > 250 ||
      !['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(orgRow.status) ||
      trialRow.organization_id !== org ||
      !VALID_TRIAL_STATES.includes(trialRow.status as TrialState) ||
      !Number.isSafeInteger(trialRow.allocated_requests) ||
      !Number.isSafeInteger(trialRow.consumed_requests) ||
      !Number.isSafeInteger(trialRow.duration_days) ||
      trialRow.allocated_requests < 0 || trialRow.consumed_requests < 0 ||
      trialRow.duration_days < 1 ||
      (trialRow.expires_at !== null && !Number.isFinite(Date.parse(trialRow.expires_at)))) {
    return null
  }
  return {
    businessName: orgRow.name,
    businessStatus: orgRow.status as SupportTrialContext['businessStatus'],
    trialStatus: trialRow.status as TrialState,
    allocated: trialRow.allocated_requests,
    consumed: trialRow.consumed_requests,
    durationDays: trialRow.duration_days,
    expiresAt: trialRow.expires_at,
  }
}

/**
 * Never infer MPG staff authority from tenant OWNER/ADMIN role.
 * Authorization is MR-6 explicit current membership + unrevoked MPG_ADMIN grant.
 * Elevated reads are bounded to one organization and audited before disclosure.
 */
export async function getSupportTrialExtensionRequests(
  organizationId: string
): Promise<SupportTrialRequestResult> {
  if (!isLocalTrialRequestSupportViewEnabled()) return { status: 'DISABLED' }
  const access = await authorizeSupportAccess(organizationId)
  if (!access) return { status: 'DENIED' }

  let requests: SupportTrialRequest[]
  let context: SupportTrialContext
  let truncated: boolean

  try {
    const client = createAdminClient()
    const [requestResult, orgResult, trialResult] = await Promise.all([
      client.from('trial_extension_requests')
        .select('id,organization_id,requested_by,status,reason,requested_at')
        .eq('organization_id', access.organizationId)
        .eq('status', 'OPEN')
        .order('requested_at', { ascending: true })
        .limit(MAX_REQUESTS + 1),
      client.from('organizations').select('id,name,status')
        .eq('id', access.organizationId).maybeSingle(),
      client.from('organization_entitlements')
        .select('organization_id,status,allocated_requests,consumed_requests,duration_days,expires_at')
        .eq('organization_id', access.organizationId).maybeSingle(),
    ])
    if (requestResult.error || orgResult.error || trialResult.error ||
        !requestResult.data || !orgResult.data || !trialResult.data ||
        requestResult.data.length > MAX_REQUESTS + 1) {
      throw new Error('TRIAL_INBOX_READ_UNAVAILABLE')
    }
    const parsed = requestResult.data.slice(0, MAX_REQUESTS)
      .map(row => normalizeRequest(row, access.organizationId))
    const parsedContext = normalizeContext(
      orgResult.data, trialResult.data, access.organizationId
    )
    if (parsed.some(item => item === null) || !parsedContext) {
      throw new Error('TRIAL_INBOX_INTEGRITY_INVALID')
    }
    requests = parsed as SupportTrialRequest[]
    context = parsedContext
    truncated = requestResult.data.length > MAX_REQUESTS
  } catch {
    await recordSupportTrialRequestInspection(access, 'UNAVAILABLE')
    return { status: 'UNAVAILABLE' }
  }

  // Recheck after the reads: a revoked support grant cannot authorize output.
  const current = await authorizeSupportAccess(access.organizationId)
  if (!current || current.actorId !== access.actorId) return { status: 'DENIED' }
  if (!await recordSupportTrialRequestInspection(current, 'AVAILABLE')) {
    return { status: 'UNAVAILABLE' }
  }

  return {
    status: 'AVAILABLE', requests, context, truncated,
    snapshotAt: new Date().toISOString(),
  }
}
