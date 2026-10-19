# MR-5I4A — Reserve invoice events for invoice-evidence processing

**State: ENGINEERING COMPLETE / READY FOR OWNER REVIEW, NOT OWNER ACCEPTED.**

## Verified remote state and owner bounds

- Company OS main `03a48a34481f1952a31cd5c4fb980bc381432d8d` — MR-5 remains INCOMPLETE, MR-7 Trust/Security accepted as owner-approved milestone; subsequent owner authorization permits bounded NON-LIVE billing engineering only.
- Product main `6b7ac073432921789314315ec5fc624a81d8f699` — unchanged.
- MR-5I3 parent PR #54 feature HEAD `bf6f3cb72b707acfa53c066dc2da8198a7d6e1f1` — ENGINEERING COMPLETE / READY FOR OWNER REVIEW; UNMERGED.
- The initial design brief was to bridge subscription processing and invoice financial evidence without Stripe API credentials. Remote code inspection exposed an **earlier security/consistency prerequisite** that must be fixed first.

## The concrete risk

The merged feature tree has two different processors sharing `billing_webhook_events` and the lease pair: the MR-5C subscription recovery worker and MR-5E2 invoice evidence claim. Before this change, the MR-5C queue inventory and event lease permit any Stripe TEST event type, including `invoice.paid` and `invoice.payment_failed`. Its subscription worker classifies these as unsupported and could finish them as `IGNORED`, rendering the MR-5E invoice-evidence preflight unavailable and obscuring payment history. A signed webhook is durable evidence of receipt, **not** payment settlement.

## Smallest safe fix

Update the existing **unmerged** `20261018225000_mr5c3c1_test_recovery_queue.sql` feature-branch migration with `event_type NOT LIKE 'invoice.%'` consistently at:

1. Subscription recovery partial queue index.
2. `lease_stripe_webhook_processing` (service-role-only atomic claim).
3. `complete_stripe_webhook_processing` (SQL-fenced finalization).
4. The eligible ID selector in `inspect_stripe_test_webhook_recovery`.
5. Queue inventory aggregate counts.

Use all `invoice.*` events rather than only today's two recognized invoice event types, so new Stripe invoice types cannot be consumed accidentally before provider-evidence policy is extended. Preserve existing customer/subscription event support, retry cooldown, subscription mutex, lease/fencing and RLS/security-invoker grants unchanged. No new schema table/permission or public route.

Extend the existing **isolated** MR-5C recovery dispatcher integration test to seed `invoice.paid`, `invoice.payment_failed`, and an unexpected `invoice.upcoming`, and verify:

- No invoice is queued, counted or leased by subscription recovery; even a direct service-role claim returns `NO_WORK`.
- A forged attempt to finish an invoice as `IGNORED` is denied with `NOT_LEASE_HOLDER`.
- Signed receipt rows stay RECEIVED, unprocessed and tenant-unassigned, with both attempt counters untouched.
- The separate MR-5E2 invoice evidence claimant **still leases** the two recognized types; the future unknown invoice type is ineligible.
- Even once the dedicated invoice lease owns a row, MR-5C claim and finalization remain denied. This does **not** mark payment PROCESSED, settle an invoice, or authorize paid usage.

## Verification and next gate

Require Internal CI lint, typecheck, full application tests and synthetic build; disposable Supabase/PostgreSQL migrations plus all prior cross-chain domain/security tests, isolated recovery dispatcher/owner-operator tests, and SQL cleanup. Inspect complete diff; no production or hosted migrations, real Stripe traffic/credentials, paid entitlement writes or main merge.

**Next MR-5I4B:** create a read-only, explicit/local TEST correlation boundary between already durable invoice references, independently sourced future `BillingEvidenceReadPort` facts, and tenant-safe subscription projection. Keep `NOT_CONFIGURED` when Stripe credentials are absent; never promote a subscription's `ACTIVE` status to payment truth or paid access.

## Final test results and correction
- First database run: **176/176** baseline PostgreSQL tests passed; the new test failed during fixture creation because the existing `billing_webhook_events_invoice_reference_check` correctly forbids storing an invoice reference for the unsupported `invoice.upcoming` event. Corrected **test fixture only** to set `provider_invoice_id = NULL` for that type. No RLS, schema constraint or production behavior was weakened.
- [Internal CI #39238426747](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39238426747): PASS — lint, Next route type generation, typecheck, **682/682 application tests (47 files)** and synthetic production build.
- [Isolated Synthetic E2E #39238426697](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39238426697): PASS — **176/176 combined disposable DB tests (24 files)**, **7/7 recovery queue tests** (including one new invoice ownership regression), **2/2 sealed operator tests**, **4/4 signed local operator tests** = **189/189 database-backed tests**; database teardown PASS.
- Diff contains only this handoff, original unmerged feature migration, and existing recovery queue integration tests; invoice processing lease and source RLS/grants are not changed. No credentials, Stripe API calls, hosted DB operation, live billing, paid-access activation or `main` merge.
- Next MR-5I4B remains separately gated: read-only subscription-projection+invoice evidence correlation, default NOT_CONFIGURED without an independently verified provider adapter; never grant paid access from an ACTIVE projection.
