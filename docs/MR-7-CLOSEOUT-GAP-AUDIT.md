# MR-7 Remaining Gap / Closeout Audit

| Metadata | Value |
|---|---|
| Date | 2026-10-17 |
| Milestone | MR-7 — Trust / Security / Compliance |
| Audit Slice | MR-7 Remaining Gap / Closeout Audit — reconciled after C5C2-H |
| Slice Status | ENGINEERING COMPLETE / READY FOR OWNER REVIEW |
| Product Baseline | `29fe5527113e7d3a82c16899e2cc2f940846ea22` |
| Company OS Baseline | `b62a7fea72c30eb8e768511815816b4de1ed1a3e` |
| Hosted Supabase Project | `awvqtwkzprygsoyfspuz` (`mpg-reputation`) |
| Scope | Planning / evidence only; no product implementation code, schema mutation, deployment, live messaging, billing, pilot activation, or Case B implementation |
| Owner Boundary | Do not implement Case B; do not activate MR-8; do not enable live messaging or billing |

## 1. Purpose

This audit records the truthful remaining MR-7 closeout state after completion and owner acceptance of MR-7C.5C2-H.

It separates:

1. accepted MR-7 engineering evidence;
2. resolved hosted-verification debt;
3. remaining documentation / legal-review preparation;
4. external legal/compliance dependencies;
5. items that belong to later milestones and must not be pulled forward.

This document is an engineering/readiness audit, not legal advice or a compliance certification.

## 2. Current MR-7 State

MR-7 remains **IN PROGRESS**.

Accepted technical work includes:

- MR-7B.1 — messaging authority evidence and suppression hardening;
- MR-7B.2 — sender identity enforcement;
- MR-7B.3 — transport payload minimization;
- MR-7C.1 — privacy lifecycle contract and direct-delete safety;
- MR-7C.2 — customer privacy export;
- MR-7C.3 — controlled customer erasure/anonymization and delivery;
- MR-7C.4 — retention policy and bounded maintenance controls;
- MR-7C.5A — external processor retention map;
- MR-7C.5B — Inngest/provider privacy hardening;
- MR-7C.5C1 — Case A post-restore privacy verification foundation;
- MR-7C.5C2 — Case A controlled restore-delta replay engine;
- MR-7C.5C2-H — hosted Case A migration and bounded synthetic verification.

MR-7C.5C2-H is **OWNER ACCEPTED / MERGED** on product `main` at
`29fe5527113e7d3a82c16899e2cc2f940846ea22`.

Case B remains explicitly owner-excluded and must not be implemented.

## 3. MR-7 Roadmap Exit-Criteria Mapping

| Roadmap Requirement | Current Evidence | Audit Classification |
|---|---|---|
| Comprehensive PostgreSQL RLS audit and cross-tenant negative testing | Existing real-RLS, tenant-isolation, support-access, privacy/export/erasure, completion-platform, and security-definer suites; hosted privilege inspection and security-advisor reconciliation | SUBSTANTIALLY SATISFIED by accepted technical evidence |
| Customer retention/export/deletion lifecycle | C2 export, C3 erasure/anonymization, C4 retention controls, C5 processor map, Case A restore verification/replay | SATISFIED for current owner-authorized scope |
| Durable suppression preventing prohibited re-contact | Durable suppressions, recipient evidence, unsubscribe hardening, final dispatch authority checks, permanent retention guards | SATISFIED by accepted evidence |
| US/Canada messaging technical controls | Sender identity, postal-address enforcement, permission fail-closed behavior, suppression/unsubscribe, RFC 8058 work, neutral templates | TECHNICAL CONTROLS IMPLEMENTED; legal sufficiency remains qualified-review gated |
| Product Terms / Privacy Policy technical enforcement | No final legal text or frozen acceptance/versioning contract; public Terms/Privacy surfaces belong to MR-9 | GATED BY QUALIFIED REVIEW / OWNER POLICY |
| Technical controls audit prepared for qualified legal review | Execution handoff, privacy lifecycle contract, retention matrix, processor map, hosted security evidence, this reconciled closeout audit | NEEDS CONSOLIDATED LEGAL-REVIEW PACKET |
| End-to-end privacy restore safety | Case A collection, replay, verification and hosted proof accepted | SATISFIED FOR CASE A; Case B owner-excluded |

## 4. Hosted Supabase Reconciliation

The hosted MPG Reputation Supabase environment is an engineering/test database containing synthetic/seed state and zero real customer data.

### 4.1 Migration State — Resolved

Repository migration count: **26**.

Hosted migration history after C5C2-H: **26/26**.

The C5C2 migration is present and applied under its canonical repository version:

`20261011120000_mr7c5c2_restore_delta_replay`

The earlier audit finding that hosted Supabase was 25/26 is obsolete and is superseded by the accepted C5C2-H evidence.

### 4.2 Replay Function State — Resolved

Hosted verification confirmed both maintenance functions exist:

- `public.replay_customer_erasure_maintenance(uuid, uuid, timestamptz)`;
- `public.replay_suppression_maintenance(uuid, text, text, text, timestamptz)`.

Privilege verification confirmed:

- `PUBLIC`: no execute;
- `anon`: no execute;
- `authenticated`: no execute;
- intended elevated server role: execute allowed.

Both functions remain `SECURITY DEFINER` with fixed
`search_path=public, pg_temp`.

### 4.3 Hosted Case A Proof — Resolved

C5C2-H bounded synthetic hosted verification established:

1. unreconciled restored privacy state remains BLOCK;
2. valid customer-erasure replay restores the accepted anonymized state;
3. valid suppression replay preserves historical reason and timestamp;
4. post-replay persisted-state predicates PASS;
5. exact replay is idempotent;
6. conflicting erasure certificate timestamps fail closed;
7. cross-tenant replay attempts fail closed;
8. malformed suppression replay inputs are denied;
9. incomplete/unreconciled state remains BLOCK;
10. injected audit-write failure proves atomic rollback;
11. temporary test objects and synthetic fixtures were cleaned up.

The hosted proof exercised the exact persisted-state predicates used by the accepted C5C1 verifier. It did not claim that the TypeScript verifier itself was re-executed through a hosted application runtime.

## 5. Hosted Security Advisor Reconciliation

### 5.1 RLS Enabled / No Policy Findings

Seven intentionally server-owned tables remain reported as RLS-enabled with no user-facing policies:

- `billing_webhook_events`;
- `completion_api_credentials`;
- `completion_ingestion_requests`;
- `cost_ledger`;
- `customer_erasure_records`;
- `messaging_authority_evidence`;
- `review_request_recipient_evidence`.

Hosted privilege inspection confirmed no SELECT/INSERT/UPDATE/DELETE for `anon` or `authenticated` on these tables.

Append-only privacy evidence controls remain intact:

- `customer_erasure_records`: service role SELECT + INSERT; UPDATE/DELETE denied;
- `review_request_recipient_evidence`: service role SELECT + INSERT; UPDATE/DELETE denied.

Classification: **REVIEWED / NO TENANT EXPOSURE DEMONSTRATED BY THESE ADVISORIES**.

### 5.2 Authenticated SECURITY DEFINER Advisor Findings

Existing advisor warnings remain on:

- `create_org_with_owner_and_location`;
- `submit_quick_complete_atomic`;
- `user_has_role`;
- `user_org_ids`;
- `user_role`.

Prior hosted definition inspection confirmed:

- anonymous execution denied;
- authenticated execution is constrained by `auth.uid()` and/or tenant role/location checks;
- fixed `public, pg_temp` search paths;
- no demonstrated authorization bypass in the accepted audit.

The new C5C2 replay functions are not in the authenticated warning set because authenticated execution is revoked.

Classification: **REVIEWED HARDENING ADVISORY / NO PROVEN AUTHORIZATION BYPASS**.

### 5.3 Leaked Password Protection

Leaked-password protection remains disabled on the current Supabase plan.

Classification: **PLATFORM / PLAN HARDENING DEPENDENCY**, not a repository implementation defect.

No plan upgrade or commercial/infrastructure change is authorized by this audit.

## 6. Remaining MR-7 Gaps

### GAP-1 — MR-7 Technical-Control Packet for Qualified Review

**Status:** IMPLEMENTABLE AS DOCUMENTATION / NOT LEGAL SIGN-OFF

The accepted evidence is distributed across multiple engineering documents.

The next safe internal slice is to consolidate a qualified-review packet covering:

- messaging authority / permission controls;
- sender identity and physical-address controls;
- unsubscribe and suppression behavior;
- retention, export and erasure controls;
- external processor retention/deletion behavior;
- Case A restoration privacy guarantees;
- hosted security-advisor reconciliation;
- known platform hardening advisories;
- unresolved jurisdiction-specific questions;
- Terms / Privacy technical-enforcement questions that require legal/policy decisions.

The packet must not claim statutory compliance or invent legal conclusions.

### GAP-2 — Qualified US/Canada Legal / Compliance Review

**Status:** GATED / EXTERNAL DEPENDENCY

Qualified review is still required before external customer data, live customer messaging, pilot activation, or public/commercial release.

Review must resolve or validate, as applicable:

- US/Canada message classification and consent/permission treatment;
- sender identification and physical-address requirements;
- unsubscribe/opt-out requirements;
- quiet-hours obligations where applicable;
- retention-policy legal sufficiency;
- Terms of Service requirements;
- Privacy Policy requirements;
- processor/data-processing obligations;
- Google/platform policy obligations where applicable.

Engineering must not invent these conclusions.

### GAP-3 — Terms / Privacy Technical Enforcement

**Status:** GATED BY GAP-2 / OWNER POLICY / MR-9 SURFACE DEPENDENCY

MR-7 names Terms of Service and Privacy Policy technical enforcement controls, but final legal text and a frozen acceptance/versioning policy do not yet exist.

Do not implement a fabricated acceptance contract.

Public `/terms` and `/privacy` pages remain MR-9 surfaces.

### GAP-4 — Case B Disaster-Recovery Privacy Ledger

**Status:** OWNER-EXCLUDED / DO NOT IMPLEMENT

Case B covers catastrophic primary-database loss where no readable pre-restore source remains.

No independent durable offsite privacy-delta source is selected.

Per current owner direction, **Case B is excluded from current work and is not a basis for starting new architecture during MR-7 closeout**.

## 7. Items That Are Not MR-7 Closeout Work

Do not pull these items into MR-7 closeout:

- MR-5 billing completion;
- MR-1B-H hosted domain validation;
- MR-8 pilot activation;
- MR-9 public product website;
- live customer messaging;
- live billing/charging;
- final pricing;
- commercial launch;
- Company Stage 2 activation.

They remain separately gated by Company OS and explicit owner decisions.

## 8. Closeout Decision

The earlier engineering gap for C5C2 hosted application/verification is **RESOLVED / OWNER ACCEPTED**.

MR-7 nevertheless remains **IN PROGRESS** because:

1. the technical-control evidence still needs consolidated packaging for qualified review;
2. qualified US/Canada legal/compliance review remains incomplete;
3. final Terms / Privacy technical-enforcement requirements depend on that review and owner policy.

Case B is not to be implemented and must not be used to expand the current engineering scope.

This audit therefore does **not** mark MR-7 complete, does **not** activate MR-8, and does **not** authorize live messaging, live billing, pilot use, external customer data, or commercial release.

## 9. Recommended Next Slice

### MR-7 Closeout Technical-Control Packet

**Objective:** Consolidate the accepted technical controls and unresolved legal/policy questions into a review-ready engineering packet for qualified US/Canada legal/compliance review.

**Allowed:**

- documentation/evidence reconciliation;
- trace accepted controls to repository/migration/test evidence;
- document hosted security-advisor findings and classifications;
- list unresolved legal/policy questions;
- identify which future technical controls depend on qualified review.

**Not allowed:**

- legal certification or statutory-compliance claims;
- invented Terms of Service or Privacy Policy text;
- Case B implementation;
- MR-8 activation;
- live customer messaging;
- live billing;
- production/customer pilot;
- unrelated schema or application changes.

### Exit Evidence

The slice is complete when one consolidated packet truthfully records:

- implemented messaging/permission controls;
- implemented suppression/unsubscribe controls;
- implemented retention/export/erasure controls;
- implemented Case A restore controls and hosted evidence;
- current security-advisor reconciliation;
- external/platform dependencies;
- exact questions requiring qualified review;
- explicit non-authorization of Case B, MR-8, messaging, billing, pilot and launch.

## 10. Owner Gate

**Audit reconciliation:** ENGINEERING COMPLETE / READY FOR OWNER REVIEW.

Recommended next action:

**Review this reconciled closeout audit, then authorize/continue the MR-7 Closeout Technical-Control Packet.**

This recommendation does not activate Case B, MR-8, messaging, billing, pilot operation, or commercial release.
