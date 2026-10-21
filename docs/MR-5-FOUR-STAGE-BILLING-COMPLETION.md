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

## Batch 1 second bounded slice — read-only invoice evidence chain

The existing signed local invoice journey reads six **real disposable PostgreSQL records**:
the tenant's saved checkout quote, exact checkout reservation, billing account,
subscription projection, private synthetic invoice draft, and signed receipt.
`inspectSyntheticInvoiceEvidenceChain` validates record IDs, account/tenant/
provider/environment, Price, existing checkout session shape, subscription and
receipt event ID/hash/invoice and invoice event status. It refuses altered sources,
foreign tenants, non-READY checkout, processed/failed receipts, unknown session
IDs and missing sources.

**Even a six-record match returns only `SYNTHETIC_CHAIN_ONLY`**, with
`paymentAuthorized=false`, `financialFinality=false` and
`accessAuthorized=false`. Crucially, neither matching local amount nor event
signature proves that an actual Stripe invoice belongs to that checkout session.
**An accepted provider-authenticated invoice → checkout → subscription/Price
association is still missing and must never be inferred.** No hosted database,
provider credentials, financial SQL migration, production call or live entitlement
is included.

### Settlement contract sign-off packet (owner decisions still OPEN)

| Decision | Default fail-closed engineering posture |
|---|---|
| Exact money event | Require approved independent provider payment/charge evidence; signed invoice webhook and subscription ACTIVE are not enough |
| Invoice/checkout link | Require authenticated provider references to exact intended checkout/session, Customer, Subscription and Price; local equality is insufficient |
| Frozen price authority | Require independently accepted immutable terms, currency and billing period; current configurable catalog and synthetic quotes are not contracts |
| Partial, zero, tax, discount, proration and multi-line invoices | Manual review until explicitly accepted and specified |
| Refund, dispute, chargeback, payment reversal | Manual review / no automatic entitlement extension until owner-approved state and clawback rules |
| Concurrency, retries, duplicate Event IDs or different Event IDs for same invoice | Single atomic DB invoice key and fenced transaction, independent verification and rollback proof before permission to mark successful |
| Audits, retention, PII and credential trust | Least-privilege service boundary, provenance timestamp and audit retention policy require review |

**Open owner decision before Stage 1 can actually finalize money:** provider TEST access, what constitutes settled/captured money, supported invoice shapes/tax/discount/proration/refund cases, frozen terms retention and evidence freshness, and recovery/reversal policy. These are separate from permission to organize and start Stage 1.

## Stage 1 — TEST invoice-success quarantine (security finding and remediation)

**Finding after chronological migration review:** MR-5C3A originally had
a generic TEST webhook finalizer that could process an invoice event; however,
**MR-5C3C1 already removed that legacy path** by excluding all `invoice.*`
events from both generic lease and completion RPCs. It also introduced
retry cooldown, age gates and exponential scheduling; those existing
protections must not be overwritten. The first candidate migration
accidentally copied older MR-5C3A functions, and disposable CI caught
that regression. The final candidate therefore **does NOT replace either
existing generic function**.

**Scoped candidate fix:** The repo-only migration
`20261020123000_mr5_stage1_invoice_completion_quarantine.sql` adds a
database-level defense against privileged `UPDATE` from an in-flight TEST
invoice to `PROCESSED` or `IGNORED`, even if a new code path bypasses
the existing generic queue exclusions. The existing invoice-specific
service-only claim/fail RPCs and later MR-5C3C1 cooldown/queue behavior
remain unchanged. Disposable tests assert forbidden terminal updates,
existing invoice-specific fail-only handling, generic invoice non-admission
and unrelated subscription-event completion. One legacy source-read
integration fixture now verifies that a fabricated invoice
`PROCESSED` transition is denied rather than requiring it to succeed.

**Scope limitation:** This patch does not retroactively invalidate historical
synthetic fixture rows seeded directly as `PROCESSED`, and does not yet ban
fresh privileged INSERT of terminal invoice rows. Before real financial
settlement, an owner-accepted immutable provider evidence and success
admission architecture must close INSERT bypasses, establish invoice
ledger uniqueness and transactional rollback, and define legitimate
`PROCESSED` transitions. No invoice finality success RPC exists in this
slice and none is authorized by the generic queue. No hosted/production
migration is approved.

## Stage 1 — conservative unlinked invoice INSERT admission (incremental)

The candidate `20261020124000_mr5_stage1_invoice_terminal_insert_quarantine.sql`
adds a service-side PostgreSQL `BEFORE INSERT` guard for Stripe TEST
`invoice.paid` / `invoice.payment_failed` events whose
`organization_id IS NULL` and whose initial state claims
`PROCESSED` or `IGNORED`. This mirrors normal signed incoming
webhook receipts, which must enter unlinked/RECEIVED and use fenced
evidence review. A failed INSERT is rolled back, with no event or
entitlement created.

A stricter blanket invoice terminal INSERT prohibition **failed 21
pre-existing database tests**, because earlier non-authorizing
lifecycle-proposal tests deliberately seed tenant-attributed, already
PROCESSED synthetic invoice records to exercise replay, ordering,
cross-tenant source binding and reviewer holds. No service-role
testing bypass, disable-trigger switch or removal of that established
coverage was accepted.

**Open financial admission gap:** a privileged actor can still
construct a tenant-attributed synthetic invoice with PROCESSED status;
this remains *untrusted*, not a proof of funds or a real paid
entitlement. Closure requires owner approval of the real
provider-attested atomic ledger/finalizer design and a reworked
historical-fixture strategy. Neither the original UPDATE trigger nor
this ingress INSERT guard is a complete settlement invariant.

## Stage 1 — atomic synthetic invoice reconciliation review ledger

A repo-only, service-role-restricted `billing_synthetic_invoice_reconciliation_reviews` table captures **review-required synthetic correlations**, never financial truth. A PostgreSQL INSERT trigger matches the persisted quote, invoice evidence draft, checkout reservation, signed event receipt, billing account and subscription projection for exact TEST org/account/Price/currency/amount/interval. A SECURITY INVOKER RPC `record_mr5_synthetic_invoice_review` inserts one immutable review row per provider TEST invoice using unique constraints and `ON CONFLICT DO NOTHING`, returning `REQUIRES_PROVIDER_ATTESTATION`, `ALREADY_RECORDED` or `REPLAY_CONFLICT`. No paid status, successful invoice finalizer, billing charge, real provider read or entitlement mutation exists. Hard-false SQL checks enforce `financial_finality=false` and `access_authorized=false`.

**This is not an accepted financial-settlement ledger.** It is a durable non-authorizing manual review staging record and still lacks a provider-authenticated invoice-to-checkout association and accepted frozen commercial contract. Synthetic review acceptance must never be used to interpret provider funds received or to promote paid access. This is a candidate migration for disposable CI only, not hosted deployment.

## Stage 1 — idempotent review lookup after webhook failure

The additive, **disposable-CI-only** migration
`20261020130000_mr5_stage1_stable_synthetic_review_replays.sql`
addresses a review-replay edge case: after a signed synthetic invoice receipt
transitions from `PROCESSING` to `FAILED`, the original INSERT trigger
correctly refuses *new* evidence, but previously the review RPC also retried
that INSERT before checking an existing immutable row. An exact replay could
therefore fail instead of returning `ALREADY_RECORDED`.

The updated service-only SECURITY INVOKER RPC first checks for the already
recorded provider/environment/invoice tuple and returns `ALREADY_RECORDED`
only for the exact saved quote and draft; a mismatched quote returns
`REPLAY_CONFLICT`. First-time submissions still pass the unchanged source
validation INSERT trigger; concurrent first admissions still use the existing
unique invoice key and `ON CONFLICT DO NOTHING`. Integration regression
coverage includes post-failure exact replay, conflicting replay and direct
failed-source INSERT rejection. **These outcomes remain non-authorizing;
financial_finality and access_authorized stay false.** No hosted migration,
provider request, successful settlement or paid entitlement is included.

