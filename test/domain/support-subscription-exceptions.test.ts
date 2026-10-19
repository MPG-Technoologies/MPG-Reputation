import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/support/access', () => ({ authorizeSupportAccess: vi.fn() }))
vi.mock('@/lib/support/audit', () => ({
  recordSupportSubscriptionExceptionInspection: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { authorizeSupportAccess } from '../../src/lib/support/access'
import { recordSupportSubscriptionExceptionInspection } from '../../src/lib/support/audit'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  getSupportSubscriptionExceptionCases,
  isLocalSubscriptionExceptionSupportViewEnabled,
} from '../../src/lib/support/subscription-exceptions'

const org='11111111-1111-4111-8111-111111111111'
const actor='22222222-2222-4222-8222-222222222222'
const id='33333333-3333-4333-8333-333333333333'
const subscriptionId='44444444-4444-4444-8444-444444444444'
const vars=[
 'ENABLE_LOCAL_SUBSCRIPTION_EXCEPTION_SUPPORT_VIEW',
 'MPG_SUBSCRIPTION_EXCEPTION_SUPPORT_TARGET','ENABLE_LIVE_BILLING',
 'NEXT_PUBLIC_SUPABASE_URL','VERCEL_ENV',
]
const original=Object.fromEntries(vars.map(k=>[k,process.env[k]]))

function enable() {
 process.env.ENABLE_LOCAL_SUBSCRIPTION_EXCEPTION_SUPPORT_VIEW='true'
 process.env.MPG_SUBSCRIPTION_EXCEPTION_SUPPORT_TARGET='LOCAL_SYNTHETIC'
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54331'
 process.env.ENABLE_LIVE_BILLING='false'
 delete process.env.VERCEL_ENV
}
function row(fields:Record<string,unknown>={}) {
 return {
  id,organization_id:org,subscription_record_id:subscriptionId,
  review_reason:'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW',review_state:'OPEN',
  environment:'TEST',source_kind:'SYNTHETIC',verification_status:'UNVERIFIED',
  access_authorized:false,opened_at:'2026-10-19T08:00:00.000Z',...fields,
 }
}
function fixtures(rows:Record<string,unknown>[]=[row()]) {
 const auth={actorId:actor,organizationId:org,supabase:{}}
 vi.mocked(authorizeSupportAccess).mockResolvedValue(auth as never)
 vi.mocked(recordSupportSubscriptionExceptionInspection).mockResolvedValue(true)
 const chain={
  select:vi.fn().mockReturnThis(),
  eq:vi.fn().mockReturnThis(),
  order:vi.fn().mockReturnThis(),
  limit:vi.fn(async()=>({data:rows,error:null})),
 }
 vi.mocked(createAdminClient).mockReturnValue({from:vi.fn(()=>chain)} as never)
 return chain
}
describe('MR-5E3C3C audited internal synthetic subscription inspection',()=>{
 beforeEach(()=>{vi.resetAllMocks();enable()})
 afterEach(()=>{for(const [k,v] of Object.entries(original)){
  if(v===undefined)delete process.env[k]
  else process.env[k]=v
 }})
 it('is fail-closed without local test flag or on hosted/production targets',()=>{
  for(const x of [
   {ENABLE_LOCAL_SUBSCRIPTION_EXCEPTION_SUPPORT_VIEW:'false'},
   {MPG_SUBSCRIPTION_EXCEPTION_SUPPORT_TARGET:'HOSTED'},
   {NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co'},
   {ENABLE_LIVE_BILLING:'true'},
   {VERCEL_ENV:'preview'},
  ]){
   enable();Object.assign(process.env,x)
   expect(isLocalSubscriptionExceptionSupportViewEnabled()).toBe(false)
  }
 })
 it('does no authorized or privileged reads when disabled',async()=>{
  process.env.ENABLE_LOCAL_SUBSCRIPTION_EXCEPTION_SUPPORT_VIEW='false'
  expect(await getSupportSubscriptionExceptionCases(org)).toEqual({status:'DISABLED'})
  expect(authorizeSupportAccess).not.toHaveBeenCalled()
  expect(createAdminClient).not.toHaveBeenCalled()
 })
 it('denies missing support authority before privileged reads',async()=>{
  vi.mocked(authorizeSupportAccess).mockResolvedValue(null)
  expect(await getSupportSubscriptionExceptionCases(org)).toEqual({status:'DENIED'})
  expect(createAdminClient).not.toHaveBeenCalled()
 })
 it('bounds returned rows, rechecks support actor and audits before display',async()=>{
  const chain=fixtures([row({email:'secret@example.test',provider_customer_id:'cus_hidden'})])
  const result=await getSupportSubscriptionExceptionCases(org)
  expect(result.status).toBe('AVAILABLE')
  if(result.status!=='AVAILABLE')return
  expect(result.cases).toEqual([{
    id,subscriptionRecordId:subscriptionId,
    reason:'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW',
    openedAt:'2026-10-19T08:00:00.000Z',
  }])
  expect(JSON.stringify(result)).not.toContain('secret@example.test')
  expect(JSON.stringify(result)).not.toContain('cus_hidden')
  expect(chain.eq).toHaveBeenCalledWith('organization_id',org)
  expect(chain.eq).toHaveBeenCalledWith('review_state','OPEN')
  expect(chain.limit).toHaveBeenCalledWith(21)
  expect(authorizeSupportAccess).toHaveBeenCalledTimes(2)
  expect(recordSupportSubscriptionExceptionInspection)
   .toHaveBeenCalledWith(expect.objectContaining({actorId:actor}),'AVAILABLE')
 })
 it('does not return data when the scoped support grant changes after read',async()=>{
  fixtures()
  vi.mocked(authorizeSupportAccess)
   .mockResolvedValueOnce({actorId:actor,organizationId:org,supabase:{}} as never)
   .mockResolvedValueOnce(null)
  expect(await getSupportSubscriptionExceptionCases(org)).toEqual({status:'DENIED'})
  expect(recordSupportSubscriptionExceptionInspection).not.toHaveBeenCalled()
 })
 it('refuses to reveal rows if mandatory audit recording fails',async()=>{
  fixtures()
  vi.mocked(recordSupportSubscriptionExceptionInspection).mockResolvedValue(false)
  expect(await getSupportSubscriptionExceptionCases(org)).toEqual({status:'UNAVAILABLE'})
 })
 it('rejects malformed, foreign tenant or non-synthetic response rows',async()=>{
  for(const change of [
   {organization_id:'55555555-5555-4555-8555-555555555555'},
   {verification_status:'VERIFIED'},
   {environment:'LIVE'},
   {access_authorized:true},
   {review_reason:'NOT_A_REASON'},
   {subscription_record_id:'invalid'},
  ]) {
   fixtures([row(change)])
   expect(await getSupportSubscriptionExceptionCases(org)).toEqual({status:'UNAVAILABLE'})
   expect(recordSupportSubscriptionExceptionInspection)
    .toHaveBeenCalledWith(expect.anything(),'UNAVAILABLE')
  }
 })
 it('limits to the first twenty cases and reports truncation',async()=>{
  fixtures(Array.from({length:21},(_,i)=>row({id: i===0?id:'aaaaaaaa-aaaa-4aaa-8aaa-'+String(i).padStart(12,'0')})))
  const result=await getSupportSubscriptionExceptionCases(org)
  expect(result.status).toBe('AVAILABLE')
  if(result.status==='AVAILABLE'){
   expect(result.cases).toHaveLength(20)
   expect(result.truncated).toBe(true)
  }
 })
})
