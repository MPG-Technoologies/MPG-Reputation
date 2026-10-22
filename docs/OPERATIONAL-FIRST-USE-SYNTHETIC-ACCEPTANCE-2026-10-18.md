# MPG Reputation — Synthetic First-Use Operational Acceptance

| Item | Value |
|---|---|
| Date | 2026-10-18 |
| Product baseline | `MPG-Technoologies/MPG-Reputation` `main` `6b7ac073432921789314315ec5fc624a81d8f699` |
| Governance baseline | `techwithmpg/mpg-company-os` `main` `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Status | IN PROGRESS — synthetic first-use evidence; **not** browser, provider or real-client acceptance |
| Environment | GitHub Actions isolated disposable Supabase, console email; never hosted customer state |
| Scope | MPG client = paying subscribing business; end customer = recipient of that business's review request |

## 1. Journey and actual evidence

| MPG-client step | Code / automated evidence | Current evidence class | Still missing |
|---|---|---|---|
| 1. Open signup / sign in | `src/app/login/page.tsx`, `src/actions/auth.ts`; synthetic E2E provisions a test identity and uses Supabase sign-in | CODE PRESENT + synthetic API authentication | Browser signup, email confirmation, session persistence and recovery behavior **NOT VISUALLY ACCEPTED** |
| 2. Create a business and first location | `src/actions/onboarding.ts` redirects to setup, `create_org_with_owner_and_location` exercised in isolated `true-e2e.test.ts` | Synthetic DB-backed RPC | Complete browser form validation, onboarding error recovery, real user-perceived performance **NOT VISUALLY ACCEPTED** |
| 3. Save, test and confirm Google review link | Google guide from merged PR #11, exact tested/saved URL matcher from merged PR #12, RLS-protected manager action | CODE PRESENT; domain/SSR tests; E2E seeds a fixture already CONFIRMED | Test still bypasses the real save/test/confirm server-action UI; actual Google Business Profile and redirect target **NOT VISUALLY ACCEPTED** |
| 4. Start trial | `src/actions/usage.ts` calls `activate_organization_trial`; merged PR #13 renders next step by effective trial status. Synthetic E2E now asserts NOT_STARTED → ACTIVE via that same DB RPC and repeated activation idempotency | DB-backed procedure path, UI SSR assertions | Does **not** invoke the authenticated Next.js server action or click the trial button in a browser; no live billing |
| 5. Record a genuine completed service | `src/actions/quick-complete.ts`, `submit_quick_complete_atomic`, outbox, merged PR #14 factual receipt | Synthetic DB-backed chain and mocked SSR feedback | No verified browser form interaction, error/duplicate UI recovery or staff device acceptance |
| 6. Observe review-request pipeline and customer link | `true-e2e.test.ts` exercises dispatch, review eligibility, console provider, persisted request, simulated HTTP redirect and idempotent tracked click | Synthetic DB-backed chain | Console-provider SENT is not actual inbox delivery; no published Google review attribution or external Twilio/Resend acceptance |

**Evidence distinction:** The test is a synthetic server/database pipeline demonstration. It cannot establish that the paying business successfully registered in an actual browser, that Google accepted the link, that an email arrived in an external inbox, or that the business's end customer published a Google review.

## 2. This bounded test improvement

The original isolated E2E seeded `organization_entitlements` by calling `provision_organization_trial` and then directly updating the entitlement status and dates with elevated fixture access. That *bypassed* the product's normal trial-transition procedure, limiting confidence in the first-use sequence.

This slice removes that direct UPDATE and uses `activate_organization_trial` after provisioning instead. It asserts:

1. Provisioning leaves the trial `NOT_STARTED` and without a start timestamp.
2. Explicit activation moves the status to `ACTIVE` and sets both start/expiry timestamps.
3. Repeated activation returns `already_active` and does not reset or extend the original trial dates.
4. The existing isolated chain can still complete only with accepted synthetic inputs and `EMAIL_PROVIDER=console`.

This is verification only. It changes **no product implementation, migrations, RLS, provider credentials, tenant grants or pricing**. Service-role access belongs solely to the disposable test harness; client-facing authorization is a separate acceptance requirement.

## 3. Readiness verdict and next closure steps

- **SOURCE / SYNTHETIC READY:** server-side organization creation, confirmed destination fixture, explicit trial RPC, completion ingestion, outbound workflow simulation and tracked redirect.
- **NOT YET OPERATIONALLY ACCEPTED:** the end-to-end browser journey for an MPG subscribing business and its business staff; real external account email confirmation; destination interaction; actual inbox delivery; mobile view/accessibility; actual role provisioning.
- **GATED:** qualified US/Canada legal review, MR-1B-H sender-domain validation, MR-5 billing completion, MR-8 pilot authorization, live messaging, commercial launch.
- **OWNER-EXCLUDED:** Case B catastrophic privacy restore; do not implement it here.

**Recommended next safe acceptance slice:** a hermetic browser-driven test using fake clients and fake end customers. Test signup / login / organization form / Google-link save-test-confirm / Usage & Trial activation / Quick Complete receipt / dashboard with realistic success, failure and permission-negative cases. First audit the existing test tooling and decide how to isolate browser authentication and database state. Do not claim any test passed until actually run.

**Production note:** A GitHub `main` merge or synthetic build passing does not establish that a production deployment happened or authorize real customer delivery.
