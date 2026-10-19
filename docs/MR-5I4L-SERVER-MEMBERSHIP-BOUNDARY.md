# MR-5I4L — Current-Session Active Organization Read Boundary

**State: IN PROGRESS — CI and final diff pending. NOT OWNER ACCEPTED.**  
**Scope: repository-only, unwired, server-side membership resolution and synthetic tests. NOT global org selection implementation.**

## REMOTE — verified 2026-10-20

- Governance `techwithmpg/mpg-company-os` `main`: `03a48a34481f1952a31cd5c4fb980bc381432d8d`. The accepted Company OS still lists **MR-5 PAUSED / INCOMPLETE**, MR-6 accepted, MR-7 Trust/Security/Compliance active, MR-8 gated. Later owner messages authorize bounded **provider-independent** billing engineering, not production/live billing or final pricing.
- Product `MPG-Technoologies/MPG-Reputation` `main`: `6b7ac073432921789314315ec5fc624a81d8f699`. MR-5I4K [draft PR #65](https://github.com/MPG-Technoologies/MPG-Reputation/pull/65), unmerged `68b3d9cf977b7b7bf782bb0b4a120cc0bd518cc6`, passed **760/760 application** and **219/219 disposable database** tests. Product billing PRs #55–#65 remain stacked and unmerged; do NOT represent any of their changes as deployed or in main.
- Security and economic invariants: preserve existing user-scoped RLS, OWNER/ADMIN financial UI gates, independent per-action authorization and **30 Free Review Requests**. No real customer data, provider account, live messages, charges, paid access, hosted migrations or public prices.

## TASK

MR-5I4K created a **pure, unwired** `resolveProposedActiveOrganization` policy. It could refuse invalid/foreign/revoked choices **only when given trusted current membership rows**. MR-5I4L is the smallest safe follow-up: establish an actual **server-side source of those rows**, still without choosing route vs session preference or changing AppLayout.

## FINDINGS

- `src/lib/supabase/server.ts` already creates a cookie-backed **user** Supabase client; it is the appropriate privilege boundary. Do not use service-role access.
- Existing `src/app/app/layout.tsx` still chooses `memberships[0]` for AppShell, Quick Complete modal and notification context. Billing (MR-5I4I) and Usage & Trial (MR-5I4J) intentionally block multiple orgs until an approved context design is ready.
- Existing `organization_users` join to `organizations` supplies an organization ID and name; a missing or mismatched joined row must be rejected rather than guessed. No new table, cookie, shared cache or mutation is justified in this slice.
- The accepted **route-scoped vs session preference** design choice remains unresolved. MR-5I4K recommends route-scoped URLs for tab/history clarity, but recommendation is NOT owner acceptance.

## IMPLEMENTATION

- `src/lib/workspace/server-active-organization.ts` adds **unwired** `resolveCurrentServerOrganization(proposedOrganizationId?)`.
- Uses a fresh `createClient()` + `supabase.auth.getUser()` and refuses missing, anonymous or failed authentication **before** any membership query.
- Reads `organization_users` with `.eq('user_id', auth.user.id)`, selects only `organization_id, role, organizations(id, name)`, and immediately fails closed on query failure or missing rows. Never asks the browser to supply membership rows; never reads metadata or a service-role client.
- Rejects NULL, mismatched or missing joined organization IDs instead of building a synthetic tenant identity. Passes the re-read rows into the existing MR-5I4K pure selection policy. Proposed ID is an **untrusted hint**, not authorization. Foreign/stale/revoked hint never silently falls back to another business.
- Returns context only. **Every product action must continue independently verifying current authentication, role, tenant and RLS.** Selecting an organization never indicates invoice settlement, billing access, trial entitlement or payment authorization.
- New `test/domain/server-active-organization.test.ts` uses a mocked authenticated Supabase user client (no database/network) to check auth-before-read, exact user-ID filtered query, malformed/foreign joins, multi-org ambiguity and ordering, forged hints/non-disclosure, revocation across separate calls, duplicate memberships, and VIEWER role non-elevation. It asserts only the membership table is queried.
- One new line in `.github/workflows/internal-ci.yml` runs this file alongside the existing synthetic-domain allowlist.

**Unchanged:** No AppLayout, Quick Complete, UI switcher, Billing/Usage page, navigation, API action, RLS SQL, migration, provider SDK, payment flow, trial accounting or live customer system is wired to this helper. It is a prerequisite server trust boundary, not a functional end-to-end business switcher.

## SECURITY / ACCEPTANCE GATES

1. **Before wiring the selector:** Owner/security decision on explicit org-scoped routes vs session-bound server preference. Route-scoped is only the current recommendation. Define legacy URL behavior, new server component boundaries, session scope, two-tab transitions and cache keys, and per-action tenant/role revalidation.
2. **Browser and database proof:** Use authenticated **isolated synthetic** user sessions; role matrix OWNER/ADMIN/OPERATOR/VIEWER, multiple memberships, two tabs, A→B switch, stale/revoked account, wrong-tenant URL and deep link, modal identity, desktop/mobile, concurrent tab operations and support auditing. None is claimed executed by this slice.
3. **No new authorization power:** Membership resolution is a read helper. Explicitly reject use as a payment finalizer, as an RLS bypass or as an instruction to grant billing rights. Even a selected OWNER role must be checked again at mutation time.
4. **No hidden state:** No implicit fallthrough to first membership for multi-org, no unsigned org-ID cookie, editable metadata, or stale cached role. Do not introduce elevated account access just to make tests pass.
5. **No live release:** Provider TEST account/real API verification, accepted immutable payment terms, atomic financial finalizer and paid access remain separately gated. Production billing, messaging and pilot remain OFF.

## VERIFICATION REQUIRED

Run GitHub Internal CI lint, Next typegen, typecheck, full allowlisted app tests/build; isolated disposable PostgreSQL E2E regression; review complete diff for only **four files**: server-only helper, its new mock test, single CI entry, this handoff. Confirm no secrets, no production guard relaxation, no new route or migration. This slice cannot be called ENGINEERING COMPLETE until those checks actually pass.

**NEXT (owner architecture decision required):** If route-scoped context is accepted, implement an isolated organization-scoped server/layout first slice, then test the app-wide context (AppShell, Quick Complete, Billing, Usage, actions and cache boundaries) against disposable multi-org users **before** any main merge. If not yet accepted, continue other provider-independent work; do not silently rewire global auth/navigation. Full stacked PR diff, migration order and owner-controlled main merge remain an independent integration gate.
