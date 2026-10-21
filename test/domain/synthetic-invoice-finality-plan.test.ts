import { describe, expect, it } from 'vitest'
import { DEFAULT_TRIAL_REQUESTS, deriveTrialLifecycle } from '../../src/domain/entitlement'
import {
  planSyntheticInvoiceFinality,
  type SyntheticInvoiceLeaseSnapshot,
  type SyntheticPriorInvoiceEvent,
} from '../../src/domain/billing/synthetic-invoice-finality-plan'

const org = '11111111-1111-4111-8111-111111111111'
const leaseToken = '22222222-2222-4222-8222-222222222222'
const now = '2026-10-19T11:01:00Z'
const receipt: SyntheticInvoiceLeaseSnapshot = {
  provider: 'stripe', environment: 'TEST', organizationId: null,
  providerEventId: 'evt_newpaid', eventType: 'invoice.paid',
  providerInvoiceId: 'in_new', payloadHash: 'a'.repeat(64),
  processingStatus: 'PROCESSING', processedAt: null,
  processingLeaseToken: leaseToken,
  processingLeaseExpiresAt: '2026-10-19T11:03:00Z',
  processingAttemptCount: 1, providerCreatedAt: '2026-10-19T11:00:00Z',
}
const past: SyntheticPriorInvoiceEvent = {
  providerEventId: 'evt_oldpaid', payloadHash: 'b'.repeat(64),
  organizationId: org, subscriptionId: 'sub_example',
  invoiceId: 'in_old', environment: 'TEST', eventType: 'invoice.paid',
  processingStatus: 'PROCESSED', providerCreatedAt: '2026-10-18T10:00:00Z',
}
const baseline = {
  mode: 'LOCAL_SYNTHETIC' as const, now, organizationId: org,
  subscriptionId: 'sub_example', invoiceId: 'in_new',
  providerEventId: 'evt_newpaid', leaseToken,
  receipt, priorEvents: [past],
  sourceRead: { outcome: 'SYNTHETIC_MATCH_ONLY' as const },
  providerInspection: { outcome: 'EVIDENCE_ONLY' as const },
}
type Input = Parameters<typeof planSyntheticInvoiceFinality>[0]
const plan = (patch: Partial<Input> = {}) =>
  planSyntheticInvoiceFinality({ ...baseline, ...patch })

describe('MR-5I4D synthetic invoice finality non-authorizing policy', () => {
  it('only proposes separately gated atomic finality even with synthetic evidence', () => {
    expect(plan()).toEqual({
      outcome: 'PROPOSAL_ONLY',
      nextGate: 'AUTHENTICATED_PROVIDER_AND_ATOMIC_FINALITY_REQUIRED',
    })
    const serialized = JSON.stringify(plan())
    for(const hidden of ['in_new','sub_example','evt_newpaid','22222222','PAID', 'PROCESSED']) {
      expect(serialized).not.toContain(hidden)
    }
  })

  it('rejects HOSTED/LIVE modes and any LIVE receipt or history', () => {
    expect(plan({mode:'LIVE'})).toEqual({outcome:'BLOCKED',reason:'MODE_GATED'})
    expect(plan({mode:'HOSTED'})).toEqual({outcome:'BLOCKED',reason:'MODE_GATED'})
    expect(plan({receipt:{...receipt,environment:'LIVE'}}))
      .toEqual({outcome:'BLOCKED',reason:'LIVE_GATED'})
    expect(plan({priorEvents:[{...past,environment:'LIVE'}]}))
      .toEqual({outcome:'BLOCKED',reason:'LIVE_GATED'})
  })

  it('rejects expired and absent lease ownership (not a DB fencing authority)', () => {
    expect(plan({leaseToken:'33333333-3333-4333-8333-333333333333'}))
      .toEqual({outcome:'BLOCKED',reason:'NOT_LEASE_HOLDER'})
    expect(plan({receipt:{...receipt,processingLeaseToken:null}}))
      .toEqual({outcome:'BLOCKED',reason:'NOT_LEASE_HOLDER'})
    expect(plan({receipt:{...receipt,processingLeaseExpiresAt:now}}))
      .toEqual({outcome:'BLOCKED',reason:'LEASE_EXPIRED'})
    expect(plan({receipt:{...receipt,processingLeaseExpiresAt:'2026-10-19T10:00:00Z'}}))
      .toEqual({outcome:'BLOCKED',reason:'LEASE_EXPIRED'})
    expect(plan({receipt:{...receipt,processingLeaseExpiresAt:null}}))
      .toEqual({outcome:'BLOCKED',reason:'LEASE_EXPIRED'})
  })

  it('does not treat RECEIVED/FAILED/PROCESSED/IGNORED as an owned lease', () => {
    for (const processingStatus of ['RECEIVED','FAILED','PROCESSED','IGNORED']) {
      expect(plan({receipt:{...receipt,processingStatus}}))
        .toEqual({outcome:'BLOCKED',reason:'EVENT_NOT_IN_PROCESSING'})
    }
  })

  it('rejects event/tenant/invoice mismatches or claimed tenant rows', () => {
    for(const patch of [
      {organizationId: '33333333-3333-4333-8333-333333333333'},
      {processedAt: now},
      {providerEventId: 'evt_forged'},
      {providerInvoiceId: 'in_foreign'},
    ]) {
      expect(plan({receipt:{...receipt,...patch}}))
        .toEqual({outcome:'BLOCKED',reason:'TENANT_OR_EVENT_MISMATCH'})
    }
    expect(plan({invoiceId:'in_foreign'}))
      .toEqual({outcome:'BLOCKED',reason:'TENANT_OR_EVENT_MISMATCH'})
    expect(plan({providerEventId:'evt_foreign'}))
      .toEqual({outcome:'BLOCKED',reason:'TENANT_OR_EVENT_MISMATCH'})
  })

  it('validates exact source identifiers, event type, fingerprint and timestamps', () => {
    for (const changes of [
      {providerEventId:'wrong'}, {providerInvoiceId:'wrong'},
      {eventType:'invoice.upcoming'}, {payloadHash:'invalid'},
      {processingAttemptCount:0}, {processingAttemptCount:4},
      {providerCreatedAt:'not-a-date'},
      {providerCreatedAt:'2026-10-20T00:00:00Z'},
    ]) {
      expect(plan({receipt:{...receipt,...changes}}))
        .toEqual({outcome:'BLOCKED',reason:'INVALID_INPUT'})
    }
    expect(plan({now:'not-a-date'}))
      .toEqual({outcome:'BLOCKED',reason:'INVALID_INPUT'})
    expect(plan({organizationId:'not-a-uuid'}))
      .toEqual({outcome:'BLOCKED',reason:'INVALID_INPUT'})
  })

  it('blocks forged, oversized or structurally invalid event history', () => {
    expect(plan({priorEvents:[{...past,organizationId:'33333333-3333-4333-8333-333333333333'}]}))
      .toEqual({outcome:'BLOCKED',reason:'INVALID_HISTORY'})
    expect(plan({priorEvents:[{...past,subscriptionId:'sub_foreign'}]}))
      .toEqual({outcome:'BLOCKED',reason:'INVALID_HISTORY'})
    expect(plan({priorEvents:[{...past,payloadHash:'wrong'}]}))
      .toEqual({outcome:'BLOCKED',reason:'INVALID_INPUT'})
    expect(plan({priorEvents:Array(101).fill(past)}))
      .toEqual({outcome:'BLOCKED',reason:'INVALID_INPUT'})
    expect(plan({priorEvents:[{...past,providerCreatedAt:'2026-11-01T00:00:00Z'}]}))
      .toEqual({outcome:'BLOCKED',reason:'INVALID_HISTORY'})
  })

  it('never treats a duplicate processed event as permission for another success', () => {
    const original = {...past,providerEventId:receipt.providerEventId,
      invoiceId:receipt.providerInvoiceId!,payloadHash:receipt.payloadHash,
      providerCreatedAt:receipt.providerCreatedAt}
    expect(plan({priorEvents:[original]}))
      .toEqual({outcome:'NO_CHANGE',reason:'ALREADY_PROCESSED_EVENT'})
    expect(plan({priorEvents:[{...original,processingStatus:'PROCESSING'}]}))
      .toEqual({outcome:'REVIEW_REQUIRED',reason:'DUPLICATE_IN_FLIGHT_OR_FAILED'})
    expect(plan({priorEvents:[{...original,processingStatus:'FAILED'}]}))
      .toEqual({outcome:'REVIEW_REQUIRED',reason:'DUPLICATE_IN_FLIGHT_OR_FAILED'})
  })

  it('rejects event ID reuse with a different signed payload, invoice or event type', () => {
    const original = {...past,providerEventId:receipt.providerEventId,
      invoiceId:receipt.providerInvoiceId!,payloadHash:receipt.payloadHash,
      providerCreatedAt:receipt.providerCreatedAt}
    for(const changed of [
      {...original,payloadHash:'c'.repeat(64)},
      {...original,invoiceId:'in_other'},
      {...original,eventType:'invoice.payment_failed' as const},
    ]) {
      expect(plan({priorEvents:[changed]}))
        .toEqual({outcome:'REVIEW_REQUIRED',reason:'CONFLICTING_REPLAY'})
    }
  })

  it('requires manual review for another event on the same invoice', () => {
    for(const changed of [
      {...past,invoiceId:'in_new'},
      {...past,invoiceId:'in_new',eventType:'invoice.payment_failed' as const},
      {...past,invoiceId:'in_new',processingStatus:'FAILED' as const},
      {...past,invoiceId:'in_new',processingStatus:'PROCESSING' as const},
    ]) {
      expect(plan({priorEvents:[changed]})).toMatchObject({outcome:'REVIEW_REQUIRED'})
    }
  })

  it('rejects equal/newer event timestamps without using time as authority', () => {
    for(const providerCreatedAt of [receipt.providerCreatedAt,'2026-10-19T11:00:30Z']) {
      expect(plan({priorEvents:[{...past,providerCreatedAt}]}))
        .toEqual({outcome:'REVIEW_REQUIRED',reason:'OUT_OF_ORDER_EVENT'})
    }
  })

  it('never infers successful settlement from invoice.payment_failed', () => {
    expect(plan({receipt:{...receipt,eventType:'invoice.payment_failed'}}))
      .toEqual({outcome:'REVIEW_REQUIRED',reason:'PAYMENT_FAILURE'})
  })

  it('fails closed without configured or positive provider proof', () => {
    expect(plan({sourceRead:{outcome:'NOT_CONFIGURED'}}))
      .toEqual({outcome:'BLOCKED',reason:'PROVIDER_NOT_CONFIGURED'})
    expect(plan({providerInspection:{outcome:'NOT_CONFIGURED'}}))
      .toEqual({outcome:'BLOCKED',reason:'PROVIDER_NOT_CONFIGURED'})
    expect(plan({providerInspection:null}))
      .toEqual({outcome:'BLOCKED',reason:'PROVIDER_NOT_CONFIGURED'})
    expect(plan({sourceRead:{outcome:'BLOCKED',reason:'SOURCE_NOT_READY'}}))
      .toEqual({outcome:'BLOCKED',reason:'CORRELATION_NOT_MATCHED'})
    expect(plan({providerInspection:{outcome:'BLOCKED',reason:'PAYMENT_NOT_SETTLED'}}))
      .toEqual({outcome:'BLOCKED',reason:'PROVIDER_EVIDENCE_MISSING'})
  })

  it('does not touch the 30 Free Review Requests trial or product entitlements', () => {
    const trial = {status:'ACTIVE' as const,allocated_requests:DEFAULT_TRIAL_REQUESTS,
      consumed_requests:5,expires_at:'2026-11-01T00:00:00Z'}
    const before = JSON.stringify(trial)
    const baselineTrial = deriveTrialLifecycle(trial,new Date(now))
    plan()
    plan({receipt:{...receipt,eventType:'invoice.payment_failed'}})
    expect(JSON.stringify(trial)).toBe(before)
    expect(DEFAULT_TRIAL_REQUESTS).toBe(30)
    expect(deriveTrialLifecycle(trial,new Date(now))).toEqual(baselineTrial)
  })
})
