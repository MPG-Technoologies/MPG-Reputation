# MPG Reputation — MR-5D3D3C Billing Recovery Decision Policy (OWNER-ACCEPTED POLICY BASELINE)

| Control | State |
|---|---|
| Slice | MR-5D3D3C — policy and evidence contract ONLY |
| Status | OWNER ACCEPTED — policy baseline only, 2026-10-19; financial action authority remains unresolved |
| Product base | MR-5D3D3B at `fbc933061892e9debeb6ed455ea0c4bdeff03951` |
| Company OS | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Governance | Company OS records MR-5 PAUSED/INCOMPLETE; later owner instruction permits bounded non-live engineering, not billing activation |
| Mutation, hosted Stripe acceptance, live billing | NOT AUTHORIZED |

## Purpose and existing contracts

The MR-5D3D3A private `stripe_test_billing_recovery_reviews` table is append-only, records OPEN requests and is not an approval ledger. The MR-5D3D3B support view exposes a minimal, audited per-organization read model after `authorizeSupportAccess`. Existing MR-6A MPG_ADMIN support grants are organization-scoped and allow investigation only, not financial decision rights. Ordinary tenant OWNER/ADMIN membership can request a review but cannot resolve it.

The owner accepted this policy-only baseline on 2026-10-19. Unresolved action-specific questions below remain explicit gates for future implementation. **It does not confer authorization to implement or invoke recovery mutations.** In particular no release, retry with a new idempotency key, overwrite customer mapping, mark-paid, provision entitlement, refund, or close-as-approved operation follows from an OPEN case.

## Proposed decision classes (no executable commands yet)

1. **NO_ACTION_REQUIRED**: independent evidence proves no outstanding inconsistency. Record an immutable explanation before any eventual closure mechanism.
2. **NEEDS_MORE_EVIDENCE**: Stripe response is ambiguous, stale, unreachable or lacks an exact saved provider ID. Preserve all reservations and links.
3. **ESCALATE_CONFLICT**: provider object does not match the tenant, frozen checkout terms, customer binding, reservation, or current projection. Do not auto-correct.
4. **PROPOSE_SAFE_RETRY**: only after current provider truth and transaction state prove an exact original idempotency/reservation retry is safe. This is *not* permission to generate a fresh key.
5. **PROPOSE_MANUAL_RESOLUTION**: operator requests a separately authorized, explicitly scoped change. Proposal has no side effect.

No decision class is equivalent to `PAID`, `SETTLED`, `APPROVED` or `CLOSED`. Actual closing and changing records require a separately reviewed immutable decision/event model and database transaction contract.

## Authority and separation of duties — owner decision required

- A signed-in business OWNER/ADMIN may create an eligible review request through the existing narrow path; this does not grant MPG operator rights.
- A currently authorized, exact-org MPG_ADMIN may inspect cases and generate an **investigation recommendation only**, subject to fresh membership/grant checks and mandatory audit.
- An actor permitted to **approve financial recovery mutations** has NOT been defined. Do not reuse `MPG_ADMIN`, service-role possession, or tenant OWNER/ADMIN as a substitute for this missing authorization.
- Owner must specify the approving role, per-organization scope, whether independent second approval is required, approval expiry, revocation checks, and any provider-account operational dependency. Fail closed while undecided.
- The eventual executor must reauthorize at commit time, never rely on page-render, case creation or a previously cached grant.

## Evidence required before any action policy can be approved

- Verify current authenticated actor, exact active organization and current membership/grant; no cross-tenant reads.
- Fresh, exact-ID Stripe TEST provider reads against the saved immutable Customer/Checkout IDs only; record source, time, identity match and freshness threshold. Provider API failure or missing ID is **UNKNOWN**, not proof that no object exists.
- Independently verify the original reservation, idempotency key, fixed Stripe Price/quantity/currency, client reference, checkout expiry, subscription projection and authoritative tenant/customer mapping.
- Preserve independently corroborated invoice, payment-intent and subscription evidence for any potential paid state. A completed Checkout Session or locally ACTIVE projection alone is **NOT** sufficient payment evidence.
- Account for in-flight, late, replayed and out-of-order webhooks; provider-truth and local-state snapshots must not be interpreted as atomically consistent.
- Reference evidence through minimal immutable identifiers/fingerprints and timestamps, not raw provider payloads, payment details, personal data, secrets or checkout URLs in review/audit logs.

## Transaction, deduplication and conflict rules for a future design

- Bind each proposal to one case UUID, exact organization, kind, evidence fingerprint, expected state/version and named action intent.
- Enforce DB-scoped idempotency for proposals, approvals, and executions; concurrent workers must not execute twice. Distinguish a repeated command from new authorized intent.
- Under appropriate organization/case/reservation locks, atomically recheck case state, active subscription/entitlement, lease, provider identity, current membership and evidence freshness immediately before any local mutation.
- Never bypass existing webhook inbox, deduplication, recovery correlation, suppression/unsubscribe, trial/usage or entitlement gates. No direct `paid` flag.
- Reject stale evidence, unexpected foreign IDs, contested mappings, unknown provider outcome, changed Price, changed tenant, concurrent completion, or a pending webhook; escalate instead of guessing.
- A released reservation or retried session must be proven nonpayable/noncompleting under an owner-approved provider-side finality protocol before any new attempt is allowed. No automated expiry-based release.
- Design immutable actor-attributed audit for recommendation, approval/denial, proposed action, execution result, failure and rollback/compensation; audit persistence failure must block execution. Do not rely on editable notes.
- Define forward-only compensation and conflict handling rather than deleting immutable evidence or reusing an uncertain idempotency key.

## Owner review decisions / explicit gates

1. Who, if anyone, may approve a payment-impacting recovery? Is a second independent approver necessary?
2. Which action types can be permitted at all? Treat release/relink/mark-paid/refund as individually gated, not implied.
3. What exact Stripe evidence, freshness threshold and webhook finality checks are mandatory per action?
4. What immutable decision ledger, atomic database lock/compare-and-swap and audit protocol should be accepted?
5. What is the manual escalation/compensation runbook for unknown or conflicting provider state?
6. When will hosted Stripe TEST acceptance be authorized? It remains owner-deferred.

## Acceptance criteria for this POLICY slice

- Policy explicitly separates tenant request, MPG investigation, owner-approved financial decision and future execution.
- Missing provider evidence always fails closed; never infer payment or no payment from an ambiguous checkout.
- Any future mutation requires independently approved authority, evidence, locking, idempotency, audit and rollback design.
- Current MR-5C webhook reconciliation, MR-5E invoice-backed entitlements and MR-5F hosted TEST acceptance remain separately gated.
- Preserve **30 Free Review Requests**, suppression/unsubscribe, existing RLS and tenant isolation.
- No application code, migrations, permissions, billing state, provider API calls, secrets, deployment or `main` merge in this slice.

## Next

Owner accepted the baseline; before any financial recovery implementation, resolve the remaining authority/evidence questions through a separate explicit decision. Only then design the smallest safe mutation-specific MR-5D3D3D slice, separately approve its implementation, and test it in isolated synthetic environments. MR-5E verified payment/invoice evidence may be designed independently without granting paid access. Do not claim MR-5 complete or change Company Stage.
