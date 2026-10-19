# MPG Reputation — MR-5C3A Durable Webhook Lease / Recovery Foundation

| Detail | Verified scope |
|---|---|
| Stage | MR-5C3A — BOUNDED ENGINEERING |
| Branch base | MR-5C2 PR #20 head `3786a773b29f2d20326804be3133811b5fe85c5c` (PR #20 is unmerged) |
| Billing provider | Stripe TEST only; not connected to a live account |
| Real customer billing, messaging, entitlements | Not implemented, not activated |
| Code impact | Only migration, DB types, synthetic tests, CI and this document |

## Why this slice

The durable Stripe webhook intake already verifies raw Stripe signatures and stores provider event identity and a payload SHA-256 hash, not a replayable webhook body. Later MR-5C2 can atomically persist a validated TEST subscription snapshot, but cannot safely process or recover events yet.

MR-5C3A provides *event custody*: a database-backed, revocable, time-limited processing lease attached to an already-durable webhook claim. It does **not** process the Stripe subscription, mark invoices settled, or grant paid access.

## Existing and new state

No existing columns or RLS policies are removed or relaxed. The existing `billing_webhook_events` table gains `processing_lease_token`, `processing_lease_expires_at` and bounded `processing_attempts` (0–5).

Two SECURITY INVOKER RPCs are added:

1. `lease_stripe_webhook_processing(event_id)`: atomically leases a TEST event with `RECEIVED`, `FAILED`, or expired `PROCESSING` state, for 180 seconds; increments attempt count and returns a one-use fencing token, persisted event ID and event type. Does not return raw data or customer details. No parallel worker can obtain a second non-expired lease for the same event. Exhausted attempts or already-finalized rows return `NO_WORK`.
2. `complete_stripe_webhook_processing(event_id, lease_token, status, organization_id?, error_code?)`: only a still-current, unexpired token can set `PROCESSED`, `IGNORED` or `FAILED`. Successful processing requires an identified organization. Ignored events may not supply an organization. Failed events accept one of five approved fixed error codes and no organization ID. Replayed or expired tokens cannot overwrite newer results.

Both functions are **TEST-only** and have explicit `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE TO service_role`, with a fixed empty `search_path`. They are deliberately not invoked from public routes. A business OWNER is never a payment-provider webhook operator.

## Verification and safety tests

The disposable Supabase integration suite covers:
- exactly one winner across concurrent lease claims;
- token-protected processing completion and no replay;
- ignored/unsupported-event handling;
- recoverable sanitized failure and retry;
- invalid completion arguments, expired and superseded worker tokens;
- five-attempt recovery cap;
- hard TEST/LIVE isolation despite elevated database caller;
- signed-in organization OWNER and anonymous RPC denial;
- disposal of synthetic organizations and events after the test.

## Hard remaining boundary: what is still NOT implemented

This is NOT a complete event processing pipeline. The following are required before connecting it:

- A trusted background worker / task scheduler with no public service-role exposure.
- A safe way to re-fetch the event's current subscription identity from Stripe for durable recovery. Historical rows store provider event ID and SHA-256, not the original body.
- Per-**subscription** serialization **across** Stripe API retrieval and database reconciliation. Event-level leasing does not guarantee two different Stripe events affecting the same subscription are ordered correctly.
- Verification of Stripe event environment and provider customer/billing account association on each attempt; no authority from event metadata.
- Idempotent, auditable transition from a validated subscription projection to the correct processed result, plus detection/reporting of permanently failed events.
- Provider test credentials and TEST-only hosted acceptance of the complete processing/recovery flow.
- MR-5D Checkout/Customer Portal, MR-5E paid entitlements, MR-5F hosted provider test-mode acceptance, separately owner-gated policies, and governed publication.

**No automatic trigger, worker, Stripe API call, data projection, payment, refund, entitlement, email or SMS was introduced.** The webhook HTTP handler remains durable intake only.

PR #18 remains the separate proposed, server-configurable price plan: ₱1,500 each month and ₱1,000 for the entire year, not ₱12,000 annually. Both amounts remain unpublished until commercial approval.

Company OS main `03a48a34481f1952a31cd5c4fb980bc381432d8d` still places MR-5 paused/incomplete because of provider dependencies and MR-7 in progress. The latest owner instruction authorizes bounded technical continuation only. MR-8, Case B, live charging, real-customer pilot and marketing remain blocked.

## Exact next slice

MR-5C3B — trusted TEST background-worker orchestration and recovery. Start by inspecting the existing message/event task abstractions; do **not** assume this lease constitutes an atomic provider-state read. Verify the authenticated Stripe event retrieval, tenant correlation, subscription-level serialization, and subscription projection together with separate synthetic failure/reordering tests.

## Verification

Pending CI, to be updated from the GitHub Actions runs themselves.
