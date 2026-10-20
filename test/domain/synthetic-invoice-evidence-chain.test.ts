import { describe, expect, it } from 'vitest'
import { inspectSyntheticInvoiceEvidenceChain } from '../../src/domain/billing/synthetic-invoice-evidence-chain'

const org = '11111111-1111-4111-8111-111111111111'
const acct = '22222222-2222-4222-8222-222222222222'
const reserve = '33333333-3333-4333-8333-333333333333'
const sub = '44444444-4444-4444-8444-444444444444'
const receiptId = '55555555-5555-4555-8555-555555555555'
const q = {
  checkout_reservation_id:reserve,organization_id:org,billing_account_id:acct,
  provider:'stripe',environment:'TEST',provider_price_id:'price_synthetic',
  plan_id:'monthly',candidate_currency:'PHP',candidate_amount_minor:150000,
  candidate_interval:'month',source_kind:'SYNTHETIC',approval_status:'PROPOSED',
  verification_status:'UNVERIFIED',payment_authorized:false,access_authorized:false,
}
const i = {
  organization_id:org,billing_account_id:acct,subscription_record_id:sub,
  webhook_event_record_id:receiptId,provider:'stripe',environment:'TEST',
  provider_invoice_id:'in_synthetic',provider_event_id:'evt_synthetic',
  source_payload_hash:'a'.repeat(64),candidate_price_id:'price_synthetic',
  candidate_currency:'PHP',candidate_amount_minor:150000,candidate_interval:'month',
  source_kind:'SYNTHETIC',verification_status:'UNVERIFIED',
  financial_finality:false,access_authorized:false,
}
const reservation = {
  id:reserve,organization_id:org,billing_account_id:acct,
  provider:'stripe',environment:'TEST',provider_customer_id:'cus_synthetic',
  provider_price_id:'price_synthetic',plan_id:'monthly',status:'READY',
  stripe_session_id:'cs_test_synthetic',
}
const account = {id:acct,organization_id:org,provider:'stripe',environment:'TEST',
  provider_customer_id:'cus_synthetic'}
const subscription = {id:sub,organization_id:org,billing_account_id:acct,
  provider:'stripe',environment:'TEST',provider_subscription_id:'sub_synthetic',
  provider_price_id:'price_synthetic',normalized_status:'ACTIVE'}
const receipt = {
  id:receiptId,provider:'stripe',environment:'TEST',provider_event_id:'evt_synthetic',
  event_type:'invoice.paid',provider_invoice_id:'in_synthetic',payload_hash:'a'.repeat(64),
  processing_status:'PROCESSING',organization_id:null,processed_at:null,
}
const base = {quote:q,invoice:i,reservation,account,subscription,receipt}
const expectDenied = (changes: Record<string, unknown>, reason: string) =>
  expect(inspectSyntheticInvoiceEvidenceChain({...base,...changes}))
    .toEqual({outcome:'REVIEW_REQUIRED',reason})

describe('MR-5 Stage 1 signed receipt to checkout synthetic chain (non-settling)', () => {
  it('matches six staged source records but never claims paid access or checkout provenance', () => {
    const result = inspectSyntheticInvoiceEvidenceChain(base)
    expect(result).toEqual({
      outcome:'SYNTHETIC_CHAIN_ONLY',
      unresolved:'INVOICE_TO_CHECKOUT_PROVIDER_PROVENANCE_NOT_ESTABLISHED',
      paymentAuthorized:false,financialFinality:false,accessAuthorized:false,
    })
    for (const id of [org,acct,reserve,sub,receiptId,'in_synthetic','evt_synthetic']) {
      expect(JSON.stringify(result)).not.toContain(id)
    }
  })
  it.each(['quote','invoice','reservation','account','subscription','receipt'])(
    'does not reconstruct a missing %s', (key) => {
      expectDenied({[key]:null}, 'MISSING_SOURCE')
    })
  it.each([
    ['quote',{candidate_amount_minor:100000},'CANDIDATE_MISMATCH'],
    ['quote',{payment_authorized:true},'CANDIDATE_MISMATCH'],
    ['invoice',{financial_finality:true},'CANDIDATE_MISMATCH'],
    ['invoice',{organization_id:'66666666-6666-4666-8666-666666666666'},'CANDIDATE_MISMATCH'],
    ['invoice',{candidate_price_id:'price_other'},'CANDIDATE_MISMATCH'],
    ['reservation',{id:'77777777-7777-4777-8777-777777777777'},'RESERVATION_MISMATCH'],
    ['reservation',{organization_id:'88888888-8888-4888-8888-888888888888'},'RESERVATION_MISMATCH'],
    ['reservation',{provider_price_id:'price_other'},'RESERVATION_MISMATCH'],
    ['reservation',{status:'PREPARING'},'CHECKOUT_NOT_READY'],
    ['reservation',{stripe_session_id:'invalid'},'IDENTITY_INVALID'],
    ['account',{provider_customer_id:'cus_other'},'ACCOUNT_MISMATCH'],
    ['account',{organization_id:'88888888-8888-4888-8888-888888888888'},'ACCOUNT_MISMATCH'],
    ['receipt',{payload_hash:'b'.repeat(64)},'RECEIPT_MISMATCH'],
    ['receipt',{provider_event_id:'evt_other'},'RECEIPT_MISMATCH'],
    ['receipt',{provider_invoice_id:'in_other'},'RECEIPT_MISMATCH'],
    ['receipt',{event_type:'invoice.payment_failed'},'RECEIPT_MISMATCH'],
    ['receipt',{processing_status:'PROCESSED'},'RECEIPT_MISMATCH'],
    ['receipt',{processing_status:'FAILED'},'RECEIPT_MISMATCH'],
    ['receipt',{processed_at:'2026-10-20T00:00:00Z'},'RECEIPT_MISMATCH'],
    ['receipt',{environment:'LIVE'},'RECEIPT_MISMATCH'],
    ['subscription',{id:'66666666-6666-4666-8666-666666666666'},'SUBSCRIPTION_MISMATCH'],
    ['subscription',{billing_account_id:'66666666-6666-4666-8666-666666666666'},'SUBSCRIPTION_MISMATCH'],
    ['subscription',{provider_price_id:'price_other'},'SUBSCRIPTION_MISMATCH'],
    ['subscription',{normalized_status:'ENDED'},'SUBSCRIPTION_MISMATCH'],
    ['invoice',{source_payload_hash:'missing'},'IDENTITY_INVALID'],
    ['reservation',{provider_customer_id:'invalid'},'IDENTITY_INVALID'],
  ] as const)('blocks mismatched %s record %#', (table, patch, reason) => {
    expectDenied({[table]:{...base[table],...patch}},reason)
  })
  it('uses exact five-segment UUIDs and denies malformed source record IDs', () => {
    expect(inspectSyntheticInvoiceEvidenceChain(base).outcome)
      .toBe('SYNTHETIC_CHAIN_ONLY')
    expectDenied({reservation:{...reservation,id:'33333333-3333-3333-333333333333'}},'IDENTITY_INVALID')
    expectDenied({invoice:{...i,webhook_event_record_id:'not-a-uuid'}},'IDENTITY_INVALID')
  })
  it('cannot mutate private inputs or infer an accepted quote from a matching projection', () => {
    const before = JSON.stringify(base)
    expect(inspectSyntheticInvoiceEvidenceChain(base).outcome).toBe('SYNTHETIC_CHAIN_ONLY')
    expect(JSON.stringify(base)).toBe(before)
  })
})
