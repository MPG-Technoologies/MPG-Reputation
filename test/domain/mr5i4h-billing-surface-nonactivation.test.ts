import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * MR-5I4H: synthetic billing UI / operator-surface integration tripwires.
 *
 * Checks that the reviewed pre-provider routes still exist and visibly keep
 * their critical nonactivation boundaries. Textual source checks are a narrow
 * regression signal, not a substitute for browser tests, SQL/RLS enforcement,
 * provider proof, or owner acceptance. Actual provider integration must later
 * replace this audit with permissioned end-to-end acceptance evidence.
 */
const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const billing = source('src/app/app/settings/billing/page.tsx')
const preview = source('src/app/app/settings/billing/plan-preview.tsx')
const clientActions = source('src/app/app/settings/billing/local-synthetic-actions.tsx')
const clientNav = source('src/app/app/nav.tsx')
const actionGate = source('src/lib/billing/stripe-test-action-request.ts')
const actionRoute = source('src/app/api/internal/billing/test/action/route.ts')
const successScreen = source('src/app/billing/checkout/return-screen.tsx')
const webhook = source('src/app/api/webhooks/stripe/route.ts')
const adminNav = source('src/components/admin/admin-ui.tsx')
const recovery = source('src/lib/support/billing-recovery.ts')
const exceptions = source('src/lib/support/subscription-exceptions.ts')
const recoveryPage = source('src/app/admin/organizations/[organizationId]/billing-recovery/page.tsx')
const exceptionPage = source('src/app/admin/organizations/[organizationId]/subscription-exceptions/page.tsx')
const invoiceClaim = source('supabase/migrations/20261019131000_mr5e2d2_fenced_invoice_processing.sql')
const syntheticInvoice = source('supabase/migrations/20261019170000_mr5i4f_synthetic_invoice_evidence_drafts.sql')
const syntheticQuote = source('supabase/migrations/20261019180000_mr5i4g_synthetic_checkout_quote_snapshots.sql')

describe('MR-5I4H client and operator billing surface nonactivation', () => {
  it('keeps Billing navigation, authenticated owner/admin scoping and Usage & Trial route', () => {
    expect(clientNav).toContain("href: '/app/settings/billing'")
    expect(billing).toContain('supabase.auth.getUser()')
    expect(billing).toContain(".from('organization_users')")
    expect(billing).toContain("membership.role !== 'OWNER' && membership.role !== 'ADMIN'")
    expect(billing).toContain(".from('organization_billing_accounts')")
    expect(billing).toContain(".from('organization_subscriptions')")
    expect(billing).toContain(".eq('organization_id', orgId)")
    expect(billing).toContain(".eq('environment', 'TEST')")
    expect(billing).toContain('href="/app/settings/usage"')
    expect(billing).toContain('30 Free Review Requests')
  })

  it('does not publish draft pricing or enable customer payments in production', () => {
    expect(billing).toContain("process.env.NODE_ENV !== 'production'")
    expect(billing).toContain("process.env.ENABLE_MR5D_BILLING_UI_PREVIEW === 'true'")
    expect(billing).toContain('isLocalTestBillingActionEndpointEnabled()')
    expect(billing).toContain('Preview only')
    expect(preview).toContain('not an available offer')
    expect(billing).toContain('Payments, checkout, and subscription changes are not enabled')
  })

  it('retains early production/hosted/LIVE disable before constructing privileged clients', () => {
    const admission = actionRoute.indexOf('if (!isLocalTestBillingActionEndpointEnabled())')
    const privileged = actionRoute.indexOf('createSupabaseClient<Database>(url, key')
    expect(admission).toBeGreaterThan(-1)
    expect(privileged).toBeGreaterThan(admission)
    for (const guard of [
      "process.env.NODE_ENV !== 'production'",
      'process.env.VERCEL_ENV === undefined',
      "process.env.ENABLE_LIVE_BILLING !== 'true'",
      "process.env.ENABLE_STRIPE_TEST_BILLING_ACTIONS === 'true'",
      'LOCAL_SYNTHETIC',
      'http://127.0.0.1:54331',
    ]) expect(actionGate).toContain(guard)
    expect(actionRoute).toContain('admitStripeTestBillingAction(')
    expect(actionRoute).toContain("return reply({ outcome: 'DISABLED' }, 404)")
  })

  it('allows only plan/org/action client intent, no price, customer, credentials or redirect', () => {
    expect(actionGate).toContain("['action','organizationId','planId']")
    expect(actionGate).toContain("['action','organizationId']")
    expect(actionGate).toContain('Object.keys(body).every(key => allowedKeys.includes(key))')
    expect(clientActions).toContain("fetch('/api/internal/billing/test/action'")
    expect(clientActions).toContain("url.hostname === 'checkout.stripe.com'")
    expect(clientActions).toContain("url.hostname === 'billing.stripe.com'")
    expect(clientActions).not.toContain('ENABLE_LIVE_BILLING=true')
  })

  it('keeps checkout returns and webhook ingestion distinct from payment proof', () => {
    expect(successScreen).toContain('getCheckoutReturnMessage(kind)')
    expect(successScreen).toContain('Never trust or display the query string session_id as payment evidence')
    expect(webhook).toContain('verifyStripeWebhookEvent(rawBody, signature)')
    expect(webhook).toContain('claimVerifiedStripeWebhookEvent(')
    expect(webhook).toContain('Downstream processing and')
    expect(webhook).not.toMatch(/(grantPaidEntitlement|settleInvoice|activatePaidSubscription)\s*\(/)
  })

  it('keeps MPG support billing views local-only, tenant-audited and read-only', () => {
    expect(adminNav).toContain("label: 'Billing recovery'")
    expect(adminNav).toContain("label: 'Subscription reviews'")
    for (const text of [recovery, exceptions]) {
      expect(text).toContain("process.env.NODE_ENV !== 'production'")
      expect(text).toContain('LOCAL_SYNTHETIC')
      expect(text).toContain('authorizeSupportAccess(')
      expect(text).toMatch(/recordSupport(BillingRecovery|SubscriptionException)Inspection\(/)
    }
    expect(recoveryPage).toContain('Investigation only')
    expect(exceptionPage).toContain('not payment evidence')
    for (const text of [recoveryPage, exceptionPage]) {
      expect(text).not.toMatch(/(approvePayment|grantPaidEntitlement|settleInvoice)\s*\(/)
    }
  })

  it('preserves no successful invoice finalizer and hard-false evidence stages', () => {
    expect(invoiceClaim).toContain('claim_stripe_test_invoice_processing')
    expect(invoiceClaim).toContain('fail_stripe_test_invoice_processing')
    expect(invoiceClaim).not.toMatch(/CREATE FUNCTION public\.(?:finalize|settle|complete)_stripe_test_invoice/i)
    for (const sql of [syntheticInvoice, syntheticQuote]) {
      expect(sql).toContain('CHECK (environment = \'TEST\')')
      expect(sql).toContain("CHECK (access_authorized = false)")
      expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
      expect(sql).toContain('TO service_role')
    }
    expect(syntheticInvoice).toContain('CHECK (financial_finality = false)')
    expect(syntheticQuote).toContain('CHECK (payment_authorized = false)')
  })
})
