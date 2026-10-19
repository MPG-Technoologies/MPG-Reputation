# MR-5I4G — Proposed TEST Checkout Quote Snapshot and Provider Adapter Boundary

**State: IN PROGRESS — scoped CI and final diff pending. NOT OWNER ACCEPTED.**

## Source-of-truth checkpoint — October 19, 2026

- Company OS `techwithmpg/mpg-company-os` main `03a48a34481f1952a31cd5c4fb980bc381432d8d`: MR-5 is still formally PAUSED/INCOMPLETE and MR-7 active under accepted governance. Later owner direction approves *bounded non-live provider-ready engineering*, not live payment or release authorization.
- Product `MPG-Technoologies/MPG-Reputation` main `6b7ac073432921789314315ec5fc624a81d8f699`, unchanged. MR-5I4F parent unmerged draft PR #60 at `18465cf2ef983d325bb0e08a24df3ea67e32b13e`, with earlier billing PRs #55–#59 also unmerged.
- No Stripe TEST account connection or payment API, accepted commercial pricing, real settlement, paid entitlement, live messaging, customer pilot, production deployment or merge into main. Preserve **30 Free Review Requests**.

## Why this slice

The existing server-side `configureReputationBillingCatalog`, `getConfiguredReputationBillingCatalog` and `prepareStripeTestCheckout` validate proposed per-plan PHP quotes and TEST Stripe Price bindings; `reserve_stripe_test_checkout` protects one TEST reservation per organization. **Both the configured catalog and the subscription projection can change**. Re-deriving an *old quote* from current environment configuration would silently reprice its history. MR-5I4F invoice evidence records are unverified, not frozen checkout or financial truth. MR-5I4G therefore freezes a **synthetic historical candidate quote** associated with an existing TEST reservation, without claiming a legally or provider-accepted contract.

## Narrow implementation

1. New repository-only SQL migration `supabase/migrations/20261019180000_mr5i4g_synthetic_checkout_quote_snapshots.sql` creates `billing_synthetic_checkout_quote_snapshots` for TEST Stripe reservations. One snapshot per reservation (`UNIQUE(checkout_reservation_id)`), exact tenant/account composite FK, reservation FK and source validation in a `SECURITY INVOKER` insertion trigger. Requires matching tenant, saved TEST Price and plan, existing unexpired PREPARING/READY reservation.
2. Stores only candidate plan, Price ID, PHP minor amount, interval, capture timestamp and scope IDs. No card, email, customer personal information, Stripe secret, raw provider object or payment token. `SYNTHETIC`, `PROPOSED`, `UNVERIFIED`, `payment_authorized = false`, `access_authorized = false` are enforced by SQL. This can NEVER authorize charging, invoice processing or product access.
3. Service role has SELECT/INSERT **only** on this private RLS-enabled table; PUBLIC, anon, authenticated (including OWNER) cannot access it; no browser route, new service-role client, scheduled worker or read API is added. No service-role UPDATE/DELETE, though authorized org erasure cascades remain possible. Privilege-scoped append-only is not immutable against DBA migrations.
4. Extends `src/types/database.ts` with exact fields and literal hard-false flags.
5. Adds disposable PostgreSQL integration tests for one-time freeze and uniqueness, price drift from later server configuration, cross-tenant/customer reservation mismatches, expired/invalid reservation, malformed and authority-elevating input, anon/OWNER permissions, service-role append-only, unchanged trial and erasure. The CI workflow runs them ONLY against its own temporary localhost database. No hosted migration.
6. Existing checkout/provider/policy code is unchanged. A previous quote is not re-derived from a new catalog, and an arbitrary browser price is **not** accepted into any real checkout. This staging table can be written only by privileged synthetic test infrastructure. It is not activated by a customer workflow.

## Explicit provider adapter boundary — design only

Existing `BillingEvidenceReadPort.readInvoice` is read-only and intentionally returns mere **`EVIDENCE_ONLY`** even when fed perfect synthetic facts; no provider-authentication attestation or safe invoice finalizer exists. Later approved TEST provider integration MUST:

- Retrieve the *actual current* TEST Price, Invoice, linked Payment/Charge/Refund/Dispute and Subscription from an independently authenticated account server-side, never trust a client body or Stripe webhook event alone.
- Bind the account's tenant, Customer and Subscription to durable stored IDs and accepted immutable checkout terms, with separate Price/amount/currency/interval/tax/discount/recurrent-billing policies. A `PROPOSED` synthetic quote is **not** those terms, and matching it to a provider object does not promote it automatically.
- Establish authenticated provider provenance and a bounded observation freshness window as a distinct approved interface from mockable `BillingEvidenceReadPort`; fail closed without provider credentials, on LIVE, or on inconsistent/refunded/disputed/stale observations.
- Pass independently verified facts into a separately accepted fenced **atomic PostgreSQL invoice settlement** transaction and immutable financial ledger, with unique provider+environment+invoice key and replay/rollback checks. No database transaction can make its preceding provider HTTP read distributed-atomic.
- Keep separately reviewed paid entitlement activation/reversal, invoice finality, trial eligibility and live charging behind explicit owner approval.

### Remaining design decisions (not silently resolved)

The proposed `₱1,500/month` and `₱1,000/year` catalog is **not a final approved price**. Retention, accepted checkout terms, customer-currency choice for US/Canada validation, discounts, tax, proration, multi-line invoice and pricing change/grandfathering rules need separate commercial and accounting review. Current quote snapshot amounts are *synthetic candidate values only*, potentially independently inserted by the privileged test harness and **not** verified against a real provider Price. Future production code MUST NOT consume this table as settlement or accepted contract authority.

## Verification and next slice

Expected scoped diff: one new synthetic-only migration, `src/types/database.ts`, one disposable DB integration test, one line in the existing isolated E2E workflow, this handoff. CI lint/typecheck/unit tests/build and disposable DB security/uniqueness/drift/erasure suite must pass before engineering completion. Inspect final diff, no secrets or widened permissions, keep PR stacked and draft.

**NEXT:** MR-5I4H — formally reconcile the synthetic billing branch stack and remaining provider-independent client/admin billing workflows; identify integration conflicts and acceptance gaps without automatically merging any PR or activating production.
