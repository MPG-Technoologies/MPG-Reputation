# MR-5I4J — Usage & Trial Tenant Context Consistency and Org-Selection Decision Gate

**State: ENGINEERING COMPLETE / READY FOR OWNER REVIEW — NOT OWNER ACCEPTED.**  
**Slice type: bounded fail-closed client page correction + isolated acceptance tests, NOT global organization switcher or real-payment activation.**

## 1. Latest remote source — 2026-10-20

- Governance `techwithmpg/mpg-company-os` `main` `03a48a34481f1952a31cd5c4fb980bc381432d8d`: MR-5 remains formally **PAUSED / INCOMPLETE** due to provider/account dependency, MR-7 trust/legal remains active, MR-8 and production charges gated. Owner has since directed *bounded non-live billing preparation*, not deployment, final pricing or full MR-5 acceptance.
- Product `MPG-Technoologies/MPG-Reputation` `main` `6b7ac073432921789314315ec5fc624a81d8f699` unchanged. Parent MR-5I4I `cc7f58159071904e011b6ee6d1759bbb6ff58dfc`, draft/unmerged PR #63, passed [Internal CI #39325590044](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39325590044) (**733/733 tests**) and [isolated database #39325590042](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39325590042) (**219/219 tests**). Billing PRs #55–#63 remain unmerged feature work; no hosted migration or payment provider TEST/live connection.
- Preserve **30 Free Review Requests**; no payment-entitlement coupling, live billing, live messaging, public pricing, pilot/launch or Company Stage change.

## 2. Important existing behavior

The app's shared `src/app/app/layout.tsx` picks `memberships[0]` and displays that business name/role. MR-5I4I intentionally changed only Billing to refuse multi-business membership before any TEST account/subscription reads. However `src/app/app/settings/usage/page.tsx` still separately picked `userOrgs?.[0]` and loaded `getOrganizationUsageSummary(orgId)` for that arbitrary membership. That same page rendered `UsageClient` even when `getOrganizationUsageSummary` failed, passing null data, and did not check its response's organization ID.

The usage server action already authenticates and verifies membership and database RLS; this is *not proof of tenant bypass*. But silently displaying whichever allowed business appears first and rendering an empty client as if it were confirmed is incorrect operational context. Billing links directly to Usage & Trial, so both customer financial-adjacent pages must be consistent.

## 3. Smallest safe implementation

1. Pure `src/domain/workspace/single-usage-membership.ts` classifier. Input is expected to come only from authenticated, RLS-restricted membership query. Distinguishes `UNAVAILABLE`, `NO_MEMBERSHIP`, `AMBIGUOUS_ORGANIZATION`, `INVALID_MEMBERSHIP`, and `SELECTED`. Accepts exactly one valid UUID and recognized role OWNER/ADMIN/OPERATOR/VIEWER; does not treat membership as authorization or invent a selected organization. Rejects ambiguity **before** returning any tenant ID.
2. `src/app/app/settings/usage/page.tsx` now rejects unauthenticated/anonymous sessions, query errors, multi-org and malformed membership **before loading usage**. It displays truthful, non-PII error notices rather than an arbitrary organization's usage. Single-org existing permissions remain intact for all four roles. It refuses mismatched or unsuccessful summary results, with no `UsageClient`/trial controls rendered when verification fails. Existing `getOrganizationUsageSummary` membership/RLS authorization and `startOrganizationTrialAction` OWNER/ADMIN guard remain unchanged.
3. Tests: `test/domain/usage-organization-context.test.ts` (7 policy cases) and `test/domain/usage-organization-page.test.ts` (7 actual server-rendered page tests, using synthetic mocked session/usage/organization data), verifying no usage request for multiple memberships, mixed roles, invalid/stale data, correct single-org display and no trial actions on mismatched/failed summary. Included in credential-free Internal CI allowlist.
4. No SQL migration, provider SDK/account, payment route, RLS/grant, trial economics adjustment, real customer data, production deployment or global app context refactor.

## 4. Shared active-organization UX — security/architecture review required before implementation

The product does **not** have a trustworthy shared active-organization selector. The general layout, other pages, modal provider and operational actions still select `memberships[0]`, and app-wide navigation has no single server-authoritative active org. Introducing a selector on Billing alone or trusting `?organizationId=`, localStorage, editable user metadata, or an unsigned cookie would risk displaying a business in the shell while reading another tenant's records.

A future separately accepted application-wide design must:

- Source the visible organization list from **current authenticated user + database/RLS membership**, with any selector choice revalidated server-side every request.
- Bind active org identity to the authenticated actor/session and a trustworthy server-side preference or validated route context. Browser inputs are hints, *never permission or payment authority*; never trust a stale cached role.
- Define a single authoritative org for AppShell, Quick Complete modal, Dashboard, Usage, Billing, settings, review requests, and API actions. Each action must independently verify membership and allowed role; unauthenticated, revoked, switched and two-tab states fail closed.
- Decide whether a persistent session preference, organization-scoped URL model, or another accepted server-bound strategy is appropriate. Cover org switch/revoke race, stale tabs, back/forward, direct links, cache isolation, RLS, mobile drawer and screen reader behavior.
- Prohibit enabling payments/paid entitlements solely from a selected org; provider financial authority remains completely independent.
- Include actual authenticated **isolated** browser acceptance with synthetic users and multiple organizations once an app-wide design is approved. Current Vitest server-rendered tests are not Playwright/browser proof, and no hosted/customer account was used.

## 5. Acceptance matrix and test evidence

| Scenario | Expected behavior in this MR-5I4J slice |
| --- | --- |
| Multi-org OWNER and VIEWER, in any order | Usage refuses to choose a tenant; no `getOrganizationUsageSummary` and no `UsageClient` |
| Multi-org same organization repeated | Still refuse ambiguity; no implicit order |
| Single OWNER, ADMIN, OPERATOR, VIEWER | Render usage only after valid org and matching successful summary |
| Missing or invalid membership/role, membership query error | Generic safe notice; no usage read |
| Unauthenticated/anonymous session | Redirect to login before membership query |
| Summary fetch failed, no data, or other-org result | No trial control render; no false successful usage display |
| Billing page for multi-org | Remains blocked by MR-5I4I before any invoice/account read |
| Admin scoped billing recovery and exceptions | Unchanged: read-only, support-grant/audit gated; no mutation |
| 30 Free Review Requests | Unchanged |
| Browser E2E/app-wide org switching/real Stripe TEST | Not done, separate gates |

**Verified CI — code commit `d5ea5fcd`:**

- [Internal CI #39329135431](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39329135431) **PASS**: ESLint, Next.js route type generation, TypeScript, **747/747 synthetic application tests across 55 files** (including 14 new Usage context/page cases), Next.js synthetic build.
- [Isolated Synthetic E2E #39329135351](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39329135351) **PASS**: **206/206** scoped PostgreSQL tests (27 files), **7/7** retry queue, **2/2** sealed operator, **4/4** signed operator = **219/219 database-backed tests** and disposable container teardown.
- First Internal CI run failed TypeScript on one *test fixture's* extra property; it was fixed by assigning a separate forged fixture value, preserving the strict domain signature. The actual server/page code and authorization controls were not weakened.
- Scoped diff compared with unmerged parent PR #63: **six intended files only** — new Usage context helper, updated Usage page, 7-case unit test, 7-case mocked server-render test, two Internal CI allowlist lines and this handoff. No migration, RLS/tenant privilege changes, user data, credentials, provider API, payment route, live billing, trial modification, entitlement grant, production deploy or merge to main.
- The final documentation-only checkpoint will trigger GitHub CI again; code and test logic are unchanged. **Engineering completion is not owner acceptance.**

**Verification required:** GitHub Internal CI lint/typegen/typecheck, all allowlisted synthetic app tests/build; isolated disposable PostgreSQL integration suite for regression. Full scoped diff review limited to one Usage page, pure resolver, two test files, CI allowlist and this handoff; no provider, real customer or production access. Only claim pass when GitHub jobs succeed.

**NEXT — MR-5I4K:** app-wide organization-selection design/owner security decision with migration-free proof and isolated synthetic browser acceptance plan. Before any merge to `main`, reconcile the complete unmerged billing PR stack and exact migration order with owner approval. Commercial provider TEST integration, actual financial settlement and launch remain blocked.
