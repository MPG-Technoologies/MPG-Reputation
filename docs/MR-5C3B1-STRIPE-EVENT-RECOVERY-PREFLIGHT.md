# MPG Reputation — MR-5C3B1 Trusted Stripe Event Recovery Preflight

| Metadata | Value |
|---|---|
| Slice | MR-5C3B1 — persisted verified Stripe Event recovery, validation and tenant-correlation preflight |
| Status | IN PROGRESS pending real CI |
| Base | MR-5C3A owner-review branch `chatgpt/mr5c3a-webhook-processing-leases` (`3b746f1c09c1e5330ff698741204baaac4c5cc86`) |
| Provider mode | Stripe **TEST only**, no external provider credentials present or used in verification |
| Production changes | **NONE** — no route, live API, hosted database or entitlement mutations |

## Continuation and motivation

The existing webhook route verifies the exact raw Stripe signature and persists only a durable Stripe Event ID, type, environment, and SHA-256 of the body. It does **not** persist the event payload for replay. MR-5C3A adds TEST-only, service-role-only leasing of previously verified event records, with short-lived fencing tokens, duplicate locking and bounded retries. MR-5C2 adds atomic TEST subscription projection persistence, and MR-5C1 adds a conservative projection candidate constructor.

MR-5C3B1 bridges an important missing read-only step in that workflow: recovering a previously stored, verified TEST Event from Stripe itself, re-fetching the current Subscription and preparing a trusted, organization-linked candidate **without writing** it.

## Implementation

`src/lib/billing/stripe-recovery-preflight.ts` exports `prepareRecoveredStripeSubscription`. A caller must supply an already service-only accessible Supabase connection and its current `eventRecordId` and `leaseToken`. The function:

1. Reads the durable `billing_webhook_events` row; verifies `PROCESSING`, `TEST`, provider `stripe`, valid Event ID, a **matching unexpired processing token**. If not, it does not request provider data.
2. Fetches the Event from an injected Stripe adapter by stored Event ID; confirms returned Event ID/type/livemode match the signature-verified durable record. For unsupported Event types, returns `IGNORED` after validating identity.
3. For subscription created/updated/deleted events, validates the subscription object and ID; fetches the **current Subscription**, *not the webhook snapshot*, and confirms it is a TEST subscription with the right ID.
4. Reuses the existing `resolveStripeSubscriptionOrganization` to map the trusted Stripe Subscription customer against `organization_billing_accounts`, ignoring event-snapshot metadata.
5. Reuses the MR-5C1 subscription projection validator, rejecting malformed prices, statuses, dates, cross-tenant customer, and TEST/LIVE mismatches.
6. Re-reads the lease and refuses to return a candidate if the lease expired or was superseded while fetching Stripe.
7. Returns a minimized, validated `READY` candidate with a trusted provider customer identifier, or an explicit sanitized `FAILED` reason compatible with MR-5C3A's error-code allowlist. No raw customer contact data or provider error text is propagated.

`src/lib/billing/stripe-test-recovery-transport.ts` provides a Stripe SDK-backed TEST-only adapter. It **refuses live and publishable keys** regardless of `ENABLE_LIVE_BILLING` and only retrieves events and subscriptions; it does not create charges, checkout sessions or payment methods. It is **not imported into the webhook route or automatically invoked**.

`test/domain/stripe-recovery-preflight.test.ts` uses synthetic event/Stripe retrievers and a fake read-only DB query interface; no actual Stripe keys, network calls or hosted data. CI explicitly allowlists the tests.

## Important processing and recovery constraints

- Stripe's Event retrieval API currently permits retrieving an event **only within 30 days of creation**. An older webhook claim may not be recoverable from Event ID alone. Retried failures must stop at the established attempt cap and be flagged for manual reconciliation using authenticated billing accounts and current provider truth; never synthesize event payload from its SHA hash. Reference: https://docs.stripe.com/api/events/retrieve
- A valid event-level lease is **not** a subscription-level lock. Two different Stripe Events for the same subscription can finish provider API retrieval and database updates out of order. Therefore, MR-5C3B2 must implement per-subscription serialization and fencing for the entire **fetch → trusted customer resolution → write** critical section, and prevent a stale lease owner from applying a projection after takeover.
- **This slice never calls MR-5C2 persistence**, marks an event `PROCESSED` or `IGNORED` in the DB, or starts an HTTP/serverless scheduler. `READY` means prepared for later transactional reconciliation, **not settled payment** or subscription entitlement.
- Re-reading the lease prevents known expiry at preflight return but does **not** make the later provider-data write safe without a transactional fencing check. Never connect this preflight alone to production processing.
- Full MR-5C3 will additionally need a trusted worker trigger, bounded retry/backoff, reconciliation for permanently failed Event lookups, operational observability and synthetic cross-event ordering tests.

## Governance continuity

- Latest verified Company OS main `03a48a34481f1952a31cd5c4fb980bc381432d8d`: MR-5 remains historically PAUSED/INCOMPLETE under MPG-DEC-049; MR-7 ACTIVE / legal review outstanding (DEC-051), MR-8 GATED, Case B excluded, no real customer pilot/production billing/messaging/launch.
- The owner has explicitly directed bounded engineering continuation; no production authorization or public pricing approval is inferred.
- [PR #18](https://github.com/MPG-Technoologies/MPG-Reputation/pull/18) separately holds the owner-corrected engineering proposal **₱1,500/month and ₱1,000/year total** and server environment configurable amounts. This slice does not modify pricing.
- [PR #19](https://github.com/MPG-Technoologies/MPG-Reputation/pull/19), [PR #20](https://github.com/MPG-Technoologies/MPG-Reputation/pull/20), and [PR #21](https://github.com/MPG-Technoologies/MPG-Reputation/pull/21) remain open and unmerged; this is a stacked review branch on #21, not a main change.

## Verification

Pending actual GitHub Actions CI. No test result is implied until a run succeeds.
