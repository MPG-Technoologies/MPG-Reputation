import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../src/types/database'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const opts={auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient<Database>(url,serviceKey,opts)
const anonymous=createClient<Database>(url,anonKey,opts)
const viewer=createClient<Database>(url,anonKey,opts)
const suffix=randomUUID().replaceAll('-','')
let ownerId='',viewerId='',orgId='',foreignOrgId=''

function data<T extends {data:unknown;error:unknown}>(r:T):NonNullable<T['data']>{
  if(r.error||r.data===null)throw new Error('Synthetic rate-limit SQL failed',{cause:r.error})
  return r.data as NonNullable<T['data']>
}
function parsed(r:Json|null){
  if(!r||typeof r!=='object'||Array.isArray(r))throw new Error('Bad rate-limit response')
  return r as Record<string,unknown>
}
async function claim(
  action:'CUSTOMER_SETUP'|'CHECKOUT'|'PORTAL'='CHECKOUT',
  userId=ownerId, organizationId=orgId
) {
  return parsed(data(await admin.rpc('claim_stripe_test_billing_action',{
    p_user_id:userId,p_organization_id:organizationId,p_action:action,
  })))
}
async function reset() {
  data(await admin.from('stripe_test_billing_action_limits')
    .delete().eq('organization_id',orgId).select('organization_id'))
}

describe('MR-5D3C1 TEST service-role billing action rate limit (disposable DB)',()=>{
  beforeAll(async()=>{
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    orgId=data(await admin.from('organizations').insert({
      name:'MR-5D3C1 Synthetic Business',slug:'mr5d3c1-'+suffix,
    }).select('id').single()).id
    foreignOrgId=data(await admin.from('organizations').insert({
      name:'MR-5D3C1 Foreign Business',slug:'mr5d3c1-foreign-'+suffix,
    }).select('id').single()).id
    const pw=randomUUID()
    const created=data(await admin.auth.admin.createUser({
      email:'mr5d3c1-owner-'+suffix+'@example.test',password:pw,email_confirm:true,
    }))
    const created2=data(await admin.auth.admin.createUser({
      email:'mr5d3c1-viewer-'+suffix+'@example.test',
      password:randomUUID(),email_confirm:true,
    }))
    if(!created.user||!created2.user)throw new Error('Fixture users missing')
    ownerId=created.user.id;viewerId=created2.user.id
    data(await admin.from('organization_users').insert([
      {organization_id:orgId,user_id:ownerId,role:'OWNER'},
      {organization_id:orgId,user_id:viewerId,role:'VIEWER'},
    ]).select('id'))
  },30000)
  afterAll(async()=>{
    for(const id of [orgId,foreignOrgId]){
      if(id){const {error}=await admin.from('organizations').delete().eq('id',id)
        if(error)throw error}
    }
    for(const id of [ownerId,viewerId]){
      if(id){const {error}=await admin.auth.admin.deleteUser(id)
        if(error)throw error}
    }
  })
  it('rejects service-role calls for viewers, unknown actors and foreign organizations',async()=>{
    expect(await claim('CHECKOUT',viewerId)).toEqual({outcome:'NOT_AUTHORIZED'})
    expect(await claim('CHECKOUT',randomUUID())).toEqual({outcome:'NOT_AUTHORIZED'})
    expect(await claim('CHECKOUT',ownerId,foreignOrgId)).toEqual({outcome:'NOT_AUTHORIZED'})
    expect(data(await admin.from('stripe_test_billing_action_limits')
      .select('user_id').eq('organization_id',orgId))).toHaveLength(0)
  })
  it('permits five requests across actions and denies the sixth',async()=>{
    await reset()
    const actions=['CUSTOMER_SETUP','CHECKOUT','PORTAL','CHECKOUT','PORTAL'] as const
    for(let i=0;i<actions.length;i++){
      expect(await claim(actions[i])).toEqual({outcome:'ALLOWED',remaining:4-i})
    }
    expect(await claim()).toEqual({outcome:'RATE_LIMITED'})
    const row=data(await admin.from('stripe_test_billing_action_limits')
      .select('attempts,last_action').eq('organization_id',orgId).single())
    expect(row).toMatchObject({attempts:5,last_action:'PORTAL'})
  })
  it('concurrent calls admit no more than five in the same minute',async()=>{
    await reset()
    const results=await Promise.all(Array.from({length:12},()=>claim()))
    expect(results.filter(x=>x.outcome==='ALLOWED')).toHaveLength(5)
    expect(results.filter(x=>x.outcome==='RATE_LIMITED')).toHaveLength(7)
    const bucket=data(await admin.from('stripe_test_billing_action_limits')
      .select('attempts').eq('organization_id',orgId).single())
    expect(bucket.attempts).toBe(5)
  })
  it('expired synthetic window resets atomically to one attempt',async()=>{
    data(await admin.from('stripe_test_billing_action_limits')
      .update({period_started_at:'2020-01-01T00:00:00Z'})
      .eq('organization_id',orgId).select('organization_id'))
    expect(await claim('CUSTOMER_SETUP')).toEqual({outcome:'ALLOWED',remaining:4})
    const bucket=data(await admin.from('stripe_test_billing_action_limits')
      .select('attempts,last_action').eq('organization_id',orgId).single())
    expect(bucket).toMatchObject({attempts:1,last_action:'CUSTOMER_SETUP'})
  })
  it('denies RPC and rate table to anon and authenticated browser users',async()=>{
    expect((await anonymous.rpc('claim_stripe_test_billing_action',{
      p_user_id:ownerId,p_organization_id:orgId,p_action:'CHECKOUT',
    })).error).not.toBeNull()
    expect((await viewer.rpc('claim_stripe_test_billing_action',{
      p_user_id:ownerId,p_organization_id:orgId,p_action:'PORTAL',
    })).error).not.toBeNull()
    expect((await anonymous.from('stripe_test_billing_action_limits')
      .select('user_id')).error).not.toBeNull()
    expect((await viewer.from('stripe_test_billing_action_limits')
      .select('user_id')).error).not.toBeNull()
  })
})
