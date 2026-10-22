# MR-5I24 — Provider-OFF Checkout Return and Scoped Billing Navigation

**Date:** 2026-10-22  
**Status:** IN PROGRESS pending exact-head CI and full scoped diff. Not OWNER ACCEPTED or commercial payment authorization.  
**Workstream:** MR-5 Stage 3 customer billing experience, organization-role acceptance, return-path resilience.

## Verified remote checkpoint

- Company OS `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`, MPG-DEC-052.
- Product `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`.
- Held integration PR #67: DRAFT, unmerged, `699c8a9ad8d6c356eeb0e29affa83feeeac2a227`. No owner authorization for its main merge.
- Parent MR-5I23 PR #95 `a9a4abc628b2a9a66550a647ab1f937c7156da91` passed exact-head Internal CI and isolated Synthetic E2E. This slice branches from #95; deferred encrypted-backup PR #94 is deliberately not included.

## Existing symptom and minimal correction

The existing `src/app/billing/checkout/return-screen.tsx` is rendered for both `/billing/checkout/success` and `/billing/checkout/cancel`. Both returned users to **`/app/settings/billing`**, the legacy page that safely refuses to choose a billing organization when a user owns/works for multiple businesses. That path forces the customer through a second "Multiple businesses detected" denial and then a chooser link, even though `/workspace/organizations` is already the accepted authenticated, RLS-scoped business chooser with per-organization Billing links (OWNER/ADMIN only).

Change only the **return screen's navigation** to `/workspace/organizations`, with descriptive button text "Choose business to view billing", explicit no-payment-confirmation copy, and anonymous-authenticated session denial. **Do not** use query string `session_id`, a caller-supplied org ID, Stripe redirect URL, cookies or billing status as trusted tenant/payment authority. A user may view only current businesses exposed by the chooser, and each scoped Billing page still checks fresh membership and role.

## Tests and impact

- `test/domain/billing-checkout-return-page.test.ts`: real server-rendered success and cancellation return screens, button destination, no arbitrary organization/Stripe link, pending/no-settlement text, unauthenticated/anonymous/auth-error denial, and no privileged reads.
- Explicit Internal CI source-domain test registration.
- No provider API calls, SQL changes, new database objects, price/entitlement policy, RLS bypass, real invoices, live checkout, admin grants or full page refactor.
- No provider TEST browser completion claimed; genuine provider connection remains separately blocked.

## Remaining critical gates

Real settlement and accepted financial finality, full client/admin browser acceptance, paid entitlement lifecycle rules, provider TEST credentials and e2e verification, and independent cumulative PR #67 security review remain OPEN. The owner separately deferred local encrypted backup, hosted migrations and restore until the manual execution phase; this does not waive security, production or deployment prerequisites.

**Next**: continue Stage 3 authenticated customer/admin acceptance and safely address any concrete UI contract failures. Prepare Stage 1 owner decision packet for provider-attested settlement policy, without generating any synthetic paid authority.
