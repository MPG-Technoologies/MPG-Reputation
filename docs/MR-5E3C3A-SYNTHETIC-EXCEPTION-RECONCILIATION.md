# MR-5E3C3A — Exception Reconciliation Policy (Synthetic-Only)

**Status: IN PROGRESS pending CI and review.**

## Verified authority
- Company OS `techwithmpg/mpg-company-os` main: `03a48a34481f1952a31cd5c4fb980bc381432d8d`; MR-5 PAUSED / INCOMPLETE, MR-7 active under accepted governance. Subsequent owner direction authorizes bounded, non-live billing preparation without payment credentials.
- Product `MPG-Technoologies/MPG-Reputation` main: `6b7ac073432921789314315ec5fc624a81d8f699`, unchanged.
- Parent: MR-5E3C2 HEAD `25d0f1634a517786cfa9710d381084bc4728fdb4`, PR #47 engineering verified, unmerged.
- Owner reiteration: no Stripe or other payment API credentials yet; keep integration optional and prepare architecture for later TEST wiring. No hosted migrations, charges, paid entitlement activation or production deployment.

## Existing system preserved
MR-5E3A provides purely proposed lifecycle transitions. MR-5E3B stores private TEST/SYNTHETIC/UNVERIFIED proposals, permanently `access_authorized = false`. MR-5E3C1 reads tenant-bound event identity to stage proposals in disposable tests. MR-5E3C2 protects cross-event ordering with a service-only, transactional PostgreSQL insert trigger. None of this proves settlement or modifies the MR-4 **30 Free Review Requests** trial.

## Bounded MR-5E3C3A implementation
`src/domain/billing/synthetic-exception-reconciliation.ts` is a **pure, credential-free, read-only** deterministic policy for inspecting a bounded (at most 100 events) synthetic subscription history. It accepts normalized TEST-only, UNVERIFIED-only, non-authorizing records; no external provider reads or privileged clients are available.

It emits one of:
- `SIMULATED_CANDIDATE_ONLY` — a possible synthetic transition, never an entitlement, with a candidate status/period.
- `NO_CHANGE` — an identical source event already appears in the supplied history.
- `REVIEW_REQUIRED` — fail-closed exception with an explicit reason code.

Conservative rules:
1. Exact tenant, subscription-record and provider-subscription linkage, event UUID/hash/ISO time checks and strictly increasing synthetic provider event time. Reject duplicate history events, reversed or equal timestamps, missing lineage, and LIVE inputs.
2. Delayed older renewals do not override newer failures. An identical replay is `NO_CHANGE`; replay with a different hash or candidate is escalated.
3. A renewal after PAST_DUE becomes `PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW`, even if its simulated period advances. Repeated failure also escalates. Failures never add paid time.
4. A dispute/refund requires review; historic dispute review, cancellation or termination holds cannot be silently cleared by later paid proposals.
5. End-of-period changes cannot be simulated before paid-through time, and no failed payment or cancellation without prior subscription becomes an activation.
6. Outputs include a structured minimal **audit-ready descriptor** with tenant/subscription/event IDs, reason and assessment time. `durableAuditRecorded = false` explicitly confirms this is **not persisted**, not a manual-review case filed in the support system, and not financial evidence.
7. No database imports, writes, API endpoints, scheduler, Stripe SDK, hosted TEST integration, prices, RLS policies, permission grants, trial/usage mutations, entitlement grants, or live messaging.

## Important limitations
- The input history is caller supplied in isolated synthetic tests. This pure policy **does not** prove the history is complete or authenticated. A future read-only server resolver must independently join the correct private tables under tenant isolation and enforce a transactional snapshot.
- Stripe event creation time alone does not establish financial causality, provider state or payment settlement. Manual review is not optional for ambiguous recovery/corrections.
- **No durable manual-review audit log exists in this slice**; durable review-case persistence, deduplication, ownership, redaction, and support approvals remain a separately scoped follow-up.
- The positive synthetic state is never a product-access decision. MR-4 remains authoritative for 30 Free Review Requests and suppression/unsubscribe must remain intact.

## Verification and next
Run Internal CI lint/typecheck/synthetic tests/build, isolated PostgreSQL regression workflow, full scoped diff. Next MR-5E3C3B may stage deduplicated, private review cases under a local synthetic-only gate, after inspecting existing support/recovery review architecture. Do not create parallel reviews unnecessarily; preserve reuse and await owner approval for any real customer/production integration.
