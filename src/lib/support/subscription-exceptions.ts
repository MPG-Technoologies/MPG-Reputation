import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeSupportAccess } from './access'
import { recordSupportSubscriptionExceptionInspection } from './audit'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX = 20
const REASONS = [
'HISTORY_INVALID_OR_AMBIGUOUS','EVENT_FINGERPRINT_CONFLICT','OLDER_OR_EQUAL_TIME',
'INITIAL_SUBSCRIPTION_REQUIRES_REVIEW','UNSUPPORTED_TRANSITION',
'PAID_PERIOD_NOT_ADVANCED','PAID_PERIOD_INVALID',
'FAILED_PAYMENT_PERIOD_MISMATCH','REPEATED_PAYMENT_FAILURE',
'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW','DISPUTE_OR_REFUND_HOLD',
'CANCELLATION_HOLD','TERMINAL_SUBSCRIPTION_HOLD','END_BEFORE_PAID_PERIOD',
'REFUND_OR_DISPUTE_REQUIRES_REVIEW',
] as const

export interface SubscriptionExceptionCase {
  readonly id: string
  readonly subscriptionRecordId: string
  readonly reason: typeof REASONS[number]
  readonly openedAt: string
}
export type SubscriptionExceptionInspection =
 | { readonly status: 'DISABLED' | 'DENIED' | 'UNAVAILABLE' }
 | { readonly status: 'AVAILABLE'; readonly cases: SubscriptionExceptionCase[];
     readonly truncated: boolean; readonly snapshotAt: string }

export function isLocalSubscriptionExceptionSupportViewEnabled(): boolean {
 return process.env.ENABLE_LOCAL_SUBSCRIPTION_EXCEPTION_SUPPORT_VIEW === 'true' &&
 process.env.MPG_SUBSCRIPTION_EXCEPTION_SUPPORT_TARGET === 'LOCAL_SYNTHETIC' &&
 process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV === undefined &&
 process.env.ENABLE_LIVE_BILLING !== 'true' &&
 ['http://127.0.0.1:54331','http://localhost:54331']
 .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}
type CaseRow = {
 id: string; organization_id: string; subscription_record_id: string;
 review_reason: string; review_state: string; source_kind: string;
 environment: string; verification_status: string;
 access_authorized: boolean; opened_at: string
}
function parseCase(row: CaseRow, organizationId: string): SubscriptionExceptionCase | null {
 if (!UUID.test(row.id) || row.organization_id !== organizationId ||
 !UUID.test(row.subscription_record_id) ||
 !REASONS.includes(row.review_reason as typeof REASONS[number]) ||
 row.review_state !== 'OPEN' || row.source_kind !== 'SYNTHETIC' ||
 row.environment !== 'TEST' || row.verification_status !== 'UNVERIFIED' ||
 row.access_authorized !== false || !Number.isFinite(Date.parse(row.opened_at))) return null
 return {id: row.id, subscriptionRecordId: row.subscription_record_id,
 reason: row.review_reason as typeof REASONS[number], openedAt: row.opened_at}
}
export async function getSupportSubscriptionExceptionCases(
 organizationId: string
): Promise<SubscriptionExceptionInspection> {
 if (!isLocalSubscriptionExceptionSupportViewEnabled()) return {status:'DISABLED'}
 const access = await authorizeSupportAccess(organizationId)
 if (!access) return {status:'DENIED'}
 let cases: SubscriptionExceptionCase[]
 let truncated: boolean
 try {
  const {data,error} = await createAdminClient()
   .from('billing_synthetic_subscription_exception_reviews')
   .select('id,organization_id,subscription_record_id,review_reason,review_state,source_kind,environment,verification_status,access_authorized,opened_at')
   .eq('organization_id',access.organizationId).eq('review_state','OPEN')
   .order('opened_at',{ascending:true}).limit(MAX+1)
  if (error || !data || data.length > MAX+1) throw new Error('READ_FAILED')
  const parsed=data.slice(0,MAX).map(row=>parseCase(row,access.organizationId))
  if(parsed.some(row=>row===null)) throw new Error('INVALID_CASE_ROW')
  cases=parsed as SubscriptionExceptionCase[]
  truncated=data.length>MAX
 } catch {
  await recordSupportSubscriptionExceptionInspection(access,'UNAVAILABLE')
  return {status:'UNAVAILABLE'}
 }
 const current = await authorizeSupportAccess(access.organizationId)
 if(!current || current.actorId!==access.actorId) return {status:'DENIED'}
 const recorded=await recordSupportSubscriptionExceptionInspection(current,'AVAILABLE')
 if(!recorded) return {status:'UNAVAILABLE'}
 return {status:'AVAILABLE',cases,truncated,snapshotAt:new Date().toISOString()}
}
