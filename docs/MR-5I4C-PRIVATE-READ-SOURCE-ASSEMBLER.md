# MR-5I4C — Sealed local TEST invoice read-source assembler

**State: ENGINEERING COMPLETE / READY FOR OWNER REVIEW — NOT OWNER ACCEPTED.**

## Verified remote baseline (October 19, 2026)

- Company OS `techwithmpg/mpg-company-os` main: `03a48a34481f1952a31cd5c4fb980bc381432d8d`; accepted governance still calls MR-5 PAUSED / INCOMPLETE because real payment provider/account setup and legal/commercial prerequisites are unresolved. Owner's later explicit instruction allows bounded **non-live** engineering without Stripe credentials.
- Product `MPG-Technoologies/MPG-Reputation` main: `6b7ac073432921789314315ec5fc624a81d8f699`, unchanged at inspection.
- Parent MR-5I4B: PR #56, branch `chatgpt/mr5i4b-invoice-projection-correlation`, HEAD `1362a2794bf53b2e0c44c1e852f38a04368a2c03`, stacked, DRAFT, unmerged. MR-5I4A parent PR #55 is also unmerged.
- No Stripe account, provider API credentials, verified external settlement, live charging, real-customer pilot, publication, production deployment or final commercial price decision.

## Source inventory and smallest safe implementation

The existing MR-5C signed webhook ingress saves minimal `billing_webhook_events`, including a provider invoice ID for supported invoice events. MR-5E2D2 has a separate fenced invoice lease path but does **not** finalize an invoice to paid. MR-5I4B already compares synthetic supplied invoice/account/subscription/provider snapshots, without accepting those DTOs as financial truth. The existing `BillingEvidenceReadPort` is an injectable read-only interface; there is no real provider adapter. Server-side price configuration uses `getConfiguredReputationBillingCatalog` and `resolveStripePriceBinding`; never accept browser-supplied amount or Price.

Add `src/lib/billing/stripe-test-private-invoice-read-assembler.ts`, imported only on the server, which:

1. Requires explicit `LOCAL_SYNTHETIC` flags, localhost disposable database URL, nonproduction Node/Vercel, disabled LIVE billing, and a separate 64-digit hexadecimal operator token compared using `timingSafeEqual`. No token/configuration: disabled; wrong token: denied **before any read**. This is a manually called internal operator function, **not** an HTTP endpoint, scheduler or authenticated customer role.
2. Fetches one existing TEST `invoice.paid` receipt by exact provider event ID from the service-role-only inbox; requires unchanged initial receipt status `RECEIVED`, no assigned organization, no processed timestamp or invoice processing lease/attempt history. A signed webhook is an event-receipt hint, **never** settlement proof.
3. Checks ACTIVE organization for explicitly supplied operator-scoped organization ID, exact associated TEST `organization_billing_accounts` Customer binding, and at most two matching ACTIVE subscriptions. If zero or multiple active records, fail closed. This prevents arbitrary browser-submitted org IDs from selecting another tenant's customer or subscription: this function has no browser entrypoint and returns no raw references, though the operator still must identify the intended org.
4. Selects exact Stripe TEST Price from server configuration and the configurable **internal proposed** PHP monthly/yearly catalog (currently ₱1,500/month and ₱1,000/year, **not commercial approval**). Missing provider Price returns `NOT_CONFIGURED`; mismatched persisted Price or invalid catalog is blocked, without silently inventing a Price.
5. Uses the existing MR-5I4B diagnostic and, **only if explicitly injected**, `BillingEvidenceReadPort` to compare paid-amount/interval/currency/Price, independently asserted Customer/Subscription identity, payment status, refunds/disputes, provider observation age and active period. In the present credential-free system, it returns `NOT_CONFIGURED`; in synthetic tests, a matching in-memory port returns **`SYNTHETIC_MATCH_ONLY`**, not financial truth.
6. Re-reads the same whitelisted inbox/account/subscription/organization fields and fails on changed snapshots. This catches some concurrent writes but **is not atomic**, does not hold a lease, and cannot guarantee transaction isolation or finality.

No database tables, RLS grants, schema or migrations; no privileged client creation; no raw PII exposure; no payment provider calls, writes, event `PROCESSED` transition, paid entitlement, trial consumption, 30 Free Review Requests reduction, live messaging, production deployment or main merge.

## Tests

The new `test/integration/stripe-test-private-invoice-read-assembler.test.ts` runs **only on disposable PostgreSQL** in `.github/workflows/isolated-synthetic-e2e.yml`. It covers default `NOT_CONFIGURED`, operator/production/hosted/LIVE gate, invalid IDs, tenant mismatch, missing receipt, replay/in-flight status, price/catalog invalidity, positive synthetic in-memory evidence, unpaid/disputed/stale/mismatched provider truth, event mutation during read, and two competing ACTIVE subscriptions.

The existing Internal CI workflow still verifies lint/typecheck/all non-DB domain suites/build; the disposable E2E workflow verifies migrations, RLS-aware DB fixtures and cross-chain regressions. Neither workflow sends provider requests or operates on hosted data.

## Known security and business gates

- Operator token prevents accidental unauthorized local calls; it is not a customer-auth mechanism and must never become a public route. Only a narrowly privileged local test client may read the private inbox; production elevated access is not authorized here.
- The operator-provided organization ID is an investigation scope, **not** provider-authenticated ownership. DB correlation plus a fake provider adapter is not sufficient for trusted payment evidence. If the provider is missing, `NOT_CONFIGURED` is expected. A real independently authenticated provider adapter and source-authorized event identity are later separate work.
- Two read snapshots do **not** give a transaction guarantee; later atomic provider verification/lease/fencing and event finalization require a separately reviewed policy. Invoice `RECEIVED` must not become `PROCESSED` or paid just because this inspection matched.
- No customer paid-access gate, invoice accounting finality, refund/dispute automation, live billing, Stripe TEST account activation, final pricing or commercial state is approved. MR-5 remains INCOMPLETE.

## Next bounded slice

**MR-5I4D:** Design the separate **fenced invoice processing/finality state machine** and source-authenticated read-adapter requirements. Before implementation of any `PROCESSED` success path, require exact event lease ownership, independently authenticated current provider Invoice/Subscription/Payment data, durable tenant linkage, controlled ordering/replay corrections and auditable policy. No real provider credentials or paid entitlement grants unless separately owner-authorized.

## Verification

The initial disposable Vitest run failed to resolve Next.js `server-only` in the Node test harness. Aligned with the repository's existing Vitest pattern by adding `vi.mock('server-only', () => ({}))` in **the test file only**, keeping the production import and server-only boundary. The next run exposed a newly introduced UUID regex typo (four groups instead of the standard five); fixed the source validator without reducing input constraints, then re-ran all checks.

- [Internal CI #39250597206](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39250597206): **PASS** — ESLint, Next.js route type generation, TypeScript typecheck, **691/691 synthetic application tests across 48 files**, synthetic production build.
- [Isolated Synthetic E2E #39250597204](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39250597204): **PASS** — **185/185** scoped disposable PostgreSQL tests in 25 files, including all **9/9 MR-5I4C read-assembler tests**; **7/7** recovery queue, **2/2** sealed operator, **4/4** signed local operator = **198/198 database-backed tests**, disposable database teardown successful.
- Final PR #57 diff against stacked parent PR #56: exactly **four intended files** — one new private read-only server-only module, one new disposable database test file, one CI allowlist line, and this handoff document. No authorization/RLS changes, schema/grants/migrations, real provider calls, payment finalization, production activation, charge or entitlement writes, hosted DB or merge into main.
- Synthetic test fixtures and fake port observations are deliberately non-authoritative and must not be labeled real payment evidence. Billing milestone MR-5 remains **INCOMPLETE**, MR-7 governance and MR-8 launch gates unaffected.
