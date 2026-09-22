# MPG Reputation — MR-5 Billing Architecture

| Metadata | Value |
|---|---|
| Product | MPG Reputation |
| Milestone | MR-5 — Billing |
| Status | PAUSED AT SAFE ENGINEERING CHECKPOINT / EXTERNAL BILLING PROVIDER DEPENDENCY; INCOMPLETE |
| Governing Decision | MPG-DEC-048 (historical activation); MPG-DEC-049 (accepted pause / MR-6 exception) |
| Final Pricing | NOT APPROVED |
| Live Billing | NOT AUTHORIZED |
| Real Customer Charging | NOT AUTHORIZED |

## Purpose

MR-5 establishes the billing engineering foundation without approving final pricing, commercial terms, live billing, public launch, pilot operation, marketing approval, lifecycle ACTIVE, or real-customer charging.

## Current State

Historical MR-5A baseline: at MR-5 start there was no Stripe SDK, billing route, billing table, checkout flow, customer portal, billing webhook handler or Stripe environment configuration. That statement describes the start, not the current implementation.

Safe pause checkpoint: `d654656b59810877502d2e737dd236ae83b9c379`, parent `8d6629aa70498fa13de19e43614c2d5f95b891f4`, verified on local main, origin/main and vercel-staging/main on 2026-09-22. The focused checkpoint adds only `src/lib/billing/stripe-subscription-truth.ts` and `test/integration/stripe-subscription-truth.test.ts`.

Preserved work includes billing tables/domain types, Stripe SDK adapter with signature and TEST/LIVE controls, environment-isolated identifiers, atomic durable webhook claims and `POST /api/webhooks/stripe` intake. The new resolver retrieves provider truth for a verified subscription event, checks environment, obtains the provider customer ID and resolves the organization through `organization_billing_accounts`; provider metadata is not tenant authority. Retrieval is injected into the resolver; it is not wired into the intake route.

**MR-5C remains PARTIAL, not complete.** The intake route acknowledges durable receipt, not completed subscription processing. Processor wiring, subscription projection, out-of-order reconciliation and recovery remain unimplemented. Claims retain event identity/hash rather than raw payload; later recovery must retrieve and verify provider state using persisted provider identifiers, not assume a replayable event body exists. No entitlement mutation, checkout or portal behavior is implemented by this checkpoint. The existing trial engine remains intact.

**MR-5 remains INCOMPLETE, not accepted or closed.** Billing-provider/account eligibility, verification and setup remain unresolved. This is an external dependency, not verified evidence that Stripe is unavailable to MPG. Billing is preserved, not abandoned; no provider replacement is automatic. Research may continue separately.

Under accepted `MPG-DEC-049`, MR-6 Admin / Support / Observability is ACTIVE NEXT for non-billing-dependent work; see [execution handoff](MR-6-EXECUTION-HANDOFF.md). MR-7 remains after MR-6. Resume remaining MR-5 when the dependency is resolved and complete it before any gate materially dependent on production billing or commercial charging. MR-8 stays gated until prerequisites are deliberately reconciled. Company Stage 1 remains active; Stage 2 and later stages remain inactive.

Checkpoint validation: `pnpm lint`, `pnpm typecheck`, `pnpm test` (51 files / 591 tests passed; no skips), `pnpm build` (18 routes generated) and `git diff --check` passed. The provider-truth suite contributes 8 passing tests. `.gitignore` was untouched. These are local synthetic engineering checks, not hosted provider acceptance.

## Provider Direction

Stripe is the current test-mode implementation target. Stripe is the external payment system of record for Stripe-managed billing objects. MPG stores only the trusted local projection needed for organization association, subscription state, entitlement decisions, operational troubleshooting, and webhook auditability.

## Billing / Entitlement Boundary

Billing state and product entitlement state are related but distinct.

```text
Stripe
  -> Billing Provider Adapter
  -> Local Billing Projection
  -> Billing Domain Decision
  -> Organization Entitlement / Product Access
```

Stripe webhooks must never directly bypass MPG domain rules or replace the existing trial engine.

## Billing Persistence (Implemented Foundation)

### organization_billing_accounts
- id
- organization_id
- provider
- provider_customer_id
- environment
- created_at
- updated_at

### organization_subscriptions
- id
- organization_id
- billing_account_id
- provider
- environment
- provider_subscription_id
- provider_price_id
- provider_status
- normalized_status
- current_period_start
- current_period_end
- cancel_at_period_end
- canceled_at
- created_at
- updated_at

Persisted normalized states: `PENDING`, `ACTIVE`, `GRACE`, `SUSPENDED`, `ENDED`.

### billing_webhook_events
- id
- provider
- environment
- provider_event_id
- event_type
- processing_status
- payload_hash
- organization_id
- provider_created_at
- received_at
- processed_at
- error_code
- created_at

Provider identifiers are isolated by billing environment. `provider_customer_id`, `provider_subscription_id`, and `provider_event_id` are namespaced by `TEST` or `LIVE` where persisted.

Subscriptions must match their billing account across `organization_id`, `provider`, and `environment`. Webhook-event deduplication occurs within `(provider, environment, provider_event_id)`.

Schema support for `LIVE` exists only to enforce a safe provider boundary. It does not authorize live billing, real-customer charging, final pricing, checkout, entitlement activation, or public launch.

## Provider Boundary

Current adapter/checkpoint structure (the earlier proposed `provider.ts` / `types.ts` split is not implemented):

```text
src/lib/billing/
  stripe.ts
  stripe-webhook-store.ts
  stripe-subscription-truth.ts
```

Business policy remains outside the low-level Stripe adapter.

## Route Status

```text
POST /api/billing/checkout  — NOT IMPLEMENTED / PAUSED
POST /api/billing/portal    — NOT IMPLEMENTED / PAUSED
POST /api/webhooks/stripe   — DURABLE INTAKE ONLY; PROCESSOR REMAINS PAUSED
```

Checkout and portal routes must derive organization identity server-side and enforce authorized membership/role checks.

Webhook processing must verify the signature using the raw request body, deduplicate by provider event ID, prevent cross-tenant mutation, tolerate duplicate and out-of-order delivery, and record sanitized processing results.

## Security

- Stripe secret key and webhook secret are server-only.
- No raw card number or CVC is stored by MPG.
- Billing data is organization-scoped.
- Provider synchronization uses trusted server paths.
- Cross-tenant negative tests are mandatory.

## Proposed Future Configuration

```text
BILLING_PROVIDER=stripe
ENABLE_LIVE_BILLING=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=
```

The historical MR-5A slice did not add these variables. The current Stripe adapter/intake reads server-side Stripe credentials and the live-billing guard; this list is not evidence of a hosted account, provisioned price or configured deployment. Final pricing must not be hard-coded. Live billing and real charging remain unauthorized.

## Test-Mode Gate

MR-5 engineering must operate in Stripe test mode. A successful test subscription must not enable live email, authorize public launch, authorize real charging, bypass readiness gates, or establish final pricing.

## Commercial Boundary

Final plan names, prices, billing intervals, included usage, overages, discounts, refunds, grace periods, and cancellation terms remain owner-gated. Stripe test products/prices are engineering fixtures only.

## Engineering Sequence

The original sequence is retained, with current pause status:

1. MR-5A — Architecture and governance reconciliation — checkpointed baseline.
2. MR-5B — Billing persistence and domain model — checkpointed foundation.
3. MR-5C — Stripe test adapter and webhook processing — PARTIAL CHECKPOINT; processor/projection/recovery remainder PAUSED.
4. MR-5D — Checkout + Customer Portal — DEFERRED / PAUSED.
5. MR-5E — Controlled entitlement synchronization — DEFERRED / PAUSED.
6. MR-5F — Hosted billing-provider test-mode acceptance — DEFERRED / PAUSED.

Resume gate: resolve provider/account dependency, re-inspect the preserved checkpoint, complete MR-5C processing/recovery, then D/E/F with synthetic test-mode evidence. Commercial payment/refund/discount/grace policies, final prices and live enablement still require their separate decisions.

## MR-5A Exit Condition

MR-5A is complete when this architecture baseline exists, the roadmap reflects MPG-DEC-048, stale MR-5 authorization wording is reconciled, no payment implementation has been introduced prematurely, and lint/typecheck/tests/build/diff validation pass.
