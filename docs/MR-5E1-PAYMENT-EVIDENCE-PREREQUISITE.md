# MR-5E1 — Payment Evidence Prerequisite (Synthetic Contract)

| Control | State |
|---|---|
| Base | MR-5D3D3C accepted policy branch `d24bca54fe48dd5ce759f69cc7d32117488fea11` |
| Scope | Pure domain classifier and synthetic unit tests only |
| Status | IN PROGRESS — verification pending |
| Governance | MR-5 remains PAUSED/INCOMPLETE in Company OS; owner requested bounded non-live engineering |
| No authorization | No active paid entitlement, payment capture, provider calls, hosted migration, production change, or main merge |

## Existing implementation inspected

`src/domain/billing/policy.ts` explicitly separates normalized subscription projection from product entitlement. `src/domain/billing/catalog.ts` has proposed, configurable PHP monthly/annual plan assumptions, not approved offers. The MR-5D3D2 provider recovery read verifies saved Checkout/Customer IDs but deliberately labels a completed checkout COMPLETED_UNVERIFIED. MR-5D3D3C is the owner-accepted *policy baseline* requiring payment/invoice verification.

## What this slice adds

`src/domain/billing/payment-evidence.ts` supplies a pure fail-closed synthetic prerequisite checker. It requires a fresh invoice marked paid with zero remaining amount, independently indicated succeeded payment, active subscription status, matching TEST/LIVE mode, exact organization and subscription correlation, and a nonexpired period. It returns only a prerequisite classification, **never entitlement**.

`test/domain/payment-evidence.test.ts` exercises null/stale/foreign/mismatched/unpaid/failed/expired scenarios and a synthetic matching case. No database, environment flag, API route, Stripe adapter, customer data or runtime feature access is changed.

## Explicit limitations and remaining work

The classifier **cannot independently verify** its caller's object came from Stripe, or establish webhook ledger processing, invoice settlement finality, customer mapping, refund/dispute state, cancellation behavior, entitlement dates or trial/usage transitions. In particular a caller-supplied `VERIFIED_PAYMENT_EVIDENCE` assessment must not grant paid access. Next: design a trusted provider and durable webhook/invoice correlation service, source-authenticated, cross-checked with tenant and RLS; add tests for duplicate/out-of-order provider events; only subsequently design a separate fail-closed paid-entitlement state machine.

Preserve **30 Free Review Requests**, suppression, unsubscribe and existing tenant/RLS boundaries. Final price, real Stripe test-mode and LIVE acceptance remain explicitly gated.
