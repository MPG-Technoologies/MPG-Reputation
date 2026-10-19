# MR-5E3C3B — Private Synthetic Subscription Exception Case Intake

**State: IN PROGRESS until scoped CI verification.**

## Source of truth

Company OS main `03a48a34481f1952a31cd5c4fb980bc381432d8d` remains authoritative, with MR-5 PAUSED/INCOMPLETE and MR-7 active. Bounded non-live billing engineering continues under the owner's explicit later instruction. Product main `6b7ac073432921789314315ec5fc624a81d8f699` is unchanged. Parent is verified, unmerged MR-5E3C3A PR #48 HEAD `4befbefb954ddb679b8abe4cb0642873c199aac1`.

**No Stripe/payment API keys exist. No hosted TEST acceptance, payment writes, entitlement grants, real customer data, live messaging, production deployment or main merge is authorized.**

## Existing architecture preserved

MR-5D3D3A already implements a locked-down, append-only `stripe_test_billing_recovery_reviews` table with customer-setup/checkout kinds, one case per organization/kind and server-owned reason generation. MR-5D3D3B uses MR-6 support-grant/inspection patterns. An individual subscription exception is **not** CUSTOMER_SETUP or CHECKOUT; reusing the same per-org/kind uniqueness would mix unrelated events and corrupt deduplication. Preserve that existing architecture and security posture without changing its table, RPC or MPG support permissions.

MR-5E3C3A emits ephemeral `REVIEW_REQUIRED` reasons for simulated subscription exceptions. It does not prove event history is complete or authenticate provider financial evidence.

## This bounded slice

A new private `billing_synthetic_subscription_exception_reviews` table records at most **one OPEN case per source webhook event**, with a reason allowlist limited to MR-5E3C3A review-needed codes. It uses the existing recovery-intake security model: RLS enabled, no anon/authenticated table grants, service_role SELECT/INSERT only, no UPDATE/DELETE, no public route, no new support privileges or operator approvals. Synthetic-only, TEST-only, UNVERIFIED-only and `access_authorized=false` are **database CHECK** invariants, not application promises.

A composite FK requires the exact tenant/provider/environment subscription; a service-only SECURITY INVOKER trigger checks the referenced webhook belongs to the same tenant and TEST provider environment. The webhook retains the original ON DELETE SET NULL organization-erasure behavior; case entries cascade on organization deletion. No provider IDs, raw payload, email, address, payment data or free-text notes are copied into the review table.

The default-disabled `requestLocalSyntheticSubscriptionExceptionReview` facade requires local loopback disposable Supabase, explicit synthetic opt-in, nonproduction, no Vercel and LIVE billing disabled. It only accepts a `REVIEW_REQUIRED` result whose synthetic flags are false/UNVERIFIED and matches saved private subscription+webhook IDs. It rejects unresolved/positive results, unexpected reasons and tenant/source mismatch. An exact case retry returns ALREADY_OPEN; a different reason against the same event is REVIEW_CONFLICT; concurrent duplicates are protected by the unique event constraint.

**The review reason comes from caller-supplied synthetic policy results and is NOT independently verified provider truth.** No browser route, operational review UI, case closure/decision flow, real support actor authorization, or durable MR-6 support audit was implemented. This is *staged synthetic review intake*, NOT an MPG support investigation already conducted. An OPEN case does not authorize refunds, retries, paid-access changes or charges.

## Verification and next gate

- Run Internal CI: lint, Next typegen, typecheck, 625+ synthetic app tests and build.
- Run disposable PostgreSQL E2E including private-case insert/dedup/conflict/cross-tenant/event guard and role grants, nonauthorizing flags, MR-4 unchanged **30 Free Review Requests** and organization erasure.
- Review final diff: exactly intended migration, typed DB, local-only facade, integration suite, test allowlist and handoff; no secrets, RLS/security weakening, live provider API, hosted database or production action.
- Next, inspect existing MR-6 support-grant/read model and add a separate, owner-gated **read-only** cross-surface support inspection, with immutable actor-attributed audit. Any actual resolution/closure and payment override remains out of scope until provider TEST evidence, support approval and financial authorization are decided.
