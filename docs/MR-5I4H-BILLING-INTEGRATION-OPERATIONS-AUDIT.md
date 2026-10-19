# MR-5I4H — Billing Branch Integration and Operational Readiness Audit

**State: IN PROGRESS — CI verification and final scoped review pending; NOT OWNER ACCEPTED.**  
**Type: pre-integration audit + credential-free regression guard, NOT billing activation.**

## 1. Remote source and authority — 2026-10-19

- Company OS: `techwithmpg/mpg-company-os` `main` `03a48a34481f1952a31cd5c4fb980bc381432d8d`. Accepted `MPG-DEC-049/050/051` still characterize MR-5 as **PAUSED / INCOMPLETE** due to external provider/account dependency; MR-6 owner accepted; MR-7 trust/compliance is active, with separate US/Canada legal-review gate; MR-8 gated. Owner's later explicit decision to *continue provider-independent billing engineering and integration audit* authorizes only bounded non-live preparation, not an MR-5 acceptance reversal, production billing, or a main merge.
- Product: `MPG-Technoologies/MPG-Reputation` `main` `6b7ac073432921789314315ec5fc624a81d8f699`. Latest stacked MR-5I4G draft PR #61 head `d382ef89924fe6a9f616c27c10905ebd130da2f4`, based on MR-5I4F draft #60. Earlier MR-5I4A–E #55–#59 remain open/unmerged. This audit is stacked on #61, on its own `chatgpt/mr5i4h-billing-branch-readiness-audit` branch.
- GitHub compare `main...#61` returned **343 commits ahead / 0 behind, 175 changed files**. This measures the cumulative *feature branch candidate*, not a deployed baseline or a local working-tree merge. **Never represent these changes as already integrated into main.**
- Root PR #18 (price catalog) and #19 (subscription projection) are separately open against `main`. The earlier **MR-5I1** integration PR #52 combined the distinct MR-5C and MR-5D/E branch lines on a feature branch; its handoff documents a synthetic 681-test application and 179-test database checkpoint. Subsequent PRs #53–#61 add signed recovery, invoice evidence, data guards, checkout quote freezing. A merged *feature branch* is not a merged *main*.

## 2. Candidate client workflow — verified from code, not browser

| Step | Existing implementation | Readiness / gap |
| --- | --- | --- |
| Navigation | `src/app/app/nav.tsx` includes **Billing** -> `/app/settings/billing`; existing **Usage & Trial** remains separate | Present in the unmerged candidate, not current main |
| Customer entry/role | `src/app/app/settings/billing/page.tsx` authenticates user and reads `organization_users`, gates billing record reads to OWNER/ADMIN | No browser session / hosted user test in this slice; multi-organization **first membership** selection instead of explicit organization context is a UX/selection risk |
| Subscription status | RLS-scoped TEST `organization_billing_accounts` and `organization_subscriptions` read; `ui-state.ts` distinguishes unavailable, pending, active, grace, suspended, ended | `ACTIVE` is clearly marked provider TEST *projection*, not settled payment or paid product access |
| Pricing | Configurable server proposal, monthly/yearly preview only in nonproduction with `ENABLE_MR5D_BILLING_UI_PREVIEW=true` | Proposed ₱1,500/mo and ₱1,000/yr are NOT approved or published; pricing for US/Canada validation remains a separate commercial question |
| Local actions | `local-synthetic-actions.tsx` and POST `/api/internal/billing/test/action`: TEST Customer, Checkout, Portal | Disabled unless explicit LOCAL_SYNTHETIC flags, nonproduction environment, disposable DB; requires Stripe **TEST account credentials** for actual session creation; cannot be claimed end-to-end accepted without provider |
| Request admission | Action schema accepts only `action`, `organizationId`, and optional `planId`; user auth/organization gate, request origin/CSRF admission and rate limits | Never accept browser-supplied amount, Price, Customer, redirect or role; require local/hosted authorized end-to-end tests at appropriate gate |
| Checkout return | `/billing/checkout/success` and `/billing/checkout/cancel` require auth and explicitly refuse query `session_id` as payment evidence | Does not establish subscription or payment completion |
| Contract snapshot | MR-5I4G private TEST-only historical *proposed* quote snapshot per reservation | Historical candidate price does not establish final provider-attested, accepted commercial contract |

**Outstanding client operation:** real provider payment-method entry, invoice and receipt history, plan switch and cancellation through approved provider portal, visible transaction outcome reconciliation, accepted tax/discount/proration policies, true payment-based entitlement, multi-org active context, full authenticated desktop/mobile journey. No claim these are absent from all design work; they are **not provider-integrated or validated** at this checkpoint.

## 3. Candidate platform-owner / support workflow

| Surface | Evidence | Restriction / gap |
| --- | --- | --- |
| `/admin/organizations/[organizationId]` | Existing organization inspection and audit capability | Not a billing finance dashboard |
| `/admin/organizations/[organizationId]/billing-recovery` | `getSupportBillingRecoveryCases` reads scoped TEST recovery requests, audited by `recordSupportBillingRecoveryInspection` | LOCAL_SYNTHETIC only, authorized MPG support, readonly; no manual charging, link reset or recovery mutation |
| `/admin/organizations/[organizationId]/subscription-exceptions` | `getSupportSubscriptionExceptionCases` reads unverified, TEST-only exception cases, audited before display | LOCAL_SYNTHETIC only, authenticated MPG support; no settlement, grants, or case closure |
| OrganizationHeader | Conditionally renders the two support links under their gates | No general admin billing landing page, consolidated revenue/invoice ledger dashboard, settlement/refund workflow or financial reporting in inspected routes |

The platform-owner surface is appropriately cautious but **not yet a complete billing operations console**. Do not call the support read-only views a payment administration system.

## 4. Integration and release gate matrix

| Priority | Gap / evidence | Next safe action | Requires owner/external gate |
| --- | --- | --- | --- |
| P0 | Feature candidate is **343 ahead of main**, 175 touched files. Most billing PRs are stacked and unmerged | Produce a reproducible isolated integration candidate; independently review complete cumulative diff, migration order and PR lineage, then run combined synthetic checks. **No merge to main in this audit** | Owner approval required for merge to main |
| P0 | No approved real payment provider/account/API. Existing TEST session adapter expects TEST credentials | Keep real provider connection blocked. When available, independently verify TEST Price/checkout/portal/webhook and settlement under approved staging | External provider account + separately owner-authorized connection |
| P0 | No trusted financial finalizer/immutable *settled* ledger or verified entitlement activation | Review MR-5I4E schema/accounting transaction design; require frozen accepted terms, attested TEST provider evidence, atomic lease/idempotency proof, refund/dispute accounting, distinct product entitlement policy | Owner architecture/security/commercial review |
| P1 | Billing UI reads the first returned org membership | Audit app-wide active-organization context and select the intended active membership consistently; test multiple organizations without leaking data | No commercial gate for bounded UX research; changing established tenant context needs security review |
| P1 | Platform billing is limited to scoped recovery and subscription review, no platform-wide financial ledger UI | Design truthful operational dashboard *after* there is a financial ledger; current support views should remain read-only and audited | Accepted ledger + support-role policy before monetary operations |
| P1 | Client invoice history, cancellation/change and real recurring billing end-to-end not provider-tested | Preserve existing customer portal boundary; test monthly/yearly, cancel-at-period, payment failure, duplicate webhooks and invoice history in an approved TEST provider environment | Provider account, test credentials, approved testing |
| P1 | Full authenticated client and MPG-admin visual journeys not executed on integrated candidate | Use disposable synthetic users and guarded browser simulation on isolated candidate (desktop/mobile), screenshots and role tests; never infer UX from unit-test success | Owner-approved isolated test environment, no production customers |
| P1 | New synthetic MR-5I4F/G SQL migrations exist only in stacked PR/ephemeral CI | Run migration/lint and replay/rollback reviews on the exact consolidated candidate; **do not push to hosted** without specifically approved DB work | Test scope allowed; hosted migration scope needs separate acceptance |
| P2 | US/Canada launch currency, taxes, prices, invoice policy, retention and qualified legal review unresolved | Record decision package; no new advertised price, compliant claim, refund promise or commercial launch assertion | Owner commercial decision and qualified legal input |

There is **no reliable percent-complete measurement** from lines of code or test counts. Engineering foundation is extensive, but mainline integration, payment authority and operations are incomplete.

## 5. This MR-5I4H slice

Add `test/domain/mr5i4h-billing-surface-nonactivation.test.ts` as a credential-free **source-level pre-integration guard** and an Internal CI allowlist line. These checks pin:

1. Business Billing navigation; server session and OWNER/ADMIN scoped reads; separate **30 Free Review Requests** usage navigation.
2. Nonproduction-only pricing preview and disabled default checkout.
3. LOCAL_SYNTHETIC-only POST billing action admission **before** service-role client creation, and no payment fields/redirects in the client body.
4. Checkout return and signed webhook durable intake distinct from paid access.
5. Internal MPG recovery/exception support pages existing behind LOCAL_SYNTHETIC capability and auditable authorized reads.
6. No successful invoice finalizer and hard `UNVERIFIED` / false-authority bounds of the MR-5I4F/G staging tables.

These are textual regression tripwires, **NOT complete App Router UX tests, proof of RLS semantics, trusted provider settlement, security review or evidence the whole 343-commit candidate is merged**. Reuse the existing 711 application and 219 disposable DB checks for whole-candidate synthetic baseline; never claim any number unless its corresponding run actually finishes.

### Safety and git

The audit changes no TSX product routes, existing auth/RLS, grants, migrations, provider keys, sandbox/hosted database, pricing, webhook worker, live billing, messaging or entitled access. It creates one test, one CI allowlist entry, and this report. Work is isolated on feature branch; no main merge/production deployment.

## 6. Next bounded slice — MR-5I4I

**Isolated combined billing acceptance and UI smoke-plan implementation** on the feature-branch candidate: build a high-value synthetic multi-org client billing context and platform-support navigation test, verify branch/migration preflight in an isolated runtime, inspect combined full diff and provide an owner acceptance dossier. Only then request explicit owner approval for mainline integration. Real provider/financial finality stays blocked; no fake payment confirmations or live activation.
