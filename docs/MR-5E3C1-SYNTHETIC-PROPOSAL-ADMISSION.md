# MR-5E3C1 — Local Synthetic Subscription Proposal Admission

**Status: IN PROGRESS** until final GitHub CI and diff review.

## Remote baseline and governance

- Product `main`: `6b7ac073432921789314315ec5fc624a81d8f699` (unchanged).
- Company OS `main`: `03a48a34481f1952a31cd5c4fb980bc381432d8d`. MR-5 remains PAUSED/INCOMPLETE in accepted governance; latest owner explicitly authorizes continued bounded non-live engineering.
- Stacked base: verified MR-5E3B proposal ledger `d7ca8f2f6627ee635dd28df400d715acf29897f9` on PR #45, not merged.
- The owner has **no Stripe or other payment provider API** yet. Connect and test that provider later. No real charges, hosted migrations, paid activation, pricing freeze or live messaging.

## Existing evidence

MR-5E3A has pure subscription lifecycle **simulation**. MR-5E3B added a service-role-only, TEST-only, SYNTHETIC-only private `billing_paid_entitlement_proposals` ledger: `verification_status = UNVERIFIED` and `access_authorized = false` are hard DB constraints, with event/type/tenant checks and unique event recording. MR-4 `organization_entitlements` and `consume_trial_entitlement` continue as the operational **30 Free Review Requests** trial authority. An existing `organization_subscriptions.normalized_status = ACTIVE` is not a paid-access grant.

## Objective — the smallest safe admission slice

`src/lib/billing/local-synthetic-proposal-admission.ts` stages **one** already-computed synthetic `PROPOSAL_ONLY` domain decision. It is default disabled, **LOCAL_SYNTHETIC-only** with an explicit opt-in flag, exact disposable loopback Supabase URL, nonproduction, no Vercel and live billing disabled.

When allowed, it reads the private subscription and exact webhook record and verifies:

- UUIDs, known action/candidate-status pair, TEST environment, candidate subscription and organization IDs, source event ID and fingerprint, and ISO source/period timestamps.
- The saved Stripe TEST subscription belongs to the claimed organization and matches the simulated provider subscription ID.
- The private webhook has the exact event ID, hash and received-at timestamp and is in a synthetic `PROCESSED` state, with the expected event type. A positive invoice action also requires an `in_` invoice reference.
- Records only `SYNTHETIC / UNVERIFIED / access_authorized=false`; no raw provider payload, PII, or new entitlement state.
- On an identical source event replay, return `ALREADY_RECORDED` after verifying the stored fields; a different candidate on the same event returns `REPLAY_CONFLICT`. The database's existing unique event constraint arbitrates concurrent duplicate inserts. It never UPSERTs or edits immutable proposals.

**Scope limitation:** Different event IDs proposing transitions for the same subscription are *not yet* atomically sequenced or resolved. This function does **not** authenticate financial evidence; callers can build synthetic proposals with fake proof markers in tests. The persisted `PROCESSED` marker here is test data, NOT proof the financial webhook processor exists. No actual provider records are fetched. This is an isolated synthetic harness, not permission to add a production worker, webhook handler, billing activation or product entitlement.

## Verification

- Run GitHub Internal CI (lint, route typegen, typecheck, synthetic unit suite, build).
- Run disposable PostgreSQL E2E including new admission tests: initial staging, identical and concurrent replay, conflicting replay, foreign subscription/event, wrong source state/type/fingerprint/timestamp, inactive flags, 30-request trial remains unchanged and no subscription mutation.
- Final diff/security review against PR #45 base, no leakage of credentials, provider network calls, grants, schema changes, production guard relaxation, real data, or `main` merge.

## Next slices (not implemented here)

A real event worker must obtain authentic provider TEST evidence; advance the fenced durable claim to a settled/processed terminal state with audit and recovery; atomically sequence *all* subscription events; implement a separate owner-approved authoritative paid entitlement and usage policy; and pass hosted Stripe TEST acceptance after credentials are provided. This admission harness cannot substitute for those gates.
