import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/support/access', () => ({ authorizeSupportAccess: vi.fn() }))
vi.mock('@/lib/support/audit', () => ({
  recordSupportBillingRecoveryInspection: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))
import { authorizeSupportAccess } from '../../src/lib/support/access'
import { recordSupportBillingRecoveryInspection } from '../../src/lib/support/audit'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  getSupportBillingRecoveryCases,
  isLocalBillingRecoverySupportViewEnabled,
} from '../../src/lib/support/billing-recovery'

const org='11111111-1111-4111-8111-111111111111'
const actor='22222222-2222-4222-8222-222222222222'
const original = Object.fromEntries([
  'ENABLE_STRIPE_TEST_RECOVERY_SUPPORT_VIEW',
  'MPG_STRIPE_TEST_RECOVERY_SUPPORT_TARGET',
  'ENABLE_LIVE_BILLING', 'NEXT_PUBLIC_SUPABASE_URL', 'VERCEL_ENV',
].map(k=>[k,process.env[k]]))
function enable(){
  process.env.ENABLE_STRIPE_TEST_RECOVERY_SUPPORT_VIEW='true'
  process.env.MPG_STRIPE_TEST_RECOVERY_SUPPORT_TARGET='LOCAL_SYNTHETIC'
  process.env.ENABLE_LIVE_BILLING='false'
  process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54331'
  delete process.env.VERCEL_ENV
}
function row(overrides:Record<string,unknown>={}){
  return {
    id:'33333333-3333-4333-8333-333333333333',
    organization_id:org,kind:'CHECKOUT',reason:'EXPIRED_CHECKOUT_SESSION',
    state:'OPEN',requested_at:'2026-10-19T01:00:00.000Z',...overrides,
  }
}
function fixtures(rows:Record<string,unknown>[]=[row()]){
  const snapshot={actorId:actor,organizationId:org,supabase:{}}
  vi.mocked(authorizeSupportAccess).mockResolvedValue(snapshot as never)
  vi.mocked(recordSupportBillingRecoveryInspection).mockResolvedValue(true)
  const chain={
    select:vi.fn().mockReturnThis(),
    eq:vi.fn().mockReturnThis(),
    order:vi.fn().mockReturnThis(),
    limit:vi.fn(async()=>({data:rows,error:null})),
  }
  vi.mocked(createAdminClient).mockReturnValue({
    from:vi.fn(()=>chain),
  } as never)
  return {snapshot,chain}
}
describe('MR-5D3D3B support-only TEST recovery inspection',()=>{
  beforeEach(()=>{vi.resetAllMocks();enable()})
  afterEach(()=>{for(const [k,v] of Object.entries(original)){
    if(v===undefined)delete process.env[k]
    else process.env[k]=v
  }})
  it('is disabled in production targets, hosted and without explicit flags',()=>{
    for(const patch of [
      {ENABLE_STRIPE_TEST_RECOVERY_SUPPORT_VIEW:'false'},
      {MPG_STRIPE_TEST_RECOVERY_SUPPORT_TARGET:'HOSTED_TEST'},
      {ENABLE_LIVE_BILLING:'true'},
      {NEXT_PUBLIC_SUPABASE_URL:'https://hosted.supabase.co'},
      {VERCEL_ENV:'preview'},
    ]){
      enable();Object.assign(process.env,patch)
      expect(isLocalBillingRecoverySupportViewEnabled()).toBe(false)
    }
  })
  it('does not inspect or audit while disabled',async()=>{
    process.env.ENABLE_STRIPE_TEST_RECOVERY_SUPPORT_VIEW='false'
    expect(await getSupportBillingRecoveryCases(org)).toEqual({status:'DISABLED'})
    expect(authorizeSupportAccess).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })
  it('denies without an MR-6 MPG_ADMIN grant before privileged reads',async()=>{
    vi.mocked(authorizeSupportAccess).mockResolvedValue(null)
    expect(await getSupportBillingRecoveryCases(org)).toEqual({status:'DENIED'})
    expect(createAdminClient).not.toHaveBeenCalled()
  })
  it('minimizes output, scopes DB read, rechecks actor and audits before return',async()=>{
    const f=fixtures([row({requested_by:'private',stripe_session_url:'secret'})])
    const result=await getSupportBillingRecoveryCases(org)
    expect(result.status).toBe('AVAILABLE')
    if(result.status!=='AVAILABLE')return
    expect(result.cases).toEqual([{
      id:row().id,kind:'CHECKOUT',reason:'EXPIRED_CHECKOUT_SESSION',
      state:'OPEN',requestedAt:'2026-10-19T01:00:00.000Z',
    }])
    expect(f.chain.eq).toHaveBeenCalledWith('organization_id',org)
    expect(f.chain.eq).toHaveBeenCalledWith('state','OPEN')
    expect(f.chain.limit).toHaveBeenCalledWith(21)
    expect(authorizeSupportAccess).toHaveBeenCalledTimes(2)
    expect(recordSupportBillingRecoveryInspection)
      .toHaveBeenCalledWith(expect.objectContaining({actorId:actor}), 'AVAILABLE')
  })
  it('returns UNAVAILABLE, not data, if audit persistence fails',async()=>{
    fixtures()
    vi.mocked(recordSupportBillingRecoveryInspection).mockResolvedValue(false)
    expect(await getSupportBillingRecoveryCases(org)).toEqual({status:'UNAVAILABLE'})
  })
  it('does not return snapshot if authorization changes after read',async()=>{
    fixtures()
    vi.mocked(authorizeSupportAccess).mockResolvedValueOnce({
      actorId:actor,organizationId:org,supabase:{},
    } as never).mockResolvedValueOnce(null)
    expect(await getSupportBillingRecoveryCases(org)).toEqual({status:'DENIED'})
    expect(recordSupportBillingRecoveryInspection).not.toHaveBeenCalled()
  })
  it('rejects unexpected tenant data and audits an unavailable outcome',async()=>{
    fixtures([row({organization_id:'44444444-4444-4444-8444-444444444444'})])
    expect(await getSupportBillingRecoveryCases(org)).toEqual({status:'UNAVAILABLE'})
    expect(recordSupportBillingRecoveryInspection)
      .toHaveBeenCalledWith(expect.anything(),'UNAVAILABLE')
  })
})
