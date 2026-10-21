# MPG Reputation — MR-5C3C2A Recovery Operator Trust Boundary and Escalation

| Field | State |
|---|---|
| Date | 2026-10-18 |
| Milestone | MR-5C3C2A, bounded operations trust-boundary engineering |
| Baseline | MR-5C3C1 PR #24 `4001ecb0cc9558406cc12d3c78013aaf6aaf3ec7` |
| Company OS main | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Commercial activation | NOT AUTHORIZED |
| PR state | IN PROGRESS pending actual synthetic CI |

## Purpose

The earlier webhook reconciliation and retry work is real code, but it is dormant. Operations require two separate controls: (1) securely authorize the execution path without accidentally reaching hosted or production accounts, and (2) identify when an Event cannot recover automatically, without exposing customer data or silently pretending an alert was sent.

This slice prepares those boundaries **only for the local disposable synthetic Supabase environment**. This is intentionally narrower than a production-exposed manual endpoint, webhook, scheduler or job.

## Implementation

`src/lib/billing/stripe-recovery-operator.ts` exports `runAuthorizedLocalStripeRecoveryOperation` as a server-only, dependency-injected operator interface. It invokes the existing `dispatchStripeTestRecoveryBatch` only after all conditions hold:

1. `ENABLE_STRIPE_TEST_RECOVERY_OPERATOR=true`, **and**
2. existing `ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER=true`, **and**
3. `MPG_STRIPE_RECOVERY_TARGET=LOCAL_SYNTHETIC`, **and**
4. `NEXT_PUBLIC_SUPABASE_URL` equals the disposable local `http://127.0.0.1:54331` or `http://localhost:54331`, **and**
5. `VERCEL_ENV` is absent and `ENABLE_LIVE_BILLING` is not true, **and**
6. a private, 32-byte random hex-encoded `MPG_STRIPE_RECOVERY_OPERATOR_TOKEN` is present, **and**
7. the provided 64-character hex proof matches the server token in a constant-time comparison.

No public route or credential-bearing UI is created; no privileged client is instantiated by this module. The caller injects an already-authorized TEST Supabase client and Stripe event/subscription retrievers, and the earlier database role permissions remain the final enforcement. Token values are never logged, returned or persisted.

The server-only reporting helper `deriveStripeRecoveryOperatorSignal` converts safe aggregate counts to:
- `HEALTHY`: no material pending backlog/alerts;
- `ATTENTION`: automated retries/deferred backlog or failed events that remain retryable;
- `MANUAL_REVIEW_REQUIRED`: exhausted events, Event API age-outs or unhandled worker errors.

This signal is an **in-memory decision**, **not a sent alert, support ticket or notification**. Counts come from the start-of-batch queue inventory; backlog is calculated after allowing for the number of events examined.

### Support escalation and reconciliation runbook

When `MANUAL_REVIEW_REQUIRED` is returned:

1. **Do not manually mark a webhook PROCESSED**, set normalized `ACTIVE`, grant paid entitlements, or edit subscription tables from the dashboard.
2. Verify the environment is strictly TEST and confirm the source of any affected event using an authorized service-only audit workflow. Never share a Stripe API key, service-role key, token, customer email or raw webhook payload in logs, chat or support tickets.
3. For `EXHAUSTED_EVENTS` (five attempts), inspect the sanitized error status and provider availability. Do not reset counters without a documented, separately authorized recovery procedure.
4. For `AGED_OUT_EVENTS`, the current Stripe Event API may no longer return the original event. Use trusted Stripe TEST customer/subscription inventory and existing verified `organization_billing_accounts` mapping to identify the **current** provider subscription. Do not reconstruct the original event from the stored payload SHA-256; do not trust event metadata for tenant ownership.
5. Run a **separate** approved, subscription-level fenced reconciliation of fresh provider truth and record which internal event/subscription identities were investigated. The current local-only gate is not that hosted recovery tool.
6. For `PROCESSING_ERRORS`, inspect sanitized internal operational logs; confirm whether the failure came from database availability, provider retrieval, authorization or lease expiration. Keep actions within TEST only.
7. Escalate any real-customer billing discrepancy, charge dispute, production deployment, credential boundary change, or compliance uncertainty to the owner rather than improvising a DB mutation.

This is a documented manual **procedure**, not automated remediation. No real customer data is used in test execution.

## Remaining MR-5C3 work

MR-5C3C2B should implement/verify a **separately owner-approved authenticated scheduler or private worker interface** on an explicitly designated hosted engineering/test target, together with durable operator alert delivery, audit trails, recovery procedures for permanent provider Event retrieval failure and real Stripe TEST credentials. Supabase documents that Cron can trigger serverless work using `pg_cron` and `pg_net` with secrets stored in Vault, but that infrastructure is **not** enabled in this PR.

References:
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/cron
- https://docs.stripe.com/api/events/retrieve

## Explicit non-actions

No production deployment, scheduler, cron migration, public route, operator login feature, new auth role, hosted DB connection/migration, real Stripe test-account call, live billing, billing checkout, paid entitlement, messaging, customer pilot, pricing publication, Company Stage change or merge to main.

The latest owner continuation authorizes bounded engineering; it does not alter the accepted Company OS production or commercial gates. All preceding MR-5 PRs #18–#24 remain unmerged; this work is stacked on #24.

## Verification

Not accepted on source inspection alone. CI results must be recorded after actual checks run:
- lint, typecheck, test allowlist and production build;
- stacked migrations and existing isolated PostgreSQL suite;
- deny-by-default, wrong proof, wrong target, live flag and token mismatch tests;
- complete intended diff and no-secret/no-prod-change review.
