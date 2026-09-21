# MPG Reputation — MR-5 Billing Architecture

| Metadata | Value |
|---|---|
| Product | MPG Reputation |
| Milestone | MR-5 — Billing |
| Status | MR-5A ENGINEERING BASELINE |
| Governing Decision | MPG-DEC-048 |
| Final Pricing | NOT APPROVED |
| Live Billing | NOT AUTHORIZED |
| Real Customer Charging | NOT AUTHORIZED |

## Purpose

MR-5 establishes the billing engineering foundation without approving final pricing, commercial terms, live billing, public launch, pilot operation, marketing approval, lifecycle ACTIVE, or real-customer charging.

## Current State

At MR-5 start there is no Stripe SDK, billing route, billing table, checkout flow, customer portal, billing webhook handler, or Stripe environment configuration. The existing `organization_entitlements` trial engine remains intact and live customer messaging remains separately gated.

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

## Proposed Minimal Data Model

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

Candidate normalized states: `PENDING`, `ACTIVE`, `GRACE`, `SUSPENDED`, `ENDED`.

### billing_webhook_events
- id
- provider
- provider_event_id
- event_type
- processing_status
- payload_hash
- organization_id
- received_at
- processed_at
- error_code
- created_at

`provider_event_id` must be unique so duplicate webhook delivery cannot duplicate business effects.

## Provider Boundary

Proposed server-only structure:

```text
src/lib/billing/
  provider.ts
  stripe.ts
  types.ts
```

Business policy remains outside the low-level Stripe adapter.

## Proposed Routes

```text
POST /api/billing/checkout
POST /api/billing/portal
POST /api/webhooks/stripe
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

MR-5A does not add these variables yet. Final pricing must not be hard-coded.

## Test-Mode Gate

MR-5 engineering must operate in Stripe test mode. A successful test subscription must not enable live email, authorize public launch, authorize real charging, bypass readiness gates, or establish final pricing.

## Commercial Boundary

Final plan names, prices, billing intervals, included usage, overages, discounts, refunds, grace periods, and cancellation terms remain owner-gated. Stripe test products/prices are engineering fixtures only.

## Engineering Sequence

1. MR-5A — Architecture and governance reconciliation
2. MR-5B — Billing persistence and domain model
3. MR-5C — Stripe test adapter and webhook processing
4. MR-5D — Checkout and Customer Portal
5. MR-5E — Controlled entitlement synchronization
6. MR-5F — Hosted test-mode acceptance

## MR-5A Exit Condition

MR-5A is complete when this architecture baseline exists, the roadmap reflects MPG-DEC-048, stale MR-5 authorization wording is reconciled, no payment implementation has been introduced prematurely, and lint/typecheck/tests/build/diff validation pass.
