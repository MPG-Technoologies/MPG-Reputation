# MPG Reputation — MR-5D3D1 Read-only TEST Billing Recovery Diagnosis

| Field | State |
|---|---|
| Slice | MR-5D3D1 — inspect uncertain TEST Customer / Checkout reservations |
| Baseline | MR-5D3C2 [PR #32](https://github.com/MPG-Technoologies/MPG-Reputation/pull/32), HEAD `08d97d13afb83456868bf16f38d272b26a9bd167` |
| Company OS main | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` |
| MR-5 governance | PAUSED / INCOMPLETE; bounded engineering continuation per owner |
| Hosted Stripe TEST acceptance | DEFERRED until owner-approved deployed test |
| Live billing, messaging, charging, launch | NOT AUTHORIZED |
| Engineering status | IN PROGRESS until CI evidence |

## Why this slice comes first

Existing MR-5D2 and MR-5D3B1 reservations correctly refuse to generate fresh Stripe idempotency keys when Stripe's previous result is uncertain. A timeout may indicate a successful provider object creation. Deleting, manually resetting, or reopening a reservation without checking provider truth could create duplicate Customers or paid subscriptions. Recovery must start with a **diagnosis** of the tenant's exact state, before any provider lookup or mutation.

## Implementation

- `supabase/migrations/20261019030000_mr5d3d1_test_billing_recovery_diagnostics.sql` defines exactly one read-only `inspect_stripe_test_billing_recovery(p_user_id,p_organization_id)` RPC. It is `SECURITY INVOKER`, uses an empty search path and has explicit EXECUTE restrictions denying `PUBLIC`, `anon`, and `authenticated`; **only service_role** may call it from a trusted server.
- The SQL independently validates that the business exists, is ACTIVE and the specified authenticated user has an actual `OWNER` or `ADMIN` membership before inspecting private records.
- It reads only this organization's existing TEST Stripe account/subscription rows, Customer provisioning reservation and Checkout reservation; no cross-tenant joins, no network call, no lock/reset/update/INSERT, no subscription or entitlement mutation.
- It returns a minimal `{outcome,customer,checkout}` object and **never** Customer IDs, provider names, URLs, Stripe Checkout/Portal session identifiers, fencing tokens, raw PII, amounts, timestamps or payment records. Invalid/outside-user requests return `NOT_AUTHORIZED`, not resource-existence details.
- `src/lib/billing/stripe-test-recovery-diagnostics.ts` is a TEST-only, server-only wrapper, disabled unless `ENABLE_STRIPE_TEST_RECOVERY_DIAGNOSTICS=true` and `MPG_STRIPE_TEST_RECOVERY_TARGET=LOCAL_SYNTHETIC`, with exact disposable Supabase URL and not running in Vercel/production/live billing. It authenticates the real Supabase JWT and performs RLS-scoped `user_has_role` before invoking the narrowly scoped service-only diagnosis RPC. It validates every returned state and rejects unexpected fields or raw provider data. **No public HTTP handler or browser action** invokes it.
- The data is a point-in-time **advisory diagnostic** only. It MUST NOT itself authorize a charge, an entitlement, reopening a reservation, refund or Customer linking; a subsequent action must recheck fresh provider and local truth transactionally.

## State interpretation

| Customer setup | Meaning |
|---|---|
| `NOT_STARTED` | No TEST account or provisioning reservation |
| `IN_FLIGHT` | Original reservation lease still active |
| `RETRY_SAME_RESERVATION` | Lease expired while original immutable idempotency reservation is still within 10 minutes |
| `RECONCILE_PROVIDER` | Aged, inconsistent or unlinked READY reservation; inspect Stripe TEST Customer identity first |
| `ACCOUNT_LINKED` | Existing TEST organization billing account mapping |

| Checkout | Meaning |
|---|---|
| `NOT_STARTED` | No TEST checkout reservation or non-ended subscription |
| `IN_FLIGHT` | Checkout reservation lease remains active |
| `RETRY_SAME_RESERVATION` | Lease expired; only exact original idempotency parameters are still eligible for retry |
| `ACTIVE_SESSION` | Local TEST Checkout Session stored and within its recorded expiry, **not payment proof** |
| `RECONCILE_PROVIDER` | Session expired, reservation aged or ambiguous; do not reset or create another Session |
| `SUBSCRIPTION_RECORDED` | Local TEST non-ENDED provider projection exists, **not settled-payment proof** |

The functions deliberately never surface a `PAID` classification.

## Recovery runbook / next owner-gated step

**MR-5D3D2** may define read-only Stripe TEST Customer and Checkout status verification via an approved support/operator credential. It must independently validate the TEST Customer mapping, customer name, reserved session identity/idempotency reference, subscription status, session expiry and webhook processing before any support decision. Verify tenant ownership from repository DB evidence, not Stripe metadata, and never infer payment settlement from a Checkout redirect.

**MR-5D3D3** can later define a support-reviewed, auditable, transaction-protected release/retry policy for abandoned sessions proven safe. Never delete reservations or overwrite Customer mappings merely to unblock user checkout. Whether expired TEST sessions may be safely recreated, how cancellations/refunds are handled, and who may approve release are separate operating decisions.

**MR-5E** remains a distinct milestone: paid entitlements require verified provider payment evidence and explicit owner-approved policy. Preserve **30 Free Review Requests**, existing usage accounting, messaging suppression, idempotency and RLS.

**MR-5F** remains owner-DEFERRED for real hosted Stripe TEST acceptance and deployed testing. Do not activate production payments, real customer pilot, company stage, final price or commercial release.

## Verification

Required: lint, typecheck, build, synthetic deny-by-default tests, full disposable PostgreSQL integration tests covering in-flight/retry/aged states, saved vs expired session, subscription record precedence, cross-tenant membership, RPC privilege revocation, lack of row mutations and cleanup. No new RLS changes, public route, real provider key, Stripe call, hosted migration, customer PII, checkout release or production deployment.
