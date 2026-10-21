# MR-5E3B — Private, Tenant-Bound Paid Entitlement Proposal Ledger

Status: IN PROGRESS — final CI and scoped security review pending.

## Governance and Source of Truth

- Company OS main `03a48a34481f1952a31cd5c4fb980bc381432d8d`; MR-5 remains PAUSED / INCOMPLETE under accepted governance with bounded non-live engineering resumed under latest owner direction.
- Product main `6b7ac073432921789314315ec5fc624a81d8f699`, unchanged.
- Parent: MR-5E3A verified owner-review checkpoint `bdd7fefeb60d4fa77b2a9599711eaae24664c704`.
- **No payment provider API credentials or Stripe account is connected.** Build provider-ready persistence only, without live billing, hosted DB changes or paid access activation.

## Verified Existing Boundary

- `organization_entitlements`, `usage_ledger` and `consume_trial_entitlement` from MR-4 are the authoritative existing **30 Free Review Requests** trial implementation; do not reset, consume or bypass it.
- `organization_subscriptions` is the provider billing projection, not a paid feature permission.
- `billing_webhook_events` is a private, environment-isolated durable inbox; MR-5E2D2 introduced TEST-only fenced claims and failures but not trusted PROCESSED provider payment finality.
- MR-5E3A added pure, synthetic-only subscription lifecycle **proposals**, not a payment/entitlement grant.

## Smallest Safe Persistence Slice

Repository migration `20261019140000_mr5e3b_paid_entitlement_proposals.sql` introduces `billing_paid_entitlement_proposals`, deliberately **not** `organization_entitlements` or an enforceable paid access table.

- Synthetic-only, TEST-only, `verification_status = UNVERIFIED` and `access_authorized = false` are database CHECK invariants, **even when candidate_status is ACTIVE**.
- Each record has a tenant-scoped composite FK to the existing subscription and a durable inbox record FK. A SECURITY INVOKER `BEFORE INSERT` trigger validates the webhook's organization, provider, environment, PROCESSED marker, processed timestamp, hash shape and proposed action/event type. This is a consistency guard, **NOT** independent Stripe authenticity. The webhook organization's original ON DELETE SET NULL semantics remain intact for erasure; a composite webhook-org FK would conflict with that erasure policy.
- One proposal per `webhook_event_record_id` protects against repeated event proposal inserts. Proposal action and candidate status are constrained to valid pairs.
- RLS enabled, **no anon/authenticated policy or table grants**, and `service_role` receives `SELECT, INSERT` only (no UPDATE/DELETE). No new RPC or public API route. Deleting a synthetic organization cascades the proposals and preserves webhook source erasure semantics.
- No invoice/payment/PII payloads, provider keys, card data, raw webhook contents or user-facing lease tokens are copied.
- No existing messaging, trial usage, billing provider adapter, subscription projection, reminder, suppression or unsubscribe behavior is changed.

This table is an append-only **proposal staging ledger**, not yet the authoritative paid entitlement state. It does NOT process webhook events, prove payment settled, grant access or allow conversion to a verified/published paid entitlement. An existing user can have a provider subscription normalized as ACTIVE but still cannot acquire paid access from a synthetic proposal.

## Integration/Owner Acceptance Gates

Future independently authorized work must: complete authenticated TEST provider invoice/payment/subscription retrieval; validate signed webhook PROCESSED state, organization and environment; apply financial finality/replay/refund/dispute policy; define an auditable atomic transaction that projects an owner-approved paid entitlement into a separate enforceable state; enforce quotas without bypassing MR-4; prove cross-tenant and stale-event denial in disposable tests; then perform hosted Stripe TEST acceptance when provider credentials exist. Live charges, final prices and production billing remain gated.

Migration stays in Git until owner-approved deployment/testing work. **Do not apply it to hosted Supabase as part of this slice.**

## Verification

Required: GitHub Internal CI lint, typecheck, synthetic tests, build; isolated disposable PostgreSQL suite (cross-tenant FK and source trigger, status/role denials, replay, trial quota unchanged and organization erasure); complete diff review; no secrets, RLS weakening, entitlement writes or unexpected files. Do not claim engineering complete before checks pass.
