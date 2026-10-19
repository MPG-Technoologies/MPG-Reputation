# MPG Reputation — MR-5D3C2 Local TEST Billing Action Integration

| Item | State |
|---|---|
| Slice | MR-5D3C2 — connect existing MR-5D contracts through a fail-closed LOCAL_SYNTHETIC handler + existing Billing UI |
| Base | MR-5D3C1 [PR #31](https://github.com/MPG-Technoologies/MPG-Reputation/pull/31), `5309b855ff8645cd9c83b27c74dbef170d615dce` |
| Company OS main | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Hosted TEST Stripe account/provider acceptance | OWNER-DEFERRED until approved deployed test |
| Commercial launch / live billing | NOT AUTHORIZED |
| Status | IN PROGRESS pending checks |

## Implementation

- `src/lib/billing/stripe-test-action-request.ts` validates one of **three and only three** request schemas: `{action:'CUSTOMER_SETUP',organizationId}`, `{action:'PORTAL',organizationId}`, or `{action:'CHECKOUT',organizationId,planId:'monthly'|'annual'}`. Any extra field is denied, including user IDs, role claims, Stripe Customer/Price IDs, billing amounts, quantity, codes, callback URLs or custom redirect.
- `POST /api/internal/billing/test/action` is a real Next.js server-side route but **hard-disabled in production/preview/hosted environments** before accessing cookies, credential stores, clients or request bodies. It requires explicit `ENABLE_STRIPE_TEST_BILLING_ACTIONS=true`, `MPG_STRIPE_TEST_BILLING_ACTION_TARGET=LOCAL_SYNTHETIC`, disposable local DB address, `NODE_ENV !== production`, no `VERCEL_ENV`, and no live billing.
- The request body is read through a bounded Web stream (**1024-byte hard limit**), strict UTF-8 and exact JSON action schema. The existing MR-5D3C1 admission additionally requires same-origin JSON POST, `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: cors`, non-simple `x-mpg-billing-action: 1`, current Supabase JWT user and OWNER/ADMIN membership, plus service-only PostgreSQL rate-limit admission.
- Only then is a narrowly intended server-only service-role client used for the previously accepted service-only provisioning/checkout reservation RPC. The route does not expose the key, Stripe secret or RLS-unscoped table access to the browser.
- `CUSTOMER_SETUP` invokes MR-5D3B1's frozen-name/idempotent TEST Customer provisioning; `CHECKOUT` invokes MR-5D1/2's exact TEST Price validation, fenced checkout reservation and TEST Stripe Checkout creator; `PORTAL` invokes MR-5D3B2's safe TEST Billing Portal configuration/session validator. The action-specific adapter still demands its own independent TEST/LOCAL_SYNTHETIC configuration and refuses LIVE billing or live keys.
- All POST responses have `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`; no CORS grants, `OPTIONS` returns 405. Errors never reveal provider exceptions, service-role keys, raw PII or Customer IDs. Redirect URLs are allowed **only after** validated, authorized Stripe TEST session results.
- Existing `/app/settings/billing` reuses its server-read active organization, existing trial/usage navigation and business-level billing status; when both local preview and local action flags are on, `BillingPlanPreview` mounts `LocalSyntheticBillingActions` within the selected plan. It sends the exact same-origin POST using the custom header, shows pending/rate/recovery feedback and verifies the Stripe hostname again before redirecting. Missing Customer links offer TEST setup guidance. An existing active/pending subscription disables another checkout. **The production Billing page remains read-only; proposed prices stay hidden.**

## Why this is not a complete activated billing product

No TEST Stripe secret, actual Customer provisioning, Checkout or Billing Portal session was used during automated CI. By prior owner instruction, real/hosted provider testing is postponed until an explicitly approved deployed-test stage. Even in local development, these three actions require independently enabled provider flags and credentials which are NOT configured by this PR. An open portal/checkout URL never grants paid entitlement.

Missing policy/acceptance:
- TEST Stripe provider inventory reconciliation for abandoned/ambiguous Customer and Checkout reservations.
- Automatic tenant admin billing state refresh and server-side reconciliation when Stripe sessions expire.
- Provider TEST billing configuration and correct invoice/cancellation/upgrade rules.
- MR-5E verified entitlement gates, `30 Free Review Requests` trial transition and access continuity.
- MR-5F real hosted TEST provider acceptance and authorized deployment. No final price publication, MR-8 pilot or launch.
- Future hosted TEST activation needs a **new separately reviewed identity and credential boundary**; do not turn LOCAL_SYNTHETIC into HOSTED_TEST by changing a string. The global CSRF/rate/role behavior must be retested against the deployed environment and reverse proxy.

## Security tests

Use synthetic tests for request schema/cross-origin rejects (MR-5D3C1), disabled HTTP route and OPTIONS/CORS rejection, body size limit and privileged-key absence. Rerun inherited disposable PostgreSQL tests for 5-in-60-second atomic limits and tenant isolation. Review the precise scoped diff before considering owner review. No `main` merge, production deploy, hosted DB migration, live provider, real customer data or messaging permitted.
