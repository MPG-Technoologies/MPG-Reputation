# MPG Reputation — MR-5C3B2 Fenced TEST Reconciliation Worker

| Item | State |
|---|---|
| Date | 2026-10-18 |
| Milestone | MR-5C3 — PARTIAL, MR-5C3B2 bounded engineering slice |
| Branch base | MR-5C3B1 PR #22 (`688b5950d94dcf43e9948a1fc07504e6fea419c7`) |
| Billing environment | **TEST-only** hard-coded in database transaction |
| Excluded | live billing, checkout, real charges, entitlements, actual hosted Supabase updates, cron or public worker route |
| Status | IN PROGRESS pending CI |

## Why this work

The durable webhook intake and MR-5C3A's event-level processing lease are verified. MR-5C3B1 recovers an authenticated TEST Event by stored provider Event ID and builds a validated current Subscription candidate from a fresh provider retrieval. However, two separate Stripe Events can target the same subscription. Event-level leases alone do not prevent the *older provider snapshot* finishing last.

## Changes

- **New migration** `supabase/migrations/20261018180500_mr5c3b2_fenced_subscription_reconciliation.sql` creates a unique, TEST-only per-Stripe-subscription mutex row, RLS enabled, service-role-only SQL access and three SECURITY INVOKER RPCs:
  - `lease_stripe_subscription_reconciliation` checks the current verified-event lease and acquires a 120-second fenced subscription-specific lease, no wider than the 180-second event lease.
  - `release_stripe_subscription_reconciliation` releases a slot only when its unique token matches.
  - `commit_stripe_subscription_reconciliation` **in one PostgreSQL transaction** checks the event and subscription tokens and their expiry, invokes MR-5C2's trusted tenant/account/customer status persistence function and marks the durable Event `PROCESSED`. An old or superseded worker cannot update a projection or finalize a newer event.
- **Server-only worker** `src/lib/billing/stripe-test-reconciliation-worker.ts` handles one explicitly supplied durable record, reusing MR-5C3A's event lease, MR-5C3B1's Stripe Event identity recovery/tenant verification and MR-5C2's valid state. It acquires the subscription lock BEFORE the read of current Stripe Subscription, then calls the fenced commit RPC, and releases ownership on error. Sanitized `FAILED` and `IGNORED` statuses are persisted through the existing token-fenced finalization contract. It uses *injected* current-provider read functions; no external account or Stripe API is contacted in CI.
- The existing public POST `/api/webhooks/stripe` is **unchanged** and remains signature-verified durable intake only. This worker is not wired to a route, scheduler, client UI, or deployment.
- `src/types/database.ts` includes service-only RPC signatures and table types; disposable Supabase CI executes synthetic worker and mutex tests. No customer PII or raw event payload is retained.

## Reliability semantics and limits

**Test-mode only.** The status `ACTIVE` in the subscription projection does not equal payment settlement, paid entitlement, live sending, or trial conversion. No `GRACE` policy is enabled.

**Provider-freshness approach:** different Event IDs for the same Stripe Subscription cannot simultaneously retrieve provider Subscription state under an active mutex. The next holder fetches the provider again, rather than replaying old Event snapshot state. The SQL function checks both fencing tokens atomically and rejects expired or revoked leases. The event and local subscription projection commit atomically.

**Bounded retry:** earlier MR-5C3A permits at most five event-processing claims. FAILED events can be reclaimed, and abandoned leases expire automatically. Failure codes are fixed sanitized enumerations. A BUSY subscription is recorded as a recoverable processing failure, not a provider-state write. A separate scheduler with queue selection and interval-based backoff has **not** been installed or activated in this slice. Without a controlled retry schedule, automatic end-to-end recovery and permanent failure alerting remain incomplete.

**Event retention:** Stripe Events can be fetched for 30 days. The hash of a webhook body is not a replayable event. Expired Stripe Event IDs need a separately controlled subscription inventory reconciliation/manual intervention, not reconstructed payloads.

**Provider availability:** no live or even connected TEST Stripe API key is provisioned/used in this branch. Test data and mocked provider transport are synthetic. A real Stripe test-mode account acceptance is outstanding.

**Production governance:** Company OS main `03a48a34481f1952a31cd5c4fb980bc381432d8d`, product main `6b7ac073432921789314315ec5fc624a81d8f699`, and current owner direction allow bounded engineering but not merging, production deploy, hosted schema mutations, customer charging, live messaging, trial bypass, real-customer pilot, marketing or MR-8 activation. PR #18 pricing (₱1,500/month; ₱1,000 for 12 months total) remains independent, unmerged and unpublished.

## Verification

The disposable PostgreSQL test suite checks: one winner for concurrent Event IDs, forged tokens, expired event tokens, superseded subscription tokens, cross-tenant/customer input, invalid statuses and LIVE environment rejection, anonymous RPC denial, success and duplicate Event outcomes, provider failure recovery, and BUSY mutex behavior. Verify CI results before claiming completion.

## NEXT

MR-5C3C — controlled service-only retry dispatcher: safely select durable TEST events needing processing, enforce backoff for FAILED events, report exhausted attempts/30-day Event expiry, add boundary authenticated scheduler/job trigger with explicit enable flag (not production activation), and run Stripe test-account lifecycle acceptance when owner supplies test credentials.

Then MR-5D checkout/customer portal, MR-5E entitlements, MR-5F hosted Stripe test-mode full-cycle verification. **MR-5 remains INCOMPLETE.**
