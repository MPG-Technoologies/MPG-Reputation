# MR-5E2D1 — Local Synthetic Durable Invoice Inbox Preflight

| Control | State |
|---|---|
| Base | MR-5E2C verified HEAD `c00d39301bda4aba5a559dec7f087da9e1143201` |
| Company OS | `03a48a34481f1952a31cd5c4fb980bc381432d8d` — MR-5 PAUSED/INCOMPLETE, bounded non-live development directed by owner |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` — unchanged |
| State | IN PROGRESS; final CI required |
| Environment | LOCAL_SYNTHETIC ONLY; disabled by default |

## Purpose and existing evidence

MR-5C signature-verifies and durably claims raw Stripe events without storing the raw payload. MR-5E2C persists a minimal invoice reference for signed invoice events. MR-5E2B can resolve an independently read provider Invoice against the persisted Customer → Billing Account → Subscription → active organization mapping. These pieces previously had no narrow read-only bridge from the actual private event row to the provider and tenant identity check.

## Changes

- `src/lib/billing/stripe-invoice-truth.ts`: extract reusable exact-invoice reference resolution without manufacturing a fictional cryptographically verified event. Keep existing verified-event resolver behavior.
- `src/lib/billing/stripe-test-invoice-inbox.ts`: add a private read-only preflight. Explicitly require LOCAL_SYNTHETIC test flags, no LIVE billing, nonproduction execution and disposable loopback Supabase. Select one TEST Stripe event from service-role-only `billing_webhook_events` by exact event ID, confirm expected invoice event type, invoice reference, payload hash format and RECEIVED/unprocessed state. Independently retrieve invoice identity and confirm Customer, Subscription and active tenant mapping. Re-read the same event to detect concurrent state changes. Return only a bounded internal identity assessment.
- `test/integration/stripe-test-invoice-inbox.test.ts`: disposable database fixtures assert exact mapping, missing/unsupported event, incomplete reference, processing-in-progress, provider ID/environment mismatch, foreign customer, provider outage, in-flight state change and flag gating. The test uses synthetic table rows as controlled fixtures; this does not constitute independent proof of Stripe signature verification.
- Add the test to the isolated PostgreSQL CI allowlist.

## Strict nonauthorization

`MATCHED_IDENTITY_ONLY` means a read-only tenant identity correlation, **not** an invoice paid event, successful provider settlement, durable event processing, or product entitlement. A matching provider invoice/customer/subscription is necessary but is never enough to activate a subscription. The test boolean/fixture is not authenticity proof. No production route, runner, scheduler, webhook status update, hosted migration, Stripe network call, payment write, trial reset, RLS widening or secrets.

## Next gates

Actual MR-5E2D event processing requires: an owner-accepted, immutable and idempotent database transition, lease/lock/concurrency model; independently authenticated provider invoice/payment/subscription status with invoice cycle periods, refunds/disputes and event-order handling; audit/failure recovery; and isolated tests. A second read detects some races but **does not** make the assessment atomic or safe for entitlement writes. MR-5E3 paid entitlements and MR-5F hosted Stripe TEST acceptance remain separately gated. Preserve 30 Free Review Requests and suppression/unsubscribe.
