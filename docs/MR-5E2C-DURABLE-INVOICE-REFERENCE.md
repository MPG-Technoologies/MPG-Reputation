# MR-5E2C — Minimal Signed Invoice Reference in Durable Webhook Intake

| Control | State |
|---|---|
| Scope | Persist exact provider invoice ID from signed invoice events only |
| Parent | MR-5E2B corrected HEAD `845b2d44794e0edebc652e1abd7051d3c5165bf7` |
| Company OS main | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Milestone governance | MR-5 PAUSED / INCOMPLETE in Company OS; bounded non-live engineering explicitly continued by Owner |
| State | IN PROGRESS — fresh CI validation pending |

## Verified preexisting behavior

The production HTTP Stripe route verifies the original webhook's signature before calling `claimVerifiedStripeWebhookEvent`. The latter deduplicates by (provider, environment, event ID), stores the raw-body hash, event type and processing status, but does not persist the invoice ID or process a subscription. MR-5E2B independently resolves invoice ownership against the provider invoice identity and existing tenant Customer/Subscription mapping. Neither proves payment.

## Bounded implementation

- One nullable `provider_invoice_id` on the existing private, RLS-enabled `billing_webhook_events` table. The SQL CHECK allows a populated ID only for `invoice.paid` or `invoice.payment_failed` and enforces the `in_` identifier shape. Existing historical NULL rows remain unresolved rather than being inferred or backfilled.
- `claimVerifiedStripeWebhookEvent` extracts an invoice ID **only after** the signed event has passed the existing route's Stripe verification. For an invoice event without the correct object/ID, it fails closed before inserting. An unrelated event never obtains an invoice ID from metadata or other fields.
- The API handler, existing duplicate-event hashing, TEST/LIVE isolation, event status, organization link and RLS privileges are unchanged. Only the minimal invoice ID is retained; no amount, customer email, raw payload, payment intent, receipt or checkout URL.
- Disposable PostgreSQL test calls the actual signed HTTP route and verifies persisted invoice ID for paid and failed events, null for unrelated events, malformed-object denial, body signature tampering denial and replay deduplication.

## Remaining security/operational gates

A signed `invoice.paid` event stored as `RECEIVED` is **NOT** proof of payment, a processed webhook, an approved subscription, or an authorization to provision paid access. The new column is a correlation *hint* only. Event-body authenticity is verified at ingestion; later processing still requires independently fetched provider Invoice/Subscription/Payment truth, fresh organization mapping, immutable event state transitions, ordering/replay handling, refunds/disputes and evidence provenance.

Do not grant paid entitlements based on `provider_invoice_id`, `processing_status = 'RECEIVED'`, Checkout success or a local ACTIVE subscription projection. MR-5C resolver/processor and MR-5E3 entitlement state remain separately gated.

No hosted migration execution, live Stripe test keys, customer charges, entitlement write, tenant/RLS weakening, production deployment, release or main merge. Preserve **30 Free Review Requests**, suppression/unsubscribe and usage caps.

## Verification and next slice

Run GitHub Internal CI and isolated synthetic PostgreSQL E2E, review full scoped diff and fix any implementation failures. Next: design and implement a minimum authorized event processor that independently retrieves provider facts and atomically tracks invoice-processing state without granting entitlements.
