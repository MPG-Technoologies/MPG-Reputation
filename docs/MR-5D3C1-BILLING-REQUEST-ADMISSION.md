# MPG Reputation — MR-5D3C1 Billing Action Admission / Rate Limit

| Item | State |
|---|---|
| Slice | MR-5D3C1 — service-only TEST billing request-admission contract |
| Baseline | MR-5D3B2 [PR #30](https://github.com/MPG-Technoologies/MPG-Reputation/pull/30), HEAD `017dbffbd806710d41828afc1ac3f189abb627dd` |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Company OS main | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Provider/hosted testing | DEFERRED by owner until approved deployed-test environment |
| Status | IN PROGRESS pending CI |

## Why this slice exists

Customer provisioning (MR-5D3B1), TEST Checkout (MR-5D2), and TEST Portal (MR-5D3B2) are individually TEST-mode gated, server-only SDK contracts. Before connecting their invocation to a business-facing billing action, the app needs an auditable, tenant-authorized and globally shared **request boundary**, not ad-hoc buttons calling an elevated database client.

This slice does **not** create public routes, activate billing buttons or instantiate Stripe. It is a hardened precursor to MR-5D3C2; it must not be mistaken for a deployed CSRF protection solution in isolation.

## Implementation

- `src/lib/billing/stripe-test-billing-action-admission.ts` exports a server-only function `admitStripeTestBillingAction` for eventual `CUSTOMER_SETUP`, `CHECKOUT`, or `PORTAL` actions. It accepts *only* a request's basic evidence and an organization UUID; it does **not** accept customer IDs, price IDs, amounts, portal redirects, role claims, or a user UUID.
- Disabled unless explicit `ENABLE_STRIPE_TEST_BILLING_ACTIONS=true` and `MPG_STRIPE_TEST_BILLING_ACTION_TARGET=LOCAL_SYNTHETIC`, no `VERCEL_ENV`, `NODE_ENV !== 'production'`, `ENABLE_LIVE_BILLING` not true, and the exact disposable local Supabase URL.
- Requires `POST`, **exact** configured local Origin, `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: cors`, JSON content type and non-simple `x-mpg-billing-action: 1` header. This layered Fetch Metadata + Origin + non-simple request-header check prevents a cross-origin form POST from gaining a valid billing admission. A future route must not emit permissive CORS headers and must keep anti-CSRF checks at the first boundary.
- Verifies the current authenticated Supabase `auth.getUser()` and `user_has_role(org_id, ['OWNER','ADMIN'])` through the caller's **RLS-scoped client**. Only after authentication and origin verification does a separately injected privileged client invoke the private atomic rate-limit RPC.
- `supabase/migrations/20261019020000_mr5d3c1_billing_action_rate_limit.sql` adds `stripe_test_billing_action_limits` with RLS and only `service_role` access. `claim_stripe_test_billing_action` is `SECURITY INVOKER` / empty search path, revokes PUBLIC/anon/authenticated EXECUTE and independently checks OWNER/ADMIN membership. One persistent org+user bucket limits **all three actions combined** to five requests in a rolling-style fixed 60-second window. A race uses the PostgreSQL unique PK, making the sixth and later concurrent requests fail atomically.
- No raw customer data, Stripe credentials, provider event bodies, prices, telephone numbers or email addresses are stored in this rate table. It stores org/user UUID, start of last window, bounded count, last action and timestamps.

## Critical limitation

This is **admission only**. It is NOT a functional public billing endpoint. A future authenticated handler must enforce request body validation, a concrete active organization context, security headers/no-store, response redaction, origin verification at the edge, the actual admission call, permission recheck before provider side effect, and provider-specific error handling. The service-role client and Stripe secret must never cross into browser code.

The rate budget is a simple synthetic engineering control, not a fully operational distributed anti-fraud or tenant-global provider quota. Final live rate policy, logging, alerting, audit retention and per-organization caps require separately approved rules. Admission doesn't permit bypassing the existing MR-5D checkout reservation/idempotency controls.

## Remaining backlog

**MR-5D3C2:** bind admitted actions to the existing Billing workspace with a fail-closed local-only handler, strict request schema, temporary disabled UI and complete synthetic tests. Do not activate real provider operations until an owner-approved deployed TEST environment is available.

**MR-5D3D:** support-safe recovery of aged/ambiguous customer and checkout reservations, handling provider account recovery and no-double-create rules.

**MR-5E:** paid entitlements must be based on verified subscription plus payment evidence; `ACTIVE` alone must never grant service.

**MR-5F:** owner-deferred hosted provider test acceptance (subscriptions, invoices, renewal, failure, cancellation) and production readiness validation.

No hosted database migrations applied, no LIVE billing, messaging, real Customer provisioning, Stripe calls, actual charges, commercial launch/pricing approval, public portal/checkout activation, pilot, deployment or main merge.

## Verification

Run actual GitHub CI: lint, typecheck, domain tests, production build, and disposable PostgreSQL integration tests including concurrent request budget, RLS/role denial and fixed-window reset. Review full scoped diff and record outcome on PR.
