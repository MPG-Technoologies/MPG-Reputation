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

// Exact set of private tables added by the 17 new MR-5 migrations.
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
] as const

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

  it('all nine new private tables exist and are selectable by isolated service role', async () => {
    for (const table of PRIVATE_BILLING_TABLES) {
      const { error } = await privileged.from(table).select('id').limit(1)
      expect(error, table).toBeNull()
    }
  })

  it('all nine new private tables reject direct anonymous SELECT', async () => {
    for (const table of PRIVATE_BILLING_TABLES) {
      const { error } = await anonymous.from(table).select('id').limit(1)
      expect(error?.code, table).toBe('42501')
    }
  })

  it('all nine new private tables reject direct authenticated SELECT', async () => {
    for (const table of PRIVATE_BILLING_TABLES) {
      const { error } = await member.from(table).select('id').limit(1)
      expect(error?.code, table).toBe('42501')
    }
  })

  it('ordinary users cannot insert a synthetic quote or paid-entitlement proposal', async () => {
    for (const table of [
      'billing_paid_entitlement_proposals',
      'billing_synthetic_invoice_evidence_drafts',
      'billing_synthetic_checkout_quote_snapshots',
    ] as const) {
      // An empty object should fail on GRANT before reaching any data checks.
      const { error } = await member.from(table).insert({})
      expect(error?.code, table).toBe('42501')
    }
  })
})
