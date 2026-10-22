# MPG Reputation — MR-5 Owner Pricing Correction and Configurable Subscription Plans

| Field | State |
|---|---|
| Date | 2026-10-18 |
| Scope | MR-5 — bounded subscription price catalog and secure operator configuration |
| Price direction | **OWNER-SPECIFIED ENGINEERING VALUES**; not an approved public offer |
| Charging | **DISABLED** — no live billing, checkout route or paid entitlement activation |
| Source | Owner correction after engineering PR #18 was prepared |

## Exact Owner instruction

- **Monthly** — ₱1,500 per month; one charge per month.
- **Yearly** — ₱1,000 for the **entire year**; one charge every 12 months.
- **DO NOT** describe yearly as ₱1,000 per month, ₱12,000/year, or a monthly equivalent billing amount.
- At the nominal monthly rate, 12 months total ₱18,000. The nominal ₱1,000 annual offer is ₱17,000 less, approximately **94.44% lower**. This unusually large difference is the owner's explicit direction and warrants a separate sustainability/COGS review before publication.

No paid plan request limits, overages, tax/refund policy, cancellation policy, grace policy, or regional presentment are inferred. Existing 30 Free Review Requests trial hypothesis is separate.

## Where MPG can configure the price today

Use **server-only environment variables**, such as the Vercel project's Environment Variables settings or local non-committed development environment:

```dotenv
# PHP pesos, not centavos. Both are optional.
MPG_BILLING_MONTHLY_PRICE_PHP=1500
MPG_BILLING_ANNUAL_PRICE_PHP=1000

# Stripe remains disabled:
ENABLE_LIVE_BILLING=false

# Future test-mode Stripe mappings only (no real IDs yet):
# STRIPE_TEST_MONTHLY_PRICE_ID=
# STRIPE_TEST_ANNUAL_PRICE_ID=
```

To adjust a proposed price, an authorized MPG operator changes the matching server-only variable and restarts/redeploys the relevant application environment. **Missing variables** use the owner-corrected ₱1,500 and ₱1,000 defaults. **Present-but-invalid variables** (e.g. negative, zero, non-numeric, excessive decimals) cause a fail-closed configuration error instead of silently falling back.

Variables accept a positive PHP amount with at most two decimal places, e.g. `1750` or `1750.50`, without currency symbols or thousands separators. Amounts are stored and compared in integer centavos. Monthly-equivalent values displayed for an annual plan are informational rounding only; the payable annual amount is a single yearly charge.

No client-tenant user may edit the global price, and no unauthenticated setting writes exist. **An in-app MPG pricing editor is not yet implemented.** The existing MR-6 support role is granted per tenant and must not be reused as unrestricted global pricing administration. That editor requires an explicitly governed company-wide role, audited changes, concurrency handling and existing-subscriber price-version policy, and is a separate security-sensitive slice.

## Code changes

- `src/domain/billing/catalog.ts`: corrected default yearly amount to **100,000 PHP minor units** (₱1,000); preserves the monthly amount of 150,000 minor units (₱1,500); provider verification accepts the configured plan catalog rather than assuming defaults.
- `src/domain/billing/configuration.ts`: pure, deterministic amount parsing and immutable configurable price catalog with fail-closed invalid settings.
- `src/lib/billing/pricing.ts`: trusted server-only environment reader for future checkout and pricing-page server code. Browser-provided amounts/plan data are never an authority for billing.
- `src/lib/billing/stripe-plan-bindings.ts`: preexisting test/live Price-ID mapping still fail-closed and unconnected to payment processing.
- `test/domain/billing-catalog.test.ts` and `test/domain/billing-configuration.test.ts`: amount, interval, invalid configuration, old ₱12,000/year mismatch and provider-price validation coverage.
- `.github/workflows/internal-ci.yml`: new tests are explicitly allowlisted.

## Stripe Price boundary

The Stripe SDK, verified webhook intake, account and subscription tables, TEST/LIVE isolation, and provider-truth resolution are already present; do not rebuild them. The next feature slice must finish MR-5C verified subscription projection and recovery before MR-5D checkout, MR-5E paid entitlements, and MR-5F test-mode verification.

**Stripe Price objects are not mutable in amount/recurrence in place.** Changing an MPG proposal in server configuration does *not* change an existing Stripe Price or customer subscription. On future Stripe account setup, provision distinct monthly and annual recurring Price objects matching current configured amounts; after a price change, deliberately provision and bind a new Stripe Price and separately decide how existing subscribers are treated. Before creating any test Checkout Session, server code must fetch the configured Stripe Price and validate ID, currency, amount, interval, active status, and mode against the authoritative server catalog. No charge, trial conversion or entitlement may be caused by configuration changes alone.

## Scope, governance, and remaining gates

- Product engineering feature branch only; no production data, hosted DB migration, provider accounts, payments, or checkout routes modified.
- Company OS main `03a48a34481f1952a31cd5c4fb980bc381432d8d` retains MR-7 IN PROGRESS, MR-8 GATED, Case B OWNER-EXCLUDED and LIVE messaging/billing OFF; the later Owner request controls exact proposed engineering amounts.
- Pricing is **not a published public offer** until applicable commercial review, geography/payment-provider eligibility, tax/Terms/Privacy review and Owner-approved launch gates.
- 94.44% annual discount requires checking hosting, messaging, payment processing and support costs before final pricing approval.
- Tests are evidence only when a CI run actually succeeds.

Reference: [Stripe recurring Price objects](https://docs.stripe.com/api/prices), [Stripe currencies](https://docs.stripe.com/currencies).
