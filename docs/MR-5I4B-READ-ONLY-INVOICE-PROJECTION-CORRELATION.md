# MR-5I4B — Read-only synthetic invoice / subscription projection correlation

**State: IN PROGRESS — CI and final diff review pending; NOT OWNER ACCEPTED.**

## Remote source of truth and scope

- Company OS main `03a48a34481f1952a31cd5c4fb980bc381432d8d`: MR-5 officially remains INCOMPLETE / PAUSED at the governed provider dependency; the Owner subsequently directed bounded **non-live** billing preparation.
- Product main `6b7ac073432921789314315ec5fc624a81d8f699`: unchanged.
- Parent MR-5I4A PR #55 `b853dbfa75765b9e33d0a18c808f0965bca80677` is unmerged, ENGINEERING COMPLETE / READY FOR OWNER REVIEW. Invoice.* events are reserved from MR-5C subscription recovery processing for MR-5E evidence handling.
- Stripe, payment-provider accounts/API credentials, hosted provider tests, LIVE billing, final pricing and customer charging remain **absent/not authorized**. Proposed configurable PHP plans remain ₱1,500 per month and ₱1,000 per year, **not final commercial pricing**.

## Reuse — no parallel billing infrastructure

Existing reusable paths include the signed MR-5C durable webhook inbox, MR-5E2C stored invoice references, MR-5E2D1 identity preflight, MR-5E2D2 private TEST invoice claims, MR-5E2D3 `BillingEvidenceReadPort` and `inspectProviderInvoiceEvidence`, and the tenant-bound `organization_billing_accounts` / `organization_subscriptions` projections. `ACTIVE` in the last table is an operational projection only; it is not proof of a payment or paid entitlement. The MR-5E3 paid-entitlement proposal ledger is deliberately not consumed or mutated here.

## Bounded change

Add `src/domain/billing/synthetic-invoice-projection-correlation.ts` as a **pure, read-only diagnostic** accepting caller-supplied snapshots of an existing durable invoice receipt, tenant billing account, normalized subscription projection and a server-derived expected invoice binding. No provider adapter is installed. It:

1. Refuses anything except explicitly enabled localhost/disposable-database `LOCAL_SYNTHETIC` TEST configuration. Production, hosted, Vercel, LIVE, or disabled operation returns `DISABLED`; LIVE references in an otherwise local test return `LIVE_GATED`.
2. Requires a valid `invoice.paid` durable receipt still `RECEIVED`, with a saved exact invoice reference, a syntactically valid event ID/payload hash, and no prematurely assigned organization/processed timestamp. A signed receipt remains receipt-only, not financial proof.
3. Compares **exactly** the expected organization, account, saved Customer, Subscription, Price, TEST environment and nonexpired local subscription period. Foreign tenant, conflicting invoice, unsupported event, not-yet-active or expired projection are blocked **before any adapter call**.
4. Returns `NOT_CONFIGURED` when the real provider is absent — the normal pre-API state. With an explicitly injected **synthetic test adapter**, delegates independent invoice amount/currency/interval/Price/payment/refund/dispute/freshness checks to the existing `inspectProviderInvoiceEvidence` port. It returns only `SYNTHETIC_MATCH_ONLY` or a bounded `BLOCKED` reason.
5. Never returns raw invoice objects, payment IDs, customer identifiers, a payment-settled flag, subscription mutation, a paid-entitlement grant or an instruction to consume trial usage.

The snapshots are NOT automatically authenticated merely because their fields match. In particular `SYNTHETIC_MATCH_ONLY` must **never** be consumed by API routes, entitlement policies, RLS functions or payment/financial finality logic. This module is not a trusted server-side financial assembler, not a payment-state machine and not an authorized live feature.

## Tests and review gates

The credential-free Internal CI allowlist includes `test/domain/synthetic-invoice-projection-correlation.test.ts`: no adapter, disabled guards, LIVE/hosted/production gate, invalid durable references, foreign tenant/customer/subscription/Price, not-paid/claimed invoice, expired projection, matching synthetic provider facts, and absent/unpaid/stale/refunded/disputed/unavailable provider evidence.

Require Internal CI lint, Next typegen, typecheck, the full allowlisted unit suites and synthetic build. The unchanged isolated PostgreSQL suite remains a separate stacked-PR regression check; no database schema/RLS/grants/jobs/routes/secret/provider SDK are changed by this slice. Inspect full diff and keep the branch unmerged.

## Important next work

**MR-5I4C (separate review):** Design a *trusted, local-only read assembler* that loads durable event, billing account, frozen Price and subscription projection from the existing private tables with explicit worker identity, tenant scope, event lease/fencing and change-during-read protections. It must source verified provider facts from an authenticated read adapter once credentials are available, and must reject stale events, replays, refunds/disputes and mismatched financial evidence. The current provider interface supports future injection but no verified provider integration exists. Only a later separately accepted atomic processing/finality and paid-entitlement policy may write `PROCESSED` or grant access. Preserve **30 Free Review Requests**, suppression/unsubscribe and all tenant boundaries.

No Company Stage/status change, production deploy, hosted migration, real charging, LIVE messaging, commercial release or merge into `main` is authorized by this work.
