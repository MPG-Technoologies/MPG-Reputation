# MPG Reputation — MR-5C1 Provider-Truth Projection Candidate

| Metadata | Value |
|---|---|
| Slice | MR-5C1 — trusted Stripe subscription state normalization |
| Status | ENGINEERING SLICE IN PROGRESS pending CI and review |
| Base | Product main `6b7ac073432921789314315ec5fc624a81d8f699` |
| Owner direction | Continue bounded subscription engineering; Stripe API/Price IDs not yet supplied |
| Relationship | Independent of unmerged MR-5 pricing PR #18 |
| No live billing | Guaranteed: no live Stripe client or payment route touched |

## Problem and smallest safe change

Current `src/lib/billing/stripe-subscription-truth.ts` retrieves fresh provider identity/status and resolves Stripe Customer ID to a trusted organization, but cannot yet form the complete local subscription row for `organization_subscriptions`. The webhook route persists *intake only*. MR-5C transactional projection, recovery, and provider wiring remain unfinished.

This slice adds one **pure candidate preparation function** in `src/lib/billing/stripe-subscription-candidate.ts` and allowlisted synthetic tests. No service-role query, API call, schema migration, entitlement logic, Stripe Checkout or source-to-database mutation is introduced.

### Trusted boundary

Input must be a fresh Stripe subscription retrieved by a future safe processor **after** verified signature, LIVE gate, Stripe environment match, and persisted Stripe Customer mapping. The function rechecks:
- subscription ID and customer ID match the trusted organization resolver output, TEST/LIVE cannot cross;
- organization/billing account IDs are UUIDs;
- the provider status is one of Stripe's known status enum values;
- exactly one subscription item and one valid provider Price ID;
- coherent billing period start/end (item-level modern API fields; old subscription-level fields only as a pair), a valid cancellation flag and timestamp;
- no arbitrary provider metadata or customer contact data is retained.

Provider status mapping is **billing projection only**:
| Stripe status | MPG normalized status |
|---|---|
| `incomplete`, `trialing` | `PENDING` |
| `active` | `ACTIVE` |
| `past_due`, `unpaid`, `paused` | `SUSPENDED` |
| `canceled`, `incomplete_expired` | `ENDED` |

**Important**: An `ACTIVE` billing projection **does not establish invoice settlement, payment received, trial conversion, production messaging or paid entitlement**. `GRACE` is deliberately never granted without an approved grace-period/dunning policy. A scheduled end-of-term cancellation flag does not mark an active subscription ENDED prematurely.

`providerStateUpdatedAt` remains **null**. The creation timestamp of a Stripe Event is not a monotonic subscription-state version and cannot safely decide out-of-order authority. The subsequent MR-5C2 transactional projection must serialize changes, re-fetch provider truth, handle existing rows and replay/recovery correctly.

## Acceptance tests

`test/domain/stripe-subscription-candidate.test.ts` covers all eight statuses, tenant/customer/environment spoofing, malformed/ambiguous subscription items, wrong/missing prices, invalid periods, legacy item-to-subscription period fallback, pending cancellation, and data minimization. `.github/workflows/internal-ci.yml` explicitly includes the new tests.

## Remaining work and dependency

- **MR-5C2:** implement atomic, idempotent, tenant-bound projection/upsert using trusted provider state and deterministic recovery. Existing `organization_subscriptions` constraints must hold. Do not change RLS or use service-role in caller code for convenience.
- **MR-5C3:** connect background processing to durable verified intake, mark processed/failed with bounded retry and sanitized audit evidence. No subscriber state may be inferred solely from webhook event snapshots. 
- **MR-5D/E/F:** checkout/customer portal, paid entitlement sync, hosted Stripe test-mode acceptance **remain incomplete and provider-gated**.
- **PR #18:** proposed ₱1,500/month and ₱1,000/year owner pricing and server environment configurability remain in a separate unmerged PR. Avoid duplicating or silently merging that work.

Company OS `MPG-DEC-051` remains authoritative for MR-7 legal gate, MR-8 gated, Case B excluded, and no commercial charges, live messaging, pilot, public site or launch authority.

Stripe status reference: https://docs.stripe.com/api/subscriptions/object

### Verification
Will be filled only with actually executed CI. No hosted DB operation or Stripe API call in this slice.
