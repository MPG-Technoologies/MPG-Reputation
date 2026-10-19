import { describe, expect, it } from 'vitest'
import { DEFAULT_TRIAL_REQUESTS, deriveTrialLifecycle } from '../../src/domain/entitlement'
import {
  reconcileSyntheticSubscriptionExceptions,
  type ReconciliationAction,
  type SyntheticProposalFact,
} from '../../src/domain/billing/synthetic-exception-reconciliation'

const org = '11111111-1111-4111-8111-111111111111'
const subscriptionRecordId = '22222222-2222-4222-8222-222222222222'
const sub = 'sub_synthetic'
const now = '2026-10-19T12:00:00Z'
const end = '2026-11-19T00:00:00Z'
const laterEnd = '2026-12-19T00:00:00Z'
const status: Record<ReconciliationAction, SyntheticProposalFact['status']> = {
  INITIAL_ACTIVATION: 'ACTIVE',
  RENEWAL: 'ACTIVE',
  PAYMENT_DUE: 'PAST_DUE',
  SCHEDULE_CANCELLATION: 'CANCEL_AT_PERIOD_END',
  END_AT_PERIOD: 'ENDED',
  ESCALATE_FOR_REVIEW: 'REVIEW_REQUIRED',
}

function fact(
  ordinal: number,
  action: ReconciliationAction,
  overrides: Partial<SyntheticProposalFact> = {},
): SyntheticProposalFact {
  return {
    organizationId: org,
    subscriptionRecordId,
    providerSubscriptionId: sub,
    environment: 'TEST',
    providerEventId: 'evt_case' + ordinal,
    webhookEventRecordId: '33333333-3333-4333-8333-' + String(ordinal).padStart(12, '0'),
    eventFingerprint: String(ordinal % 10).repeat(64),
    providerCreatedAt: new Date(Date.parse('2026-10-19T07:00:00Z') + ordinal * 60000).toISOString(),
    action,
    status: status[action],
    periodEnd: end,
    sourceKind: 'SYNTHETIC',
    verificationStatus: 'UNVERIFIED',
    accessAuthorized: false,
    ...overrides,
  }
}
const active = fact(1, 'INITIAL_ACTIVATION')
function inspect(
  incoming: SyntheticProposalFact,
  history: readonly SyntheticProposalFact[] = [],
  extra: Partial<Parameters<typeof reconcileSyntheticSubscriptionExceptions>[0]> = {},
) {
  return reconcileSyntheticSubscriptionExceptions({
    organizationId: org,
    subscriptionRecordId,
    providerSubscriptionId: sub,
    environment: 'TEST',
    history,
    incoming,
    now,
    ...extra,
  })
}

describe('MR-5E3C3A synthetic-only exception reconciliation', () => {
  it('can simulate first activation but never authorize any paid access', () => {
    const output = inspect(active)
    expect(output).toMatchObject({
      outcome: 'SIMULATED_CANDIDATE_ONLY',
      audit: {
        reason: 'SIMULATED_ACTIVATION',
        environment: 'TEST',
        sourceKind: 'SYNTHETIC',
        evidenceVerified: false,
        accessAuthorized: false,
        durableAuditRecorded: false,
      },
      candidate: { status: 'ACTIVE', periodEnd: end },
    })
    expect(output).not.toHaveProperty('allowed')
    expect(output).not.toHaveProperty('entitlementGranted')
  })

  it('simulates ordinary renewal only when paid period strictly advances', () => {
    const renewed = fact(2, 'RENEWAL', { periodEnd: laterEnd })
    expect(inspect(renewed, [active])).toMatchObject({
      outcome: 'SIMULATED_CANDIDATE_ONLY',
      audit: { reason: 'SIMULATED_RENEWAL' },
      candidate: { status: 'ACTIVE', periodEnd: laterEnd },
    })
    expect(inspect(fact(3, 'RENEWAL'), [active])).toMatchObject({
      outcome: 'REVIEW_REQUIRED', audit: { reason: 'PAID_PERIOD_NOT_ADVANCED' },
    })
  })

  it('cannot recover a past-due plan automatically, even with a later paid event', () => {
    const failed = fact(2, 'PAYMENT_DUE')
    const recovery = fact(3, 'RENEWAL', { periodEnd: laterEnd })
    expect(inspect(recovery, [active, failed])).toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      audit: { reason: 'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW' },
    })
  })

  it('rejects a delayed old renewal after a newer failure', () => {
    const newestFailure = fact(4, 'PAYMENT_DUE')
    const lateDelivery = fact(3, 'RENEWAL', { periodEnd: laterEnd })
    expect(inspect(lateDelivery, [active, newestFailure])).toMatchObject({
      outcome: 'REVIEW_REQUIRED', audit: { reason: 'OLDER_OR_EQUAL_TIME' },
    })
  })

  it('blocks same-second ambiguity rather than guessing order', () => {
    const sameTime = fact(3, 'RENEWAL', {
      providerCreatedAt: active.providerCreatedAt, periodEnd: laterEnd,
    })
    expect(inspect(sameTime, [active])).toMatchObject({
      outcome: 'REVIEW_REQUIRED', audit: { reason: 'OLDER_OR_EQUAL_TIME' },
    })
  })

  it('treats exact replay as no-change but conflicting fingerprint as review', () => {
    expect(inspect(active, [active])).toMatchObject({
      outcome: 'NO_CHANGE', audit: { reason: 'EXACT_EVENT_REPLAY' },
    })
    expect(inspect({ ...active, eventFingerprint: 'f'.repeat(64) }, [active])).toMatchObject({
      outcome: 'REVIEW_REQUIRED', audit: { reason: 'EVENT_FINGERPRINT_CONFLICT' },
    })
    expect(inspect({
      ...active, periodEnd: laterEnd,
    }, [active])).toMatchObject({
      outcome: 'REVIEW_REQUIRED', audit: { reason: 'EVENT_FINGERPRINT_CONFLICT' },
    })
  })

  it('does not lift a dispute/review hold with a newer renewal', () => {
    const dispute = fact(2, 'ESCALATE_FOR_REVIEW')
    const renewal = fact(3, 'RENEWAL', { periodEnd: laterEnd })
    expect(inspect(renewal, [active, dispute])).toMatchObject({
      outcome: 'REVIEW_REQUIRED', audit: { reason: 'DISPUTE_OR_REFUND_HOLD' },
    })
  })

  it('does not confuse a new refund/dispute signal with proof of settlement', () => {
    expect(inspect(fact(2, 'ESCALATE_FOR_REVIEW'), [active])).toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      audit: { reason: 'REFUND_OR_DISPUTE_REQUIRES_REVIEW' },
    })
  })

  it('keeps scheduled cancellation hold and does not revive terminal subscriptions', () => {
    const cancellation = fact(2, 'SCHEDULE_CANCELLATION')
    const terminal = fact(3, 'END_AT_PERIOD')
    const renewal = fact(4, 'RENEWAL', { periodEnd: laterEnd })
    expect(inspect(renewal, [active, cancellation])).toMatchObject({
      outcome: 'REVIEW_REQUIRED', audit: { reason: 'CANCELLATION_HOLD' },
    })
    expect(inspect(renewal, [active, terminal])).toMatchObject({
      outcome: 'REVIEW_REQUIRED', audit: { reason: 'TERMINAL_SUBSCRIPTION_HOLD' },
    })
  })

  it('rejects an early period end but permits a simulated end at paid-through date', () => {
    const cancellation = fact(2, 'SCHEDULE_CANCELLATION')
    const terminal = fact(3, 'END_AT_PERIOD', {
      providerCreatedAt: '2026-11-19T01:00:00Z',
    })
    expect(inspect(terminal, [active, cancellation])).toMatchObject({
      outcome: 'REVIEW_REQUIRED', audit: { reason: 'END_BEFORE_PAID_PERIOD' },
    })
    expect(inspect(terminal, [active, cancellation], {
      now: '2026-11-19T02:00:00Z',
    })).toMatchObject({
      outcome: 'SIMULATED_CANDIDATE_ONLY', audit: { reason: 'SIMULATED_PERIOD_END' },
      candidate: { status: 'ENDED' },
    })
  })

  it('never extends paid period due to payment failure', () => {
    expect(inspect(fact(2, 'PAYMENT_DUE'), [active])).toMatchObject({
      outcome: 'SIMULATED_CANDIDATE_ONLY',
      audit: { reason: 'SIMULATED_PAYMENT_DUE' },
      candidate: { status: 'PAST_DUE', periodEnd: end },
    })
    expect(inspect(fact(3, 'PAYMENT_DUE', {periodEnd: laterEnd}), [active])).toMatchObject({
      outcome: 'REVIEW_REQUIRED', audit: { reason: 'FAILED_PAYMENT_PERIOD_MISMATCH' },
    })
    expect(inspect(fact(3, 'PAYMENT_DUE'), [active, fact(2, 'PAYMENT_DUE')])).toMatchObject({
      outcome: 'REVIEW_REQUIRED', audit: { reason: 'REPEATED_PAYMENT_FAILURE' },
    })
  })

  it('does not create a subscription from a failed payment or cancellation', () => {
    for (const action of ['PAYMENT_DUE', 'SCHEDULE_CANCELLATION'] as const) {
      expect(inspect(fact(1, action))).toMatchObject({
        outcome: 'REVIEW_REQUIRED',
        audit: { reason: 'INITIAL_SUBSCRIPTION_REQUIRES_REVIEW' },
      })
    }
  })

  it('rejects foreign organizations and provider subscriptions', () => {
    expect(inspect({ ...active, organizationId:'99999999-9999-4999-8999-999999999999' }))
      .toMatchObject({ outcome:'REVIEW_REQUIRED',
        audit: { reason:'TENANT_OR_SUBSCRIPTION_MISMATCH' }})
    expect(inspect({ ...active, providerSubscriptionId:'sub_foreign' }))
      .toMatchObject({ outcome:'REVIEW_REQUIRED',
        audit: { reason:'TENANT_OR_SUBSCRIPTION_MISMATCH' }})
    expect(inspect(fact(2,'RENEWAL',{periodEnd:laterEnd}), [
      {...active, subscriptionRecordId:'99999999-9999-4999-8999-999999999999'},
    ])).toMatchObject({outcome:'REVIEW_REQUIRED',
      audit:{reason:'TENANT_OR_SUBSCRIPTION_MISMATCH'}})
  })

  it('rejects history gaps that can be observed: duplicates and bad ordering', () => {
    const b=fact(2,'RENEWAL',{periodEnd:laterEnd})
    const c=fact(3,'PAYMENT_DUE',{periodEnd:laterEnd})
    const incoming=fact(4,'RENEWAL',{periodEnd:'2027-01-19T00:00:00Z'})
    for(const history of [
      [b,active],
      [active,active],
      [active,{...b,providerCreatedAt:active.providerCreatedAt}],
      [active,{...b,providerEventId:active.providerEventId}],
      [active,{...b,webhookEventRecordId:active.webhookEventRecordId}],
      [active,{...c,verificationStatus:'VERIFIED' as 'UNVERIFIED'}],
    ]) {
      expect(inspect(incoming,history)).toMatchObject({
        outcome:'REVIEW_REQUIRED',audit:{reason:'HISTORY_INVALID_OR_AMBIGUOUS'},
      })
    }
  })

  it('fails closed for missing source metadata, invalid status and LIVE mode', () => {
    const incoming=fact(2,'RENEWAL',{periodEnd:laterEnd})
    for(const patch of [
      {eventFingerprint:'not-a-hash'},
      {providerCreatedAt:'unknown'},
      {sourceKind:'EXTERNAL'},
      {verificationStatus:'VERIFIED'},
      {accessAuthorized:true},
      {status:'ENDED'},
    ]) {
      expect(inspect({...incoming,...patch} as SyntheticProposalFact,[active])).toMatchObject({
        outcome:'REVIEW_REQUIRED',audit:{reason:'INVALID_INPUT'},
      })
    }
    expect(inspect(incoming,[active],{environment:'LIVE'})).toMatchObject({
      outcome:'REVIEW_REQUIRED',audit:{reason:'LIVE_GATED'},
    })
  })

  it('keeps a bounded audit-ready descriptor without PII or persisted status', () => {
    const result=inspect(fact(2,'RENEWAL',{periodEnd:laterEnd}),[active])
    expect(result.audit).toEqual({
      organizationId:org,subscriptionRecordId,providerSubscriptionId:sub,
      incomingEventId:'evt_case2',
      incomingWebhookRecordId:'33333333-3333-4333-8333-000000000002',
      previousEventId:'evt_case1',
      assessedAt:now,
      reason:'SIMULATED_RENEWAL',
      environment:'TEST',sourceKind:'SYNTHETIC',
      evidenceVerified:false,accessAuthorized:false,durableAuditRecorded:false,
    })
    expect(JSON.stringify(result)).not.toContain('cus_')
    expect(JSON.stringify(result)).not.toContain('sk_live_')
  })

  it('preserves the 30 Free Review Requests trial without mutating data', () => {
    const trial={status:'ACTIVE' as const, allocated_requests:DEFAULT_TRIAL_REQUESTS,
      consumed_requests:12,expires_at:'2026-11-01T00:00:00Z'}
    const original=JSON.stringify(trial)
    const before=deriveTrialLifecycle(trial,new Date(now))
    inspect(fact(2,'RENEWAL',{periodEnd:laterEnd}),[active])
    inspect(fact(2,'PAYMENT_DUE'),[active])
    expect(JSON.stringify(trial)).toBe(original)
    expect(DEFAULT_TRIAL_REQUESTS).toBe(30)
    expect(deriveTrialLifecycle(trial,new Date(now))).toEqual(before)
    expect(before.remainingRequests).toBe(18)
  })
})
