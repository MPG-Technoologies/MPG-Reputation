# MPG Reputation — MR-5D1 Checkout Readiness and Provider Price Verification

| Item | State |
|---|---|
| Slice | MR-5D1 — authorized subscription checkout preflight (no session creation) |
| Base | Pricing contract [PR #18](https://github.com/MPG-Technoologies/MPG-Reputation/pull/18), `b5b79705399260e10bd67f831b7e9c54da4b6260` |
| Current milestone | MR-5 — INCOMPLETE |
| Price state | Owner engineering proposal: ₱1,500/month, ₱1,000 **TOTAL per year** |
| Launch/charging | NOT AUTHORIZED |
| Verification | Pending CI at initial handoff |

## Owner sequencing decision

On 2026-10-18 the owner directed deferring **hosted and real Stripe provider testing until the app is deployed for approved testing**, while continuing to implement other product features. This is permission for bounded development, not a production deploy, credential provisioning, activation of billing, or release of final pricing.

MR-5C's synthetic/test-mode processing and recovery PRs #19–#25 remain preserved and open. This checkout preflight is **independently stacked on the pricing proposal PR #18**, not a fork or duplication of the webhook code. Product main remains `6b7ac073432921789314315ec5fc624a81d8f699`, Company OS main `03a48a34481f1952a31cd5c4fb980bc381432d8d`.

## What is implemented

`src/lib/billing/stripe-test-checkout-preflight.ts` exports `prepareStripeTestCheckout`. It accepts an RLS-scoped Supabase **authenticated user** client, a requested organization UUID and `monthly` or `annual` plan identifier, and an injected read-only Stripe Price retriever. The preflight:

1. Performs Supabase `auth.getUser()`; **does not accept the caller's user ID**.
2. Validates the requested organization UUID and exactly the known monthly/annual plan IDs.
3. Calls `user_has_role(org_id, ['OWNER', 'ADMIN'])` under the caller's JWT. A viewer, operator, unauthenticated user, support-only user, or member of another organization must not authorize checkout.
4. Reads the mapped `organization_billing_accounts` TEST Stripe customer using the caller's tenant RLS. **No user-provided Stripe Customer ID is accepted.** If the account has not been created via a future authorized setup flow, it returns `ACCOUNT_SETUP_REQUIRED`.
5. Checks `organization_subscriptions` for any non-ended TEST subscription; returns `SUBSCRIPTION_EXISTS` rather than accidentally creating duplicate subscriptions or overriding renewal/cancellation policies.
6. Resolves the selected pricing proposal from the independently configurable **server-only** `MPG_BILLING_MONTHLY_PRICE_PHP` and `MPG_BILLING_ANNUAL_PRICE_PHP`; malformed configuration fails closed.
7. Resolves the configured TEST Stripe Price binding and fetches the actual Price using an injected read-only provider adapter. Verifies the exact Price ID, **TEST** mode, active status, PHP currency, integer minor-unit amount, billing interval and interval count. Any mismatch fails closed.
8. Only then returns a minimal **server-internal** checkout `READY` intent, not a Stripe Checkout Session or redirect.

`src/lib/billing/stripe-test-checkout-price.ts` is a read-only TEST Stripe SDK Price retriever. It rejects missing, live or publishable keys. It never makes a charge, creates a checkout session, or stores payment credentials.

No public endpoints, frontend billing pages, Stripe account/customer creation, paid access grants, trial-state changes, or live Stripe calls are included. No new schema/RLS policies are required.

## Explicit concurrency limitation

**Preflight is not final checkout authorization.** It checks existing subscriptions before preparing a proposed session, but two requests could race. Before enabling actual TEST Checkout Session creation, MR-5D2 must design an idempotent, transaction-protected checkout initiation state or equivalent trusted provider-side constraint and re-check account/tenant/price at commit. Do not expose `READY` as proof of payment or grant entitlement from a checkout redirect. Stripe subscription state must still arrive via the validated MR-5C processor before paid access changes.

## Remaining MR-5D sequence

- **MR-5D2:** test-only checkout session creation and customer provisioning contract with anti-duplicate concurrency/idempotency, safe approved success/cancel URLs, and signature-backed subscription lifecycle semantics. Never create unapproved live Checkout Sessions.
- **MR-5D3:** tenant-owner/admin billing UI and secure customer portal entry, subscription overview and confirmation/pending screens; ensure authorized organization selection and friendly setup guidance. Build against current Next.js navigation, not an invented second dashboard.
- **MR-5E:** paywall/entitlements only after verified billing state, respecting **30 Free Review Requests** trial and suppression/operational safeguards.
- **MR-5F:** hosted Stripe TEST mode account acceptance / complete simulation on owner-approved deployment, deferred by owner to later.

## Verification requirements

- Synthetic tests prove monthly amount = 150,000 centavos and annual amount = 100,000 centavos **per entire 12 months**; custom configured amount mismatches fail closed.
- Deny unauthenticated, viewer, cross-org, malformed organization/plan, duplicate subscription, absent billing account, wrong provider Price, LIVE Price, wrong currency/amount/interval, missing configured Price ID, provider outage and live Stripe key.
- Disposable local Supabase tests confirm real RLS and role enforcement under actual user JWT, with cleanup.
- CI lint, typecheck, synthetic tests, build, diff review; **no hosted DB/provider connections**.

No final pricing publication or commercial claim has been approved. The unusually steep annual discount remains a separate owner economic/commercial decision before launch.
