# MPG Reputation — Four-Stage Billing Completion Delivery Plan

**State:** APPROVED TO ORGANIZE AND START PROVIDER-INDEPENDENT ENGINEERING. **Stage 1 IN PROGRESS.** No new commercial/pricing/financial policy has been accepted. MR-5 remains **PAUSED / INCOMPLETE** at milestone governance level pending real provider access and owner-controlled finality decisions.

**Latest remote baseline (2026-10-20):** Company OS `techwithmpg/mpg-company-os` `main` `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`, product `MPG-Technoologies/MPG-Reputation` `main` `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`. Cumulative billing engineering remains in **DRAFT PR #67**, branch `chatgpt/mr5i5-integrated-billing-review-20261020`; do not independently merge stacked billing PRs or merge to main without owner authorization.

## Delivery rules

Use four **outcome-based grouped engineering stages**, not four automatic approvals or four huge uncontrolled commits. Integrate existing code; do not restart. Within each stage use bounded commits, focused tests, complete CI/database checks at the integrated checkpoint, an independent security/diff review, and owner acceptance at appropriate gates. Keep Stripe TEST/LIVE, hosted DB, live messages, commercial pricing, actual customer data, charges, billing activation, deployment and main merge controlled separately.

### Stage 1 — Financial settlement integrity
**Goal:** A trustworthy, tenant-bound, immutable checkout-to-invoice evidence and single-invoice finality contract; no assumption that a signed webhook or `ACTIVE` subscription proves paid funds.

**Already engineered:** Durable signed webhook receipt and replay protection, TEST-only fenced invoice claim/failure, existing private synthetic quote snapshots and invoice evidence drafts, unique candidate invoice ID, and non-authorizing provider evidence inspection / finality-plan code.

**Current work:** Reconcile frozen candidate quote to candidate invoice attributes **without** upgrading either to payment authority. Real-provider attestation, frozen accepted terms, immutable financial ledger, event and invoice exact-ID transaction, settlement semantics, proration/discount/tax, payment references, dispute/refund and recovery decisions remain **unaccepted**.

**Done when:** Owner accepts the financial contract and provider attestation rules, independently verified provider state and immutable commercial terms support an atomic, unique invoice settlement ledger/transaction with full replay/concurrency/reversal tests. A non-activating synthetic-only partial check is NOT completion.

### Stage 2 — Paid subscription and entitlement lifecycle
**Goal:** Securely link accepted settled-invoice evidence (never projection status alone) to exactly-once tenant paid entitlements for first activation, monthly/yearly renewals, failed/late payments, cancellations, expiry, refunds and disputes.

**Already engineered:** Trial and 30 Free Review Requests, usage/suppression, subscription projections, immutable synthetic proposals and non-authorizing lifecycle plans.

**Done when:** Owner accepts grace/refund/cancellation policy, atomic SQL-backed tenant entitlement lifecycle with idempotency and reversal, and verified TEST synthetic cases. No provider connection or synthetic proposal may create a charge or paid access by itself.

### Stage 3 — End-to-end integration, customer/admin UX and security acceptance
**Goal:** Authenticated customer and MPG-admin billing/usage journey consistent across single/multiple organizations, keyboard/mobile layouts, tenant RLS, audits, operational recovery and navigation. Reconcile PR #67 cumulative migrations and separately overlapping PR #69, without blindly merging them.

**Already engineered:** TEST-only customer billing overview and sandbox operations, MPG-admin reviews, read-only business-scoped pages and synthetic Auth/RLS/database tests.

**Done when:** Independent full migration/security/diff review, role/tenant/PII tests, browser/multi-tab and mobile acceptance, backend/UI correctness with no false settled-payment message, and owner-reviewed integration PR. No main merge without explicit authorization.

### Stage 4 — Provider TEST connectivity and final release-readiness verification
**Goal:** Wire approved external payment provider TEST credentials, compare authenticated current invoice/charge/refund/dispute status, and exercise provider-assisted checkout, webhook, renewals, cancel, failed payments and dispute/reversal end-to-end. Confirm currency/merchant/geographic policies and legal/compliance boundaries.

**Dependency:** A real provider TEST account/API credentials and owner authorization. Do not invent or simulate actual provider acceptance.

**Done when:** Real TEST provider acceptance passes and owner marks billing engineering complete. Production billing, activation, launch and paid-customer onboarding require **separate** authorizations.

## Stage-gate snapshot

| Stage | State | Critical dependency |
|---|---|---|
| 1 — Invoice settlement integrity | IN PROGRESS (synthetic preparatory work) | Accepted financial finality and provider trust model |
| 2 — Paid entitlement lifecycle | NOT STARTED (existing proposals only) | Accepted Stage 1 contract and lifecycle policy |
| 3 — Integration/security/UI acceptance | IN PROGRESS (parallel groundwork) | Whole PR review + browser/tenant tests |
| 4 — Provider TEST validation | BLOCKED | Provider TEST credentials and approval |

## Batch 1 first bounded slice (this change)

Add a pure, untrusted-candidate comparison for saved private synthetic checkout quotes and synthetic invoice drafts. Require exact tenant/account/Price/currency/amount/interval plus hard-false finance and access status. Return `CONSISTENT_SYNTHETIC_ONLY` only; **no positive payment or entitlement authorization**. Add negative evidence tests and use it in existing disposable-db checkout-to-invoice acceptance. Does NOT create financial ledger, successful finalization RPC, DB migration, provider connector, real charge or trial mutation.

**Open owner decision before Stage 1 can actually finalize money:** provider TEST access, what constitutes settled/captured money, supported invoice shapes/tax/discount/proration/refund cases, frozen terms retention and evidence freshness, and recovery/reversal policy. These are separate from permission to organize and start Stage 1.
