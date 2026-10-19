# MR-5I2 — Signed synthetic webhook-to-projection acceptance

**State: IN PROGRESS until combined CI passes.**

## Remote source of truth
- Company OS main: `03a48a34481f1952a31cd5c4fb980bc381432d8d`. MR-5 INCOMPLETE; MR-7 owner-approved security milestone and owner-approved bounded nonlive billing preparation.
- Product main: `6b7ac073432921789314315ec5fc624a81d8f699`, unchanged.
- Parent MR-5I1 verified, unmerged branch HEAD `856cb71b07067c39167a7669b09b8378568d7e25` (PR #52). Both formerly separate billing chains already share one tested tree.
- No Stripe/provider credentials or hosted Supabase environment is available for billing provider TEST acceptance. No live charging or paid entitlement activation authorized.

## Objective
Prove one **synthetic TEST HTTP webhook to subscription projection** crossing the real application boundaries and disposable PostgreSQL, *not* merely separate component-level tests.

## Implementation: test-only scope
- New `test/integration/stripe-signed-synthetic-worker-journey.test.ts` calls the **real Next.js Stripe POST route** with raw request bytes and a locally generated Stripe-signature test header using only fixture secrets.
- Route verifies the signature and commits a durable TEST event into the existing private webhook inbox. A separately invoked, existing MR-5C worker fetches the event and current Subscription using explicit **in-memory fake provider retrievers**, obtains a SQL-fenced event lease and subscription mutex, and atomically commits provider subscription projection plus event status.
- Replayed identical signed events are acknowledged as duplicates and do not change the subscription; a different signed payload for the same Event ID returns a conflict. Invalid signatures are rejected; LIVE events are denied before persistence.
- A delayed synthetic event uses the retriever's *current* `past_due` status instead of untrusted event metadata, yielding the existing `SUSPENDED` subscription projection; unknown provider customers cannot obtain tenant correlation or mark the event PROCESSED.
- A synthetic **ACTIVE subscription row is NOT a paid entitlement**. Every case checks that the existing 30 Free Review Requests trial and private paid-entitlement proposal ledger remain unchanged.
- No application source, SQL migration, RLS/auth changes, webhook route wiring, worker scheduler, provider network calls, credentials, live payments, real customers or production changes. Only tests, CI allowlist and this handoff.

## Important limitations
This harness uses real **local signature verification** and real **local PostgreSQL**, but a **fake provider API**. The Stripe Event is not independently fetched from Stripe; its corresponding in-memory retriever and the current Subscription are deliberately simulated. This is **not externally authenticated payment evidence**, invoice settlement, complete paid billing, hosted TEST or commercial launch. The webhook HTTP route does **not** automatically invoke or schedule the reconciliation worker; test code calls it explicitly after intake.

## Verification required
Run Internal CI (lint, typecheck, 681+ application tests, build), isolated PostgreSQL CI (original 179+ suites and new signed synthetic route-to-worker test), cleanup and scoped diff review. Mark READY FOR OWNER REVIEW only after green final CI. No `main` merge.

## Next gated work
Provider-independent follow-up: a bounded **server-only local synthetic recovery dispatcher** or callable acceptance harness to bridge inbox event IDs to the already fenced worker without activating hosted scheduler or public worker endpoint. Separate TEST provider credentials/financial evidence must be introduced only when supplied and expressly authorized. Full provider financial truth + owner-approved atomic paid entitlement and usage policy remain future acceptance gates.
