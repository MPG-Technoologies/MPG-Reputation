# MPG Reputation — MR-5C2 Atomic TEST Subscription Projection

| Item | State |
|---|---|
| Date | 2026-10-18 |
| Milestone | MR-5C (PARTIAL) — service-only atomic subscription persistence |
| Branch base | MR-5C1 projection candidate PR #19, which is NOT YET MERGED |
| Owner direction | Continue bounded billing engineering, keep Stripe charges OFF |
| Status | IN PROGRESS pending synthetic PostgreSQL verification |
| Live charging, billing checkout, provider calls, paid entitlements | NOT IMPLEMENTED / NOT AUTHORIZED |

## Current system and delta

MR-5A/B already created `organization_billing_accounts`, `organization_subscriptions`, `billing_webhook_events`; MR-5C earlier preserved the raw-signature-verified **durable intake only** and trusted Stripe Customer correlation; MR-5C1 proposed a typed, fail-closed provider subscription projection candidate in product PR #19. MR-5C2 now adds:

- `supabase/migrations/20261018150000_mr5c2_atomic_subscription_projection.sql` — one transaction-scoped, SECURITY INVOKER function `public.reconcile_stripe_subscription_projection`, restricted to `service_role`, **TEST environment only** regardless of app flags.
- `src/lib/billing/stripe-subscription-projection-store.ts` — injectable privileged-database-client boundary for the candidate; no service client is created and no webhook is wired.
- `src/types/database.ts` — precise RPC signature.
- `test/integration/stripe-subscription-projection-atomic.test.ts` and isolated E2E allowlist — PostgreSQL tests on disposable local Supabase with the actual migration.

## Atomic invariants

1. Full input validation of provider subscription/customer/price IDs, date ranges and an exhaustive Stripe status → normalized status mapping. No `GRACE` or paid entitlement from this function.
2. Transaction-level advisory lock by subscription identifier and `FOR UPDATE` locking on the authoritative `organization_billing_accounts` row.
3. Match **billing-account ID + organization ID + Stripe Customer ID + provider + TEST mode inside the same database transaction**. Never trust tenant claims in a Stripe event's `metadata`.
4. Reject reassigning an existing Stripe subscription to another organization or billing account; existing composite foreign keys and unique IDs remain unchanged.
5. Duplicates return `UNCHANGED` without changing `updated_at`; changed provider states update the same subscription row; a new provider subscription is inserted once.
6. `PUBLIC`, `anon` and `authenticated` cannot EXECUTE the SQL function, including authenticated business OWNER users. It is SECURITY INVOKER (not privileged SECURITY DEFINER) and uses a fixed empty search path and schema-qualified tables.
7. No untrusted raw payloads, customer contact fields or Stripe event snapshots are stored.

## What this does NOT solve yet

**A transaction lock only guarantees atomicity, not provider-state freshness.** Stripe Event `created` is not an authoritative monotonic version of the Stripe Subscription; the provider snapshot may become stale between retrieval and SQL commit. Therefore **out-of-order webhook processing/recovery remain OPEN**. The future MR-5C3 processor must acquire a consistent per-subscription serialized reconciliation lane, fetch current Stripe provider truth in that lane, resolve authoritative customer mapping, then invoke this transaction, with bounded retry and recovery. Do not call this RPC directly with a received event snapshot or with arbitrary app-supplied JSON.

The SQL function intentionally **blocks LIVE** even with service-role access and any environment flag. No checkout route or user-facing subscription action was introduced, Stripe keys not provisioned, no actual payment/accounting record created, no entitlements or messaging activated, and no hosted Supabase changes have been applied as part of this PR.

The existing `organization_subscriptions` and `billing_webhook_events` models remain distinct; this slice does **not** mark durable intake events PROCESSED. MR-5C3 must atomically and idempotently coordinate event claims, provider retrieval, recovery and processed/failed outcomes.

## Owner pricing continuity

Separately unmerged [PR #18](https://github.com/MPG-Technoologies/MPG-Reputation/pull/18) contains the requested **₱1,500 per month / ₱1,000 per full year** proposed pricing and independently configurable server-side amounts. This slice deliberately does not duplicate prices or build checkout. No published pricing or commercial charge is authorized.

## Testing & reconciliation

Disposable local Supabase E2E must prove:
- successful initial insert, update and duplicate replay idempotency;
- cross-tenant and Stripe Customer mismatch rejection;
- existing-subscription reassignment rejection;
- failed-payment and terminal status handling without granting access;
- forged `GRACE`, invalid Price/period, and LIVE hard block;
- denial for anonymous and authenticated owner sessions;
- concurrent identical calls create one row.

The company's accepted `MPG-DEC-051` continues to mark MR-7 legal/compliance review pending, MR-8 gated and Case B excluded. The Owner's later direction permits bounded engineering progress but does not accept MR-5 or approve production. Full MR-5 completion is still pending MR-5C3, checkout/customer portal (MR-5D), entitlement synchronization (MR-5E) and hosted Stripe test-mode acceptance (MR-5F).

No new pricing or provider decisions are inferred from this work.
