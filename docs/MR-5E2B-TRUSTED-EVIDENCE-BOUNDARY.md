# MR-5E2B — Trusted invoice evidence assembler: implementation boundary

Status: INVESTIGATING / DESIGN ONLY — not engineering complete.
Base: MR-5E2 synthetic event correlation branch at `52119e95e21a8b44bea203aba97a2d908b00ebd4`.
Company OS main: `03a48a34481f1952a31cd5c4fb980bc381432d8d`.
Product main: `6b7ac073432921789314315ec5fc624a81d8f699`.
Company OS continues to record MR-5 PAUSED / INCOMPLETE; bounded non-live engineering was directed by owner. No billing activation or hosted tests.

## Findings

- Existing `src/domain/billing/policy.ts` explicitly treats billing subscription projection as non-entitlement.
- MR-5E1's `assessPaymentEvidence` requires consistent tenant, invoice, environment, currency, subscription, paid status, succeeded payment, period and freshness, but **does not authenticate** those supplied facts.
- MR-5E2's `correlateInvoiceEvidence` deduplicates matching synthetic provider events and rejects conflicting, unprocessed, unsigned, stale or foreign events; `signatureVerified` remains a caller-supplied boolean, not trustworthy proof.
- MR-5D3D2 provider-recovery adapter reads saved Checkout/Customer IDs only, not invoice or payment settlement. A Checkout marked complete is not paid evidence.
- Therefore no available verified runtime path yet bridges signed durable webhook processing to independently authenticated provider invoice/payment truth, and there is no authority to grant paid access.

## Smallest safe implementation contract before wiring

1. Inspect the existing MR-5C webhook ingress, signature verification and replay/idempotency implementation and the exact durable inbox/reconciliation tables before modifying them. Do not create a parallel event-authority mechanism.
2. Authenticate tenant identity against existing organization billing binding using a server-only, scoped read; browser input and organization-scoped OWNER/ADMIN must not select arbitrary Stripe Customer, Subscription, Invoice or event IDs.
3. Assemble normalized evidence *only* from durable provider-event records already verified by the trusted ingress and independently retrievable provider invoice/subscription/payment facts. Derive verification provenance on the server; never accept a boolean from caller as proof.
4. Ensure each event's provider ID, event environment, invoice ID, subscription ID, organization mapping, processing state and ordering are consistent. Replays, late payment-failed events, refunds and disputes must not create a stale paid assessment.
5. Reject unknown/ambiguous provider result, unresolved event processing, missing linkage or mismatch without changing reservation, user role, billing status, entitlement or trial usage.
6. Return a bounded internal assessment without raw Stripe objects, PII, checkout URLs, credentials or unrestricted provider identifiers. Only a later separately reviewed MR-5E3 transaction may project entitlements.
7. Verify tenant/foreign identity denial, concurrent replay, delayed failure, wrong invoice/currency, missing provider response, PENDING/FAILED durable event, outdated evidence and auditability in isolated synthetic and disposable DB tests.

## Explicit blockers and acceptance gates

No code or migration should be introduced until the exact MR-5C trusted ingress/inbox schema and the right side of its provider resolver are verified from the current product branch. A simple `signatureVerified: true` DTO is **never** adequate authority.

Do not conflate:
- Stripe Checkout success return with payment settlement.
- Local ACTIVE subscription projection with invoice paid evidence.
- MR-5E2 synthetic CORRELATED_EVIDENCE_ONLY with a trustworthy entitlement.
- Existing MPG_ADMIN investigation grants with financial transaction authority.

MR-5E3 must preserve 30 Free Review Requests and all existing suppression/unsubscribe and tenant/RLS controls. Hosted Stripe TEST acceptance remains owner-deferred; LIVE billing, financial mutation, production deploy, and main merge remain unauthorized.

## Next

Inspect concrete webhook, subscription and billing persistence code; map field-level evidence provenance; only then implement minimal read-only assembler and targeted tests. Reconcile MR-5E2 CI before marking it engineering complete.
