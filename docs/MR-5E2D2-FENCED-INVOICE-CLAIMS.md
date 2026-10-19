# MR-5E2D2 — Fenced TEST Invoice Processing Claims

| Control | State |
|---|---|
| Parent | MR-5E2D1 verified `6f88fc3b55b842fc93e8e4629e8cb24f256f7c58` |
| Company OS | `03a48a34481f1952a31cd5c4fb980bc381432d8d` — MR-5 PAUSED/INCOMPLETE, owner permits bounded non-live engineering |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` — unchanged |
| Status | IN PROGRESS; final isolated CI and diff review required |
| Hosting | Repository migration only; **DO NOT APPLY HOSTED / PRODUCTION** |

## Objective and bounded scope

Add atomic, service-only processing **claims** for previously signed, persisted TEST invoice events. This slice does not verify invoice paid status, run an asynchronous worker, call Stripe, mark an event PROCESSED, or change entitlements.

## Implementation

- Add `processing_lease_token`, `processing_lease_expires_at` and `processing_attempt_count` to existing private RLS-protected `billing_webhook_events`. Keep previous privileges. No raw Stripe invoice payload, customer PII, payment status or keys are stored.
- Service-only, SECURITY INVOKER RPC `claim_stripe_test_invoice_processing`: use `FOR UPDATE` to serialize the single TEST inbox row; require supported invoice type, validated invoice ID/hash, `RECEIVED` or an expired leased `PROCESSING`, no `processed_at` or assigned organization; reject unrelated, LIVE, completed, unknown legacy PROCESSING and FAILED rows. Reclaim at most three attempts, mint a new UUID token for each claim, give no role or tenant access to the caller.
- Service-only, SECURITY INVOKER RPC `fail_stripe_test_invoice_processing`: permit only a current, nonexpired lease owner to set `FAILED` and a fixed non-PII error code, clearing the lease. **FAILED means unresolved worker investigation requiring human review, not a Stripe payment failure.** No auto-retry of FAILED. Old lease tokens cannot modify an event after takeover.
- Typed server-side facade `stripe-test-invoice-processing.ts` hard-disables all calls unless explicit local synthetic flags, loopback Supabase, no Vercel, nonproduction and live billing disabled. Its lease token is privileged internal state and must never go to the browser.
- Integration tests use only disposable local Postgres to verify concurrent claims, fencing after simulated expiry, max attempts, stale tokens, failed-case review, invalid/LIVE/foreign-event filtering, environment gates and anon EXECUTE denial.

## What is NOT built

There is deliberately **no success/PROCESSED transition**, no payment settlement evidence, no subscription or usage projection, no provider customer/invoice fetch, no webhook worker/queue, no hosted Stripe TEST acceptance, and no entitlement grant.

The previous MR-5E2D1 read-only preflight is for `RECEIVED` only. A future MR-5E2D3 processor must revalidate authenticated provider truth after receiving its fenced lease, define specific failure versus retry policies and add a separately owner-reviewed atomic terminal processing state and audit linkage. Never treat the returned CLAIMED lease as proof the invoice was paid, or grant access from a claimed event.

## Security review and acceptance gates

Check no changes to existing RLS or service_role privileges, no SECURITY DEFINER, no public EXECUTE, no production guard weakening, no raw PII, no payment status or lease token in public responses, and exact intended files only. No main merge or hosted migrations. Owner acceptance and hosted provider TEST acceptance are separate.

Preserve **30 Free Review Requests**, suppression/unsubscribe, onboarding, and existing trial/usage boundaries.
