import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * MR-5I4E: narrow repository safety tripwires for the *current* invoice
 * implementation. These textual checks are defense-in-depth, NOT an SQL
 * security proof, financial attestation, or substitute for database tests.
 *
 * Future authorized finality implementation must deliberately revise this
 * suite together with its reviewed SQL, grants, integration tests and gates.
 */
const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

const migration = source(
  'supabase/migrations/20261019131000_mr5e2d2_fenced_invoice_processing.sql'
)
const processing = source('src/lib/billing/stripe-test-invoice-processing.ts')
const invoiceFinalityPolicy = source('src/domain/billing/synthetic-invoice-finality-plan.ts')
const proposals = source(
  'supabase/migrations/20261019140000_mr5e3b_paid_entitlement_proposals.sql'
)
const schema = source('supabase/migrations/20260921212000_mr5c_billing_environment_isolation.sql')

describe('MR-5I4E existing invoice financial nonactivation safety contract', () => {
  it('keeps the invoice SQL surface to fenced claim and manual failure only', () => {
    expect(migration).toMatch(/CREATE FUNCTION public\.claim_stripe_test_invoice_processing\(/)
    expect(migration).toMatch(/CREATE FUNCTION public\.fail_stripe_test_invoice_processing\(/)
    const declared = [...migration.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z_]+)\s*\(/gi)]
      .map(match => match[1]).sort()
    expect(declared).toEqual([
      'claim_stripe_test_invoice_processing',
      'fail_stripe_test_invoice_processing',
    ])
    expect(migration).not.toMatch(/SET\s+processing_status\s*=\s*'PROCESSED'/i)
    expect(migration).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(?:settle|complete|finalize).*invoice/i)
  })

  it('retains restricted service-only grants for current invoice claim/failure', () => {
    for (const entry of [
      { name: 'claim_stripe_test_invoice_processing', signature: 'TEXT' },
      { name: 'fail_stripe_test_invoice_processing', signature: 'TEXT,UUID,TEXT' },
    ]) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${entry.name}(${entry.signature})`
      )
      const section = migration.split(`REVOKE ALL ON FUNCTION public.${entry.name}(${entry.signature})`)[1]
      expect(section).toBeDefined()
      expect(section).toMatch(/FROM PUBLIC, anon, authenticated;/)
      expect(section).toContain(
        `GRANT EXECUTE ON FUNCTION public.${entry.name}(${entry.signature})`
      )
      expect(section).toMatch(/TO service_role;/)
    }
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.[^;]+\bTO\s+(?:anon|authenticated|PUBLIC)\s*;/i)
  })

  it('preserves disabled hosted/LIVE guards in the manually invoked facade', () => {
    for (const guard of [
      'ENABLE_STRIPE_TEST_INVOICE_PROCESSING',
      'MPG_STRIPE_TEST_INVOICE_PROCESSING_TARGET',
      'LOCAL_SYNTHETIC',
      "ENABLE_LIVE_BILLING !== 'true'",
      "NODE_ENV !== 'production'",
      'VERCEL_ENV === undefined',
      'http://127.0.0.1:54331',
    ]) expect(processing).toContain(guard)
    expect(processing).toContain("'FAILED_REQUIRES_REVIEW'")
    expect(processing).not.toMatch(/\.rpc\(\s*['"](?:complete|finalize|settle)_stripe_test_invoice/i)
  })

  it('keeps review-only policy separate from payment writes', () => {
    expect(invoiceFinalityPolicy).toContain("outcome: 'PROPOSAL_ONLY'")
    expect(invoiceFinalityPolicy).toContain('AUTHENTICATED_PROVIDER_AND_ATOMIC_FINALITY_REQUIRED')
    expect(invoiceFinalityPolicy).not.toMatch(/from\s+['"]@\/lib\/supabase/)
    expect(invoiceFinalityPolicy).not.toMatch(/\.rpc\s*\(/)
    expect(invoiceFinalityPolicy).not.toMatch(/\.from\s*\(/)
  })

  it('keeps the proposed paid entitlement ledger unverified and access-false', () => {
    expect(proposals).toContain("CHECK (verification_status = 'UNVERIFIED')")
    expect(proposals).toContain('CHECK (access_authorized = false)')
    expect(proposals).toContain('ENABLE ROW LEVEL SECURITY')
    expect(proposals).toContain('FROM PUBLIC, anon, authenticated, service_role')
    expect(proposals).toContain('GRANT SELECT, INSERT ON TABLE public.billing_paid_entitlement_proposals TO service_role')
  })

  it('keeps event and subscription IDs unique per provider environment', () => {
    expect(schema).toContain('billing_webhook_events_provider_env_event_key')
    expect(schema).toContain('UNIQUE (provider, environment, provider_event_id)')
    expect(schema).toContain('organization_subscriptions_provider_env_subscription_key')
    expect(schema).toContain('UNIQUE (provider, environment, provider_subscription_id)')
  })
})
