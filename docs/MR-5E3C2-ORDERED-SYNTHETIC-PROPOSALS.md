# MR-5E3C2 — Transaction-Serialized Synthetic Proposal Ordering

Status: IN PROGRESS pending final CI and full diff review.

## Remote authority
- Company OS main `03a48a34481f1952a31cd5c4fb980bc381432d8d`: MR-5 paused/incomplete under accepted milestone governance, with latest owner directive authorizing bounded non-live provider-ready engineering. MR-7 remains active.
- Product main `6b7ac073432921789314315ec5fc624a81d8f699`, unchanged.
- Parent MR-5E3C1 `45693ff59120e4615aa521de605327ecb56edd83`, PR #46 verified / READY FOR OWNER REVIEW, unmerged.
- No Stripe account, payment API credentials or live payments yet. Hosted Supabase migrations and paid access remain gated.

## Objective
Close the explicit cross-event ordering hole from MR-5E3C1 in the existing *unverified, TEST-only, synthetic* proposal ledger, without making it an authoritative payment or product entitlement ledger. Same-event idempotency was already present, but a delayed older event could previously be staged after a newer event. Using webhook arrival time is unsafe for that determination.

## Minimal changes
- Repository-only migration `20261019150000_mr5e3c2_ordered_synthetic_proposals.sql`: nullable source-order timestamp for legacy rows; new inserts derive `source_provider_created_at` **from stored provider_created_at**, not a user-supplied ordering value or arrival time.
- A `SECURITY INVOKER`, service_role-only `BEFORE INSERT` trigger locks the *exact* tenant-matched `organization_subscriptions` row with `FOR UPDATE`. This serializes concurrent proposal inserts for one subscription. Re-check exact event duplicate across the ledger, then compare to the most recently staged provider event timestamp. Reject missing timestamps, old timestamps, and equal-second ambiguous events. Historical proposals without trusted source ordering cause manual review instead of silent bypass.
- Once an unresolved review, scheduled cancellation or terminal status is staged, block a subsequent proposed ACTIVE status from overwriting that hold. This is a narrow safety rule, **not full lifecycle state-machine enforcement**.
- The existing local-only admission facade now compares proposed event occurrence to the persisted `provider_created_at` (rather than `received_at`) and converts recognized ordering/hold failures to bounded nonauthorizing results.
- Existing synthetic ledger/admission fixtures provide provider-event creation times; new disposable PostgreSQL suite covers chronological processing, delayed old payments, equal-second ambiguity, missing time, dispute/cancellation review holds, concurrency, tenant isolation and replay.
- No real provider network calls, changed payment APIs, pricing finalization, RLS grants, new API routes, production or hosted migration application, paid entitlement activation, trial usage mutations, or new authorization hooks.

## Explicit boundary
A Stripe `provider_created_at` timestamp alone is not enough to determine the true causal/financial order of all payment updates. Different event types may have the same second, and a later provider event can report earlier financial state. Those ambiguities are **blocked for review**, not automatically resolved or reactivated. The ledger remains `SYNTHETIC/UNVERIFIED/access_authorized=false`. A future verified processor must query authoritative provider Invoice, Subscription, Payment, refund/dispute state and apply an owner-approved full lifecycle transition transaction before granting paid product access. The preexisting **30 Free Review Requests** trial is unchanged.

## Verification
Run Internal CI (lint, typecheck, synthetic tests and build), isolated disposable PostgreSQL E2E (including replay/concurrency/tenant-isolation/erasure), review full scoped diff. Do not mark ENGINEERING COMPLETE before tests pass; never claim owner acceptance or production readiness.
