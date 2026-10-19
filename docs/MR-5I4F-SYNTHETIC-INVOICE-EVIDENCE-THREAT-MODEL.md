# MR-5I4F — Synthetic Invoice Evidence Schema and Transaction Threat Model

**Status: ENGINEERING COMPLETE / READY FOR OWNER REVIEW — NOT OWNER ACCEPTED.**

## Verified remote start — 2026-10-19

- Company OS: `techwithmpg/mpg-company-os` `main` `03a48a34481f1952a31cd5c4fb980bc381432d8d`. MR-5 formally PAUSED/INCOMPLETE pending provider dependency; MR-7 active, MR-8 gated. Owner's later instruction authorizes bounded **non-live** billing preparation, NOT financial activation.
- Product: `MPG-Technoologies/MPG-Reputation` `main` `6b7ac073432921789314315ec5fc624a81d8f699`. Parent MR-5I4E draft PR #59 `e73fbdf33f9507435fb30964b47e6523735a2f07`, unmerged. Prior PRs #55–#58 remain stacked and unmerged.
- No provider API credentials/test account, provider-verified charge, accepted final pricing, live billing, or permission to activate a pilot/production. Preserve tenant/RLS, messaging suppression and **30 Free Review Requests**.

## Existing evidence and design gap

- MR-5B/C already provides tenant-bound TEST billing accounts and subscriptions, private TEST webhook receipts and provider-environment uniqueness for Event/Subscription IDs.
- MR-5E2D2 has a service-only, TEST-only two-minute invoice claim lease with fenced **FAILED** terminal outcome. It has **no invoice PROCESSED success RPC**. MR-5I4B–E provide only synthetic read/claim/finality design proposals.
- MR-5E3B has `billing_paid_entitlement_proposals` with `UNVERIFIED` and hard-false `access_authorized`, not payment truth.
- One invoice may be mentioned by **different signed provider Event IDs**. Event-ID uniqueness alone cannot prevent two finalization attempts for the same invoice. Current mutable subscription projection/Price mapping is not an authenticated, immutable checkout contract.
- MR-5I4E requires frozen terms and an authoritative invoice settlement ledger **before** any successful financial finality. Since those policies, provider proof and ledger semantics are NOT accepted, this slice implements a narrower **UNVERIFIED synthetic evidence draft table** only. It must never be treated as an actual settlement ledger.

## Implementation — repository-only migration

`supabase/migrations/20261019170000_mr5i4f_synthetic_invoice_evidence_drafts.sql` adds `public.billing_synthetic_invoice_evidence_drafts`:

1. A private, **TEST-only** synthetic table containing only whitelisted event reference (invoice/Event/hash), exact organization, billing account and subscription row IDs, candidate Price/currency/amount/interval/period and recorded timestamp. It stores **no raw payment data, credentials, emails, customer card details or provider objects**.
2. `source_kind = SYNTHETIC`, `verification_status = UNVERIFIED`, `financial_finality = false` and `access_authorized = false` are enforced by SQL `CHECK` constraints. Current PHP candidate amount is a test hypothesis, **not accepted/frozen commercial terms**. Hardcoded PHP is TEST staging and is **not a production currency decision**.
3. Composite foreign keys preserve exact tenant/provider/environment account and subscription identity, reusing existing accepted uniqueness constraints. A `SECURITY INVOKER` insert trigger checks saved webhook Event ID, `invoice.paid` type, invoice ID, hash, TEST environment, receipt status and tenant assignment when present, plus current subscription's Price ID. An **unassigned** webhook organization remains a weak evidence hint, not proof of ownership.
4. `UNIQUE(provider, environment, provider_invoice_id)` limits staging to one draft per invoice even for different signed Event IDs; `UNIQUE(webhook_event_record_id)` prevents reusing the receipt in the table. This is **idempotency staging only**; no financial ledger, committed money or guarantee of future settlement.
5. Table RLS is enabled. PUBLIC/anon/authenticated/service_role rights are explicitly revoked; **service_role only** may `SELECT, INSERT` and execute the private validator; there is **no direct service_role UPDATE/DELETE**. No public/tenant policy is granted. The role and credentials remain server-only; no new service client, route, worker or API is introduced. Tenant FK erasure can cascade, preserving the existing webhook org SET NULL retention semantics.
6. The migration adds **no** invoice-finishing RPC, invoice `PROCESSED` update, subscription/entitlement grants, trial change, messaging, provider SDK/API, financial transaction or production activation. **Repository migration remains unapplied to hosted and production**; tested only on CI's disposable PostgreSQL.

`src/types/database.ts` describes the table with literal `UNVERIFIED`, `false`, TEST and SYNTHETIC types.

## Threat model — limits and future atomicity

| Threat | MR-5I4F enforcement | Gap before true financial settlement |
| --- | --- | --- |
| Two different Event IDs with same Invoice | Unique invoice staging key | Actual financial ledger and transaction must use its own authoritative UNIQUE key, with replay-safe correction |
| Event ID reuse/mismatched payload or invoice | Exact signed receipt source/hash/ID trigger | Provider event signature and provider truth are external; service-inserted fake row cannot be proof |
| Cross-tenant account/subscription references | Composite tenant/environment/provider FKs + trigger | Authenticated provider invoice Customer and subscription linkage to accepted tenant needed |
| An Event with `PROCESSED` but no provider payment | Staging rejects processed receipts; status hard `UNVERIFIED` | Future finalizer must recheck immutable proof in one SQL transaction; PROCESSED still not access |
| Price or interval spoofing | Price must match current TEST projection; interval/amount/time constrained | Existing projection is mutable; immutable owner-accepted checkout terms and provider Price/line shape necessary |
| Authorized tenant/anon reading draft | Private RLS, no grants/policies | Privileged worker must have least-privilege boundary; service_role never browser |
| Service-role mutation/deletion | Only SELECT+INSERT granted | Privileged DBA/migration owners can change schema; append-only here is **privilege-scoped**, not absolute |
| Refund/dispute and stale Stripe state | No result indicates settled money or authorized access | Future independently authenticated provider read, dispute/reversal policy and reconciliation |
| Tenant data deletion | Org FK cascade; webhook SET NULL unchanged | Retention/audit vs erasure requires qualified review and accepted final ledger policy |
| Concurrent insert | SQL UNIQUE key serializes same-invoice draft collision | Atomic event lock, lease, immutable audit and settlement ledger remain unimplemented |
| Cross-system network/DB race | No provider call/SQL finalizer exists | Provider HTTP read and DB commit cannot be distributed atomic; choose bounded freshness/reconciliation policy |

**Future invoice-finality transaction** (NOT implemented or approved): lock exact signed Event, ensure fresh fenced lease after row lock; lock matching tenant billing account and subscription in consistent order; verify independently authenticated provider current Invoice/Payment/Subscription/Price and immutable frozen accepted terms; atomically enforce authoritative settlement invoice UNIQUE key and immutable non-PII audit record; mark Event PROCESSED **only after** all checks and writes succeed, never alone; do not grant paid product access until separately approved entitlement reconciler. Handle refunds/disputes/duplicates/failed payments, provider stale observations and transaction rollback with accepted policies.

The staged synthetic draft row has **no authority** in the future finalizer and must not be promoted by renaming its status. A real ledger must be purpose-built after legal/commercial/accounting review.

## Verification requirements

- `test/integration/billing-synthetic-invoice-evidence-drafts.test.ts` covers valid hard-false staging, duplicate invoice with different event IDs, concurrent inserts, cross-tenant account/subscription mismatches, tampered receipt, unsupported event/processed state, wrong Price, malformed/hypothetical terms, forbidden client reads and writes, forbidden service-role update/delete, unchanged 30 Free Review Requests trial, tenant erasure cascade.
- `.github/workflows/isolated-synthetic-e2e.yml` adds that test to disposable local Supabase only. Migration is applied automatically in ephemeral CI but **NOT** hosted.
- Internal CI: lint/Next typegen/typecheck, all allowed no-DB unit tests and build; isolated database regressions verify RLS/privileges/semantics. No claim of pass before runs complete.
- Full diff review versus stacked MR-5I4E parent shows **exactly 5 intended files**: this handoff; one synthetic-only SQL migration; `src/types/database.ts`; one new 11-case disposable DB integration test; one CI test allowlist line. No credentials, live integration or `main` merge.
- First disposable CI [run #39269681653](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39269681653) detected a **test-only** concurrency fixture race: two simultaneous insert requests reused the same generated Event ID and failed before invoice-key comparison. Corrected the test fixture to increment its Event sequence synchronously, without relaxing any migration/authorization constraint, in code commit `f63a81e6`.
- Verified after fix: [Internal CI #39270084887](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39270084887) **PASS** lint, Next typegen, TypeScript typecheck, **711/711 application tests in 50 files**, production compilation/build under synthetic configuration.
- Verified after fix: [Isolated Synthetic E2E #39270084884](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39270084884) **PASS**, **196/196** scoped disposable PostgreSQL tests in 26 files (including all **11/11** MR-5I4F database security/uniqueness tests), plus **7/7** retry queue, **2/2** sealed operator, **4/4** signed local operator = **209/209 total DB-backed tests**; disposable teardown PASS.
- This evidence cannot prove a provider payment, does not freeze accepted checkout prices, cannot authorize invoice finality or paid access, and must not be used as a commercial release gate. Final handoff-only commit will re-run CI.

## NEXT after owner review

MR-5I4G: define the **provider-independent invoice contract freeze and credible provider-adapter boundary** and verify that changing global catalog prices cannot rewrite pre-existing invoice candidate terms. Do not connect a real provider, finalize payments or turn on paid access unless separately authorized. Before any production financial ledger, obtain accounting, privacy-retention and acceptance decisions.
