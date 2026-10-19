import { describe, expect, it } from 'vitest'
import { DEFAULT_TRIAL_REQUESTS, deriveTrialLifecycle } from '../../src/domain/entitlement'
import { proposeSubscriptionLifecycle,
  type SubscriptionLifecycleEvent,
  type SubscriptionLifecycleSnapshot,
  type SubscriptionLifecycleProof,
} from '../../src/domain/billing/subscription-lifecycle-proposals'

const org = '11111111-1111-4111-8111-111111111111'
const now = '2026-10-19T12:00:00Z'
const event: SubscriptionLifecycleEvent = {
  eventId: 'evt_new1', fingerprint: 'a'.repeat(64),
  kind: 'INVOICE_SETTLED', organizationId: org,
  subscriptionId: 'sub_sample', environment: 'TEST',
  occurredAt: '2026-10-19T11:00:00Z',
  periodEnd: '2026-11-19T00:00:00Z',
}
const proof: SubscriptionLifecycleProof = {
  durableEventStatus: 'PROCESSED',
  providerInvoiceAssessment: { outcome: 'EVIDENCE_ONLY' },
  statusChangeVerified: true,
}
const current: SubscriptionLifecycleSnapshot = {
  organizationId: org, subscriptionId: 'sub_sample', environment: 'TEST',
  status: 'ACTIVE', periodEnd: '2026-11-19T00:00:00Z',
  lastEventId: 'evt_previous',
  lastEventFingerprint: 'b'.repeat(64),
  lastEventAt: '2026-10-18T00:00:00Z',
}
const inspect = (
  changes: Partial<{
    current: SubscriptionLifecycleSnapshot | null
    event: SubscriptionLifecycleEvent
    proof: SubscriptionLifecycleProof
    now: string
  }> = {},
) => proposeSubscriptionLifecycle({
  current: null,
  event,
  proof,
  now,
  ...changes,
})

describe('MR-5E3A lifecycle proposal simulator (not product entitlement)', () => {
  it('proposes initial activation for a processed synthetic paid event only', () => {
    const result = inspect()
    expect(result).toMatchObject({
      outcome:'PROPOSAL_ONLY',action:'INITIAL_ACTIVATION',
      candidate:{status:'ACTIVE',environment:'TEST',periodEnd:event.periodEnd},
    })
    expect(result).not.toHaveProperty('allowed')
    expect(result).not.toHaveProperty('isEligibleForInitialRequest')
  })

  it('denies no provider evidence, unprocessed events, and invalid source markers', () => {
    for (const providerInvoiceAssessment of [
      null, {outcome:'NOT_CONFIGURED'} as const,
      {outcome:'BLOCKED',reason:'PROVIDER_UNAVAILABLE'} as const,
    ]) {
      expect(inspect({proof:{...proof,providerInvoiceAssessment}}))
        .toEqual({outcome:'BLOCKED',reason:'PROVIDER_PROOF_REQUIRED'})
    }
    for (const durableEventStatus of ['RECEIVED','PROCESSING','FAILED','IGNORED'] as const) {
      expect(inspect({proof:{...proof,durableEventStatus}}))
        .toEqual({outcome:'BLOCKED',reason:'UNPROCESSED_EVENT'})
    }
    expect(inspect({event:{...event,environment:'LIVE'}}))
      .toEqual({outcome:'BLOCKED',reason:'LIVE_GATED'})
  })

  it('proposes renewal only when period strictly advances', () => {
    const next = {...event,eventId:'evt_renew',fingerprint:'c'.repeat(64),
      periodEnd:'2026-12-19T00:00:00Z'}
    expect(inspect({current,event:next})).toMatchObject({
      outcome:'PROPOSAL_ONLY',action:'RENEWAL',
      candidate:{status:'ACTIVE',periodEnd:next.periodEnd},
    })
    expect(inspect({current,event:{...next,periodEnd:current.periodEnd}}))
      .toEqual({outcome:'BLOCKED',reason:'PERIOD_INVALID'})
  })

  it('does not allow renewal when a cancellation or dispute needs review', () => {
    const next = {...event,eventId:'evt_renew',fingerprint:'c'.repeat(64),
      periodEnd:'2026-12-19T00:00:00Z'}
    expect(inspect({current:{...current,status:'CANCEL_AT_PERIOD_END'},event:next}))
      .toEqual({outcome:'BLOCKED',reason:'CANCELLATION_REQUIRES_REVIEW'})
    expect(inspect({current:{...current,status:'REVIEW_REQUIRED'},event:next}))
      .toEqual({outcome:'BLOCKED',reason:'EXCEPTION_REQUIRES_REVIEW'})
    expect(inspect({current:{...current,status:'ENDED'},event:next}))
      .toEqual({outcome:'BLOCKED',reason:'TERMINAL_REQUIRES_NEW_SUBSCRIPTION'})
  })

  it('proposes payment due without extending previous paid period', () => {
    const failing = {...event,kind:'INVOICE_FAILED' as const}
    expect(inspect({current,event:failing})).toMatchObject({
      outcome:'PROPOSAL_ONLY',action:'PAYMENT_DUE',
      candidate:{status:'PAST_DUE',periodEnd:current.periodEnd},
    })
    expect(inspect({current,event:failing,proof:{...proof,statusChangeVerified:false}}))
      .toEqual({outcome:'BLOCKED',reason:'PROVIDER_PROOF_REQUIRED'})
    expect(inspect({current,event:{...failing,periodEnd:'2027-01-01T00:00:00Z'}}))
      .toEqual({outcome:'BLOCKED',reason:'PERIOD_INVALID'})
    expect(inspect({current:{...current,status:'CANCEL_AT_PERIOD_END'},event:failing}))
      .toEqual({outcome:'BLOCKED',reason:'EXCEPTION_REQUIRES_REVIEW'})
  })

  it('proposes cancellation scheduling while preserving paid-through boundary', () => {
    expect(inspect({current,event:{...event,kind:'CANCEL_SCHEDULED'}}))
      .toMatchObject({outcome:'PROPOSAL_ONLY',action:'SCHEDULE_CANCELLATION',
        candidate:{status:'CANCEL_AT_PERIOD_END',periodEnd:current.periodEnd}})
  })

  it('refuses cancellation effective or expiration before period end', () => {
    for(const kind of ['CANCEL_EFFECTIVE','PERIOD_EXPIRED'] as const) {
      expect(inspect({current,event:{...event,kind}}))
        .toEqual({outcome:'BLOCKED',reason:'PERIOD_INVALID'})
    }
  })

  it('proposes end at period boundary without granting further access', () => {
    for(const kind of ['CANCEL_EFFECTIVE','PERIOD_EXPIRED'] as const) {
      const terminal = {...event,kind,eventId:'evt_ending',fingerprint:'d'.repeat(64),
        occurredAt:'2026-11-20T00:01:00Z'}
      expect(inspect({current,event:terminal,now:'2026-11-20T00:02:00Z'}))
        .toMatchObject({outcome:'PROPOSAL_ONLY',action:'END_AT_PERIOD',
          candidate:{status:'ENDED',periodEnd:current.periodEnd}})
    }
  })

  it('proposes review hold for refund or dispute, never a paid upgrade', () => {
    const proposed = inspect({current,event:{...event,kind:'REFUND_OR_DISPUTE'}})
    expect(proposed).toMatchObject({outcome:'PROPOSAL_ONLY',action:'ESCALATE_FOR_REVIEW',
      candidate:{status:'REVIEW_REQUIRED'}})
  })

  it('deduplicates identical event id and rejects conflicting payload fingerprint', () => {
    const duplicate = {...event,eventId:current.lastEventId,
      fingerprint:current.lastEventFingerprint}
    expect(inspect({current,event:duplicate}))
      .toEqual({outcome:'NO_CHANGE',reason:'DUPLICATE_EVENT'})
    expect(inspect({current,event:{...duplicate,fingerprint:'c'.repeat(64)}}))
      .toEqual({outcome:'BLOCKED',reason:'EVENT_FINGERPRINT_CONFLICT'})
  })

  it('fails closed for older and equal-timestamp nonidentical events', () => {
    for(const occurredAt of [current.lastEventAt,'2026-10-17T00:00:00Z']) {
      expect(inspect({current,event:{...event,occurredAt}}))
        .toEqual({outcome:'BLOCKED',reason:'STALE_OR_CONFLICTING_EVENT'})
    }
  })

  it('denies tenant/environment/subscription mismatches and malformed event IDs', () => {
    for(const edited of [
      {...event,organizationId:'22222222-2222-4222-8222-222222222222'},
      {...event,subscriptionId:'sub_foreign'},
    ]) {
      expect(inspect({current,event:edited}))
        .toEqual({outcome:'BLOCKED',reason:'TENANT_OR_SUBSCRIPTION_MISMATCH'})
    }
    expect(inspect({event:{...event,eventId:'invalid'}}))
      .toEqual({outcome:'BLOCKED',reason:'INVALID_INPUT'})
    expect(inspect({event:{...event,occurredAt:'2027-01-01T00:00:00Z'}}))
      .toEqual({outcome:'BLOCKED',reason:'INVALID_INPUT'})
  })

  it('does not start a nonexistent paid subscription from a failed event', () => {
    expect(inspect({event:{...event,kind:'INVOICE_FAILED'}}))
      .toEqual({outcome:'BLOCKED',reason:'NO_PRIOR_SUBSCRIPTION'})
  })

  it('never consumes, replenishes or rewrites the existing 30-request trial', () => {
    const trial = {status:'ACTIVE' as const,allocated_requests:DEFAULT_TRIAL_REQUESTS,
      consumed_requests:12,expires_at:'2026-11-01T00:00:00Z'}
    const original = JSON.stringify(trial)
    const baseline=deriveTrialLifecycle(trial,new Date(now))
    inspect()
    inspect({current,event:{...event,kind:'INVOICE_FAILED'}})
    expect(JSON.stringify(trial)).toBe(original)
    expect(DEFAULT_TRIAL_REQUESTS).toBe(30)
    expect(deriveTrialLifecycle(trial,new Date(now))).toEqual(baseline)
    expect(baseline.remainingRequests).toBe(18)
  })
})
