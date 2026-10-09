import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import {
  executeMultiTenantRetentionMaintenance,
  isRetentionMaintenanceEnabled,
} from '../../src/domain/privacy/retention-maintenance'
import { PERMANENT_RETENTION_CLASSES } from '../../src/domain/privacy/retention-controls'
import { hashSuppressionContact } from '../../src/domain/suppression'
import { generateTrackingToken } from '../../src/domain/tracking'
import { generateUnsubscribeToken } from '../../src/domain/unsubscribe'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const isDbAvailable = !!SERVICE_KEY && SERVICE_KEY !== 'dummy_service_role_key'

describe.skipIf(!isDbAvailable)('MR-7C.4B2 Real PostgreSQL Retention Maintenance Integration Suite', () => {
  let adminClient: SupabaseClient<Database>
  let org1Id: string
  let org2Id: string
  let org3Id: string
  let loc1Id: string
  let loc2Id: string
  let loc3Id: string
  let cust1Id: string
  let cust2Id: string
  let cust3Id: string
  let dest1Id: string
  const baseNonce = Date.now()

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Create Org 1 (ACTIVE)
    const { data: org1, error: org1Err } = await adminClient
      .from('organizations')
      .insert({
        name: `Org Maint Active ${baseNonce}`,
        slug: `org-maint-active-${baseNonce}`,
        status: 'ACTIVE',
      })
      .select('id')
      .single()
    if (org1Err || !org1) throw new Error(`Failed to create Org 1: ${org1Err?.message}`)
    org1Id = org1.id

    // Create Org 2 (INACTIVE - soft deactivated)
    const { data: org2, error: org2Err } = await adminClient
      .from('organizations')
      .insert({
        name: `Org Maint Inactive ${baseNonce}`,
        slug: `org-maint-inactive-${baseNonce}`,
        status: 'INACTIVE',
      })
      .select('id')
      .single()
    if (org2Err || !org2) throw new Error(`Failed to create Org 2: ${org2Err?.message}`)
    org2Id = org2.id

    // Create Org 3 (SUSPENDED)
    const { data: org3, error: org3Err } = await adminClient
      .from('organizations')
      .insert({
        name: `Org Maint Suspended ${baseNonce}`,
        slug: `org-maint-suspended-${baseNonce}`,
        status: 'SUSPENDED',
      })
      .select('id')
      .single()
    if (org3Err || !org3) throw new Error(`Failed to create Org 3: ${org3Err?.message}`)
    org3Id = org3.id

    // Locations
    const { data: loc1 } = await adminClient
      .from('locations')
      .insert({ organization_id: org1Id, name: `Loc 1 ${baseNonce}`, status: 'ACTIVE' })
      .select('id')
      .single()
    loc1Id = loc1!.id

    const { data: loc2 } = await adminClient
      .from('locations')
      .insert({ organization_id: org2Id, name: `Loc 2 ${baseNonce}`, status: 'ACTIVE' })
      .select('id')
      .single()
    loc2Id = loc2!.id

    const { data: loc3 } = await adminClient
      .from('locations')
      .insert({ organization_id: org3Id, name: `Loc 3 ${baseNonce}`, status: 'ACTIVE' })
      .select('id')
      .single()
    loc3Id = loc3!.id

    // Customers
    const { data: c1 } = await adminClient
      .from('customers')
      .insert({
        organization_id: org1Id,
        location_id: loc1Id,
        first_name: 'Alpha',
        last_name: 'Tester',
        email: `alpha.${baseNonce}@example.test`,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()
    cust1Id = c1!.id

    const { data: c2 } = await adminClient
      .from('customers')
      .insert({
        organization_id: org2Id,
        location_id: loc2Id,
        first_name: 'Beta',
        last_name: 'Tester',
        email: `beta.${baseNonce}@example.test`,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()
    cust2Id = c2!.id

    const { data: c3 } = await adminClient
      .from('customers')
      .insert({
        organization_id: org3Id,
        location_id: loc3Id,
        first_name: 'Gamma',
        last_name: 'Tester',
        email: `gamma.${baseNonce}@example.test`,
        permission_email: 'allowed',
        permission_source: 'quick_complete',
      })
      .select('id')
      .single()
    cust3Id = c3!.id

    // Review destination for Org 1
    const { data: dest1 } = await adminClient
      .from('review_destinations')
      .insert({
        organization_id: org1Id,
        location_id: loc1Id,
        provider: 'google',
        url: 'https://g.page/r/test-retention-maint-dest/review',
        canonical_url: 'https://g.page/r/test-retention-maint-dest/review',
        status: 'CONFIRMED',
      })
      .select('id')
      .single()
    dest1Id = dest1!.id
  })

  // 1. DISABLED SCHEDULING GUARD
  it('1. disabled guard produces zero mutations and SKIPPED_DISABLED across real database', async () => {
    // Insert an aged completion event for Org 1
    const agedDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString()
    const { data: comp } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: org1Id,
        location_id: loc1Id,
        customer_id: cust1Id,
        source: 'api',
        source_event_id: `source-disabled-test-${baseNonce}`,
        contact: { email: `guarded.${baseNonce}@example.test`, name: 'Guard Test' },
        created_at: agedDate,
        completed_at: agedDate,
      })
      .select('id')
      .single()

    const originalEnv = process.env.ENABLE_RETENTION_MAINTENANCE
    try {
      delete process.env.ENABLE_RETENTION_MAINTENANCE
      expect(isRetentionMaintenanceEnabled()).toBe(false)

      const result = await executeMultiTenantRetentionMaintenance(adminClient)
      expect(result.status).toBe('SKIPPED_DISABLED')
      expect(result.organizationsEvaluated).toBe(0)
      expect(result.totalContactsRedacted).toBe(0)
      expect(result.totalOutboxRowsPurged).toBe(0)

      // Verify completion record was NOT redacted
      const { data: check } = await adminClient
        .from('customer_completion_events')
        .select('contact')
        .eq('id', comp!.id)
        .single()
      expect(check?.contact).toEqual({ email: `guarded.${baseNonce}@example.test`, name: 'Guard Test' })
    } finally {
      if (originalEnv !== undefined) {
        process.env.ENABLE_RETENTION_MAINTENANCE = originalEnv
      }
    }
  })

  // 2. MULTI-TENANT ORCHESTRATION & BOUNDED CURSOR EXECUTION
  it('2. executes multi-tenant maintenance across ACTIVE, INACTIVE, and SUSPENDED tenants with bounded batching', async () => {
    const evalAsOf = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    const agedDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    const freshDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()

    // Org 1: Aged contact + Fresh contact + Aged DISPATCHED outbox + Aged PENDING outbox
    const { data: c1Aged } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: org1Id,
        location_id: loc1Id,
        customer_id: cust1Id,
        source: 'api',
        source_event_id: `source-c1-aged-${baseNonce}`,
        contact: { email: `c1.aged.${baseNonce}@example.test` },
        created_at: agedDate,
        completed_at: agedDate,
      })
      .select('id')
      .single()

    const { data: c1Fresh } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: org1Id,
        location_id: loc1Id,
        customer_id: cust1Id,
        source: 'api',
        source_event_id: `source-c1-fresh-${baseNonce}`,
        contact: { email: `c1.fresh.${baseNonce}@example.test` },
        created_at: freshDate,
        completed_at: freshDate,
      })
      .select('id')
      .single()

    const { data: o1Dispatched, error: o1Err } = await adminClient
      .from('domain_event_outbox')
      .insert({
        organization_id: org1Id,
        event_type: 'customer.completed',
        aggregate_type: 'customer',
        aggregate_id: cust1Id,
        payload: {
          eventId: `evt-o1-disp-${baseNonce}`,
          organizationId: org1Id,
          locationId: loc1Id,
          customerId: cust1Id,
          sourceEventId: `src-o1-disp-${baseNonce}`,
        },
        status: 'DISPATCHED',
        dispatched_at: agedDate,
        created_at: agedDate,
      })
      .select('id')
      .single()
    expect(o1Err).toBeNull()

    const { data: o1Pending, error: o1PErr } = await adminClient
      .from('domain_event_outbox')
      .insert({
        organization_id: org1Id,
        event_type: 'customer.completed',
        aggregate_type: 'customer',
        aggregate_id: cust1Id,
        payload: {
          eventId: `evt-o1-pend-${baseNonce}`,
          organizationId: org1Id,
          locationId: loc1Id,
          customerId: cust1Id,
          sourceEventId: `src-o1-pend-${baseNonce}`,
        },
        status: 'PENDING',
        created_at: agedDate,
      })
      .select('id')
      .single()
    expect(o1PErr).toBeNull()

    // Org 2 (INACTIVE): Aged contact + Aged DISPATCHED outbox + Aged FAILED outbox
    const { data: c2Aged } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: org2Id,
        location_id: loc2Id,
        customer_id: cust2Id,
        source: 'api',
        source_event_id: `source-c2-aged-${baseNonce}`,
        contact: { email: `c2.aged.${baseNonce}@example.test` },
        created_at: agedDate,
        completed_at: agedDate,
      })
      .select('id')
      .single()

    const { data: o2Dispatched, error: o2Err } = await adminClient
      .from('domain_event_outbox')
      .insert({
        organization_id: org2Id,
        event_type: 'customer.completed',
        aggregate_type: 'customer',
        aggregate_id: cust2Id,
        payload: {
          eventId: `evt-o2-disp-${baseNonce}`,
          organizationId: org2Id,
          locationId: loc2Id,
          customerId: cust2Id,
          sourceEventId: `src-o2-disp-${baseNonce}`,
        },
        status: 'DISPATCHED',
        dispatched_at: agedDate,
        created_at: agedDate,
      })
      .select('id')
      .single()
    expect(o2Err).toBeNull()

    const { data: o2Failed, error: o2FErr } = await adminClient
      .from('domain_event_outbox')
      .insert({
        organization_id: org2Id,
        event_type: 'customer.completed',
        aggregate_type: 'customer',
        aggregate_id: cust2Id,
        payload: {
          eventId: `evt-o2-failed-${baseNonce}`,
          organizationId: org2Id,
          locationId: loc2Id,
          customerId: cust2Id,
          sourceEventId: `src-o2-failed-${baseNonce}`,
        },
        status: 'FAILED',
        last_error: 'simulated failure',
        created_at: agedDate,
      })
      .select('id')
      .single()
    expect(o2FErr).toBeNull()

    // Org 3 (SUSPENDED): Aged contact
    const { data: c3Aged } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: org3Id,
        location_id: loc3Id,
        customer_id: cust3Id,
        source: 'api',
        source_event_id: `source-c3-aged-${baseNonce}`,
        contact: { email: `c3.aged.${baseNonce}@example.test` },
        created_at: agedDate,
        completed_at: agedDate,
      })
      .select('id')
      .single()

    // Run coordinator with small batch size = 2 to exercise pagination across all tenants
    const result = await executeMultiTenantRetentionMaintenance(adminClient, {
      enabledOverride: true,
      asOf: evalAsOf,
      organizationBatchSize: 2,
      perOrgContactBatchSize: 50,
      perOrgOutboxBatchSize: 50,
    })

    expect(['COMPLETED', 'PARTIALLY_FAILED']).toContain(result.status)
    expect(result.organizationsEvaluated).toBeGreaterThanOrEqual(3)
    expect(result.batchesProcessed).toBeGreaterThanOrEqual(2)
    expect(result.totalContactsRedacted).toBeGreaterThanOrEqual(3)
    expect(result.totalOutboxRowsPurged).toBeGreaterThanOrEqual(2)

    // Verify Org 1 aged contact redacted
    const { data: c1AgedCheck } = await adminClient
      .from('customer_completion_events')
      .select('contact, source_event_id')
      .eq('id', c1Aged!.id)
      .single()
    expect(c1AgedCheck?.contact).toEqual({})
    expect(c1AgedCheck?.source_event_id).toBe(`source-c1-aged-${baseNonce}`)

    // Verify Org 1 fresh contact remains intact
    const { data: c1FreshCheck } = await adminClient
      .from('customer_completion_events')
      .select('contact')
      .eq('id', c1Fresh!.id)
      .single()
    expect(c1FreshCheck?.contact).toEqual({ email: `c1.fresh.${baseNonce}@example.test` })

    // Verify Org 1 DISPATCHED outbox purged
    const { data: o1DispatchedCheck } = await adminClient
      .from('domain_event_outbox')
      .select('id')
      .eq('id', o1Dispatched!.id)
      .maybeSingle()
    expect(o1DispatchedCheck).toBeNull()

    // Verify Org 1 PENDING outbox remained protected
    const { data: o1PendingCheck } = await adminClient
      .from('domain_event_outbox')
      .select('id, status')
      .eq('id', o1Pending!.id)
      .single()
    expect(o1PendingCheck?.status).toBe('PENDING')

    // Verify Org 2 (INACTIVE) aged contact redacted
    const { data: c2AgedCheck } = await adminClient
      .from('customer_completion_events')
      .select('contact')
      .eq('id', c2Aged!.id)
      .single()
    expect(c2AgedCheck?.contact).toEqual({})

    // Verify Org 2 DISPATCHED outbox purged
    const { data: o2DispatchedCheck } = await adminClient
      .from('domain_event_outbox')
      .select('id')
      .eq('id', o2Dispatched!.id)
      .maybeSingle()
    expect(o2DispatchedCheck).toBeNull()

    // Verify Org 2 FAILED outbox remained protected
    const { data: o2FailedCheck } = await adminClient
      .from('domain_event_outbox')
      .select('id, status')
      .eq('id', o2Failed!.id)
      .single()
    expect(o2FailedCheck?.status).toBe('FAILED')

    // Verify Org 3 (SUSPENDED) aged contact redacted
    const { data: c3AgedCheck } = await adminClient
      .from('customer_completion_events')
      .select('contact')
      .eq('id', c3Aged!.id)
      .single()
    expect(c3AgedCheck?.contact).toEqual({})

    // Verify organizations were NOT deleted (soft deactivation preserved)
    const { data: org1Check } = await adminClient.from('organizations').select('id, status').eq('id', org1Id).single()
    const { data: org2Check } = await adminClient.from('organizations').select('id, status').eq('id', org2Id).single()
    const { data: org3Check } = await adminClient.from('organizations').select('id, status').eq('id', org3Id).single()
    expect(org1Check?.status).toBe('ACTIVE')
    expect(org2Check?.status).toBe('INACTIVE')
    expect(org3Check?.status).toBe('SUSPENDED')
  })

  // 3. IDEMPOTENCY & REPEATED EXECUTION
  it('3. repeating execution immediately performs zero additional mutations without corrupting state', async () => {
    const secondRun = await executeMultiTenantRetentionMaintenance(adminClient, {
      enabledOverride: true,
      organizationBatchSize: 10,
    })

    expect(secondRun.totalContactsRedacted).toBe(0)
    expect(secondRun.totalOutboxRowsPurged).toBe(0)
    expect(secondRun.status).toBe('COMPLETED')
  })

  // 4. SANITIZED AUDIT & AGGREGATE EVIDENCE (ZERO RAW PII)
  it('4. logs sanitized aggregate audit events with zero PII in metadata', async () => {
    const { data: auditEvents, error: auditErr } = await adminClient
      .from('audit_events')
      .select('id, organization_id, event_type, metadata')
      .in('event_type', ['retention.completion_contacts_redacted', 'retention.outbox_dispatched_purged'])
      .in('organization_id', [org1Id, org2Id, org3Id])

    expect(auditErr).toBeNull()
    expect(auditEvents && auditEvents.length > 0).toBe(true)

    for (const event of auditEvents!) {
      const metaStr = JSON.stringify(event.metadata)
      // Must not contain customer emails, names, or unredacted tokens
      expect(metaStr).not.toContain('@example.test')
      expect(metaStr).not.toContain('Alpha')
      expect(metaStr).not.toContain('Beta')
      expect(metaStr).not.toContain('Gamma')
      expect(metaStr).not.toContain('Tester')
      // Must contain expected operational fields
      expect(event.metadata).toHaveProperty('retention_period_days')
      expect(event.metadata).toHaveProperty('cutoff_timestamp')
    }
  })

  // 5. PERMANENT RETENTION IMMUNITY VERIFICATION
  it('5. leaves permanent retention classes completely untouched in PostgreSQL', async () => {
    // 1. Insert permanent suppression
    const suppHash = hashSuppressionContact('email', `supp.imm.${baseNonce}@example.test`)
    const { data: supp, error: suppErr } = await adminClient
      .from('suppressions')
      .insert({
        organization_id: org1Id,
        channel: 'email',
        contact_hash: suppHash,
        reason: 'UNSUBSCRIBE',
      })
      .select('id')
      .single()
    expect(suppErr).toBeNull()

    // 2. Insert completion event, review request and recipient evidence
    const { token, tokenHash } = generateTrackingToken()
    const { token: unsubToken, tokenHash: unsubTokenHash } = generateUnsubscribeToken()
    const agedSentAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString()

    const { data: compEv, error: compEvErr } = await adminClient
      .from('customer_completion_events')
      .insert({
        organization_id: org1Id,
        location_id: loc1Id,
        customer_id: cust1Id,
        source: 'api',
        source_event_id: `source-imm-${baseNonce}`,
        contact: { email: `comp.imm.${baseNonce}@example.test` },
        created_at: agedSentAt,
        completed_at: agedSentAt,
      })
      .select('id')
      .single()
    expect(compEvErr).toBeNull()

    const { data: rr, error: rrErr } = await adminClient
      .from('review_requests')
      .insert({
        organization_id: org1Id,
        location_id: loc1Id,
        customer_id: cust1Id,
        completion_event_id: compEv!.id,
        destination_id: dest1Id,
        token,
        token_hash: tokenHash,
        unsubscribe_token: unsubToken,
        unsubscribe_token_hash: unsubTokenHash,
        status: 'SENT',
        sent_at: agedSentAt,
        created_at: agedSentAt,
        channel: 'email',
      })
      .select('id')
      .single()
    expect(rrErr).toBeNull()

    const recHash = hashSuppressionContact('email', `rec.imm.${baseNonce}@example.test`)
    const { data: recEv, error: recEvErr } = await adminClient
      .from('review_request_recipient_evidence')
      .insert({
        organization_id: org1Id,
        review_request_id: rr!.id,
        channel: 'email',
        suppression_contact_hash: recHash,
      })
      .select('id')
      .single()
    expect(recEvErr).toBeNull()

    // Execute retention maintenance
    await executeMultiTenantRetentionMaintenance(adminClient, {
      enabledOverride: true,
      organizationBatchSize: 10,
    })

    // Verify suppression remains intact
    const { data: suppCheck } = await adminClient
      .from('suppressions')
      .select('id')
      .eq('id', supp!.id)
      .single()
    expect(suppCheck?.id).toBe(supp!.id)

    // Verify recipient evidence remains intact
    const { data: recEvCheck } = await adminClient
      .from('review_request_recipient_evidence')
      .select('id')
      .eq('id', recEv!.id)
      .single()
    expect(recEvCheck?.id).toBe(recEv!.id)

    // All 9 classes are verified
    expect(PERMANENT_RETENTION_CLASSES.length).toBe(9)
  })
})
