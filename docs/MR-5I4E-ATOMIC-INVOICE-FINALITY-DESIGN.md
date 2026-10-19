# MR-5I4E — Trusted Provider Evidence + Atomic Invoice Finality Design

**State: ENGINEERING COMPLETE / READY FOR OWNER REVIEW — NOT OWNER ACCEPTED. DESIGN-ONLY / NO FINANCIAL FINALITY IMPLEMENTATION.**

## 1. Authority and verified baseline — 2026-10-19

- Company governance: `techwithmpg/mpg-company-os`, `main` `03a48a34481f1952a31cd5c4fb980bc381432d8d`. Company Stage 1 remains active. Per `MPG-DEC-049/050/051`, MR-5 is **PAUSED / INCOMPLETE**, MR-6 owner accepted, MR-7 active, MR-8 gated. The Owner's subsequent instruction to continue the payment-provider-ready architecture without APIs permits narrowly bounded **non-live** design and synthetic work, not live financial activation.
- Product engineering: `MPG-Technoologies/MPG-Reputation`, `main` `6b7ac073432921789314315ec5fc624a81d8f699` remains unchanged. This PR stacks onto MR-5I4D PR #58 at `99d24cf4c8238bbf096432fba742587a90398f42`; MR-5I4A/#55, B/#56 and C/#57 also remain unmerged.
- Current proposed PHP prices are operator-configurable, not final commercial terms: ₱1,500/month and ₱1,000/year. **30 Free Review Requests**, suppression, unsubscribe and tenant isolation remain untouched.
- There is **no connected Stripe/payment provider account or verified real settlement**, no approved real-customer use, no live messaging, no pilot, no public launch and no production deployment.

## 2. Inspected existing implementation — preserve, do not reimplement

| Existing evidence | Current authority / gap |
| --- | --- |
| `billing_webhook_events` and MR-5C/E2C | Signature-checked minimal durable receipt, stored event ID, hash, invoice ID; **not** authenticated money received. Unique `(provider, environment, provider_event_id)`. |
| `claim_stripe_test_invoice_processing` and `fail_stripe_test_invoice_processing` (MR-5E2D2) | `service_role`-only TEST claim, token-fenced 2-minute lease, max 3 attempts; only `FAILED` can be written by this invoice-specific code. **No invoice success-finalization RPC**. |
| `organization_billing_accounts` (MR-5B/C) | Unique org+provider+environment and provider customer; restricted SELECT to tenant OWNER/ADMIN. |
| `organization_subscriptions` (MR-5B/C) | Exact account/tenant/environment composite FK; unique provider+environment+subscription ID; `ACTIVE` is a provider projection, **not** payment proof. |
| `BillingEvidenceReadPort` (MR-5E2D3) | Credential-free `readInvoice`; can return `EVIDENCE_ONLY` from fake data. **It carries no authenticated provider provenance**. |
| MR-5I4B/C | Synthetic identity correlation and sealed read-only local tenant/Price assembler; two reads cannot ensure SQL isolation or authenticated provider/payment provenance. |
| MR-5I4D | Pure synthetic non-authorizing review proposal; never writes `PROCESSED` or entitlements. |
| `billing_paid_entitlement_proposals` (MR-5E3B) | Synthetic-only appendable proposals, `verification_status = UNVERIFIED` and `access_authorized = false` CHECK constraints. NOT a settled invoice or payment entitlement. |

The existing invoice Event table does **not** persist an authoritative, immutable provider-invoice settlement record keyed by `(provider, environment, invoice_id)`. Existing event-ID uniqueness prevents duplicate event IDs but cannot prevent **different signed event IDs settling the same invoice twice**. The current plan/Price env mapping also does not establish immutable commercial terms for historical invoices. These are explicit blockers for a safe future settlement transaction.

## 3. Required trust boundaries

**A. Durable signed receipt:** HTTPS signature verification and replay/dedup at intake are necessary to prove received bytes, not settled funds. Keep `payload_hash`, exact provider event ID/invoice ID and TEST/LIVE isolation; never treat event metadata as tenant authorization or use arbitrary callback URLs.

**B. Authenticated provider read outside SQL:** Only a separately owner-approved server adapter using verified provider TEST credentials may retrieve the **current** invoice, linked payment/charge status, amount paid/due/remaining, refunds/disputes, Customer, Subscription, Price/line items and subscription status. It must verify environment, immutable identity binding and observed timestamp. Account/webhook metadata and client-supplied fields are never a source of tenant identity. No provider SDK, API key or Stripe test account is being activated by this design. Read-only `BillingEvidenceReadPort` remains non-authorizing; a future trusted adapter must establish *its own execution identity and provenance* independently.

**C. Durable frozen terms:** The future processor must compare against immutable Price/currency/amount/interval/subscription terms captured at the authorized checkout/commit, **not current configurable catalog values** or browser prices. Owner must separately approve provider-specific invoice-line/multiple-line, proration, coupon, tax, zero-payment, initial-trial, upgrade/downgrade and partial/refunded-payment policies. Any unsupported shape requires manual review.

**D. Single PostgreSQL reconciliation transaction:** Within one service-restricted `SECURITY INVOKER`-based, least-privilege reviewable transaction, lock/recheck durable tenant and event state and finalize *only after* a future trusted provider-authenticated evidence contract has been independently accepted. Database checks can make **local writes atomic** but cannot make a network read from Stripe and PostgreSQL a distributed atomic transaction. Bounded evidence freshness and rechecks reduce, but cannot eliminate, provider changes after retrieval. Refund/dispute handling and periodic reconciliation remain necessary.

**E. Entitlements remain separate:** Even future `PROCESSED` billing Event and immutable settlement ledger do not by themselves authorize product access. Keep MR-4 trial/usage rules unchanged; a later accepted, atomic tenant-entitlement policy must handle activation, expiration, grace, cancellation and reversal. No email/SMS activation is implied.

## 4. Proposed future transaction (PSEUDOCODE — NOT DEPLOYABLE SQL)

1. **Admission outside SQL:** explicit approved TEST-only worker identity and provider adapter; no browser, tenant OWNER, webhook HTTP handler or scheduler invokes finality directly. Require a valid leased invoice Event, signed payload reference and stored event hash, no LIVE or hosted mode without later authorization. Fetch authenticated *current* provider invoice/subscription/payment/refund/dispute facts and independently establish tenant identity. If missing, stale, disputed or ambiguous: report to manual review; do not advance to success.
2. **Begin one PostgreSQL transaction** using the minimal worker DB role. Lock rows in a **fixed order** to prevent deadlocks: exact `billing_webhook_events` by `(provider, TEST, provider_event_id)` **FOR UPDATE**, matching `organization_billing_accounts`, matching `organization_subscriptions`, then any authoritative invoice ledger key `(provider, TEST, provider_invoice_id)`. For a new ledger key, rely on a required UNIQUE constraint and atomic insert/ON CONFLICT recheck, not a nonexistent row lock.
3. **Refuse stale lease:** re-read after lock acquisition: status `PROCESSING`, exact unexpired token, attempts 1–3, received event hash and invoice ID unchanged, no previously processed timestamp/organization, exact TEST environment, allowed `invoice.paid` type, exact provider event identifier. `clock_timestamp()` after lock acquisition for expiration. Do not accept a mere TypeScript boolean claiming the lease is valid.
4. **Revalidate immutable business identity:** exact account org/customer, subscription org/account/provider/environment/ID, frozen Price, invoice ID, currency, amount and billing period. Conflict or missing frozen financial terms -> no success. Do not infer paid status from subscription `ACTIVE`.
5. **Enforce idempotency and order:** verify exact original event hash against immutable event identity, reject conflicting duplicates, and enforce **one settled invoice per `(provider, environment, invoice ID)`**, including a different Event ID for the same invoice. Support a no-op only where the prior settled invoice and event provenance match exactly. Event `created` timestamps are not serial numbers; ambiguous order and payment failures/refunds/disputes become manual-review cases, not automatic corrections. Protect against stale subscription versions with a separately reviewed monotonic provider-state/version rule.
6. **Durable financial evidence:** write a minimal append-only/audited provider provenance record (or reuse an accepted existing immutable ledger if one is found), with authoritative environment, invoice ID, event ID/hash, tenant/subscription binding, frozen Price/amount/period and evidence observation time, plus a non-PII audit reason. Never store raw Stripe event bodies, customer payment details, cards or unnecessary PII. Audit/evidence immutability must be enforced in SQL privileges, not in TypeScript convention.
7. **Finish all-or-nothing:** only after the prior checks and durable audit write succeeds may an owner-approved invoice-specific finalizer transition the Event to `PROCESSED` and set exact org/timestamp, clear the lease token, and return a **non-entitlement** result. Transaction rollback must leave both the audit record and event unchanged if any check/write fails. No direct call to the general subscription worker's `complete_stripe_webhook_processing` should bypass invoice checks.
8. **Post-transaction:** no paid access from this transition; a separately reviewed entitlement reconciler consumes qualified evidence under its own tenant, idempotency, replay/reversal and audit controls. Re-read current provider truth periodically for dispute/refund/reversal and handle exceptions explicitly.

The above is a design target, **not proof** that a provider connector, frozen terms, invoice ledger or finality SQL already exists. Do not copy these steps into a migration without separate approval and database threat modeling.

## 5. Non-negotiable failure and concurrency matrix for later isolated PostgreSQL testing

| Case | Future accepted behavior |
| --- | --- |
| Same signed Event delivered twice | Exact duplicate is idempotent; no second invoice entry or access grant |
| Different Event IDs for same Invoice | Unique invoice ledger prohibits double settlement; source mismatch => review |
| Same Event ID, different hash/invoice | Reject and audit tampering; never overwrite original receipt |
| Concurrent workers, same lease | Exactly one atomic result, other loses lease/gets no-op |
| Worker lease expires / replacement token issued | Old token cannot mutate or finalize, including after lock wait |
| Worker crashes between evidence and DB | No partial audit/event update; next authorized recovery uses fresh evidence |
| Unpaid, partial payment, missing provider, canceled subscription | Fail closed; no `PROCESSED` or entitlement |
| Refund, dispute, chargeback | No implied settled access; auditable reversal/manual review policy required |
| Stale or out-of-order webhook | Provider-current state wins over Event ordering guess; conflicting case held |
| Foreign tenant, Customer, Subscription, Price or environment | Reject before any financial commit |
| Multiple active subscriptions or invoice lines | Exact invoice-to-subscription mapping mandatory; ambiguous means review |
| Changed catalog price, tax, discount, proration | Compare *frozen contract*; no silent repricing or unsupported amount assumption |
| Duplicate payment/charge references across invoices | Require immutable payment reference uniqueness and accounting policy |
| Transaction deadlock, timeout or audit-write failure | Full rollback and bounded retry with lease fencing; never partially paid |
| Unauthenticated public/tenant API/RLS bypass attempt | No EXECUTE rights on privileged finalizer; no service-role to client |
| Event becomes `PROCESSED` without immutable ledger | Database-level invariant/test must reject, even if TypeScript misbehaves |
| Product entitlement enabled by invoice `PROCESSED` alone | Prohibited; separate accepted entitlement transaction required |

## 6. Required next owner/architecture decisions (NOT yet accepted)

1. **Provider scope:** Stripe or another actual payment API; credentials and test account availability are unresolved. No assumed account or fallback provider. Confirm whether the provider exposes reliable payment, settlement and dispute status to support the model.
2. **Accounting semantics:** Distinguish invoice `paid`, succeeded charge, captured funds, asynchronous settlement, pending transfers and refunds; choose exact supported invoice scenarios and how tax, discounts, FX and adjustments are handled. Current PHP prices are only drafts and U.S./Canada validation geography is accepted, not final currency policy.
3. **Frozen terms / invoice ledger:** Define minimal immutable storage, uniqueness constraints, privacy retention, limited grants and auditable ledger-to-event linkage; do not reuse synthetic `billing_paid_entitlement_proposals` as financial proof.
4. **Transaction isolation and evidence freshness:** Set provider read provenance, age/clock tolerance, lock order, idempotency, post-commit provider reconciliation frequency and disaster recovery. A signed source attestation cannot make remote and database state truly atomic.
5. **Processing errors and retries:** Distinguish provider `unavailable` from customer payment failure; decide bounded transient retry, expired claims, terminal manual review and operator recovery authorization.
6. **Next authorization gate:** Approve a **separate synthetic-only SQL proof-of-concept** (if needed) after design review. Any hosted/test-provider connection or LIVE financial finalizer remains separately gated.

## 7. MR-5I4E deliverable and verification scope

This slice adds **only this design document**, a credential-free repository regression test for the current *no-invoice-success* guard, and a single Internal CI allowlist entry. The test checks the current invoice-only SQL RPC names, restricted privileges and missing success-finalizer, existing TEST/LIVE identity isolation, pure MR-5I4D `PROPOSAL_ONLY` policy, and the synthetic proposal ledger's immutable `access_authorized = false` restriction. It is an architectural **tripwire, not a SQL security proof** and not provider evidence; independent SQL/RLS integration tests remain essential for any future implementation. No migration, database connection, service-role client, webhook change, provider calls, trial/entitlement mutation or production deployment.

**Verified acceptance evidence (October 19, 2026):**

- [Internal CI #39265189091](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39265189091) — **PASS**: lint, Next.js generated route types, TypeScript typecheck, **711/711 tests in 50 files** (including 6 new MR-5I4E nonactivation checks), and synthetic production build.
- [Isolated Synthetic E2E #39265189279](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39265189279) — **PASS**: **185/185** scoped disposable-PostgreSQL tests (25 files), **7/7** TEST recovery dispatch, **2/2** sealed operator, **4/4** signed local operator = **198/198 database-backed tests**, and complete disposable database teardown.
- Final scoped diff against parent PR #58: **three intended files only** — this design packet, `test/domain/mr5i4e-invoice-finality-nonactivation.test.ts`, and one Internal CI test allowlist line. No financial processing implementation, schema migration/RLS/grants, privileged client, provider connection/credential, API, billing activation, real-customer data, live messaging, hosted database change, production deployment or merge into main.
- Automated source-text checks are a **defense-in-depth tripwire only**; they do not prove all SQL privileges, settlement semantics or external API authenticity. No finality design or commercial payment is owner accepted from this engineering evidence.

The final handoff-only commit triggers a fresh GitHub CI run. Preserve the passing code and do not mark MR-5 complete.

**NEXT after accepted MR-5I4E:** MR-5I4F — validate an isolated SQL threat model and concrete immutable financial-evidence schema/transaction design *without executing successful financial finality*. Production/provider/test account activation and owner decisions remain prerequisites to real settlement.
