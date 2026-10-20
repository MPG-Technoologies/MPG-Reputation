# MR-5I5 — Consolidated Billing Candidate / Mainline Owner Review Dossier

**Status: INTEGRATION REVIEW IN PROGRESS — NOT OWNER ACCEPTED, NOT APPROVED FOR MAIN MERGE, NOT MARKET READY.**  
**Change type: repository-only reviewer checkpoint over the existing combined billing branch. NO production activation.**

## 1. Remote-first evidence — 2026-10-20

- **Company OS** `techwithmpg/mpg-company-os` `main`: `03a48a34481f1952a31cd5c4fb980bc381432d8d`. Accepted governance still says **MR-5 PAUSED/INCOMPLETE** pending payment-provider/account, MR-6 accepted, MR-7 active and qualified US/Canada legal review incomplete. The owner's more recent instructions permit bounded **non-live** billing engineering, verification and preparation for integration; these do not authorize main merge, live billing, pilot, public marketing or commercial launch.
- **Product** `MPG-Technoologies/MPG-Reputation` `main`: `6b7ac073432921789314315ec5fc624a81d8f699`. The preserved accepted baseline has MR-5B persistence + partial MR-5C; unmerged billing features are in an extensive open PR stack. The latest stacked child is [MR-5I4L PR #66](https://github.com/MPG-Technoologies/MPG-Reputation/pull/66) HEAD `79d517bcd69829299e449cd99255eb786340dbd5`.
- This integration candidate `chatgpt/mr5i5-integrated-billing-review-20261020` begins at the exact tested PR #66 HEAD and targets `main` as a **DRAFT review PR only**. This dossier is the *only* additional file over that candidate. No code is rebuilt or branch force-pushed.
- Verified GitHub ancestry comparisons: tip vs `main` = **375 commits ahead / 0 behind** and **192 changed files** (182 additions, 10 modifications): **49 docs**, **62 product source**, **62 tests**, **17 SQL migrations**, **2 CI workflows**. Separate root billing branches PR #18 (Price catalog) and PR #19 (subscription projection) and MR-5I1 unification PR #52 are all ancestors of this tip (ahead-only, behind zero). The source PRs should **NOT be merged independently into main as a substitute** for reviewed cumulative integration. No duplicate branch-content merge is needed.
- Base `main` has **26** existing migrations; cumulative candidate has **43** migration files, adding precisely **17**. Migrations are additive within this candidate; no baseline migration was removed. Migration order is by existing timestamp filenames, with MR-5C and MR-5D/E interleaving as already tested on disposable PostgreSQL.

## 2. What the integrated candidate actually contains

| Workstream | Candidate evidence | What it is **NOT** |
| --- | --- | --- |
| Price/catalog | Provider-ready configurable plan and TEST Price binding contracts | Owner-approved USD/PHP prices or tax/refund terms |
| TEST billing account and subscription | Tenant-bound billing account, subscription status projection/lease/recovery | Real invoice paid, independent settlement or product paid entitlement |
| Client Billing | `/app/settings/billing` read-only TEST overview, safe proposed-price preview, LOCAL_SYNTHETIC Customer/Checkout/Portal actions | Public payment purchase UI or verified checkout success |
| Stripe webhook | Signed durable intake and dedicated TEST worker/recovery contracts with idempotency and event partition controls | Successful invoice financial finalizer, customer charge, or live subscriber upgrade |
| Candidate invoice evidence | TEST invoice fencing, read-only evidence adapter contract, synthetic invoice/proposed quote staging with hard `UNVERIFIED` / no paid access | Trusted frozen commercial contract, financial settlement ledger, approved card payment |
| MPG support billing | Per-org authorized audited read-only recovery/exception views | Platform-wide operational financial dashboard, refund or charge controls |
| Multi-organization safety | Billing and Usage pages fail closed on ambiguity; unwired pure selector and current-user server resolver | App-wide tenant switcher; shell and other pages still default to first membership |
| Trial | Existing **30 Free Review Requests** remains independent from unverified payment proposals | Paid conversion or entitlement reduction |

No external payment account is connected in this candidate. Some TEST Stripe actions require explicit credentials and their LOCAL_SYNTHETIC flags; without such credentials the actual provider end-to-end journey is **not validated**.

## 3. Integration and security review findings

### Confirmed by remote source inspection

- The candidate still contains an early **production/hosted/LIVE kill switch** for the internal Stripe TEST action route, `src/lib/billing/stripe-test-action-request.ts`: `NODE_ENV !== production`, no `VERCEL_ENV`, `ENABLE_LIVE_BILLING !== true`, explicit `ENABLE_STRIPE_TEST_BILLING_ACTIONS=true`, `MPG_STRIPE_TEST_BILLING_ACTION_TARGET=LOCAL_SYNTHETIC`, and disposable localhost Supabase URL; route checks the flag **before** creating the privileged client.
- Private invoice-financial-flow migration `20261019131000_mr5e2d2_fenced_invoice_processing.sql` only claims/fails a TEST invoice event with fenced leases; it does **not** implement a successful `PROCESSED/PAID` finalizer.
- MR-5I4F and MR-5I4G table checks hard-disable finality/access flags, retain RLS and revoke anon/authenticated table access; service_role is restricted to SELECT/INSERT in the synthetic candidate tables.
- Existing `Billing` role-scopes its TEST records to one OWNER/ADMIN organization; existing `Usage` refuses ambiguous multi-org or mismatched usage responses, and neither provides verified payment entitlement.
- An independent security review still needs to audit **all cumulative** auth/RLS/grant semantics, trusted webhook processing and migrations before owner acceptance. The spot inspection and automated regression suites are necessary but **not a proof** of complete safe integration.

### Hard blockers (P0) before calling **billing finished**

1. **Mainline acceptance**: this is a large candidate with 192 changed files, not a scoped one-feature merge. Review code + all 17 migrations, migration replay/idempotency, operator access, service-role usage, tenant tests and full PR diff. Require explicit owner authorization for merge; this draft PR is not that authorization.
2. **Provider dependency**: register/connect an eligible billing provider TEST account, real authenticated Price/checkout/portal/webhook/invoice verification. No genuine provider acceptance test or provider live key exists.
3. **Financial finality**: approved immutable terms, independently provider-authenticated payment evidence, unique immutable settled invoice ledger, transactional fencing/idempotency, reversals/refunds/disputes, and independent authorized entitlements are NOT implemented as successful production flow.
4. **Operational acceptance**: actual authenticated synthetic users must complete signup → onboarding/location/destination → Quick Complete → queued request/delivery guard → trial/usage → local TEST billing/account/portal return → MPG support inspection, using both desktop and mobile browsers. CI Vitest/PostgreSQL tests are not this browser/system simulation.
5. **External release gates**: owner commercial decision (prices, currencies, taxes, cancellations/refunds), hosted email-domain MR-1B-H, MR-7 qualified US/Canada legal review and final Terms/Privacy controls, controlled pilot approval and later marketing/launch gates. Nothing here advances Company Stage.

### Important P1 follow-up

- The app shell and business operations still use first membership. MR-5I4K/L produced **unwired** safe selectors, not a global switcher. Before implementation, an owner/security decision is required between org-scoped routes (recommended for two-tab correctness) and session preference. Do not permit a billing page to infer an active org from unsigned URL/cookie values.

## 4. Verification gates — integrated candidate against main

The committed feature HEAD `79d517bc` previously passed [Internal CI #39336149554](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39336149554): **771/771** application tests in 57 files, lint, typecheck, route typegen and synthetic Next.js build. [Isolated Synthetic E2E #39336149226](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39336149226): **219/219** disposable PostgreSQL, recovery, and operator tests with teardown. Those are code-feature CI results, **not provider/browser/hosted verification**.

The **main-base draft integration PR must run its own CI at the exact tip**, including migrations from a clean disposable database. Do not claim completed integration acceptance before those checks finish. Expected diff against the source tip: **one dossier file only**. Expected main-base PR cumulative diff: 193 files (192 inherited + this dossier), unchanged billing implementation code.

**Final owner-review boundary:** No `git merge`, `git add .`/`-A`, `main` push, branch deletion, production deploy, hosted Supabase migration, provider charge, live messaging, unverified compliance claim, real customer pilot, pricing approval, marketing/public launch or Company Stage change is authorized by this PR.

## 5. Recommended next safe execution

1. Run and review exact **main-base draft PR** synthetic CI, DB migrations and all 193 file diffs; flag any unexpected privilege or migration risk. No independent merge of old stacked PRs before a coherent integration strategy is accepted.
2. Produce the **owner acceptance decision packet**, separating (A) permission to integrate provider-OFF engineering into main from (B) permission for provider TEST acceptance and (C) separately gated production billing. These are distinct authorizations.
3. If approved, merge only by owner-controlled action after complete security review; then test an isolated local application with synthetic users and an authenticated browser. Any defects discovered must be fixed in bounded branches before acceptance.
4. Keep financial finality and real-provider changes blocked until owner/account/legal/commercial prerequisites are resolved. Continue non-payment roadmap where authorized.

## 6. Updated integrated checkpoint — 2026-10-21

**Status: READY FOR CONTINUED INTEGRATION / OWNER REVIEW; NOT OWNER ACCEPTED OR APPROVED FOR MAIN MERGE.** The historical October 20 checkpoint and its earlier counts above are retained as historical evidence, not current branch measurements.

- Company OS `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c` (accepted MPG-DEC-052 accelerated delivery, without changing release gates).
- Product `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823` (unchanged). Cumulative billing candidate `chatgpt/mr5i5-integrated-billing-review-20261020`: `d208a7312028464ccf4d6cf556ce78331bf66e55`, **444 ahead / 0 behind main**, **221 distinct changed files**, including **21 additive SQL migrations**. This candidate is not deployed or merged to `main`.
- Child [PR #70](https://github.com/MPG-Technoologies/MPG-Reputation/pull/70) integrated as `f7f55e416c06aef2cd95535ee7fdad5acb643c7e`: signed synthetic invoice review replay after failed webhook stays idempotent and non-authorizing. Exact-tip [Internal CI #222](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39512768285) and [Isolated E2E #214](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39512768290) **PASS**.
- Child [PR #71](https://github.com/MPG-Technoologies/MPG-Reputation/pull/71) integrated as `d208a7312028464ccf4d6cf556ce78331bf66e55`: the existing migrated private-table test matrix now also verifies service-role `UPDATE`/`DELETE` denial on six append-only invoice, proposal, exception and recovery review tables. Exact-tip [Internal CI #224](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39517378140) and [Isolated E2E #216](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39517378293) **PASS**; Vercel status **SUCCESS**.
- A review of the 21 candidate migration files' permission declarations found explicit RLS/grant controls on the added private tables and no new active `SECURITY DEFINER` execution path in these migrations; this is **targeted inspection, not a full independent database security audit**. Existing E2E covers ten private-table read boundaries and 24 service-only RPCs. Stage 1 review evidence stays synthetic, `UNVERIFIED`, `financial_finality=false`, and `access_authorized=false`.
- No live Stripe account, authenticated provider TEST invoice settlement, settled-invoice financial finalizer, owner-accepted commercial terms, actual paid entitlement, or authenticated mobile/desktop end-to-end browser acceptance has been demonstrated. Existing CI proves repository checks and disposable PostgreSQL behavior only.

### Distinct owner decisions (no implied authorization)

**A — Provider-OFF engineering integration to `main`: OPEN.** Requires independent full cumulative 221-file diff and 21-migration privilege/tenant/replay review, complete branch/PR reconciliation, authenticated synthetic client/admin browser journey, and explicit owner approval for main merge. No historical stacked billing branch should be independently merged into `main` as a shortcut.

**B — Provider TEST account and payment evidence acceptance: BLOCKED.** Requires an eligible connected provider account, authorized TEST-only credentials and environment, approved settlement/finality and refund/dispute handling contract, immutable accepted terms, and actual provider-authenticated invoice/checkout/charge tests. Current local mock signatures are not provider acceptance.

**C — Production paid billing / launch: NOT AUTHORIZED.** Requires separately accepted technical, commercial, legal/privacy, customer pilot, messaging, and activation gates. Neither decision A nor B grants permission for real charges, paid-access activation, deployment or market launch.

**Next engineering work permitted now:** continue provider-independent security, browser acceptance and independent cumulative diff review in bounded branches. Do not treat this checkpoint or successful synthetic CI as MR-5 milestone closure or OWNER ACCEPTED.
