import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import { configureReputationBillingCatalog } from '../../src/domain/billing'

const key=process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const enabled=!!key && key!=='dummy_service_role_key'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const options={auth:{persistSession:false,autoRefreshToken:false}}
const suffix=randomUUID().replaceAll('-','')
const price='price_mr5i4g'+suffix
type QuoteInsert=Database['public']['Tables']['billing_synthetic_checkout_quote_snapshots']['Insert']

describe.skipIf(!enabled)('MR-5I4G synthetic historical checkout quotes (disposable only)',()=>{
  const db=createClient<Database>(url,key!,options)
  const anon=createClient<Database>(url,anonKey,options)
  const owner=createClient<Database>(url,anonKey,options)
  let orgA='',orgB='',accountA='',accountB='',reservationA='',reservationB='',ownerId=''
  const ids:string[]=[]

  async function org(letter:string){
    const {data,error}=await db.from('organizations').insert({
      name:'MR5I4G fake '+letter,
      slug:'mr5i4g-'+letter+'-'+suffix,
    }).select('id').single()
    if(error||!data)throw new Error('MR5I4G_ORG_FIXTURE_FAILED: '+error?.message)
    ids.push(data.id)
    return data.id
  }

  async function prepare(organization_id:string,letter:string,plan_id:'monthly'|'annual'='monthly'){
    const {data:account,error:accountErr}=await db.from('organization_billing_accounts')
      .insert({organization_id,provider:'stripe',environment:'TEST',
        provider_customer_id:'cus_mr5i4g'+letter+suffix})
      .select('id').single()
    if(accountErr||!account)throw new Error('MR5I4G_ACCOUNT_FIXTURE_FAILED: '+accountErr?.message)
    const {data:reservation,error:reservationErr}=await db.from('stripe_test_checkout_reservations')
      .insert({
        organization_id,billing_account_id:account.id,provider:'stripe',
        environment:'TEST',provider_customer_id:'cus_mr5i4g'+letter+suffix,
        provider_price_id:price,plan_id,return_origin:'http://localhost:3000',
        status:'PREPARING',
        session_expires_at:new Date(Date.now()+60*60_000).toISOString(),
        reservation_expires_at:new Date(Date.now()+65*60_000).toISOString(),
      }).select('id').single()
    if(reservationErr||!reservation)throw new Error('MR5I4G_RESERVATION_FIXTURE_FAILED: '+reservationErr?.message)
    return {account:account.id,reservation:reservation.id}
  }

  function quote(overrides:Record<string,unknown>={}):QuoteInsert{
    return {
      organization_id:orgA,billing_account_id:accountA,
      checkout_reservation_id:reservationA,
      plan_id:'monthly',provider_price_id:price,candidate_amount_minor:150_000,
      candidate_interval:'month',...overrides,
    } as QuoteInsert
  }

  const insert=(data:QuoteInsert)=>db.from('billing_synthetic_checkout_quote_snapshots')
    .insert(data).select('*').single()

  beforeAll(async()=>{
    if(!['http://127.0.0.1:54331','http://localhost:54331'].includes(url) ||
       process.env.ENABLE_LIVE_BILLING==='true')throw new Error('DISPOSABLE_TEST_ONLY')
    orgA=await org('a');orgB=await org('b')
    const a=await prepare(orgA,'a');accountA=a.account;reservationA=a.reservation
    const b=await prepare(orgB,'b','annual');accountB=b.account;reservationB=b.reservation
    const {data:user,error:userError}=await db.auth.admin.createUser({
      email:'mr5i4g-'+suffix+'@example.test',password:'SyntheticOnly123!',email_confirm:true,
    })
    if(userError||!user.user)throw new Error('MR5I4G_OWNER_FIXTURE_FAILED')
    ownerId=user.user.id
    const {error:membershipError}=await db.from('organization_users')
      .insert({organization_id:orgA,user_id:ownerId,role:'OWNER'})
    if(membershipError)throw new Error('MR5I4G_MEMBERSHIP_FAILED')
    const {error:loginError}=await owner.auth.signInWithPassword({
      email:'mr5i4g-'+suffix+'@example.test',password:'SyntheticOnly123!',
    })
    if(loginError)throw new Error('MR5I4G_LOGIN_FAILED')
  },30000)
  afterAll(async()=>{
    for(const id of ids)await db.from('organizations').delete().eq('id',id)
    if(ownerId)await db.auth.admin.deleteUser(ownerId)
  })

  it('freezes a TEST proposal with no payment or entitlement authority',async()=>{
    const {data,error}=await insert(quote())
    expect(error).toBeNull()
    expect(data).toMatchObject({
      organization_id:orgA,provider_price_id:price,
      plan_id:'monthly',candidate_interval:'month',candidate_amount_minor:150_000,
      provider:'stripe',environment:'TEST',candidate_currency:'PHP',interval_count:1,
      source_kind:'SYNTHETIC',approval_status:'PROPOSED',
      verification_status:'UNVERIFIED',payment_authorized:false,access_authorized:false,
    })
  })

  it('holds historical quoted amount when later server catalog configuration changes',async()=>{
    const later=configureReputationBillingCatalog({
      MPG_BILLING_MONTHLY_PRICE_PHP:'1700',
      MPG_BILLING_ANNUAL_PRICE_PHP:'1000',
    })
    expect(later.outcome).toBe('READY')
    if(later.outcome!=='READY')throw new Error('MR5I4G_EXPECT_READY')
    expect(later.plans.monthly.amountMinor).toBe(170_000)
    const {data,error}=await db.from('billing_synthetic_checkout_quote_snapshots')
      .select('candidate_amount_minor,approval_status,payment_authorized')
      .eq('checkout_reservation_id',reservationA).single()
    expect(error).toBeNull()
    expect(data).toMatchObject({
      candidate_amount_minor:150_000,approval_status:'PROPOSED',payment_authorized:false,
    })
  })

  it('rejects another quote or concurrent re-pricing of the same reservation',async()=>{
    const [first,second]=await Promise.all([
      insert(quote({candidate_amount_minor:160_000})),
      insert(quote({candidate_amount_minor:170_000})),
    ])
    expect(first.error?.code).toBe('23505')
    expect(second.error?.code).toBe('23505')
  })

  it('prevents foreign tenant/account/Price and incorrect plan binding',async()=>{
    for(const patch of [
      {organization_id:orgB},
      {billing_account_id:accountB},
      {checkout_reservation_id:reservationB},
      {provider_price_id:'price_foreign'},
      {plan_id:'annual',candidate_interval:'year'},
    ]){
      const {error}=await insert(quote(patch))
      expect(error).not.toBeNull()
    }
  })

  it('rejects live/verified/approved/paid or malformed proposed terms',async()=>{
    for(const patch of [
      {environment:'LIVE'}, {provider:'other'}, {candidate_currency:'USD'},
      {approval_status:'ACCEPTED'}, {verification_status:'VERIFIED'},
      {payment_authorized:true}, {access_authorized:true},
      {source_kind:'PROVIDER'},{candidate_amount_minor:0},
      {candidate_amount_minor:-1}, {interval_count:2},
      {candidate_interval:'year'}, {plan_id:'invalid'},
      {provider_price_id:'nope'},
    ]){
      const {error}=await insert(quote(patch))
      expect(error).not.toBeNull()
    }
  })

  it('rejects an expired reservation',async()=>{
    const {error}=await db.from('stripe_test_checkout_reservations')
      .update({reservation_expires_at:'2020-01-01T00:00:00Z'})
      .eq('id',reservationB)
    expect(error).toBeNull()
    const {error:insertErr}=await insert(quote({
      organization_id:orgB,billing_account_id:accountB,
      checkout_reservation_id:reservationB,plan_id:'annual',candidate_interval:'year',
    }))
    expect(insertErr?.message).toContain('MR5I4G_CHECKOUT_RESERVATION_MISMATCH')
  })

  it('denies unauthenticated and owner-role direct SELECT/INSERT',async()=>{
    const {error:anonRead}=await anon.from('billing_synthetic_checkout_quote_snapshots').select('id')
    expect(anonRead?.code).toBe('42501')
    const {error:ownerRead}=await owner.from('billing_synthetic_checkout_quote_snapshots').select('id')
    expect(ownerRead?.code).toBe('42501')
    const {error:ownerWrite}=await owner.from('billing_synthetic_checkout_quote_snapshots')
      .insert(quote())
    expect(ownerWrite?.code).toBe('42501')
  })

  it('denies even service-role direct UPDATE/DELETE (append-only role grant)',async()=>{
    const {error:update}=await db.from('billing_synthetic_checkout_quote_snapshots')
      .update({candidate_amount_minor:170_000}).eq('checkout_reservation_id',reservationA)
    expect(update?.code).toBe('42501')
    const {error:remove}=await db.from('billing_synthetic_checkout_quote_snapshots')
      .delete().eq('checkout_reservation_id',reservationA)
    expect(remove?.code).toBe('42501')
    const {data}=await db.from('billing_synthetic_checkout_quote_snapshots')
      .select('candidate_amount_minor').eq('checkout_reservation_id',reservationA).single()
    expect(data?.candidate_amount_minor).toBe(150_000)
  })

  it('does not affect the 30 Free Review Requests trial or checkout processing',async()=>{
    const {data:checkout}=await db.from('stripe_test_checkout_reservations')
      .select('status,stripe_session_id').eq('id',reservationA).single()
    expect(checkout).toMatchObject({status:'PREPARING',stripe_session_id:null})
    const {error}=await db.rpc('provision_organization_trial',{p_org_id:orgA})
    expect(error).toBeNull()
    const {data:trial}=await db.from('organization_entitlements')
      .select('allocated_requests,consumed_requests,status').eq('organization_id',orgA).single()
    expect(trial).toMatchObject({allocated_requests:30,consumed_requests:0,status:'NOT_STARTED'})
  })

  it('preserves permitted tenant erasure cascade',async()=>{
    const {error}=await db.from('organizations').delete().eq('id',orgA)
    expect(error).toBeNull()
    const {data}=await db.from('billing_synthetic_checkout_quote_snapshots')
      .select('id').eq('organization_id',orgA)
    expect(data).toEqual([])
  })
})
