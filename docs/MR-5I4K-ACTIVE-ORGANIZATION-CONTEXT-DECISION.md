# MR-5I4K — Application-Wide Active Organization Context: Security Decision Packet

**Status: ENGINEERING COMPLETE / READY FOR OWNER REVIEW — NOT OWNER ACCEPTED.**  
**Scope: domain policy proof + architecture / browser acceptance design. NO APPLICATION-WIDE SWITCHER IS ENABLED.**

## 1. Remote source-of-truth checkpoint (2026-10-20)

- Company governance `techwithmpg/mpg-company-os` `main` `03a48a34481f1952a31cd5c4fb980bc381432d8d`: Stage 1 remains active. MR-5 is formally **PAUSED / INCOMPLETE** pending external billing-provider/account dependency; MR-6 accepted; MR-7 Trust/Legal IN PROGRESS; MR-8 controlled pilot gated. The owner's subsequent `go on` instructions authorize bounded **provider-independent development** only, NOT financial activation, final pricing, legal approval or a merge.
- Product `MPG-Technoologies/MPG-Reputation` `main` `6b7ac073432921789314315ec5fc624a81d8f699` unchanged. Parent MR-5I4J PR #64 draft `acb7ede9cbd17bc38eb42f4b6ee1ce07c9e61d91`, all three checks passed: [747/747 app](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39329552128) and [219/219 disposable database](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39329551511). Billing PR #55–#64 stack remains unmerged and cannot be described as present in product `main`.
- Preserve **30 Free Review Requests** and all pre-existing review-request, suppression, unsubscribe, tenant/RLS, trial and provider-live gates.

## 2. Inspected architecture

| Component | Current membership context | Consequence |
| --- | --- | --- |
| `src/app/app/layout.tsx` | Authenticates, reads current `organization_users`, then sets `memberships[0]` | Arbitrary first membership drives AppShell org name/role, attention count, locations, destinations and Quick Complete modal |
| `src/components/ui/app-shell.tsx` | Displays orgName/role; navigation has no accepted active-org switcher | Cannot guarantee identity continuity across all sibling pages or tabs |
| `src/app/app/settings/billing/page.tsx` (MR-5I4I) | Refuses multiple organizations before TEST account/subscription read | Intentionally blocks finance display for multi-org users until a secure selector exists |
| `src/app/app/settings/usage/page.tsx` (MR-5I4J) | Refuses multiple organizations before usage read; denies wrong-org summary | Prevents first-membership ambiguity in usage/trial adjacent to Billing |
| `src/actions/usage.ts` | Independently checks authenticated membership before reads and OWNER/ADMIN before trial mutations | Important guard to preserve; changing view selection must not change mutation authority |
| MPG `/admin/organizations/[organizationId]/billing-recovery` and `subscription-exceptions` | Authorized, audited **read-only TEST** inspections of an explicit target | Must not inherit business-user active-org context; support grant remains independent |
| Billing TEST action endpoint | Independent authenticated org/role, origin/CSRF, localhost disposable guards | A selector cannot replace per-request billing action admission or authorize payments |

A UI-only dropdown, a query string, arbitrary localStorage/cookie, mutable user metadata or a cached `OWNER` assertion would not solve these issues and can create a mismatch between the shell, modal, page and server action. This is a context-coherence flaw, **not evidence of an exploitable RLS bypass**. No production incident was identified.

## 3. MR-5I4K implemented security contract

`src/domain/workspace/active-organization-policy.ts` adds `resolveProposedActiveOrganization(currentMemberships, proposedOrganizationId?)`.

- **Strict precondition:** the caller must independently authenticate a non-anonymous server user and read **current** membership rows **for exactly that user** through tenant-restricted database/RLS. No identity or membership may be inferred from the proposed ID. This pure resolver cannot establish authentication on its own.
- If there is one valid membership and no proposed ID, preserve the existing one-business default. If multiple memberships exist with no proposed choice, return `SELECTION_REQUIRED` with validated choices to an authenticated caller, not an arbitrary first membership.
- A proposed UUID is merely a hint. The resolver checks against the current membership set, returning `SELECTION_DENIED` for invalid, foreign or revoked IDs. **Never** fall back silently to the first membership when a stale choice is present.
- Malformed or duplicated source memberships reject all selection; no partial fallback to a different business. Normalize UUID case, keep recognized OWNER/ADMIN/OPERATOR/VIEWER roles from the database, and never elevate VIEWER merely because the choice succeeded.
- Denial results never return tenant identity or organization names. The policy contains no cookie, DB, token, navigation, payment, Stripe or entitlement code and is **not wired to any product route**.
- `test/domain/active-organization-policy.test.ts` asserts the pure future policy against single/multi-org, membership ordering, stale/revoked/foreign IDs, invalid hints, duplicated/malformed rows, name non-disclosure and role separation. It also asserts it remains **unwired** to the existing App Layout, Billing and Usage pages. One explicit Internal CI allowlist entry covers the suite.

This is **architecture evidence** for a later approved implementation, not a switcher delivered to customers. All existing fail-closed Billing and Usage safeguards remain unchanged.

## 4. Owner architecture decision required before wiring the selector

Two workable approaches have different consequences. Both MUST authorize every page/action via fresh server membership and never treat a stored organization choice as a permission.

| Decision path | Benefit | Risk / required mitigation |
| --- | --- | --- |
| **A. Explicit organization-scoped routes** (e.g. a future `/app/organizations/[organizationId]/...` segment) | Browser history, direct links and two tabs can represent distinct organizations; easier to reason about which tenant a route means | Requires broad Next route/nav/actions migration, cross-org redirect policy, caching/scope testing and owner-approved architecture change |
| **B. Session-bound server-side active-org preference** | Smaller URL migration; existing `/app/` structure can largely remain | Two tabs may race on the same preference; deep links/back navigation and stale sessions may display mismatched organizations; requires durable actor/session binding, server revalidation on every request, and deliberate tab-conflict policy |

**Suggested design for owner review:** Favor explicit organization-scoped route context for correctness across tabs and deep links, subject to a measured migration and App Router/RLS threat review. This is a recommendation, **not an accepted decision** or an authorization to replace existing routes. A hybrid that keeps legacy routes as safe redirects should be evaluated only after redirect-loop and stale-membership tests.

The exact preference/route schema, cross-tab behavior, session lifetime, URL migration, role-change detection, cache keys and cancellation/revocation UX remain **UNDECIDED**. Do not silently implement one based on a ChatGPT design proposal.

## 5. Required later end-to-end acceptance — evidence not yet collected

1. **Server admission:** real authenticated synthetic session; fresh `user.id` membership lookup, not editable metadata; reject anonymous, missing, revoked/expired (if modeled) and failed membership read. No service-role shortcuts.
2. **One active tenant across AppShell/modal and routes:** organization header, dashboard, review requests, customer lists, Quick Complete, locations, destinations, Billing, Usage and all actions use the **same revalidated organization**. Revoke/role-change between page and action must fail on action revalidation.
3. **Browser journeys:** single-org OWNER/ADMIN/OPERATOR/VIEWER; two-business mixed roles; switch A→B→A; direct link; back/forward; refresh; two tabs; stale preference; cross-tenant deep-link; mobile drawer/modal; keyboard/screen-reader labels; loading errors.
4. **Isolation proof:** issue forged org hint and unrelated ID; verify no data from another org is in HTML/server responses, query counts, modal props, route caches, or data prefetch. Keep current per-action RLS and support authorization/audit. Disallow cross-tenant invalid role transitions or incorrect trial reactivation.
5. **Payments stay off:** provider TEST portal/checkout and real subscription finality require independent credentials and owner gate; active org preference alone can never enable paid entitlement.
6. **Test environment:** one isolated disposable synthetic database and synthetic identities, plus an authorized runnable browser environment. The MR-5I4K suite is credential-free Vitest and is **not** a Playwright/browser execution report.

## 6. Merge / rollout gates

The unmerged MR-5 billing branch stack is a **large cumulative change**; verify the exact main diff and migration order before any owner-authorized merge. MR-5I4K itself changes only a pure unwired domain module, one test, an Internal CI allowlist line and this document. No UI, database migration/grant/RLS, provider account, real customer data, live API, billing finalizer, messaging, tenant role, deployed service, main branch, Company Stage or legal acceptance changes.

**NEXT — MR-5I4L:** after owner accepts an active-org context approach, implement the first **server-only membership resolver + isolated browser acceptance infrastructure** on another feature branch, retaining independent role/RLS checks; stage migration without touching hosted production. Owner decision is needed **before changing AppLayout/nav globally**. Alternative provider-independent work can continue without this decision. Commercial provider TEST/live integration remains blocked.

## 7. Verified test and diff evidence

- [Internal CI #39330758929](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39330758929): **PASS** lint, Next.js typegen, TypeScript, **760/760 application tests across 56 files** (13 new MR-5I4K domain cases) and synthetic Next.js build.
- [Isolated Synthetic E2E #39330758934](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39330758934): **PASS**, **206/206** scoped PostgreSQL tests, **7/7** retry queue, **2/2** sealed recovery operator, **4/4** signed operator = **219/219 database-backed tests**. Disposable Supabase stopped and removed.
- Reviewed full scoped diff against parent MR-5I4J PR #64: **exactly four files** — this architecture/decision packet, pure unwired domain policy, 13-case test and one Internal CI allowlist line. No routes/components/actions/global state, RLS/grants/schema, customer PII, provider SDK/secret, live billing, hosted migrations, entitlements, trial changes, messaging, production deployment or merge to main.
- The final documentation-only evidence commit triggers a fresh CI run. Neither real authenticated browser sessions nor app-wide tenant switching have been tested or enabled. **ENGINEERING COMPLETE does not mean OWNER ACCEPTED or product release approval.**
