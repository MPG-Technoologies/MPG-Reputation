# MPG Reputation — MR-5D3D2 Read-only Stripe TEST Provider Truth

| Control | State |
|---|---|
| Task | MR-5D3D2 — verify SAVED Customer and Checkout TEST provider identities |
| Product base | MR-5D3D1 PR #33 `446bd43394c56630c3b3349e1df132668fe4eb5f` |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Company OS main | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| MR-5 | PAUSED / INCOMPLETE under Company OS; bounded safe engineering per owner |
| Provider/hosted acceptance | DEFERRED by owner to approved deployed TEST stage |
| Payment, billing and commercial activation | NOT AUTHORIZED |
| Verification | PENDING CI on initial handoff |

## Trust boundaries

1. `supabase/migrations/20261019040000_mr5d3d2_provider_recovery_context.sql` adds exactly one **read-only, SECURITY INVOKER, service-role-only** RPC to select the current owner's organization **TEST** billing mapping, frozen Customer reservation identity, exact saved Checkout reservation/Session ID, expected Customer/Price ID, expiry, return origin and a boolean indicating an existing non-ended TEST subscription. RPC checks the actual organization is ACTIVE and the user is OWNER/ADMIN. It exposes the private IDs only to a trusted server and does not allow anon/authenticated to EXECUTE. The RPC does not mutate or lock records.
2. `src/lib/billing/stripe-test-provider-recovery.ts` authenticates the user with `auth.getUser()`, verifies the requested org's OWNER/ADMIN membership with the RLS-scoped client, then obtains the narrow private server-only context. It **never returns** raw provider IDs, name, amount, URLs, tokens, PII, payment evidence or arbitrary DB fields in its result.
3. Stripe provider reads use a separate injectable `StripeRecoveryReadOnlyProvider`. `src/lib/billing/stripe-test-provider-recovery-adapter.ts` exposes **read-only** `customers.retrieve`, `checkout.sessions.retrieve` and `checkout.sessions.listLineItems` using a strict TEST secret key. No Stripe create/update/delete/expire or invoice endpoint is reachable through the adapter.
4. Both the orchestration and provider adapter are **hard-disabled** unless `ENABLE_STRIPE_TEST_PROVIDER_RECOVERY=true`, `MPG_STRIPE_TEST_PROVIDER_RECOVERY_TARGET=LOCAL_SYNTHETIC`, exact disposable `localhost:54331` Supabase URL, no Vercel/production environment and `ENABLE_LIVE_BILLING` not true. No public route, button, scheduler or automatic reconciliation job invokes this adapter, and no real Stripe keys are provisioned.
5. **Customer:** verify exact saved provider ID, TEST mode, non-deleted status and (when the original Customer provisioning reservation exists) frozen business name. A Customer with verified ID but missing tenant account mapping is reported as `VERIFIED_UNLINKED`; a local ID conflict is reported as `LOCAL_CONFLICT`. No mapping gets created or overwritten.
6. **Checkout:** only when the Customer has a valid, linked TEST account, retrieve the **exact saved** `cs_test_...` Session. Verify TEST mode, subscription mode, exact Customer, `client_reference_id` equal to reservation UUID, expiry equal to stored expiry, PHP currency, exact server-configured success/cancel URLs, and exactly **one** line item with the stored Price ID and quantity 1. Provider errors, mismatches or pagination ambiguity are fail-closed. The provider Session may be OPEN, EXPIRED or COMPLETE; a COMPLETE session is **COMPLETED_UNVERIFIED**, never PAID.
7. **Missing provider ID:** when a Stripe API operation timed out before persisting a Customer ID or Checkout Session ID, an idempotency key cannot be reversed into a reliable exact-object lookup using ordinary Customer/Checkout retrieve. Therefore report **NO_PROVIDER_ID**, do **not** infer that Stripe created nothing, and do **not** restart with a new idempotency key or use Customer name/metadata search as tenant authority. A qualified TEST Stripe operator must investigate idempotency/request logs and webhook evidence before any audited decision.
8. The read-only assessment is a **snapshot**, not durable authorization. A future recovery mutation requires fresh linked-tenant and provider-truth checks inside an approved transaction; MR-5E requires separate verified payment/invoice evidence to grant access.

## Outputs

| Customer | Meaning |
|---|---|
| NO_PROVIDER_ID | No exact saved Customer ID, provider outcome remains unresolved |
| VERIFIED_LINKED | Saved provider TEST Customer matches authoritative org billing mapping |
| VERIFIED_UNLINKED | Saved reservation Customer exists but authoritative account link is missing |
| LOCAL_CONFLICT | Org billing mapping and reservation disagree |
| MISMATCH | Deleted/LIVE/foreign/name-mismatch or invalid Customer |
| PROVIDER_UNAVAILABLE | Provider read inconclusive; no safe automatic action |

| Checkout | Meaning |
|---|---|
| NO_PROVIDER_ID | No saved session ID; timeout may have created one |
| BLOCKED_CUSTOMER | Customer mapping not verified |
| MATCHED_OPEN | Exact saved TEST subscription Session matches DB and its one line item; not payment proof |
| MATCHED_EXPIRED | Exact Session is expired, still no automatic recreation |
| COMPLETED_UNVERIFIED | Stripe marks Session complete, but invoice/settlement and webhook proof not yet established |
| MISMATCH | Identity/price/quantity/return/expiry/currency/status invalid |
| PROVIDER_UNAVAILABLE | Provider read not conclusive; do not clear reservation |

## Provider documentation and API consistency

- Stripe Checkout Session object: https://docs.stripe.com/api/checkout/sessions/object
- Stripe Customer retrieve: https://docs.stripe.com/api/customers/retrieve
- Stripe Checkout Session line items: https://docs.stripe.com/api/checkout/sessions/line_items
- Stripe API idempotency: https://docs.stripe.com/api/idempotent_requests

## Remaining gates

- **MR-5D3D3:** separately approved, audit-logged reconciliation/release procedure; must not delete/replace reservation merely due to expired session, provider outage, incomplete webhook or missing ID.
- **MR-5E:** trial/paid entitlement policy based on verified payment + invoice evidence, never raw `ACTIVE` or Checkout return. Preserve **30 Free Review Requests**, RLS, usage and suppression controls.
- **MR-5F:** owner-deferred hosted provider TEST acceptance with actual Stripe TEST account, keys, invoice/renewal/payment-failure/cancellation tests, and approved deployment. No LIVE payment, pilot, migration deployment or pricing publication.
- Avoid misleading "Stripe Connect" terminology: MPG's tenant businesses are Stripe Billing Customers of MPG, not separate connected merchant accounts.

## Verification

Lint, typecheck, synthetic tests, production build; disposable PostgreSQL role/RPC-grant tests, tenant isolation, exact trusted ID/price/expiry context and lack of mutations; full intended diff. No real Stripe network, hosted Supabase mutation, secrets, public endpoint, charge, paid access, billing activation, main merge or launch.
