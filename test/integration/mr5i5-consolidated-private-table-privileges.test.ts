import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

/**
 * MR-5I5 — independent INTEGRATED private-table privilege matrix.
 *
 * Runs ONLY in disposable Supabase CI. This audits actual migrated database
 * privileges, not textual SQL patterns, and does not modify customer data,
 * billing ledgers or paid entitlements. It supplements (does not replace)
 * each table's tenant/FK/immutability tests.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const enabled = Boolean(serviceKey && anonKey && serviceKey !== 'dummy_service_role_key')
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

// Cumulative private MR-5 tables, including read-only review evidence.
// These are internal staging/lease/exception structures, NOT client invoices.
const PRIVATE_BILLING_TABLES = [
  'stripe_subscription_reconciliation_leases',
  'stripe_test_checkout_reservations',
  'stripe_test_customer_provisioning',
  'stripe_test_billing_action_limits',
  'stripe_test_billing_recovery_reviews',
  'billing_paid_entitlement_proposals',
  'billing_synthetic_subscription_exception_reviews',
  'billing_synthetic_invoice_evidence_drafts',
  'billing_synthetic_checkout_quote_snapshots',
  'billing_synthetic_invoice_reconciliation_reviews',
] as const


// Only these internal evidence/review tables are intentionally append-only
// for service_role. Lease, reservation and rate-limit tables require bounded
// state transitions and must NOT be included in this immutability matrix.
const APPEND_ONLY_BILLING_TABLES = [
  'stripe_test_billing_recovery_reviews',
  'billing_paid_entitlement_proposals',
  'billing_synthetic_subscription_exception_reviews',
  'billing_synthetic_invoice_evidence_drafts',
  'billing_synthetic_checkout_quote_snapshots',
  'billing_synthetic_invoice_reconciliation_reviews',
] as const

// Explicit named argument sets match the protected SQL function signatures
// from the candidate's 17 migrations. Keep this manifest in sync when adding
// a new private billing RPC. Trigger-only functions are included to detect
// mistakenly public EXECUTE privileges on SECURITY DEFINER code.
const PRIVATE_BILLING_RPC_ARGS = {
  reconcile_stripe_subscription_projection: [
    'p_org_id', 'p_billing_account_id', 'p_provider_customer_id',
    'p_environment', 'p_provider_subscription_id', 'p_provider_price_id',
    'p_provider_status', 'p_normalized_status', 'p_current_period_start',
    'p_current_period_end', 'p_cancel_at_period_end', 'p_canceled_at',
  ],
  lease_stripe_webhook_processing: ['p_event_id'],
  complete_stripe_webhook_processing: [
    'p_event_id', 'p_lease_token', 'p_status',
    'p_organization_id', 'p_error_code',
  ],
  lease_stripe_subscription_reconciliation: [
    'p_event_id', 'p_event_lease_token', 'p_subscription_id',
  ],
  release_stripe_subscription_reconciliation: [
    'p_subscription_id', 'p_lease_token',
  ],
  commit_stripe_subscription_reconciliation: [
    'p_event_id', 'p_event_lease_token', 'p_subscription_lease_token',
    'p_org_id', 'p_billing_account_id', 'p_provider_customer_id',
    'p_environment', 'p_provider_subscription_id', 'p_provider_price_id',
    'p_provider_status', 'p_normalized_status', 'p_current_period_start',
    'p_current_period_end', 'p_cancel_at_period_end', 'p_canceled_at',
  ],
  inspect_stripe_test_webhook_recovery: ['p_limit'],
  reserve_stripe_test_checkout: [
    'p_user_id', 'p_organization_id', 'p_billing_account_id',
    'p_provider_customer_id', 'p_provider_price_id', 'p_plan_id',
    'p_return_origin',
  ],
  finalize_stripe_test_checkout: [
    'p_user_id', 'p_reservation_id', 'p_lease_token', 'p_session_id',
    'p_session_url', 'p_session_expires_at',
  ],
  reserve_stripe_test_customer: ['p_user_id', 'p_organization_id'],
  finalize_stripe_test_customer: [
    'p_user_id', 'p_organization_id', 'p_reservation_id', 'p_lease_token',
    'p_provider_customer_id',
  ],
  claim_stripe_test_billing_action: [
    'p_user_id', 'p_organization_id', 'p_action',
  ],
  inspect_stripe_test_billing_recovery: [
    'p_user_id', 'p_organization_id',
  ],
  read_stripe_test_provider_recovery_context: [
    'p_user_id', 'p_organization_id',
  ],
  request_stripe_test_billing_recovery_review: [
    'p_user_id', 'p_organization_id', 'p_kind',
  ],
  claim_stripe_test_invoice_processing: ['p_provider_event_id'],
  fail_stripe_test_invoice_processing: [
    'p_provider_event_id', 'p_lease_token', 'p_error_code',
  ],
  validate_billing_paid_entitlement_proposal_source: [],
  enforce_synthetic_paid_proposal_event_order: [],
  validate_billing_synthetic_exception_review_source: [],
  validate_mr5i4f_invoice_evidence_draft: [],
  validate_mr5i4g_checkout_quote_snapshot: [],
  validate_mr5_synthetic_invoice_review: [],
  record_mr5_synthetic_invoice_review: ['p_quote_id','p_draft_id'],
} as const

describe.skipIf(!enabled)('MR-5I5 migrated billing private-table role matrix', () => {
  const privileged = createClient(url, serviceKey, opts)
  const anonymous = createClient(url, anonKey, opts)
  const member = createClient(url, anonKey, opts)
  const email = 'mr5i5-access-' + randomUUID().replaceAll('-', '') + '@example.test'
  const password = 'SyntheticTest-' + randomUUID()
  let createdUserId = ''

  beforeAll(async () => {
    // An accidental hosted target must fail the entire matrix, not skip it.
    if (!['http://localhost:54331', 'http://127.0.0.1:54331'].includes(url) ||
        process.env.ENABLE_LIVE_BILLING === 'true') {
      throw new Error('MR5I5_DISPOSABLE_POSTGRES_ONLY')
    }
    const { data, error } = await privileged.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (error || !data.user) throw new Error('MR5I5_SYNTHETIC_USER_CREATE_FAILED')
    createdUserId = data.user.id
    const login = await member.auth.signInWithPassword({ email, password })
    if (login.error || !login.data.session) throw new Error('MR5I5_SYNTHETIC_LOGIN_FAILED')
  }, 30000)

  afterAll(async () => {
    if (createdUserId) {
      const { error } = await privileged.auth.admin.deleteUser(createdUserId)
      if (error) throw new Error('MR5I5_SYNTHETIC_USER_TEARDOWN_FAILED')
    }
  })

  it('all ten private billing tables exist and are selectable by isolated service role', async () => {
    for (const table of PRIVATE_BILLING_TABLES) {
      const { error } = await privileged.from(table).select('*').limit(1)
      expect(error, table).toBeNull()
    }
  })

  it('all ten private billing tables reject direct anonymous SELECT', async () => {
    for (const table of PRIVATE_BILLING_TABLES) {
      const { error } = await anonymous.from(table).select('*').limit(1)
      expect(error?.code, table).toBe('42501')
    }
  })

  it('all ten private billing tables reject direct authenticated SELECT', async () => {
    for (const table of PRIVATE_BILLING_TABLES) {
      const { error } = await member.from(table).select('*').limit(1)
      expect(error?.code, table).toBe('42501')
    }
  })

  it('six private billing evidence and review tables reject service-role UPDATE/DELETE', async () => {
    // Always target a new nonexistent UUID, so even a regression in GRANTs
    // cannot mutate legitimate synthetic rows while this assertion runs.
    // SELECT/INSERT is intentionally allowed for the internal service worker;
    // mutation of historical review/evidence is not.
    for (const table of APPEND_ONLY_BILLING_TABLES) {
      const missingId = randomUUID()
      const replacementId = randomUUID()
      const { error: updateError } = await privileged.from(table)
        .update({ id: replacementId }).eq('id', missingId)
      expect(updateError?.code, table + ' UPDATE').toBe('42501')
      const { error: deleteError } = await privileged.from(table)
        .delete().eq('id', missingId)
      expect(deleteError?.code, table + ' DELETE').toBe('42501')
    }
  })

  it('all 24 private billing RPCs reject direct anonymous execution', async () => {
    for (const [rpc, argNames] of Object.entries(PRIVATE_BILLING_RPC_ARGS)) {
      const args = Object.fromEntries(argNames.map(name => [name, null]))
      const { error } = await anonymous.rpc(rpc, args)
      // PostgREST either denies an exposed RPC (42501) or hides the function
      // from its schema cache (PGRST202). Any successful invocation or
      // different database error indicates the boundary may be bypassed.
      expect(['42501', 'PGRST202'], rpc).toContain(error?.code)
    }
  })

  it('all 24 private billing RPCs reject direct signed-in execution', async () => {
    for (const [rpc, argNames] of Object.entries(PRIVATE_BILLING_RPC_ARGS)) {
      const args = Object.fromEntries(argNames.map(name => [name, null]))
      const { error } = await member.rpc(rpc, args)
      expect(['42501', 'PGRST202'], rpc).toContain(error?.code)
    }
  })

  it('ordinary users cannot insert a synthetic quote or paid-entitlement proposal', async () => {
    for (const table of [
      'billing_paid_entitlement_proposals',
      'billing_synthetic_invoice_evidence_drafts',
      'billing_synthetic_checkout_quote_snapshots',
      'billing_synthetic_invoice_reconciliation_reviews',
    ] as const) {
      // An empty object should fail on GRANT before reaching any data checks.
      const { error } = await member.from(table).insert({})
      expect(error?.code, table).toBe('42501')
    }
  })
})
