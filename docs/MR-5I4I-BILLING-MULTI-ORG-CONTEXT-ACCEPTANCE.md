# MR-5I4I — Isolated Billing Multi-Organization Safety and Client/Admin Acceptance Checkpoint

**State: ENGINEERING COMPLETE / READY FOR OWNER REVIEW — NOT OWNER ACCEPTED.**  
**Scope: small billing-context safety improvement on the unmerged combined synthetic candidate.**

## Remote-first evidence (2026-10-20)

- Company OS main: `techwithmpg/mpg-company-os` `03a48a34481f1952a31cd5c4fb980bc381432d8d`. MR-5 remains formally **PAUSED/INCOMPLETE** and MR-7 is ACTIVE pending qualified US/Canada review; MR-8, launch, real billing and pilot remain gated. Owner subsequently requested provider-independent billing work. That is engineering permission, not real financial activation, final price approval, or Company Stage advance.
- Product main: `MPG-Technoologies/MPG-Reputation` `6b7ac073432921789314315ec5fc624a81d8f699` unchanged.
- Parent MR-5I4H draft PR #62 at `512be3194b369371eb8e52b840d068b8c4118bca` is verified (Internal CI [#39280208336](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39280208336) success and isolated E2E [#39280208529](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39280208529) success). MR-5I4A–G PRs #55–#61 remain unmerged. The last cumulative candidate was 343 commits ahead of main, 0 behind, with 175 touched files; do not imply those changes are in production/main.

## Concrete finding and decision

`src/app/app/layout.tsx` defaults to `memberships[0]` for its operational context. `src/app/app/settings/billing/page.tsx` independently used `memberships[0]` as well. There is **no existing explicit trusted organization-selection/switching mechanism** for that page. Authenticated users with multiple organization memberships could view billing for whichever record the DB returned first. Although RLS still scopes to authorized memberships, *silently choosing a financially sensitive organization's context is incorrect operational UX* and may mismatch the expected active business.

The smallest safe mitigation is **fail closed on ambiguous multi-org billing context** and keep the rest of the application layout untouched. Do not invent a browser-controlled organization ID, cookie trust, new global selector, new privileged roles or billing mutation. For exactly one authenticated, validated OWNER/ADMIN membership, retain the existing read-only TEST billing experience. The error state is explicit: multiple businesses detected; billing unavailable until a supported authenticated active-organization selector exists. This intentionally disables local synthetic billing actions for multiple-org users until the follow-up architectural UX slice.

## Implementation

1. `src/domain/billing/workspace-organization-selection.ts`: pure context classifier for the *authenticated RLS membership result* — empty, malformed, ambiguous, role-restricted or selected. It checks length **before** role/ID/name, returns no org IDs for ambiguous results, and only selects one valid OWNER/ADMIN membership. **Not an authorization substitute:** Supabase RLS and POST `user_has_role` guard remain authoritative.
2. `src/app/app/settings/billing/page.tsx`: after authenticated membership read and before any account/subscription lookup, explicitly refuses multi-org / invalid context, without revealing organization names or invoice IDs, and offers truthful support guidance. Existing one-member OWNER/ADMIN display, pricing preview suppression, local-only checkout action flags, signed provider gates, 30 Free Review Requests and role denial remain in place. No URL-supplied organization selector.
3. `test/domain/billing-workspace-organization-selection.test.ts`: 8 synthetic policy cases for ordering, multiple OWNER/ADMIN/VIEWER, malformed identity, empty membership, role and information minimization.
4. `test/domain/billing-workspace-organization-page.test.ts`: 7 mocked **server-rendered page** cases for multi-org denial/no billing-table reads/no tenant names, shuffled memberships, single VIEWER denial, invalid/read-error denial, single OWNER continuity, unauthenticated redirect and onboarding. These tests are **not browser E2E** and use no hosted DB/customer.
5. Update MR-5I4H source-level guard to reflect the new unambiguous selection contract and verify ambiguity is checked before billing data access. Add both new suites to the existing credential-free Internal CI explicit allowlist.

## Candidate integration / admin-client acceptance matrix

| Scenario | Acceptance expectation | This slice's evidence |
| --- | --- | --- |
| Single OWNER / ADMIN organization | TEST billing overview still permitted; no payment settlement claims | Pure and server-rendered mocked page tests |
| Two organizations, any order or mixed roles | No arbitrary org selected, no account/subscription read, no TEST action | Pure and server-rendered mocked page tests |
| Viewer/Operator | No billing data, link to Usage & Trial | Existing role branch + new tests |
| Missing/invalid memberships | Redirect only when genuinely none; fail closed on malformed/unavailable | Pure and mocked server-rendered page tests |
| Stripe TEST action | Auth+role+CSRF/origin and localhost-only guards remain | Existing MR-5D3C and MR-5I4H regression tests; unchanged |
| TEST checkout success/cancel | Display return without payment confirmation or paid access | Existing MR-5D3A tests; unchanged |
| Internal MPG billing recovery/exception views | Scoped to authorized support with audit before display; read-only | Existing MR-5D3D3B and MR-5I4H tests; unchanged |
| 30 Free Review Requests | Trial, billing and entitlement remain separate | Existing entitlement tests; unchanged |
| Full multi-org selector | **NOT IMPLEMENTED** — do not change app-wide context without architecture/security approval | Explicit remaining gap |
| Full desktop/mobile authenticated browser walk-through | **NOT RUN** — needs isolated running app, synthetic test users and permissible UI harness | Separate acceptance step |
| Authenticated provider TEST/real payment | **NOT RUN** — no provider account/API and commercial/owner gates | Deferred |

## Verified CI and scoped final review

- [Internal CI #39324446695](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39324446695): **PASS** ESLint, Next.js route typegen, TypeScript, **733/733 application tests across 53 files** (including 15 new MR-5I4I context/page tests), and synthetic Next.js production build.
- [Isolated Synthetic E2E #39324446755, successful rerun of final code SHA](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39324446755): **PASS** **206/206** scoped PostgreSQL tests (27 files), **7/7** retry/queue, **2/2** sealed operator, **4/4** signed local operator = **219/219 DB-backed tests**, with disposable database stop/erasure.
- Initial application CI detected one *test-only* mismatch in the single-owner mock render assertion (`Checkout not available yet` versus actual `Plan selection is not available yet`). Corrected the assertion without changing product logic. Both final-code CI checks passed.
- The disposable database suite was initially cancelled by the workflow concurrency policy when the test-only correction triggered a new PR run. The subsequently rerun **final commit** database job passed.
- Diff against stacked parent MR-5I4H PR #62: exactly **seven intended files**: one pure membership resolver, one guarded billing route, two new test files, one updated prior source guard, one CI allowlist and this handoff. No migrations, RLS/auth role relaxation, service secrets, provider SDK/account, real payments, entitlements, hosted database changes, production deployment or merge to main.
- GitHub's final documentation-only checkpoint may trigger a fresh CI run; code is unchanged. Engineering complete is **not** owner acceptance or approval for billing/pilot.

## Verification and remaining risks

Run GitHub Internal CI lint/Next typegen/typecheck, all allowlisted tests including page renderer, and build; isolated disposable PostgreSQL E2E for cumulative regression. Review exact diff (expected six files: helper, page, two new tests, updated MR-5I4H test, CI allowlist, plus this handoff = **seven** files) before declaring engineering complete. Existing code outside Billing retains first-membership selection; this should be addressed as an application-wide context architecture decision, not silently rewritten by a finance-page change. We have not run a live browser or done production provider integration.

No database migration, RLS, user permission, webhook, payment, credential, provider account, live billing, hosted Supabase, messaging, entitlements, owner price, deployment or `main` merge in this slice.

**NEXT — MR-5I4J:** owner-reviewed active-organization context UX design and isolated role-aware browser acceptance on the combined candidate; verify cross-tenant navigation and operator visibility without enabling payments. Consolidated billing PRs must undergo an owner-approved, comprehensive diff and migration-order acceptance before any merge into `main`. Real payment finality and legally accepted prices remain separately gated.
