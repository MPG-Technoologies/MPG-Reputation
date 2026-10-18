# MPG Reputation — MR-5D2 TEST Checkout Initiation and Fencing

| Item | State |
|---|---|
| Slice | MR-5D2 — server-only Stripe TEST subscription Checkout Session creation contract |
| Branch base | MR-5D1 [PR #26](https://github.com/MPG-Technoologies/MPG-Reputation/pull/26), commit `f4a9ddba1a4a73bde17426403527baf7f26719a5` |
| Company OS main | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Provider testing | OWNER-DEFERRED until an explicitly approved deployed TEST application |
| Live billing, charging, customer trial changes | NOT AUTHORIZED |
| Status | IN PROGRESS pending actual CI |

## Continuation

This slice reuses **PR #18** pricing configuration and the verified **MR-5D1** authenticated tenant/price preflight. It does not fork or rewrite MR-5C webhook reliability branches #19–#25. MR-5D1 returned a valid subscription checkout intent but could not prevent two simultaneous session-creation requests or safely resume if the provider created a session and the network reply was lost.

## Implementation

1. `supabase/migrations/20261018233000_mr5d2_fenced_test_checkout.sql` creates `stripe_test_checkout_reservations` with **one current intent per organization**, strict **TEST-only** environment, existing billing account foreign key, tenant and price IDs, immutable requested plan/return origin, status `PREPARING` or `READY`, short-lived fencing token, original session expiry and reservation cooldown. RLS is enabled, and table access is restricted to `service_role`.
2. SECURITY INVOKER RPC `reserve_stripe_test_checkout` re-checks the authenticated user ID's **OWNER/ADMIN** membership in the database; locks the billing account (matching MR-5C subscription writes), validates TEST customer, and refuses a non-ended subscription. It reserves one immutable checkout intent. A second concurrent request returns `BUSY`; a changed plan/price/customer/return origin returns `DIFFERENT_INTENT`. A returned READY intent reuses the same TEST Session URL while valid.
3. SECURITY INVOKER RPC `finalize_stripe_test_checkout` atomically verifies that both the reservation lease and authorized membership are still current, rejects a new local subscription, and stores only a validated TEST session ID/hosted checkout URL before allowing a redirect. Superseded workers cannot finalize.
4. `src/lib/billing/stripe-test-checkout-start.ts` composes MR-5D1's RLS-scoped user preflight with the above **privileged server-side DB RPC** and an injected Stripe TEST Checkout creator. Every billing request must be explicitly enabled by server-only `ENABLE_STRIPE_TEST_CHECKOUT_CREATE=true`; **ENABLE_LIVE_BILLING=true still blocks execution**. It accepts only a requested organization and plan; **never accepts browser customer, price, amount, redirect destination, discount, quantity, role, or session ID**.
5. Fixed Checkout redirects come solely from exact server-controlled `MPG_BILLING_CHECKOUT_RETURN_ORIGIN`, requiring an HTTPS origin (or explicit localhost HTTP). Success: `/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}`; cancellation: `/billing/checkout/cancel`. These are future MR-5D3 pages and MUST NOT claim that a payment succeeded from the URL alone.
6. `src/lib/billing/stripe-test-checkout-session.ts` is a **gated TEST secret-key-only** Stripe SDK adapter. When explicitly invoked, it creates a **hosted** `subscription` Checkout Session with one trusted recurring Price, one quantity, existing provider Customer, promotion codes disabled, 1-hour expiration and a deterministic idempotency key derived from the reserved UUID. The returned Session must match TEST, subscription mode, expected Customer, exact expiry, open status and official `checkout.stripe.com` URL. No key has been provisioned or used in synthetic CI.
7. A provider timeout does **not** erase the checkout reservation or generate another idempotency key. A still-current reservation may be reclaimed after its 120-second lease expires with the **same** key/parameters, only within the first 10 minutes. Stripe stores idempotency keys for at least 24 hours. No automatic new Session is created once the 1-hour session/65-minute reservation window expires; an ambiguous payment or delayed webhook requires **manual reconciliation** before another attempt. This conservative block is intentional, not customer-ready retry UX.

## Concurrency and trust model

```
Authenticated business OWNER/ADMIN
  → MR-5D1 user JWT/RLS and provider TEST Price verification
  → server-only reserve_stripe_test_checkout (service role; rechecks owner in DB)
  → durable org-scoped idempotency reservation / fencing
  → Stripe TEST checkout.sessions.create (same idempotency key on every retry)
  → verify returned TEST Session fields and official hosted URL
  → server-only finalize_stripe_test_checkout (rechecks owner/subscription/lease)
  → return hosted TEST checkout URL
```

The service-role client must **never** be sent to a browser. This function does **not** create a privileged client itself; future MR-5D3 server-side route must construct and scope the trusted caller properly, apply request origin/CSRF and rate limiting, and keep all credentials server-only.

**Payment source of truth:** Checkout redirect or `READY` reservation does *not* prove a payment. Paid entitlements remain inactive until the authenticated MR-5C webhook processor validates current Stripe Subscription truth and the separate owner-approved MR-5E policy permits access.

## Explicitly remaining

- A customer/business may not have a Stripe Customer yet. MR-5D2 reuses MR-5D1's `ACCOUNT_SETUP_REQUIRED` result. **Customer provisioning is not silently implemented** here. It needs a separately authorized, tenant-safe, idempotent TEST Stripe Customer creation path, connected to onboarding; otherwise checkout remains blocked for unprovisioned customers.
- The `MANUAL_REVIEW_REQUIRED` state needs a carefully authorized support recovery mechanism checking the actual TEST Checkout Session status/expiry and current Subscription state before permitting new sessions. **Do not delete reservations to bypass this gate**.
- MR-5D3: integrate business billing pages and secured server action/API route, ensure CSRF and rate limits, plan selection, portal entry, and appropriate success/pending/cancel UX with no unverified paid status.
- MR-5E: entitlements tied to verified subscription projection and **30 Free Review Requests** trial, respecting suppression and tenant isolation.
- MR-5F: owner-deferred hosted provider TEST end-to-end acceptance, account/API/webhook Price provisioning, test card flows, renewal/failure/cancellation simulation. No hosted TEST/production environment was touched here.
- PR #18's annual proposal remains **₱1,000 total per full year** (not per month). This steep discount is an owner commercial/economics question before publication.

## Security and verification

No new public API route, scheduler, hosted database migration application, test Stripe credentials, real provider API call, actual charge, entitlement grant, live messaging, launch, production deployment, branch merge or Company Stage modification. All SQL objects are TEST-only; `PUBLIC/anon/authenticated` EXECUTE explicitly revoked; RLS remains enforced.

Required verification: disposable PostgreSQL concurrent claims, tenant/customer/role denial, stale token replay, duplicate subscription block, finalization mismatch; synthetic adapter parameter/URL validation and Stripe-key fail-closed behavior; lint/typecheck/build/final diff. Results recorded after actual CI runs.
