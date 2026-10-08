import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  hashSuppressionContact,
  normalizeEmail,
  normalizePhone,
} from '@/domain/suppression'
import type { Json } from '@/types/database'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const CUSTOMER_PRIVACY_EXPORT_SCHEMA_VERSION = '1.0' as const

type TenantClient = Awaited<ReturnType<typeof createClient>>

type ExportAuthority =
  | 'AUTHORIZED'
  | 'DENIED'
  | 'UNAVAILABLE'

export interface CustomerPrivacyExport {
  schemaVersion:
    typeof CUSTOMER_PRIVACY_EXPORT_SCHEMA_VERSION

  exportedAt: string

  organizationId: string

  customer: {
    id: string
    locationId: string
    firstName: string
    lastName: string | null
    email: string | null
    phone: string | null
    permissionEmail:
      | 'allowed'
      | 'unknown'
      | 'denied'
    permissionSms:
      | 'allowed'
      | 'unknown'
      | 'denied'
    permissionSource: string
    createdAt: string
    updatedAt: string
  }

  completionEvents: Array<{
    id: string
    locationId: string
    source: string
    sourceEventId: string
    sourceCustomerId: string | null
    sourceTransactionId: string | null
    completedAt: string
    country: string

    contactSnapshot: Record<
      string,
      Json
    >

    permissionSnapshot: Record<
      string,
      Json
    >

    createdAt: string
  }>

  reviewRequests: Array<{
    id: string
    locationId: string
    completionEventId: string
    channel: 'email' | 'sms'

    status:
      | 'SCHEDULED'
      | 'SENDING'
      | 'SENT'
      | 'DELIVERED'
      | 'CLICKED'
      | 'FAILED'
      | 'CANCELLED'
      | 'SUPPRESSED'

    scheduledFor: string
    sentAt: string | null
    deliveredAt: string | null
    remindedAt: string | null
    clickedAt: string | null
    cancelledAt: string | null
    failedAt: string | null
    createdAt: string
    updatedAt: string

    events: Array<{
      eventType: string
      createdAt: string
    }>

    messageEvents: Array<{
      provider: string
      eventType: string
      status: string
      sanitizedError: string | null
      eventOccurredAt: string | null
      processedAt: string | null
      createdAt: string
    }>
  }>

  authorityEvidence: Array<{
    completionEventId: string
    channel: 'email' | 'sms'

    assertedState:
      | 'allowed'
      | 'unknown'
      | 'denied'

    assertionKind:
      'OPERATIONAL_PERMISSION_STATE'

    permissionSource: string
    completionSource: string
    sourceEventId: string
    country: string | null
    assertedAt: string | null
    observedAt: string
    basisType: string | null
    captureMethod: string | null
    evidenceReference: string | null
    policyVersion: string | null
    actorType: string
    createdAt: string
  }>

  suppressions: Array<{
    channel: string
    reason: string
    createdAt: string
  }>
}

export type CustomerPrivacyExportResult =
  | {
      status: 'AVAILABLE'
      export: CustomerPrivacyExport
    }
  | {
      status: 'DENIED'
    }
  | {
      status: 'UNAVAILABLE'
    }

function pickJsonFields(
  value: Json,
  fields: readonly string[]
): Record<string, Json> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return {}
  }

  const source = value as {
    [key: string]:
      | Json
      | undefined
  }

  const picked: Record<
    string,
    Json
  > = {}

  for (const field of fields) {
    const candidate =
      source[field]

    if (candidate !== undefined) {
      picked[field] =
        candidate
    }
  }

  return picked
}

function readJsonString(
  value: Json,
  field: string
): string | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null
  }

  const candidate =
    value[field]

  return typeof candidate === 'string'
    ? candidate
    : null
}

async function checkExportAuthority(
  supabase: TenantClient,
  organizationId: string,
  userId: string
): Promise<ExportAuthority> {
  const {
    data: membership,
    error,
  } = await supabase
    .from('organization_users')
    .select('role')
    .eq(
      'organization_id',
      organizationId
    )
    .eq(
      'user_id',
      userId
    )
    .maybeSingle()

  if (error) {
    return 'UNAVAILABLE'
  }

  if (
    !membership ||
    !['OWNER', 'ADMIN'].includes(
      membership.role
    )
  ) {
    return 'DENIED'
  }

  return 'AUTHORIZED'
}

/**
 * Build one customer-scoped privacy export.
 *
 * Security boundary:
 *
 * - authenticated session required;
 * - tenant OWNER or ADMIN only;
 * - normal tenant/RLS client is used for
 *   tenant-visible records;
 * - service role is limited to the
 *   system-owned authority-evidence read
 *   and mandatory audit write;
 * - all queries are explicitly scoped to
 *   organization + customer relations;
 * - bearer tokens, token hashes,
 *   provider IDs and raw internal metadata
 *   are never selected;
 * - authorization is rechecked before
 *   the export is released;
 * - any required read/audit failure
 *   withholds the entire export.
 */
export async function getCustomerPrivacyExport(
  organizationId: string,
  customerId: string
): Promise<CustomerPrivacyExportResult> {
  if (
    !UUID.test(organizationId) ||
    !UUID.test(customerId)
  ) {
    return {
      status: 'DENIED',
    }
  }

  try {
    const supabase =
      await createClient()

    const {
      data: { user },
      error: authError,
    } =
      await supabase.auth.getUser()

    if (
      authError ||
      !user ||
      user.is_anonymous
    ) {
      return {
        status: 'DENIED',
      }
    }

    const initialAuthority =
      await checkExportAuthority(
        supabase,
        organizationId,
        user.id
      )

    if (
      initialAuthority !==
      'AUTHORIZED'
    ) {
      return {
        status:
          initialAuthority,
      }
    }

    const {
      data: customer,
      error: customerError,
    } = await supabase
      .from('customers')
      .select('id, location_id, first_name, last_name, email, phone, permission_email, permission_sms, permission_source, created_at, updated_at')
      .eq(
        'organization_id',
        organizationId
      )
      .eq(
        'id',
        customerId
      )
      .maybeSingle()

    if (customerError) {
      return {
        status: 'UNAVAILABLE',
      }
    }

    // Foreign and nonexistent
    // customer IDs fail identically.
    if (!customer) {
      return {
        status: 'DENIED',
      }
    }

    const {
      data: completionRows,
      error: completionError,
    } = await supabase
      .from(
        'customer_completion_events'
      )
      .select('id, location_id, source, source_event_id, source_customer_id, source_transaction_id, completed_at, country, contact, permission, created_at')
      .eq(
        'organization_id',
        organizationId
      )
      .eq(
        'customer_id',
        customerId
      )
      .order(
        'created_at',
        {
          ascending: true,
        }
      )

    if (completionError) {
      return {
        status: 'UNAVAILABLE',
      }
    }

    const {
      data: reviewRows,
      error: reviewError,
    } = await supabase
      .from('review_requests')
      .select('id, location_id, completion_event_id, channel, status, scheduled_for, sent_at, delivered_at, reminded_at, clicked_at, cancelled_at, failed_at, created_at, updated_at')
      .eq(
        'organization_id',
        organizationId
      )
      .eq(
        'customer_id',
        customerId
      )
      .order(
        'created_at',
        {
          ascending: true,
        }
      )

    if (reviewError) {
      return {
        status: 'UNAVAILABLE',
      }
    }

    const reviewRequestIds =
      (
        reviewRows ?? []
      ).map(
        (row) => row.id
      )

    let reviewEventRows:
      Array<{
        review_request_id:
          string
        event_type: string
        created_at: string
      }> = []

    let messageEventRows:
      Array<{
        review_request_id:
          string
        provider: string
        event_type: string
        status: string
        sanitized_error:
          string | null
        event_occurred_at:
          string | null
        processed_at:
          string | null
        created_at: string
      }> = []

    if (
      reviewRequestIds.length >
      0
    ) {
      const {
        data: eventData,
        error: eventError,
      } = await supabase
        .from(
          'review_request_events'
        )
        .select('review_request_id, event_type, created_at')
        .eq(
          'organization_id',
          organizationId
        )
        .in(
          'review_request_id',
          reviewRequestIds
        )
        .order(
          'created_at',
          {
            ascending: true,
          }
        )

      if (eventError) {
        return {
          status: 'UNAVAILABLE',
        }
      }

      reviewEventRows =
        eventData ?? []

      const {
        data: messageData,
        error: messageError,
      } = await supabase
        .from('message_events')
        .select('review_request_id, provider, event_type, status, sanitized_error, event_occurred_at, processed_at, created_at')
        .eq(
          'organization_id',
          organizationId
        )
        .in(
          'review_request_id',
          reviewRequestIds
        )
        .order(
          'created_at',
          {
            ascending: true,
          }
        )

      if (messageError) {
        return {
          status: 'UNAVAILABLE',
        }
      }

      messageEventRows =
        messageData ?? []
    }

    /*
     * System-owned evidence table:
     * use service role only after
     * session + tenant + role +
     * target customer authorization
     * have succeeded.
     */
    const admin =
      createAdminClient()

    const {
      data: authorityRows,
      error: authorityError,
    } = await admin
      .from(
        'messaging_authority_evidence'
      )
      .select('completion_event_id, channel, asserted_state, assertion_kind, permission_source, completion_source, source_event_id, country, asserted_at, observed_at, basis_type, capture_method, evidence_reference, policy_version, actor_type, created_at')
      .eq(
        'organization_id',
        organizationId
      )
      .eq(
        'customer_id',
        customerId
      )
      .order(
        'created_at',
        {
          ascending: true,
        }
      )

    if (authorityError) {
      return {
        status: 'UNAVAILABLE',
      }
    }

    /*
     * Suppression evidence is
     * pseudonymous and must not leak
     * its hash in the export.
     *
     * Resolve subject-associated
     * suppressions from both the
     * current customer record and
     * historical completion contact
     * snapshots.
     */
    const emailContacts =
      new Set<string>()

    const phoneContacts =
      new Set<string>()

    if (
      customer.email
    ) {
      const normalized =
        normalizeEmail(
          customer.email
        )

      if (normalized) {
        emailContacts.add(
          normalized
        )
      }
    }

    if (
      customer.phone
    ) {
      const normalized =
        normalizePhone(
          customer.phone
        )

      if (normalized) {
        phoneContacts.add(
          normalized
        )
      }
    }

    for (
      const completion of
        completionRows ?? []
    ) {
      const email =
        readJsonString(
          completion.contact,
          'email'
        )

      const phone =
        readJsonString(
          completion.contact,
          'phone'
        )

      if (email) {
        const normalized =
          normalizeEmail(email)

        if (normalized) {
          emailContacts.add(
            normalized
          )
        }
      }

      if (phone) {
        const normalized =
          normalizePhone(phone)

        if (normalized) {
          phoneContacts.add(
            normalized
          )
        }
      }
    }

    const suppressionHashes =
      new Set<string>()

    for (
      const email of
        emailContacts
    ) {
      suppressionHashes.add(
        hashSuppressionContact(
          'email',
          email
        )
      )
    }

    for (
      const phone of
        phoneContacts
    ) {
      suppressionHashes.add(
        hashSuppressionContact(
          'sms',
          phone
        )
      )
    }

    let suppressionRows:
      Array<{
        channel: string
        reason: string
        created_at: string
      }> = []

    if (
      suppressionHashes.size >
      0
    ) {
      const {
        data: suppressionData,
        error:
          suppressionError,
      } = await supabase
        .from('suppressions')
        .select('channel, reason, created_at, contact_hash')
        .eq(
          'organization_id',
          organizationId
        )
        .in(
          'contact_hash',
          [
            ...suppressionHashes,
          ]
        )
        .order(
          'created_at',
          {
            ascending: true,
          }
        )

      if (suppressionError) {
        return {
          status: 'UNAVAILABLE',
        }
      }

      suppressionRows =
        (
          suppressionData ??
          []
        ).map(
          (row) => ({
            channel:
              row.channel,
            reason:
              row.reason,
            created_at:
              row.created_at,
          })
        )
    }

    /*
     * Sensitive operation:
     * authorization is rechecked
     * immediately before release.
     */
    const finalAuthority =
      await checkExportAuthority(
        supabase,
        organizationId,
        user.id
      )

    if (
      finalAuthority !==
      'AUTHORIZED'
    ) {
      return {
        status:
          finalAuthority,
      }
    }

    const reviewEventsByRequest =
      new Map<
        string,
        CustomerPrivacyExport[
          'reviewRequests'
        ][number]['events']
      >()

    for (
      const event of
        reviewEventRows
    ) {
      const list =
        reviewEventsByRequest.get(
          event.review_request_id
        ) ?? []

      list.push({
        eventType:
          event.event_type,
        createdAt:
          event.created_at,
      })

      reviewEventsByRequest.set(
        event.review_request_id,
        list
      )
    }

    const messageEventsByRequest =
      new Map<
        string,
        CustomerPrivacyExport[
          'reviewRequests'
        ][number][
          'messageEvents'
        ]
      >()

    for (
      const event of
        messageEventRows
    ) {
      const list =
        messageEventsByRequest.get(
          event.review_request_id
        ) ?? []

      list.push({
        provider:
          event.provider,
        eventType:
          event.event_type,
        status:
          event.status,
        sanitizedError:
          event.sanitized_error,
        eventOccurredAt:
          event.event_occurred_at,
        processedAt:
          event.processed_at,
        createdAt:
          event.created_at,
      })

      messageEventsByRequest.set(
        event.review_request_id,
        list
      )
    }

    const privacyExport:
      CustomerPrivacyExport = {
      schemaVersion:
        CUSTOMER_PRIVACY_EXPORT_SCHEMA_VERSION,

      exportedAt:
        new Date().toISOString(),

      organizationId,

      customer: {
        id: customer.id,

        locationId:
          customer.location_id,

        firstName:
          customer.first_name,

        lastName:
          customer.last_name,

        email:
          customer.email,

        phone:
          customer.phone,

        permissionEmail:
          customer.permission_email,

        permissionSms:
          customer.permission_sms,

        permissionSource:
          customer.permission_source,

        createdAt:
          customer.created_at,

        updatedAt:
          customer.updated_at,
      },

      completionEvents:
        (
          completionRows ??
          []
        ).map(
          (row) => ({
            id: row.id,

            locationId:
              row.location_id,

            source:
              row.source,

            sourceEventId:
              row.source_event_id,

            sourceCustomerId:
              row.source_customer_id,

            sourceTransactionId:
              row.source_transaction_id,

            completedAt:
              row.completed_at,

            country:
              row.country,

            contactSnapshot:
              pickJsonFields(
                row.contact,
                [
                  'email',
                  'phone',
                  'firstName',
                  'lastName',
                ]
              ),

            permissionSnapshot:
              pickJsonFields(
                row.permission,
                [
                  'email',
                  'sms',
                  'source',
                ]
              ),

            createdAt:
              row.created_at,
          })
        ),

      reviewRequests:
        (
          reviewRows ??
          []
        ).map(
          (row) => ({
            id: row.id,

            locationId:
              row.location_id,

            completionEventId:
              row.completion_event_id,

            channel:
              row.channel,

            status:
              row.status,

            scheduledFor:
              row.scheduled_for,

            sentAt:
              row.sent_at,

            deliveredAt:
              row.delivered_at,

            remindedAt:
              row.reminded_at ??
              null,

            clickedAt:
              row.clicked_at,

            cancelledAt:
              row.cancelled_at,

            failedAt:
              row.failed_at,

            createdAt:
              row.created_at,

            updatedAt:
              row.updated_at,

            events:
              reviewEventsByRequest.get(
                row.id
              ) ?? [],

            messageEvents:
              messageEventsByRequest.get(
                row.id
              ) ?? [],
          })
        ),

      authorityEvidence:
        (
          authorityRows ??
          []
        ).map(
          (row) => ({
            completionEventId:
              row.completion_event_id,

            channel:
              row.channel,

            assertedState:
              row.asserted_state,

            assertionKind:
              row.assertion_kind,

            permissionSource:
              row.permission_source,

            completionSource:
              row.completion_source,

            sourceEventId:
              row.source_event_id,

            country:
              row.country,

            assertedAt:
              row.asserted_at,

            observedAt:
              row.observed_at,

            basisType:
              row.basis_type,

            captureMethod:
              row.capture_method,

            evidenceReference:
              row.evidence_reference,

            policyVersion:
              row.policy_version,

            actorType:
              row.actor_type,

            createdAt:
              row.created_at,
          })
        ),

      suppressions:
        suppressionRows.map(
          (row) => ({
            channel:
              row.channel,

            reason:
              row.reason,

            createdAt:
              row.created_at,
          })
        ),
    }

    /*
     * Mandatory, minimized audit.
     * No customer contact PII,
     * bearer tokens or payloads.
     */
    const {
      error: auditError,
    } = await admin
      .from('audit_events')
      .insert({
        organization_id:
          organizationId,

        actor_type: 'user',

        actor_id: user.id,

        event_type:
          'privacy.customer_export',

        entity_type:
          'customer',

        entity_id:
          customerId,

        metadata: {
          schema_version:
            CUSTOMER_PRIVACY_EXPORT_SCHEMA_VERSION,

          completion_count:
            privacyExport
              .completionEvents
              .length,

          review_request_count:
            privacyExport
              .reviewRequests
              .length,

          authority_evidence_count:
            privacyExport
              .authorityEvidence
              .length,

          suppression_count:
            privacyExport
              .suppressions
              .length,
        },
      })

    if (auditError) {
      return {
        status: 'UNAVAILABLE',
      }
    }

    return {
      status: 'AVAILABLE',
      export:
        privacyExport,
    }
  } catch {
    return {
      status: 'UNAVAILABLE',
    }
  }
}
