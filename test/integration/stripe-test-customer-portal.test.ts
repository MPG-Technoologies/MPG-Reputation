import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))
import { prepareStripeTestPortalSession } from '../../src/lib/billing/stripe-test-customer-portal'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL!
const key=process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const options={auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient<Database>(url,key,options)
const owner=createClient<Database>(url,anonKey,options)
const viewer=createClient<Database>(url,anonKey,options)
const anon=createClient<Database>(url,anonKey,options)
const suffix=randomUUID().replaceAll('-','')
const token='cus_PortalSynthetic'+suffix
const configurationId='bpc_SyntheticPortal'
let ownerId='',viewerId='',orgId='',outsideOrgId=''

function checked<T extends {data:unknown;error:unknown}>(r:T):NonNullable<T['data']>{
  if(r.error||r.data===null)throw new Error('Disposable TEST database setup failed',{cause:r.error})
  return r.data as NonNullable<T['data']>
}
const retrieveConfiguration=vi.fn(async()=>({
  id:configurationId,livemode:false,active:true,loginPageEnabled:false,
  features:{
    invoiceHistoryEnabled:true,paymentMethodUpdateEnabled:true,
    subscriptionUpdateEnabled:false,subscriptionCancelEnabled:false,
    customerUpdateEnabled:false,
  },
}))
const createSession=vi.fn(async (input:{
  customerId:string;configurationId:string;returnUrl:string
})=>({
  id:'bps_SyntheticPortal',livemode:false,customer:input.customerId,
  configuration:input.configurationId,returnUrl:input.returnUrl,
  url:'https://billing.stripe.com/p/session/test_SyntheticPortal',
}))
async function run(client:typeof owner, selected=orgId){
  return prepareStripeTestPortalSession({
    userSupabase:client,
    organizationId:selected,
    retrieveConfiguration,createSession,
  })
}

const envKeys=[
  'ENABLE_STRIPE_TEST_PORTAL','MPG_STRIPE_TEST_PORTAL_TARGET',
  'ENABLE_LIVE_BILLING','VERCEL_ENV','MPG_BILLING_CHECKOUT_RETURN_ORIGIN',
  'STRIPE_TEST_PORTAL_CONFIGURATION_ID',
] as const
const previous=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]))

describe('MR-5D3B2 TEST customer portal tenant isolation (disposable DB)',()=>{
  beforeAll(async()=>{
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect(process.env.ENABLE_LIVE_BILLING).not.toBe('true')
    const pw=randomUUID(),pw2=randomUUID()
    orgId=checked(await admin.from('organizations').insert({
      name:'Synthetic Portal Business',slug:'mr5d3b2-'+suffix,
    }).select('id').single()).id
    outsideOrgId=checked(await admin.from('organizations').insert({
      name:'Foreign Portal Business',slug:'mr5d3b2-foreign-'+suffix,
    }).select('id').single()).id
    checked(await admin.from('organization_billing_accounts').insert({
      organization_id:orgId,provider:'stripe',environment:'TEST',
      provider_customer_id:token,
    }).select('id'))
    const created=checked(await admin.auth.admin.createUser({
      email:'mr5d3b2-owner-'+suffix+'@example.test',
      password:pw,email_confirm:true,
    }))
    const created2=checked(await admin.auth.admin.createUser({
      email:'mr5d3b2-viewer-'+suffix+'@example.test',
      password:pw2,email_confirm:true,
    }))
    if(!created.user||!created2.user)throw new Error('No fixture user')
    ownerId=created.user.id;viewerId=created2.user.id
    checked(await admin.from('organization_users').insert([
      {organization_id:orgId,user_id:ownerId,role:'OWNER'},
      {organization_id:orgId,user_id:viewerId,role:'VIEWER'},
    ]).select('id'))
    checked(await owner.auth.signInWithPassword({
      email:'mr5d3b2-owner-'+suffix+'@example.test',password:pw,
    }))
    checked(await viewer.auth.signInWithPassword({
      email:'mr5d3b2-viewer-'+suffix+'@example.test',password:pw2,
    }))
    process.env.ENABLE_STRIPE_TEST_PORTAL='true'
    process.env.MPG_STRIPE_TEST_PORTAL_TARGET='LOCAL_SYNTHETIC'
    process.env.ENABLE_LIVE_BILLING='false'
    process.env.MPG_BILLING_CHECKOUT_RETURN_ORIGIN='http://localhost:3000'
    process.env.STRIPE_TEST_PORTAL_CONFIGURATION_ID=configurationId
    delete process.env.VERCEL_ENV
  },30000)
  afterAll(async()=>{
    for(const k of envKeys) {
      const v=previous[k];if(v===undefined)delete process.env[k]
      else process.env[k]=v
    }
    for(const id of [orgId,outsideOrgId]){
      if(id){const {error}=await admin.from('organizations').delete().eq('id',id)
        if(error)throw error}
    }
    for(const id of [ownerId,viewerId]){
      if(id){const{error}=await admin.auth.admin.deleteUser(id)
        if(error)throw error}
    }
  })
  it('only OWNER receives their own TEST Customer portal session',async()=>{
    expect(await run(owner)).toEqual({
      outcome:'READY',
      portalUrl:'https://billing.stripe.com/p/session/test_SyntheticPortal',
    })
    expect(createSession).toHaveBeenCalledWith({
      customerId:token,configurationId,
      returnUrl:'http://localhost:3000/app/settings/billing',
    })
  })
  it('rejects VIEWER, anonymous and foreign tenant before any Stripe API',async()=>{
    createSession.mockClear()
    expect(await run(viewer)).toEqual({
      outcome:'BLOCKED',reason:'NOT_AUTHORIZED',
    })
    expect(await run(anon)).toEqual({
      outcome:'BLOCKED',reason:'NOT_AUTHENTICATED',
    })
    expect(await run(owner,outsideOrgId)).toEqual({
      outcome:'BLOCKED',reason:'NOT_AUTHORIZED',
    })
    expect(createSession).not.toHaveBeenCalled()
  })
  it('rejects a deleted TEST billing account rather than creating a portal for a foreign customer',async()=>{
    const {error}=await admin.from('organization_billing_accounts')
      .delete().eq('organization_id',orgId)
    expect(error).toBeNull()
    createSession.mockClear()
    expect(await run(owner)).toEqual({
      outcome:'BLOCKED',reason:'ACCOUNT_SETUP_REQUIRED',
    })
    expect(createSession).not.toHaveBeenCalled()
  })
})
