# MR-5I4D — Synthetic invoice finality policy and provider-authentication gate

**Status: ENGINEERING COMPLETE / READY FOR OWNER REVIEW — NOT OWNER ACCEPTED.**

## Latest remote state (2026-10-19)

- Company OS `techwithmpg/mpg-company-os` main `03a48a34481f1952a31cd5c4fb980bc381432d8d` states MR-5 PAUSED/INCOMPLETE, MR-7 active; the owner's subsequent explicit directive permits bounded NON-LIVE billing preparation, **not** real payments, final pricing, hosted Stripe testing or commercial activation.
- Product `MPG-Technoologies/MPG-Reputation` main `6b7ac073432921789314315ec5fc624a81d8f699` unchanged.
- Stacked parent MR-5I4C PR #57 at `18248de4a52828ade8df8951c6a00e292090e4b4` is ENGINEERING COMPLETE / READY FOR OWNER REVIEW, UNMERGED. MR-5I4B PR #56 and MR-5I4A PR #55 remain unmerged.
- This milestone stays **provider-ready without Stripe or any payment API account/credentials**; project design proposals for PHP pricing are NOT final commercial offers. Keep the **30 Free Review Requests** trial invariant.

## Existing systems inspected

- MR-5C signed Stripe webhook **durably receives** events but receipt is not payment proof. MR-5I4A prevents the subscription recovery worker from consuming `invoice.*` events incorrectly.
- MR-5E2C persists minimal signed event invoice ID. MR-5E2D2 `claim_stripe_test_invoice_processing` SQL grants a TEST-only 2-minute fenced lease (maximum 3 attempts), but the only terminal mutation `fail_stripe_test_invoice_processing` records a MANUAL-REVIEWABLE `FAILED`. There is intentionally **no invoice PROCESSED success function**.
- MR-5E2D3 defines `BillingEvidenceReadPort` with `NOT_CONFIGURED` absent provider and `EVIDENCE_ONLY` for synthetic fake data; neither supplies authenticated settlement or paid access.
- MR-5I4B pure invoice/tenant/projection correlation is synthetic-only; MR-5I4C sealed local assembler reads private tenant, subscription, saved Price and event data but is not transactional, provider-authenticated or event-lease-owned. It returns `NOT_CONFIGURED` without adapter and `SYNTHETIC_MATCH_ONLY` with matching synthetic data.
- MR-5E3A already models **subscription lifecycle proposals**, not invoice event finality. Do not copy its state engine, authorize paid access or assume any synthetic `PROCESSED` DTO authentic.

## This smallest safe slice

Add `src/domain/billing/synthetic-invoice-finality-plan.ts` as a **pure, deterministic, non-mutating, non-authorizing review proposal** before considering database financial finalization. It accepts strictly synthetic caller-supplied lease, event history, review-context and provider-evidence metadata. It:

1. Rejects HOSTED/LIVE mode, LIVE event/history, invalid org/subscription/invoice/event IDs, malformed hashes, timestamps and lease IDs.
2. Requires an in-flight `PROCESSING` TEST invoice with a nonexpired token-shaped lease, exact event and invoice ID, no prior processed timestamp/organization binding and attempt count 1–3. **Only the future SQL transaction**, never this function, can authenticate lease ownership.
3. Detects duplicate/replayed event IDs and conflicts in fingerprint, invoice identity and event type; treats already processed events as `NO_CHANGE`, and ambiguous/in-flight/failed duplicates as `REVIEW_REQUIRED`.
4. Rejects any other event for the same invoice until a deliberate correction/ordering policy exists. Rejects stale/equal-time subscription events for manual review. Stripe Event time is **not** monotonic provider-state authority.
5. Sends `invoice.payment_failed` to manual review. No automatic reversal/settlement/refund/renewal or grant is inferred.
6. Requires MR-5I4C `SYNTHETIC_MATCH_ONLY` and MR-5E2D3 `EVIDENCE_ONLY` only to produce `PROPOSAL_ONLY` plus `AUTHENTICATED_PROVIDER_AND_ATOMIC_FINALITY_REQUIRED`; **those synthetic outcomes do not prove provider provenance or payment**. `NOT_CONFIGURED` is the correct pre-API state.
7. Returns no raw provider IDs, token, tenant PII, receipt mutations, processed status, paid entitlement, charging decision or trial effect. Pure input history can be incomplete or forged, so **even a proposal is not finalization approval**.

`test/domain/synthetic-invoice-finality-plan.test.ts` is added to the credential-free Internal CI allowlist, exercising lease expiry and takeover, duplicate/replay conflicts, provider-unavailable, cancellation-proof gaps, delayed payment failures, out-of-order evidence, LIVE isolation, and the unchanged 30 Free Review Requests trial.

## Limits / precise next design gate

This module intentionally does **not** connect to provider APIs, production billing routes, hosted migrations, invoice mutation, refund/dispute accounting, signed webhook processor, scheduled worker, subscription projection writes, RLS functions or entitlement policy. No service-role access is created for convenience.

**MR-5I4E, separately gated:** Before any `PROCESSED` success transition can be implemented, design and review an authoritative **single PostgreSQL transaction** that locks the invoice event and relevant subscription/billing account rows, verifies an unexpired processing lease/fencing token and exact tenant and provider-event hash, enforces durable global provider ID idempotency and event ordering, independently sources current invoice+subscription+payment/refund/dispute states from authenticated provider reads, prevents stale corrections, writes minimized immutable audit/provenance evidence, and finalizes only after a verified accounting policy. Never treat untrusted proof flags, synthetic histories, event timestamps or Checkout success as finality. A provider connector and Stripe TEST credentials require a separate owner-gated integration stage; live payment activation and commercial pricing remain unauthorized.

## Verification

- Initial Internal CI found a syntax error in one new test assertion (missing closing parenthesis), fixed in the test file only at `c5935f45`. No production logic or gate was weakened. Follow-up CI is green.
- [Internal CI #39258557164](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39258557164): **PASS** — lint, Next.js route type generation, TypeScript typecheck, **705/705 synthetic application tests across 49 files** (including 14 new MR-5I4D cases), synthetic production build.
- [Isolated Synthetic E2E #39258557088](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39258557088): **PASS** — **185/185** scoped disposable PostgreSQL tests across 25 files, **7/7** recovery queue, **2/2** sealed operator, **4/4** signed local operator = **198/198 database-backed tests**; disposal/teardown PASS.
- Scoped PR #58 diff relative to MR-5I4C branch includes exactly four files: new pure `src/domain/billing/synthetic-invoice-finality-plan.ts`, new `test/domain/synthetic-invoice-finality-plan.test.ts`, one new Internal CI test allowlist line and this handoff. No database schema/RLS/grants; no credentials, runtime financial processing, checkout, entitlement writes, provider API, live billing, real-customer data, messaging, production deployment or merge to `main`.
- This is a **non-authorizing synthetic proposal policy**. It does not complete accounting finality, provider proof or settlement; MR-5 remains INCOMPLETE and separate owner review/financial/provider gates stand. Final handoff evidence commit is documentation-only and GitHub Actions will re-run for final HEAD.
