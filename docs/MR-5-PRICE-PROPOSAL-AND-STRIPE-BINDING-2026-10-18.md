# MPG Reputation — MR-5 Pricing Proposal and Provider-Binding Slice

| Field | State |
|---|---|
| Date | 2026-10-18 |
| Scope | MR-5: bounded recurring-plan contract and test-mode price-binding prerequisite |
| Execution | Owner requested work toward monthly/annual subscriptions while Stripe credentials are unavailable |
| Pricing | **PROPOSED / NOT COMMERCIALLY FROZEN** |
| Provider | Existing Stripe architecture preserved; no replacement, duplicate billing stack, or checkout route |
| Live billing / charging | **OFF / NOT AUTHORIZED** |
| MR-8 / public site / marketing | **GATED** |

## Owner proposal interpretation (not a final offer)

- **Monthly:** ₱1,500 per month, charged monthly.
- **Annual:** ₱1,000 per month equivalent, **₱12,000 collected once per year** (not ₱1,000 for the whole year).
- Paying monthly for twelve months would total ₱18,000; annual option is ₱6,000 less (33⅓%).
- This interpretation must be confirmed before a publicly displayed binding price or Stripe Product/Price is created.
- The company product direction currently prioritizes US/Canada validation; PHP presentment, settlement availability, geography, taxes, refunds, renewals, payment failure/grace and cancellation terms are **unresolved commercial/operational decisions**.
- No included paid review-request quota, overages, tax representation, or contractual terms are invented by this slice. The existing **30 Free Review Requests** trial hypothesis remains separate.

## Implemented in this branch

1. `src/domain/billing/catalog.ts`: stable plan identifiers, PHP minor-unit amounts, recurring month/year intervals, conservative `PROPOSED` flag and deterministic comparison with a fetched provider Price snapshot.
2. `src/lib/billing/stripe-plan-bindings.ts`: separate server-only TEST/LIVE plan Price-ID configuration, fail-closed unknown/missing/invalid/colliding IDs, and explicit LIVE guard. A resolved Price ID does **not** enable checkout or entitlement.
3. `test/domain/billing-catalog.test.ts`: deterministic unit tests for both proposed prices, annual savings, amount/currency/interval/environment mismatches, unconfigured provider and LIVE-off behavior.
4. `src/domain/billing/index.ts`: exports the domain catalog through existing billing domain index.

### Future server-only configuration (nothing configured or activated here)

```dotenv
# Stripe test mode only, after account/provider prerequisite is available:
STRIPE_TEST_MONTHLY_PRICE_ID=
STRIPE_TEST_ANNUAL_PRICE_ID=

# Existing Stripe secret/webhook adapter remains separate.
# The following are NOT to be set for live charging at this stage:
ENABLE_LIVE_BILLING=false
# STRIPE_LIVE_MONTHLY_PRICE_ID=
# STRIPE_LIVE_ANNUAL_PRICE_ID=
```

The future checkout integration must retrieve and validate the actual Stripe Price's currency, minor-unit amount, recurring interval, active status, ID and TEST/LIVE mode server-side before creating a session. It must not trust a browser-supplied price ID, amount, organization ID or Stripe customer ID. Stable MPG plan IDs can be sent as user intent only.

## Existing MR-5 architecture remains authoritative

The repository already contains `organization_billing_accounts`, `organization_subscriptions`, `billing_webhook_events`, `src/lib/billing/stripe.ts`, signature-verified durable webhook intake, and `src/lib/billing/stripe-subscription-truth.ts`. The existing route `POST /api/webhooks/stripe` acknowledges durable receipt only. It **does not** apply subscription state, settle invoices, or grant paid entitlement.

### Safe remaining engineering sequence

1. **MR-5C remainder:** verified provider-truth processing, environment and tenant binding, subscription projection, duplicate/out-of-order safety, recovery and integration testing. Do not directly grant paid access from unverified incoming event snapshots.
2. **MR-5D:** OWNER/ADMIN-only checkout/portal request routes, server-verified matching Stripe recurring Prices, existing organization-to-customer binding, idempotency and duplicate-subscription defense; fail closed while Stripe test credentials and price objects are unavailable.
3. **MR-5E:** deterministic and auditable entitlement transition when trusted billing projection changes. Trial, paid entitlement, cancellation, failed payment, grace and recovery require separate policy decisions and tests.
4. **MR-5F:** Stripe **test-mode** checkout, renewal, failed payment, portal/cancel and webhook reconciliation using synthetic customer fixtures; owner acceptance before any live switch.

No hosted migration or provider/account settings are changed by the current price-catalog slice. Engineering scope can continue without commercial activation, but an end-to-end Stripe payment flow **cannot be honestly verified** until test-mode access/Price IDs are available.

## Verification / gates

Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` against the feature branch; claim a result only after a real run. Full diff review, privacy/security boundaries, and scoped branch/PR apply.

Current Company OS decision `MPG-DEC-051` retains MR-7 IN PROGRESS, MR-8 GATED, Case B OWNER-EXCLUDED, and LIVE billing/messaging OFF. The new owner's request authorizes bounded MR-5 **engineering preparation**, not pricing publication, production charging, commercial policy, pilot, launch, or a declaration that MR-5 is complete.

## Official Stripe references

- Recurring Prices and billing intervals: https://docs.stripe.com/api/prices
- Subscription-mode hosted Checkout: https://docs.stripe.com/api/checkout/sessions/create
- Currency and minor units: https://docs.stripe.com/currencies
