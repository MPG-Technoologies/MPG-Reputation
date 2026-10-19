# MR-5E3A — Subscription Lifecycle Transition Proposals (No Billing API)

**Status: IN PROGRESS until final CI and diff review.** This is an implementation-only checkpoint, NOT owner acceptance, paid entitlement activation, or a change to Company OS stage/milestone.

## Source control and governance

- Parent: MR-5E2D3 payment provider port accepted for engineering review at `a1332dbf4d2753017b00aaf151378a07b8c72e4c`.
- Product main: `6b7ac073432921789314315ec5fc624a81d8f699`, unchanged.
- Company OS main: `03a48a34481f1952a31cd5c4fb980bc381432d8d`. MR-5 is PAUSED / INCOMPLETE in accepted governance; bounded non-live feature work continues under the owner's latest instruction.
- Owner clarification: **No Stripe or any other payment provider API available yet.** Build a provider-ready system, connect later and perform provider tests after obtaining credentials.
- Proposed configurable prices remain `₱1,500/month` and `₱1,000/year` for engineering only. These are not final approved commercial prices.

## Existing architecture and why this is a separate slice

The authoritative MR-4 `src/domain/entitlement/policy.ts` already enforces the *30 Free Review Requests* trial and request-consumption restrictions. Existing MR-5 billing status `ACTIVE` and the MR-5E2D3 `EVIDENCE_ONLY` provider-port output are not paid access authority. The webhook system currently lacks an approved, trusted PROCESSED/paid transition, and the provider connector is intentionally not configured.

Do not change trial usage, entitlement database rows, RLS, provider secrets, suppression/unsubscribe or messaging controls just to simulate paid plans.

## Implementation

`src/domain/billing/subscription-lifecycle-proposals.ts` is a pure, deterministic, **synthetic-only proposal** policy. It accepts a normalized event, a prior subscription lifecycle snapshot, and deliberately explicit untrusted proof markers. It returns one of `BLOCKED`, `NO_CHANGE`, or `PROPOSAL_ONLY` with a candidate state. It **never authorizes** a request, writes a subscription, changes an entitlement or calls Stripe.

Proposed states: `ACTIVE`, `PAST_DUE`, `CANCEL_AT_PERIOD_END`, `ENDED`, `REVIEW_REQUIRED`.

Synthetic events: `INVOICE_SETTLED`, `INVOICE_FAILED`, `CANCEL_SCHEDULED`, `CANCEL_EFFECTIVE`, `PERIOD_EXPIRED`, `REFUND_OR_DISPUTE`.

Safety checks:
- TEST-only; any LIVE event or current LIVE state is denied.
- Exact organization, subscription and environment matching; valid identifiers/fingerprints and strict parseable timestamps.
- Require `PROCESSED` durable event marker for all proposals; positive activation/renewal also require `EVIDENCE_ONLY` provider inspection result.
- All other status-change proposals require an independently authenticated provider state change **when wired later**. A caller-supplied `statusChangeVerified: true` is **NOT** authentication and is used only by controlled synthetic tests.
- Same event ID/fingerprint returns `NO_CHANGE`; same event with different fingerprint or older/same-time different event fails closed. This only remembers the latest event; a future authoritative transaction must enforce global unique event IDs and verify a durable event's stored hash.
- Activation needs a future paid-through period. Renewal must strictly extend the previous paid period; no accidental free time extension from failed invoices.
- Cancellation scheduling retains the paid-through period. Cancellation/expiry cannot terminate prematurely. A refund/dispute proposes manual review, not continued paid access.
- No automatic revival of ENDED subscriptions; cancellation holds and exception-review holds cannot be bypassed through synthetic renewal.
- The existing MR-4 trial quota and consumption stay unchanged (regression tested).

## Non-authorization boundary

`PROPOSAL_ONLY` is a simulation result, not a financial assertion or entitlement. Even `candidate.status = ACTIVE` must never be used in a route, trigger, RLS function or product access check. The proof DTO is not cryptographic evidence, and there are no real provider accounts or integrations. All customer request eligibility must continue through the existing authoritative MR-4 path.

No RPC, schema migration, hosted DB action, Stripe call, checkout, provider keys, payment settlement, live messaging, real customer data, production deployment or merge into main.

## Next tightly bounded slices

1. MR-5E3B: define an audited, tenant-bound **authoritative paid entitlement schema and state transition** after verifying existing MR-4 DB schema; design atomic idempotency, replay and event-linkage controls. Keep migrations repository-only before approval/testing.
2. MR-5E2D3/processing follow-up: implement the real signed webhook → authenticated provider status → fenced durable PROCESSED outcome with audit and refund/dispute correction logic. Use a pluggable read-only provider adapter; no credentials are required to build its mock first.
3. Wire paid product-access authorization only when all accepted evidence contracts, processing finality, tenant isolation and trial/usage ceilings are upheld and owner approves the gate.
4. MR-5F: obtain Stripe TEST credentials later and perform hosted provider test acceptance. LIVE billing and customer charges need separate owner approval.

## Verification

Required: Internal CI lint, typecheck, synthetic Vitest tests, build and a full scoped diff review. Existing isolated PostgreSQL test workflow is a regression check; no new DB tests are necessary for this pure domain slice.
