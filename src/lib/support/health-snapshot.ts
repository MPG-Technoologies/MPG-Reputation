import 'server-only'

import {
  authorizeSupportAccess,
  type SupportAccess,
} from './access'
import {
  recordSupportHealthSnapshotInspection,
} from './audit'

const OUTBOX_STALE_MS = 10 * 60 * 1000
const WEBHOOK_INCOMPLETE_MS = 5 * 60 * 1000

export type SupportMessagingMode =
  | 'CONSOLE'
  | 'LIVE_RESEND_CONFIGURED'
  | 'LIVE_EMAIL_DISABLED'
  | 'CONFIGURATION_INCOMPLETE'

export interface SupportMessagingConfiguration {
  mode: SupportMessagingMode
  providerIntent: 'CONSOLE' | 'RESEND' | 'OTHER'
  liveEmailEnabled: boolean
  apiKeyConfigured: boolean
  fromAddressConfigured: boolean
  webhookVerificationConfigured: boolean
}

export interface SupportMessageWindow {
  windowHours: 24 | 168
  sendRecords: {
    allProviders: number
    resend: number
  }
  providerEvents: {
    delivered: number
    deliveryDelayed: number
    bounced: number
    complained: number
    failed: number
    suppressed: number
  }
  incompletePersistedWebhooks: number
}

export interface SupportOutboxHealth {
  pendingUntouched: number
  retrying: number
  staleUntouched: number
  dispatched: number
  failed: number
  oldestPendingAgeMinutes: number | null
}

export interface SupportHealthSnapshot {
  messaging: SupportMessagingConfiguration
  last24Hours: SupportMessageWindow
  last7Days: SupportMessageWindow
  outbox: SupportOutboxHealth
  deliverabilityRatios: {
    status: 'UNKNOWN'
    reason:
      'COHORT_SAFE_DENOMINATOR_NOT_CALCULATED'
  }
  snapshotAt: string
}

export type SupportHealthSnapshotResult =
  | { status: 'DENIED' }
  | { status: 'UNAVAILABLE' }
  | {
      status: 'AVAILABLE'
      snapshot: SupportHealthSnapshot
    }

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

function validEmailAddress(
  value: string | undefined
): boolean {
  if (!value) return false

  const normalized = value.trim()
  const at = normalized.indexOf('@')

  return (
    at > 0 &&
    at < normalized.length - 1 &&
    !/[\r\n\t\0]/.test(normalized)
  )
}

function getMessagingConfiguration():
  SupportMessagingConfiguration {
  const rawProvider =
    process.env.EMAIL_PROVIDER?.trim().toLowerCase()

  const providerIntent:
    SupportMessagingConfiguration['providerIntent'] =
      !rawProvider || rawProvider === 'console'
        ? 'CONSOLE'
        : rawProvider === 'resend'
          ? 'RESEND'
          : 'OTHER'

  const liveEmailEnabled =
    process.env.ENABLE_LIVE_EMAIL === 'true'

  const apiKeyConfigured =
    configured(process.env.RESEND_API_KEY)

  const fromAddressConfigured =
    validEmailAddress(
      process.env.EMAIL_FROM_ADDRESS
    )

  const webhookVerificationConfigured =
    configured(
      process.env.RESEND_WEBHOOK_SECRET
    )

  let mode: SupportMessagingMode

  if (providerIntent === 'CONSOLE') {
    mode = 'CONSOLE'
  } else if (providerIntent !== 'RESEND') {
    mode = 'CONFIGURATION_INCOMPLETE'
  } else if (
    !apiKeyConfigured ||
    !fromAddressConfigured
  ) {
    mode = 'CONFIGURATION_INCOMPLETE'
  } else if (!liveEmailEnabled) {
    mode = 'LIVE_EMAIL_DISABLED'
  } else {
    mode = 'LIVE_RESEND_CONFIGURED'
  }

  return {
    mode,
    providerIntent,
    liveEmailEnabled,
    apiKeyConfigured,
    fromAddressConfigured,
    webhookVerificationConfigured,
  }
}

function requireCount(
  result: {
    count: number | null
    error: unknown
  }
): number {
  if (
    result.error ||
    typeof result.count !== 'number'
  ) {
    throw new Error(
      'SUPPORT_HEALTH_COUNT_UNAVAILABLE'
    )
  }

  return result.count
}

async function buildMessageWindow(
  supabase: SupportAccess['supabase'],
  organizationId: string,
  windowHours: 24 | 168,
  now: number
): Promise<SupportMessageWindow> {
  const since = new Date(
    now - windowHours * 60 * 60 * 1000
  ).toISOString()

  const incompleteCutoff = new Date(
    now - WEBHOOK_INCOMPLETE_MS
  ).toISOString()

  const [
    allSentResult,
    resendSentResult,
    deliveredResult,
    delayedResult,
    bouncedResult,
    complainedResult,
    failedResult,
    suppressedResult,
    incompleteResult,
  ] = await Promise.all([
    supabase
      .from('message_events')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('event_type', 'sent')
      .gte('created_at', since),

    supabase
      .from('message_events')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('provider', 'resend')
      .eq('event_type', 'sent')
      .gte('created_at', since),

    supabase
      .from('message_events')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('provider', 'resend')
      .eq('event_type', 'email.delivered')
      .gte('created_at', since),

    supabase
      .from('message_events')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('provider', 'resend')
      .eq(
        'event_type',
        'email.delivery_delayed'
      )
      .gte('created_at', since),

    supabase
      .from('message_events')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('provider', 'resend')
      .eq('event_type', 'email.bounced')
      .gte('created_at', since),

    supabase
      .from('message_events')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('provider', 'resend')
      .eq('event_type', 'email.complained')
      .gte('created_at', since),

    supabase
      .from('message_events')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('provider', 'resend')
      .eq('event_type', 'email.failed')
      .gte('created_at', since),

    supabase
      .from('message_events')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('provider', 'resend')
      .eq('event_type', 'email.suppressed')
      .gte('created_at', since),

    supabase
      .from('message_events')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .not('provider_event_id', 'is', null)
      .is('processed_at', null)
      .gte('created_at', since)
      .lt('created_at', incompleteCutoff),
  ])

  return {
    windowHours,
    sendRecords: {
      allProviders:
        requireCount(allSentResult),
      resend:
        requireCount(resendSentResult),
    },
    providerEvents: {
      delivered:
        requireCount(deliveredResult),
      deliveryDelayed:
        requireCount(delayedResult),
      bounced:
        requireCount(bouncedResult),
      complained:
        requireCount(complainedResult),
      failed:
        requireCount(failedResult),
      suppressed:
        requireCount(suppressedResult),
    },
    incompletePersistedWebhooks:
      requireCount(incompleteResult),
  }
}

async function buildOutboxHealth(
  supabase: SupportAccess['supabase'],
  organizationId: string,
  now: number
): Promise<SupportOutboxHealth> {
  const staleCutoff = new Date(
    now - OUTBOX_STALE_MS
  ).toISOString()

  const [
    untouchedResult,
    retryingResult,
    staleResult,
    dispatchedResult,
    failedResult,
    oldestPendingResult,
  ] = await Promise.all([
    supabase
      .from('domain_event_outbox')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('status', 'PENDING')
      .eq('attempt_count', 0),

    supabase
      .from('domain_event_outbox')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('status', 'PENDING')
      .gt('attempt_count', 0),

    supabase
      .from('domain_event_outbox')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('status', 'PENDING')
      .eq('attempt_count', 0)
      .lt('created_at', staleCutoff),

    supabase
      .from('domain_event_outbox')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('status', 'DISPATCHED'),

    supabase
      .from('domain_event_outbox')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('status', 'FAILED'),

    supabase
      .from('domain_event_outbox')
      .select('created_at')
      .eq('organization_id', organizationId)
      .eq('status', 'PENDING')
      .order('created_at', {
        ascending: true,
      })
      .limit(1)
      .maybeSingle(),
  ])

  if (oldestPendingResult.error) {
    throw new Error(
      'SUPPORT_HEALTH_OUTBOX_UNAVAILABLE'
    )
  }

  const oldestPendingAgeMinutes =
    oldestPendingResult.data
      ? Math.max(
          0,
          Math.floor(
            (
              now -
              Date.parse(
                oldestPendingResult
                  .data
                  .created_at
              )
            ) /
              60_000
          )
        )
      : null

  return {
    pendingUntouched:
      requireCount(untouchedResult),
    retrying:
      requireCount(retryingResult),
    staleUntouched:
      requireCount(staleResult),
    dispatched:
      requireCount(dispatchedResult),
    failed:
      requireCount(failedResult),
    oldestPendingAgeMinutes,
  }
}

export async function getSupportHealthSnapshot(
  organizationId: string
): Promise<SupportHealthSnapshotResult> {
  const access =
    await authorizeSupportAccess(
      organizationId
    )

  if (!access) {
    return { status: 'DENIED' }
  }

  let snapshot: SupportHealthSnapshot

  try {
    const now = Date.now()

    const [
      last24Hours,
      last7Days,
      outbox,
    ] = await Promise.all([
      buildMessageWindow(
        access.supabase,
        access.organizationId,
        24,
        now
      ),
      buildMessageWindow(
        access.supabase,
        access.organizationId,
        168,
        now
      ),
      buildOutboxHealth(
        access.supabase,
        access.organizationId,
        now
      ),
    ])

    snapshot = {
      messaging:
        getMessagingConfiguration(),
      last24Hours,
      last7Days,
      outbox,
      deliverabilityRatios: {
        status: 'UNKNOWN',
        reason:
          'COHORT_SAFE_DENOMINATOR_NOT_CALCULATED',
      },
      snapshotAt:
        new Date(now).toISOString(),
    }
  } catch {
    await recordSupportHealthSnapshotInspection(
      access,
      'UNAVAILABLE'
    )

    return {
      status: 'UNAVAILABLE',
    }
  }

  const currentAccess =
    await authorizeSupportAccess(
      access.organizationId
    )

  if (
    !currentAccess ||
    currentAccess.actorId !== access.actorId
  ) {
    return { status: 'DENIED' }
  }

  if (
    !await recordSupportHealthSnapshotInspection(
      currentAccess,
      'AVAILABLE'
    )
  ) {
    return {
      status: 'UNAVAILABLE',
    }
  }

  return {
    status: 'AVAILABLE',
    snapshot,
  }
}
