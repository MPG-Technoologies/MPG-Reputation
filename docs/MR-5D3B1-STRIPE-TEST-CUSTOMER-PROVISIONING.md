# MPG Reputation — MR-5D3B1 TEST Customer Provisioning

| Field | Value |
|---|---|
| Slice | MR-5D3B1 — service-only synthetic TEST Stripe Customer creation |
| Baseline | MR-5D3A [PR #28](https://github.com/MPG-Technoologies/MPG-Reputation/pull/28), HEAD `25322ef72e29fb7250c92d641eb9011e110d775a` |
| Product main (remote checked) | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Company OS main (remote checked) | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Commercial status | UNAPPROVED; no real billing or live checkout |
| Actual hosted Stripe TEST acceptance | OWNER-DEFERRED until deployed testing |
| Engineering status | IN PROGRESS pending CI |

## Existing system preserved

This slice adds the missing TEST Customer-setup component for the existing MR-5D1/2 preflight and checkout initiator. It **does not** alter the existing Next.js/Supabase architecture, create a competing provider customer table, bypass RLS, change pricing or create a new dashboard. PR #18 (pricing), #26, #27, #28 are open/unmerged, and this work is stacked on #28.

## Durable, fenced setup

The new migration `supabase/migrations/20261019010000_mr5d3b1_test_customer_provisioning.sql` introduces the private TEST-only `stripe_test_customer_provisioning` table, retaining one immutable reservation per organization, a frozen server-read organization name, the short-lived lease token, provider ID after success and audit timestamps. RLS is enabled; table and its two `SECURITY INVOKER` RPCs **deny PUBLIC/anon/authenticated** and only grant `service_role` access.

The `reserve_stripe_test_customer` RPC:
- Accepts only the authenticated user's UUID and selected organization UUID **from a trusted server**, and independently verifies OWNER/ADMIN membership against actual database rows.
- Locks the **organization** first to serialize concurrent attempts even if the reservation does not yet exist, checks the organization's status and an existing TEST Stripe billing account, then allocates or resumes one unexpired reservation.
- Returns `EXISTING` if already linked, `BUSY` on an active attempt, and `MANUAL_REVIEW_REQUIRED` after 10 minutes when Stripe idempotency could no longer be safely assumed across extended outages.
- Freezes the organization name on initial reservation; never takes a name, email, customer ID, metadata, test/live flag, or idempotency key from a browser.

The `finalize_stripe_test_customer` RPC:
- Rechecks OWNER/ADMIN under a privileged server caller, locks the same organization and reservation, requires a valid current fencing token, checks expiry and the provider Customer ID shape, and inserts into the **existing** unique `organization_billing_accounts` TEST Stripe mapping.
- Commits the account mapping and `READY` reservation state atomically. A stolen or stale token, foreign tenant Customer, conflicting mapping or revoked role cannot finalize.
- Does not overwrite or delete a provider mapping to "fix" a conflict. Its `CUSTOMER_CONFLICT` means manual reconciliation, not success or a retry with a new key.

## Server-only orchestration and provider boundary

`src/lib/billing/stripe-test-customer-provisioning.ts` uses the signed-in user's **RLS-scoped** Supabase client for `auth.getUser()` and `user_has_role`, then an injected trusted database client for only the two service-only RPCs. The caller creates neither a service-role key nor external HTTP endpoints.

It is **disabled by default** and strictly refuses to run unless all are true:
- `ENABLE_STRIPE_TEST_CUSTOMER_PROVISIONING=true`
- `MPG_STRIPE_TEST_PROVISIONING_TARGET=LOCAL_SYNTHETIC`
- `NEXT_PUBLIC_SUPABASE_URL` is the disposable local `http://127.0.0.1:54331` or `http://localhost:54331`
- `VERCEL_ENV` is absent and `ENABLE_LIVE_BILLING` is not true

`src/lib/billing/stripe-test-customer-provider.ts` requires all these controls **plus a TEST-only secret key** before creating an actual Stripe SDK client. It passes only the frozen business name to Stripe `customers.create` and a deterministic idempotency key from the reservation UUID. It does not create emails, payment methods, subscriptions, or charges, or use metadata as tenant authority. No real Stripe credentials are available to CI.

### Important unknown-result rule

A network timeout after `customers.create` could mean Stripe created the customer. We **never reset** the reservation or generate a different idempotency key. A new server attempt can reuse the reservation only after its lease expires, with the same frozen name and provider idempotency key within a conservative 10-minute period. After 10 minutes or a conflicting provider response, the result must be manually reconciled against trusted TEST Stripe Customer inventory before attempting fresh account creation.

Stripe references: [Customer creation](https://docs.stripe.com/api/customers/create); [idempotent requests](https://docs.stripe.com/api/idempotent_requests).

## No production activation

No public API or server action, hosted migration/application, customer data import, live Stripe key, test provider API invocation in CI, subscription checkout activation, paid entitlement, final price approval, billing charge, email/SMS, real-customer pilot, production deployment or `main` merge. Local synthetic PostgreSQL is the only database used for integration tests. No actual checkout/customer portal user workflow is enabled in the UI.

## Verification and remaining steps

CI must verify authorization, one-winner concurrent claims, immutable idempotency key, source organization name, tenant Customer uniqueness, stale lease denial, null identity rejection, role changes, 10-minute expiry and strict service-role grants. Domain mocks must prove no API calls when disabled, and the Stripe key adapter must reject LIVE keys.

**MR-5D3B2**: separately build TEST customer-portal-session generation for existing linked accounts with verified tenant OWNER/ADMIN rights and safe return origin. **MR-5D3C**: protect checkout/portal invocation with origin/CSRF/rate limiting and connect it to the billing UI after environment/provider authority. **MR-5E**: entitlement state policy. **MR-5F**: hosted TEST provider acceptance, explicitly deferred until approved deployment.

This slice closes neither MR-5 nor MR-5D. Status must remain **ENGINEERING COMPLETE** only after the required checks actually pass, and OWNER ACCEPTED only after explicit owner review.
