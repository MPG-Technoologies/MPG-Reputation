import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const isDisposableDb = !!dbKey && dbKey !== 'dummy_service_role_key'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_anon_key'

describe.skipIf(!isDisposableDb)('MR-5E3B paid-entitlement proposal ledger — nonauthorizing', () => {
  const db = createClient<Database>(url, dbKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const anon = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const nonce = Date.now()
  const orgIds: string[] = []
  let orgA = ''
  let orgB = ''
  let subA = ''
  let subB = ''
  let eventA = ''
  let eventB = ''
  let received = ''
  let unrelated = ''
  let ownerUserId = ''
  const owner = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const proposed = {
    provider: 'stripe' as const,
    environment: 'TEST' as const,
    proposed_action: 'INITIAL_ACTIVATION' as const,
    candidate_status: 'ACTIVE' as const,
    candidate_period_end: '2026-11-19T00:00:00.000Z',
  }

  async function makeOrg(letter: 'A' | 'B') {
    const {data, error} = await db.from('organizations')
      .insert({ name: 'MR5E3B synthetic ' + letter + ' ' + nonce,
        slug: 'mr5e3b-' + letter.toLowerCase() + '-' + nonce })
      .select('id').single()
    if (error || !data) throw new Error('ORG_SETUP_FAILED: ' + error?.message)
    orgIds.push(data.id)
    return data.id
  }
  async function makeSubscription(organizationId: string, suffix: string) {
    const {data: account, error: accountError} = await db
      .from('organization_billing_accounts')
      .insert({organization_id: organizationId, provider:'stripe', environment:'TEST',
        provider_customer_id:'cus_mr5e3b' + suffix + nonce })
      .select('id').single()
    if (accountError || !account) throw new Error('ACCOUNT_SETUP_FAILED: '+accountError?.message)
    const {data, error} = await db.from('organization_subscriptions').insert({
      organization_id:organizationId, billing_account_id:account.id,
      provider:'stripe',environment:'TEST',
      provider_subscription_id:'sub_mr5e3b' + suffix + nonce,
      provider_status:'active', normalized_status:'ACTIVE',
    }).select('id').single()
    if (error || !data) throw new Error('SUBSCRIPTION_SETUP_FAILED: '+error?.message)
    return data.id
  }
  async function makeEvent(organizationId: string, suffix: string,
    eventType = 'invoice.paid', status: 'PROCESSED' | 'RECEIVED' = 'PROCESSED') {
    const safeSuffix = suffix.replace(/[^A-Za-z0-9]/g, '')
    const {data, error} = await db.from('billing_webhook_events').insert({
      organization_id: organizationId,provider:'stripe',environment:'TEST',
      provider_event_id:'evt_mr5e3b'+safeSuffix+nonce,event_type:eventType,
      provider_invoice_id:eventType==='invoice.paid'?'in_mr5e3b'+safeSuffix+nonce:null,
      processing_status:status,payload_hash:'a'.repeat(64),
      processed_at:status==='PROCESSED'?'2026-10-19T12:00:00Z':null,
    }).select('id').single()
    if(error||!data) throw new Error('EVENT_SETUP_FAILED: '+error?.message)
    return data.id
  }
  async function insert(overrides: Record<string, unknown> = {}) {
    return db.from('billing_paid_entitlement_proposals').insert({
      organization_id:orgA,
      subscription_record_id:subA,
      webhook_event_record_id:eventA,
      ...proposed,
      ...overrides,
    }).select('id, organization_id, candidate_status, access_authorized, source_kind, verification_status')
      .single()
  }

  beforeAll(async()=>{
    if (!url.startsWith('http://127.0.0.1:54331') &&
        !url.startsWith('http://localhost:54331')) throw new Error('DISPOSABLE_DB_ONLY')
    orgA=await makeOrg('A')
    orgB=await makeOrg('B')
    const {error:trialError}=await db.rpc('provision_organization_trial',{p_org_id:orgA})
    if(trialError) throw new Error('TRIAL_SETUP_FAILED: '+trialError.message)
    subA=await makeSubscription(orgA,'a')
    subB=await makeSubscription(orgB,'b')
    eventA=await makeEvent(orgA,'a')
    eventB=await makeEvent(orgB,'b')
    received=await makeEvent(orgA,'received','invoice.paid','RECEIVED')
    unrelated=await makeEvent(orgA,'unrelated','customer.subscription.updated')

    const email='mr5e3b-owner-'+nonce+'@test.local'
    const {data:userData,error:userError}=await db.auth.admin.createUser({
      email,password:'Password123!',email_confirm:true,
    })
    if(userError||!userData.user) throw new Error('OWNER_SETUP_FAILED: '+userError?.message)
    ownerUserId=userData.user.id
    const {error:memberError}=await db.from('organization_users').insert({
      organization_id:orgA,user_id:ownerUserId,role:'OWNER',
    })
    if(memberError) throw new Error('OWNER_MEMBER_FAILED: '+memberError.message)
    const {error:loginError}=await owner.auth.signInWithPassword({
      email,password:'Password123!',
    })
    if(loginError) throw new Error('OWNER_LOGIN_FAILED: '+loginError.message)
  })
  afterAll(async()=>{
    for(const id of orgIds) {
      await db.from('organizations').delete().eq('id',id)
    }
    if(ownerUserId) await db.auth.admin.deleteUser(ownerUserId)
  })

  it('appends a PRIVATE proposal with a hard-false access flag',async()=>{
    const {data,error}=await insert()
    expect(error).toBeNull()
    expect(data).toMatchObject({
      organization_id:orgA,candidate_status:'ACTIVE',
      access_authorized:false,source_kind:'SYNTHETIC',
      verification_status:'UNVERIFIED',
    })
  })
  it('rejects reusing the same webhook event',async()=>{
    const {error}=await insert()
    expect(error?.code).toBe('23505')
  })
  it('rejects cross-tenant subscription linkage',async()=>{
    const {error}=await insert({subscription_record_id:subB,
      webhook_event_record_id:await makeEvent(orgA,'crosssub')})
    expect(error?.code).toBe('23503')
  })
  it('rejects cross-tenant webhook linkage at insertion',async()=>{
    const {error}=await insert({webhook_event_record_id:eventB})
    expect(error?.message).toContain('BILLING_PAID_PROPOSAL_SOURCE_NOT_VERIFIED')
  })
  it('requires PROCESSED source status and appropriate signed event type',async()=>{
    const a=await insert({webhook_event_record_id:received})
    expect(a.error?.message).toContain('BILLING_PAID_PROPOSAL_SOURCE_NOT_VERIFIED')
    const b=await insert({webhook_event_record_id:unrelated})
    expect(b.error?.message).toContain('BILLING_PAID_PROPOSAL_EVENT_TYPE_MISMATCH')
  })
  it('rejects LIVE environment, invalid candidate/action, verified claims and granted access',async()=>{
    for (const mutation of [
      {environment:'LIVE'},
      {candidate_status:'INVALID'},
      {proposed_action:'RENEWAL',candidate_status:'ENDED'},
      {source_kind:'REAL_PROVIDER'},
      {verification_status:'VERIFIED'},
      {access_authorized:true},
    ]) {
      const id=await makeEvent(orgA,'invalid'+Object.keys(mutation)[0]+Object.values(mutation)[0])
      const {error}=await insert({webhook_event_record_id:id,...mutation})
      expect(error).not.toBeNull()
    }
  })
  it('denies anon and even owning authenticated users direct access',async()=>{
    const {error:anonRead}=await anon.from('billing_paid_entitlement_proposals')
      .select('id').eq('organization_id',orgA)
    expect(anonRead?.code).toBe('42501')
    const {error:ownerRead}=await owner.from('billing_paid_entitlement_proposals')
      .select('id').eq('organization_id',orgA)
    expect(ownerRead?.code).toBe('42501')
    const {error:ownerInsert}=await owner.from('billing_paid_entitlement_proposals')
      .insert({organization_id:orgA,subscription_record_id:subA,
        webhook_event_record_id:received,...proposed})
    expect(ownerInsert?.code).toBe('42501')
  })
  it('is append-only for service role (no direct update/delete privileges)',async()=>{
    const {error:updateError}=await db.from('billing_paid_entitlement_proposals')
      .update({candidate_status:'ENDED'})
      .eq('organization_id',orgA)
    expect(updateError?.code).toBe('42501')
    const {error:deleteError}=await db.from('billing_paid_entitlement_proposals')
      .delete().eq('organization_id',orgA)
    expect(deleteError?.code).toBe('42501')
  })
  it('preserves existing 30-request trial even for a proposed ACTIVE subscription',async()=>{
    const {data: trial,error}=await db.from('organization_entitlements')
      .select('allocated_requests, consumed_requests, status')
      .eq('organization_id',orgA).single()
    expect(error).toBeNull()
    expect(trial).toMatchObject({
      allocated_requests:30,consumed_requests:0,status:'NOT_STARTED',
    })
    const {data: subscription}=await db.from('organization_subscriptions')
      .select('normalized_status').eq('id',subA).single()
    expect(subscription?.normalized_status).toBe('ACTIVE')
    // Local billing projection ACTIVE has always been non-entitlement.
    // The new synthetic proposal cannot alter trial status or allowance.
  })
  it('allows organization deletion to cascade proposals without blocking webhook erasure policy',async()=>{
    const {data: org,error:orgError}=await db.from('organizations')
      .insert({name:'MR5E3B erase '+nonce,slug:'mr5e3b-erase-'+nonce})
      .select('id').single()
    expect(orgError).toBeNull()
    if(!org)throw new Error('ERASURE_SETUP_ORG_MISSING')
    orgIds.push(org.id)
    const sub=await makeSubscription(org.id,'erase')
    const ev=await makeEvent(org.id,'erase')
    const {error:proposalError}=await insert({
      organization_id:org.id,subscription_record_id:sub,webhook_event_record_id:ev,
    })
    expect(proposalError).toBeNull()
    const {error:removeError}=await db.from('organizations')
      .delete().eq('id',org.id)
    expect(removeError).toBeNull()
    const {data:proposalRows}=await db.from('billing_paid_entitlement_proposals')
      .select('id').eq('organization_id',org.id)
    expect(proposalRows).toEqual([])
    // Billing webhook event has ON DELETE SET NULL for organization_id.
    const {data:webhook}=await db.from('billing_webhook_events')
      .select('organization_id').eq('id',ev).single()
    expect(webhook?.organization_id).toBeNull()
    await db.from('billing_webhook_events').delete().eq('id',ev)
  })
})
