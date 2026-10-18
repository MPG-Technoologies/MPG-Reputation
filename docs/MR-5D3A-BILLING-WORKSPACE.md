# MPG Reputation — MR-5D3A Billing Workspace and Safe Checkout Return Screens

| Control | State |
|---|---|
| Milestone | MR-5D3 — IN PROGRESS |
| Slice | MR-5D3A — billing overview and plan UI foundation |
| Base | MR-5D2 PR #27 commit `920eb0302b16f452b867795a831a075f7c16be77` |
| Company OS main (verified) | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Product main (verified) | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Checkout / hosted TEST | DEFERRED until an approved deployed-test window |
| LIVE billing, launch | NOT AUTHORIZED |
| Verification | SUCCESS: 507 application tests and 14 disposable database tests |

## What this adds

- `/app/settings/billing`: responsive Billing & Subscription workspace integrated with the EXISTING `PageShell`, `PageHeader`, `Panel`, shared `AppShell` navigation and `/app/settings/usage`. The business workspace is not duplicated.
- The Server Component loads its first active organization the same way as the existing app layout. It verifies the Supabase session, retrieves the authenticated user's organization membership, and **only OWNER or ADMIN** receives billing-record queries/content. VIEWER/OPERATOR receives a permission explanation and link to existing Usage & Trial instead. No organization, Stripe Customer or Stripe Price identifier comes from URL/query parameters.
- Only the user's **RLS-scoped, TEST-mode** `organization_billing_accounts` and `organization_subscriptions` records are read. Minimal data only (account existence, normalized status, current period end, scheduled cancellation). No raw PII/provider IDs in rendered UI. Query errors show an **unavailable** warning, never a fake 'no subscription'.
- A separate presentation-only `src/domain/billing/ui-state.ts` truthfully differentiates missing account, no subscription, PENDING, ACTIVE, GRACE, SUSPENDED, ENDED and data-unavailable outcomes. An ACTIVE *provider projection* is **not** confirmed payment and is **never** a paid entitlement.
- Interactive local proposal preview `BillingPlanPreview`: switches monthly/yearly plan display with correct amount intervals, without calling any API. It keeps selection accessible via `aria-pressed`, has visible pending action disabled, and explains that commercial terms are proposals.
- **Safety gate for proposed pricing**: `NODE_ENV !== 'production'` **and** `ENABLE_MR5D_BILLING_UI_PREVIEW=true`. In production no proposed amounts are shown even if this flag is set. To preview in developer mode only, set `ENABLE_MR5D_BILLING_UI_PREVIEW=true` in a local development environment. Proposed engineering values are **₱1,500/month, ₱1,000 total for the year**. No owner-approved public price is claimed.
- `/billing/checkout/success` and `/billing/checkout/cancel`: session-authenticated, non-entitling status pages matching the MR-5D2 configured return paths. They DO NOT trust `session_id` or a redirect from Stripe, and do NOT claim payment settlement. Return to `/app/settings/billing` for stored state.
- Existing `/app/settings/usage` continues to own **30 Free Review Requests** usage accounting. Trial/usage, RLS and workflow systems are untouched.

## Customer-account setup and subscription-management scope

This MR-5D3A page is read-only. Businesses without a provisioned TEST billing account are shown what is missing, rather than being asked for raw payment credentials. Since automatic Stripe Customer provisioning does **not** exist in MR-5D2, the preview does **not** expose a nonfunctioning "Create account" action. Secure provider customer provisioning and management portal remain separate MR-5D3B tasks.

The nav entry is present for all authenticated users, but the billing page itself does not expose account/subscription details without OWNER or ADMIN membership.

## Remaining MR-5D work and activation controls

1. MR-5D3B — business-safe Stripe TEST customer provisioning and portal session contract, including idempotent server-side organization/customer binding.
2. MR-5D3C — protected POST checkout invocation with CSRF/origin/rate limits, hardened per-org/user auth, no public service-role or provider key, error/pending feedback and account setup state; **do not activate billing** until owner approves actual hosted TEST integration.
3. MR-5E — verified-entitlement policy, separate from raw subscription status; preserve 30 Free Review Requests and suppression rules.
4. MR-5F — owner-deferred hosted provider TEST acceptance at approved real deployment and final commercial release gate.

No main merge, hosted schema change, production deploy, live charges, customer data, real messaging, entitlement changes, activated checkout or portal, Stripe provider call, automatic test scheduler, or price publication.

## Required checks

Lint, Next type generation, TypeScript, synthetic status tests, production build including App Router success/cancel routes, full eleven-file diff review and secrets/scope check. Existing disposable local Supabase E2E remains in the stacked PR #27; MR-5D3A adds no schema or DB mutations. Record actual CI outcome once complete.
