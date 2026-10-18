# MPG Reputation — MR-5D3B2 TEST Customer Portal Contract

| Field | Verified / planned state |
|---|---|
| Scope | MR-5D3B2 — existing-business TEST Stripe Billing Portal session |
| Baseline | [PR #29](https://github.com/MPG-Technoologies/MPG-Reputation/pull/29), `67b4af4fe5c24445275ab48902e48f49b8ebfcef` |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Company OS main | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Hosting, provider activation | OWNER-DEFERRED |
| Final commercial pricing / cancellation policy | NOT APPROVED |
| Verification | PENDING actual GitHub checks on initial authoring |

## Existing architecture

This is a bounded continuation of the existing Stripe TEST Customer provisioning, checkout preflight and Billing settings page. It neither creates a second portal nor changes tenant RLS or the raw subscription state pipeline.

### Module contracts

- `src/lib/billing/stripe-test-customer-portal.ts` — explicitly gated server-only entry point accepting an authenticated **RLS-scoped** Supabase client, a requested organization UUID, and injectable TEST Stripe configuration and portal-session transport functions.
- **Authorization:** `auth.getUser()` plus `user_has_role(org_id, ['OWNER','ADMIN'])`. Only the matching organization's **TEST** `organization_billing_accounts.provider_customer_id` may be read from existing RLS. No provider Customer, redirect URL, payment amount or billing role may be supplied from browser inputs.
- **Activation boundary:** `ENABLE_STRIPE_TEST_PORTAL=true`, `MPG_STRIPE_TEST_PORTAL_TARGET=LOCAL_SYNTHETIC`, exact disposable Supabase URL, `VERCEL_ENV` absent and `ENABLE_LIVE_BILLING` not true. No HTTP action/route, checkout invocation, scheduler, hosted database or Stripe TEST account is activated.
- **Provider configuration:** `STRIPE_TEST_PORTAL_CONFIGURATION_ID=bpc_...` is required, never Stripe's implicit default. Retrieve it and fail closed unless it's active, **TEST**, and allows **invoice history** plus **payment-method update** while disabling **subscription change, cancellation, customer-profile edits and public portal login**. These are interim TEST safety rules, not final cancellation or commercial decisions.
- **Portal session:** create with authenticated organization's Customer ID, approved configuration and fixed server-controlled return URL `MPG_BILLING_CHECKOUT_RETURN_ORIGIN + /app/settings/billing`. Validate the returned Session ID (`bps_...`), Customer, configuration, TEST mode, return URL and exact `https://billing.stripe.com/p/session/test_...` URL. Return the short-lived URL in memory only, never write it to the DB, logs, mail or persistent support records.
- `src/lib/billing/stripe-test-portal-provider.ts` — TEST secret-key-only Stripe SDK adapter for read-only portal configuration lookup and creating a hosted portal session. It cannot be constructed with a live secret or an environment outside disposable local synthetic. Both functions are injectable, so CI exercises **no real Stripe calls**.

A portal link is a bearer capability and Stripe recommends creating one on-demand for a real authenticated user. Customer Portal is **not** Stripe Connect onboarding. The businesses are MPG's subscription Customers in a Stripe Billing account; do not label this as businesses linking their own Stripe merchant accounts.

Reference: [Stripe create Billing Portal session](https://docs.stripe.com/api/customer_portal/sessions/create); [Stripe Billing Portal configuration](https://docs.stripe.com/api/customer_portal/configurations/object).

## Remaining development and gates

1. **MR-5D3C** — develop a narrowly authorized request boundary connecting account setup, TEST checkout and portal through existing MPG Reputation Billing UI, with same-origin CSRF protection, real rate limits, identity-safe errors and explicit environment policy; do not expose service-role keys.
2. **MR-5D3D** — define Stripe provider TEST recovery for abandoned/ambiguous Checkout/Customer creation, user-friendly pending/setup status, and auditable support intervention (no reset-and-duplicate).
3. **MR-5E** — paid-access entitlements keyed to trusted MR-5C subscription projection and additional verified payment evidence; `ACTIVE` provider record alone is not proof of invoice settlement. Preserve `30 Free Review Requests` and existing suppression/tenant controls.
4. **MR-5F** — owner-deferred hosted engineering/test migration and real TEST Stripe keys/provider account/checkout/portal acceptance; test renewal, failed payment, cancellation, past_due, webhook retries and rollback before any live activation.
5. Resolve final billing configuration and very large annual discount (proposed **₱1,500/month, ₱1,000 total annually**) with the owner, and legal/commercial gates before publication.

**No live billing, checkout, data mutation against hosted Supabase, credential provisioning, email/SMS, customer pilot, marketing release, production deployment, final pricing approval, entitlement changes, branch merge or Company Stage change.** Final review must compare only this slice against PR #29 and test the disposable PostgreSQL tenant isolation and all provider config/URL denials.
