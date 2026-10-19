# MPG Reputation — MR-5D3D3A Recovery Review Intake

| Control | Value |
|---|---|
| Slice | MR-5D3D3A — append-only local TEST billing recovery review request |
| Base | MR-5D3D2 [PR #34](https://github.com/MPG-Technoologies/MPG-Reputation/pull/34), `eb879e03027db015c0f7529c7506f5362ef9016c` |
| Company OS main | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Governance | MR-5 PAUSED/INCOMPLETE in Company OS; ongoing bounded engineering per owner |
| Deployed TEST acceptance | OWNER-DEFERRED |
| Recovery mutation, live billing, launch | NOT AUTHORIZED |
| Engineering status | IN PROGRESS pending CI |

## Scope and existing evidence

The prior MR-5D3D1 diagnosis and MR-5D3D2 exact-ID Stripe provider inspection are deliberately read-only. They do **not** authorize resetting a reservation, replacing a Stripe Customer, expiring a Session, approving payments, granting entitlements or skipping webhook processing. An uncertain Stripe response might already have created a provider object.

This slice adds a **case intake**, not a support approval, case resolution, or provider recovery. There is no public API route, admin UI control, Stripe key, scheduler or live payment action.

## Implementation

- `supabase/migrations/20261019050000_mr5d3d3a_recovery_review_intake.sql` creates `stripe_test_billing_recovery_reviews` in the existing database, with only two case kinds: `CUSTOMER_SETUP` and `CHECKOUT`. Rows contain the organization UUID, minimal DB-derived reason code, `OPEN` state, requesting user UUID and timestamp. **No** Customer or Checkout provider IDs, credit-card details, amount, email, session URL, free-text notes or raw external error. Exactly **one OPEN case per (organization,kind)** via unique constraint.
- RLS is enabled; `PUBLIC`, `anon`, `authenticated` have no table access. Service role receives **SELECT and INSERT only**, never UPDATE or DELETE. Review rows are immutable within the supported application role.
- `request_stripe_test_billing_recovery_review` is the only authorized creation path: a `SECURITY INVOKER` RPC with empty search path and service-only EXECUTE. It checks an ACTIVE organization and actual OWNER/ADMIN membership and acquires an organization row lock to serialize concurrent case creation. It accepts only the signed-in user's UUID from a trusted server, org UUID and one of the two case kinds. **Reason and outcome come from database facts, not the caller.**
- A Customer case is warranted for aged unlinked attempts, an unlinked READY Customer, or a conflict between reservation Customer and authoritative organization Customer mapping. Checkout warrants an aged PREPARING attempt, expired reservation or expired saved Checkout Session **unless a non-ENDED TEST subscription projection is already present**. An ACTIVE projection is not payment evidence. No provider state is inferred.
- Responses are limited to `NOT_NEEDED`, `REQUESTED`, `ALREADY_REQUESTED`, `NOT_AUTHORIZED`, `INVALID_INPUT`. Repeat calls never create duplicate rows. No case identifier or protected data is returned.
- `src/lib/billing/stripe-test-recovery-review.ts` is a server-only wrapper: authenticates current Supabase JWT with `auth.getUser()`, checks actual RLS-scoped OWNER/ADMIN membership, invokes the narrow privileged RPC, and sanitizes results. It is default-disabled unless `ENABLE_STRIPE_TEST_RECOVERY_REVIEW=true`, `MPG_STRIPE_TEST_RECOVERY_REVIEW_TARGET=LOCAL_SYNTHETIC`, exact disposable local Supabase, no Vercel deployment, nonproduction and no live billing. It creates no privileged key by itself.
- Domain and disposable PostgreSQL tests verify deny-by-default, role/tenant isolation, DB-owned reason codes, one-winner concurrent deduplication, no reservation mutation, prohibition of review UPDATE/DELETE even for `service_role`, no user PII or Stripe network activity.

## Important boundary and open operating decisions

A **tenant OWNER/ADMIN request for review is not an MPG support decision**. An OPEN case does not confer any elevated MPG support or Stripe account privilege, and it does not mean a Checkout was charged or settled. A future internal support workflow requires its own **global MPG support authorization**, case-scoped read access, immutable actor-attributed investigation events, immutable evidence references (not raw customer PII), and a conflict-free owner-approved policy. Existing per-tenant roles are **not** suitable substitutes for a global billing-operator role.

Do not add a `RELEASE`, `RETRY_WITH_NEW_IDEMPOTENCY_KEY`, `OVERRIDE_PROVIDER_CUSTOMER`, `APPROVE_PAID`, `REFUND` or `CLOSE_APPROVED` command to this RPC. A future recovery decision must retrieve fresh provider truth and webinar/webhook/invoice evidence, check business-tenant mapping and state under locks, and create a separate auditable event. No automatic release can be inferred from `MATCHED_EXPIRED`, `COMPLETED_UNVERIFIED`, `NO_PROVIDER_ID` or a locally `ACTIVE` subscription.

Future work:
- **MR-5D3D3B:** independent MGM global support authority design, case review/read model, evidence and review-event policy (no destructive mutation until owner approval).
- **MR-5E:** verified payment evidence and paid-entitlement policy; preserve **30 Free Review Requests** and suppression controls.
- **MR-5F:** real hosted Stripe TEST acceptance, provider account configuration, operator runbook, renewal/failed-payment/cancellation/rollback and separately authorized deployment.

No main merge, production deploy, hosted migration, customer-data use, Stripe calls, real billing, messaging, final pricing, pilot, company-stage change or commercial launch. Verify synthetic app and disposable DB workflows before labeling this slice engineering complete.
