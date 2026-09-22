import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  dispatchPendingOutboxEvents,
} from '@/domain/outbox/dispatcher'
import { inngest } from '@/inngest/client'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  authorizeSupportAccess,
  type SupportAccess,
} from './access'
import {
  recordSupportOutboxRetryAudit,
  type SupportOutboxRetryAuditOutcome,
} from './audit'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const OUTBOX_STALE_MS =
  10 * 60 * 1000

type OutboxCandidate = {
  id: string
  organization_id: string
  event_type: string
  aggregate_type: string
  status: string
  attempt_count: number
  created_at: string
}

export type SupportOutboxRetryResult =
  | { status: 'DENIED' }
  | { status: 'UNAVAILABLE' }
  | { status: 'NOT_ELIGIBLE' }
  | {
      status: 'DISPATCHED'
      actionId: string
    }
  | {
      status: 'RETRY_FAILED'
      actionId: string
    }
  | {
      status: 'NO_LONGER_ELIGIBLE'
      actionId: string
    }
  | {
      status: 'OUTCOME_UNKNOWN'
      actionId: string
    }
  | {
      status: 'OUTCOME_UNAVAILABLE'
      actionId: string
    }

interface SupportRecoveryDependencies {
  inngestClient?: typeof inngest
}

async function readCandidate(
  access: SupportAccess,
  outboxId: string
) {
  return await access.supabase
    .from('domain_event_outbox')
    .select(
      'id,organization_id,event_type,aggregate_type,status,attempt_count,created_at'
    )
    .eq(
      'organization_id',
      access.organizationId
    )
    .eq('id', outboxId)
    .maybeSingle()
}

function isEligibleCandidate(
  row: OutboxCandidate,
  now: number
): boolean {
  if (
    row.status !== 'PENDING' ||
    row.event_type !==
      'customer.completed' ||
    row.aggregate_type !==
      'customer_completion_event'
  ) {
    return false
  }

  if (row.attempt_count > 0) {
    return true
  }

  const createdAt =
    Date.parse(row.created_at)

  if (!Number.isFinite(createdAt)) {
    return false
  }

  return (
    createdAt <=
    now - OUTBOX_STALE_MS
  )
}

async function writeResultAudit(
  access: SupportAccess,
  actionId: string,
  outboxId: string,
  outcome:
    SupportOutboxRetryAuditOutcome
): Promise<boolean> {
  return await recordSupportOutboxRetryAudit(
    access,
    {
      actionId,
      outboxId,
      phase: 'RESULT',
      outcome,
    }
  )
}

/**
 * MR-6D bounded recovery:
 * retry one exact eligible PENDING
 * customer.completed outbox event.
 *
 * This does not permit arbitrary replay,
 * FAILED-state reset, webhook replay,
 * review-request resend, billing mutation,
 * or bulk recovery.
 */
export async function retrySupportOutboxEvent(
  organizationId: string,
  outboxId: string,
  dependencies:
    SupportRecoveryDependencies = {}
): Promise<SupportOutboxRetryResult> {
  const access =
    await authorizeSupportAccess(
      organizationId
    )

  if (!access) {
    return { status: 'DENIED' }
  }

  if (
    typeof outboxId !== 'string' ||
    !UUID.test(outboxId)
  ) {
    return {
      status: 'NOT_ELIGIBLE',
    }
  }

  const now = Date.now()

  const initial =
    await readCandidate(
      access,
      outboxId
    )

  if (initial.error) {
    return {
      status: 'UNAVAILABLE',
    }
  }

  if (
    !initial.data ||
    !isEligibleCandidate(
      initial.data,
      now
    )
  ) {
    return {
      status: 'NOT_ELIGIBLE',
    }
  }

  const actionId =
    randomUUID()

  const requestAudit =
    await recordSupportOutboxRetryAudit(
      access,
      {
        actionId,
        outboxId,
        phase: 'REQUEST',
        outcome: 'REQUESTED',
      }
    )

  // No mutation occurs when the mandatory
  // request audit cannot be persisted.
  if (!requestAudit) {
    return {
      status: 'UNAVAILABLE',
    }
  }

  // Do not retain authorization blindly
  // across inspection + audit.
  const currentAccess =
    await authorizeSupportAccess(
      access.organizationId
    )

  if (
    !currentAccess ||
    currentAccess.actorId !==
      access.actorId
  ) {
    await writeResultAudit(
      access,
      actionId,
      outboxId,
      'AUTHORIZATION_CHANGED'
    )

    return {
      status: 'DENIED',
    }
  }

  // Re-read the exact row after request
  // audit and immediately before mutation.
  const current =
    await readCandidate(
      currentAccess,
      outboxId
    )

  if (current.error) {
    await writeResultAudit(
      currentAccess,
      actionId,
      outboxId,
      'PRECONDITION_UNAVAILABLE'
    )

    return {
      status: 'UNAVAILABLE',
    }
  }

  if (
    !current.data ||
    !isEligibleCandidate(
      current.data,
      Date.now()
    )
  ) {
    const audited =
      await writeResultAudit(
        currentAccess,
        actionId,
        outboxId,
        'NO_LONGER_ELIGIBLE'
      )

    if (!audited) {
      return {
        status:
          'OUTCOME_UNAVAILABLE',
        actionId,
      }
    }

    return {
      status:
        'NO_LONGER_ELIGIBLE',
      actionId,
    }
  }

  let outcome:
    SupportOutboxRetryAuditOutcome =
      'OUTCOME_UNKNOWN'

  try {
    const result =
      await dispatchPendingOutboxEvents(
        createAdminClient(),
        dependencies.inngestClient ??
          inngest,
        {
          batchSize: 1,
          organizationId:
            currentAccess.organizationId,
          eventId: outboxId,
        }
      )

    const after =
      await readCandidate(
        currentAccess,
        outboxId
      )

    if (
      after.error ||
      !after.data
    ) {
      outcome =
        'OUTCOME_UNKNOWN'
    } else if (
      result.dispatched === 1 &&
      after.data.status ===
        'DISPATCHED'
    ) {
      outcome = 'DISPATCHED'
    } else if (
      result.failed === 1 &&
      after.data.status ===
        'PENDING'
    ) {
      outcome = 'RETRY_FAILED'
    } else if (
      after.data.status !==
        'PENDING'
    ) {
      outcome =
        'NO_LONGER_ELIGIBLE'
    } else {
      // This includes the important case where
      // provider dispatch may have succeeded but
      // durable state could not be confirmed.
      outcome =
        'OUTCOME_UNKNOWN'
    }
  } catch {
    // Do not expose raw provider/transport
    // details and do not encourage blind retry.
    outcome =
      'OUTCOME_UNKNOWN'
  }

  const resultAudit =
    await writeResultAudit(
      currentAccess,
      actionId,
      outboxId,
      outcome
    )

  // The action may already have occurred.
  // A missing result audit must not be
  // represented as a clean retry failure.
  if (!resultAudit) {
    return {
      status:
        'OUTCOME_UNAVAILABLE',
      actionId,
    }
  }

  switch (outcome) {
    case 'DISPATCHED':
      return {
        status: 'DISPATCHED',
        actionId,
      }

    case 'RETRY_FAILED':
      return {
        status: 'RETRY_FAILED',
        actionId,
      }

    case 'NO_LONGER_ELIGIBLE':
      return {
        status:
          'NO_LONGER_ELIGIBLE',
        actionId,
      }

    default:
      return {
        status:
          'OUTCOME_UNKNOWN',
        actionId,
      }
  }
}
