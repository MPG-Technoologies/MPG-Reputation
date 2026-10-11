# MR-7 Remaining Gap / Closeout Audit

| Metadata | Value |
|---|---|
| Date | 2026-10-11 |
| Milestone | MR-7 — Trust / Security / Compliance |
| Audit Slice | MR-7 Remaining Gap / Closeout Audit |
| Slice Status | ENGINEERING COMPLETE / READY FOR OWNER REVIEW |
| Product Baseline | `d7e58efee9c72eb379a461f51749f35d3954c75d` |
| Company OS Baseline | `b62a7fea72c30eb8e768511815816b4de1ed1a3e` |
| Hosted Supabase Project | `awvqtwkzprygsoyfspuz` (`mpg-reputation`) |
| Scope | Planning / evidence only; no product implementation code, schema mutation, deployment, live messaging, billing, pilot activation, or Case B implementation |
| Owner Boundary | Do not implement Case B |

## 1. Purpose

This audit determines what remains before MR-7 can be considered technically closed, while preserving the Owner instruction not to begin Case B.

It separates:

1. accepted MR-7 engineering evidence;
2. hosted verification debt;
3. remaining engineering that is safe to execute without Case B;
4. external/legal/provider dependencies;
5. items that belong to later milestones and must not be pulled forward.

This document is an engineering/readiness audit, not legal advice or a compliance certification.

## 2. Current MR-7 State

MR-7 remains **ACTIVE / IN PROGRESS**.

Accepted technical work recorded in the authoritative MR-7 execution handoff includes:

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
- MR-7C.5C2 — Case A controlled restore-delta replay engine.

MR-7C.5C2 is owner accepted and merged. Its migration is present in the repository, but the hosted engineering/test database has not yet received it.

Case B remains explicitly unresolved and is excluded from this audit's implementation scope.

## 3. MR-7 Roadmap Exit-Criteria Mapping

The original MR-7 roadmap requires:

| Roadmap Requirement | Current Evidence | Audit Classification |
|---|---|---|
| Comprehensive PostgreSQL RLS audit and cross-tenant negative testing | Existing `real-rls`, `tenant-isolation`, support-access, privacy/export/erasure, completion-platform, and security-definer test suites; accepted hosted privacy-trigger hardening; current hosted privilege inspection | SUBSTANTIALLY SATISFIED by accepted evidence; fresh closeout regression remains advisable after final hosted migration |
| Customer retention/export/deletion lifecycle | C2 export, C3 erasure/anonymization, C4 retention controls, C5 processor map, restore verification/replay | SATISFIED for accepted Case A scope |
| Durable suppression preventing prohibited re-contact | Durable `suppressions`, recipient evidence, unsubscribe hardening, final dispatch authority checks, permanent retention guards | SATISFIED by accepted evidence |
| US/Canada messaging technical controls | Sender identity, postal-address requirement, permission-state fail-closed behavior, suppression/unsubscribe, RFC 8058 work from MR-1, neutral templates | PARTIALLY SATISFIED technically; final jurisdiction/use-case interpretation remains qualified-legal-review gated |
| Product Terms / Privacy Policy technical enforcement | No final legal text or final policy-acceptance contract is frozen; public `/terms` and `/privacy` pages belong to MR-9 | GATED / NOT SAFE TO INVENT before qualified review and owner policy |
| Technical controls audit prepared for qualified legal review | MR-7 execution handoff + privacy lifecycle + retention matrix + processor map provide substantial evidence | NEEDS CLOSEOUT PACKAGING / reconciliation before legal handoff |
| End-to-end privacy restore safety | Case A collection, replay, and verification accepted | PARTIAL: Case A accepted; Case B deliberately unresolved |

## 4. Hosted Supabase Verification Findings

The hosted MPG Reputation Supabase project was inspected directly during this audit.

### 4.1 Migration State

Repository migration count on product `main`: **26**.

Hosted Supabase migration count: **25**.

Latest hosted migration:

`20261010010000_privacy_trigger_function_hardening`

Repository-only migration:

`20261011120000_mr7c5c2_restore_delta_replay.sql`

Therefore the historical C5C2 statement is still accurate: the C5C2 migration has **not** been applied to hosted Supabase.

### 4.2 C5C2 Hosted Function State

The hosted database currently reports:

- `public.replay_customer_erasure_maintenance(uuid, uuid, timestamptz)`: absent;
- `public.replay_suppression_maintenance(uuid, text, text, text, timestamptz)`: absent.

This confirms C5C2 is merged and locally/integration validated, but is not yet hosted-database verified.

## 5. Hosted Security Advisor Reconciliation

The current hosted Supabase Security Advisor was reviewed.

### 5.1 RLS Enabled / No Policy Findings

Seven server-owned tables are reported as RLS-enabled with no policies:

- `billing_webhook_events`;
- `completion_api_credentials`;
- `completion_ingestion_requests`;
- `cost_ledger`;
- `customer_erasure_records`;
- `messaging_authority_evidence`;
- `review_request_recipient_evidence`.

Direct hosted privilege inspection confirms:

- `anon`: no SELECT/INSERT/UPDATE/DELETE on all seven;
- `authenticated`: no SELECT/INSERT/UPDATE/DELETE on all seven.

This means the advisor signal is expected for these intentionally server-owned tables and is **not evidence of a tenant exposure by itself**.

The append-only controls on privacy evidence remain present:

- `customer_erasure_records`: service role SELECT + INSERT; UPDATE/DELETE denied;
- `review_request_recipient_evidence`: service role SELECT + INSERT; UPDATE/DELETE denied.

### 5.2 SECURITY DEFINER Advisor Findings

The advisor reports authenticated execution on:

- `create_org_with_owner_and_location`;
- `submit_quick_complete_atomic`;
- `user_has_role`;
- `user_org_ids`;
- `user_role`.

Hosted definitions were inspected.

Observed controls:

- anonymous execution is denied;
- onboarding requires `auth.uid()`;
- Quick Complete requires `auth.uid()`, tenant role membership, and organization/location ownership checks;
- RLS helpers derive membership/role results using the current `auth.uid()`;
- all functions use an explicit `public, pg_temp` search path.

Audit classification: **REVIEWED HARDENING ADVISORY / NO PROVEN AUTHORIZATION BYPASS FOUND IN THIS AUDIT**.

No privilege broadening or function rewrite is authorized by this audit.

### 5.3 Leaked Password Protection

Supabase Security Advisor reports leaked-password protection disabled.

Current Supabase documentation states leaked-password protection is available on **Pro Plan and above**. The current hosted MPG Reputation project is on **Free**.

Audit classification: **PLATFORM / PLAN HARDENING DEPENDENCY**, not a repository code defect. This requires an explicit plan/risk decision before it can be treated as a mandatory closure item.

## 6. Remaining MR-7 Gaps

### GAP-1 — C5C2 Hosted Migration & Case A Hosted Verification

**Status:** IMPLEMENTABLE / NOT STARTED

This is the clearest bounded engineering gap that does not enter Case B.

Required next slice:

1. apply repository migration `20261011120000_mr7c5c2_restore_delta_replay.sql` to the hosted engineering/test Supabase database;
2. verify migration history becomes 26/26;
3. verify both replay maintenance functions exist;
4. verify execution remains denied to PUBLIC / anon / authenticated and allowed only to the intended elevated server role;
5. run bounded synthetic Case A replay verification against hosted test fixtures;
6. prove fail-closed behavior and post-replay verifier PASS/BLOCK behavior;
7. run Supabase security advisors after the DDL application;
8. update MR-7 evidence truthfully.

This slice must use synthetic/seed data only.

### GAP-2 — MR-7 Closeout Technical-Control Packet for Qualified Review

**Status:** IMPLEMENTABLE AS DOCUMENTATION / NOT LEGAL SIGN-OFF

The current evidence is spread across several documents. Before qualified review, consolidate:

- messaging permission/authority controls;
- sender identity/postal-address controls;
- unsubscribe and suppression behavior;
- retention and erasure controls;
- processor retention/deletion behavior;
- restoration privacy guarantees and known gaps;
- current unresolved jurisdiction-specific questions;
- current Terms/Privacy technical-enforcement questions.

The packet must not claim statutory compliance or invent policy/legal text.

### GAP-3 — Qualified US/Canada Legal / Compliance Review

**Status:** GATED / EXTERNAL DEPENDENCY

Still required before real-customer messaging/public release as recorded in Company OS.

Legal review must resolve or validate, as applicable:

- US/Canada message classification and consent/permission treatment;
- sender identification and physical-address requirements;
- unsubscribe/opt-out requirements;
- quiet-hours requirements where applicable;
- retention-policy legal sufficiency;
- Terms of Service;
- Privacy Policy;
- processor/data-processing obligations;
- Google policy review where applicable.

Engineering must not invent these conclusions.

### GAP-4 — Terms / Privacy Technical Enforcement

**Status:** GATED BY GAP-3 / MR-9 SURFACE DEPENDENCY

The MR-7 roadmap names Terms of Service and Privacy Policy technical enforcement controls, but no final legal text or accepted acknowledgement/versioning policy exists.

Do not implement a fabricated acceptance contract.

Public `/terms` and `/privacy` pages remain MR-9 work.

### GAP-5 — Case B Disaster-Recovery Privacy Ledger

**Status:** UNRESOLVED / OWNER-EXCLUDED FROM CURRENT WORK

Catastrophic primary-database loss with no readable pre-restore database still lacks an independent authoritative offsite privacy delta source.

No storage/provider/ledger architecture is selected.

Per current owner instruction, **do not implement Case B**.

## 7. Items That Are Not MR-7 Closeout Work

The following remain important program gates but must not be pulled into this MR-7 audit slice:

- MR-5 billing completion;
- MR-1B-H hosted domain validation;
- MR-8 pilot activation;
- MR-9 public product website;
- live customer messaging;
- live billing/charging;
- final pricing;
- commercial launch;
- Company Stage 2 activation.

They remain separately gated by Company OS.

## 8. Closeout Decision

MR-7 **cannot currently be marked ENGINEERING COMPLETE** because:

1. C5C2 has not been applied/verified on the hosted engineering/test database;
2. qualified legal/compliance review remains external and incomplete;
3. Terms/Privacy technical enforcement cannot be finalized safely before that review;
4. Case B remains unresolved and is explicitly excluded by current Owner direction.

The first item is directly implementable without violating the Case B boundary.

## 9. Recommended Next Slice

### MR-7C.5C2-H — Hosted Case A Migration & Verification

**Objective:** Move the already-accepted C5C2 Case A replay engine from repository-only/local PostgreSQL evidence to hosted engineering/test Supabase verification.

**Allowed:**

- apply the existing version-controlled C5C2 migration;
- create/use bounded synthetic fixtures;
- verify function privileges and tenant/privacy invariants;
- exercise Case A replay only;
- run hosted RLS/security/integration verification;
- clean up synthetic test state;
- update documentation/evidence.

**Not allowed:**

- Case B architecture or implementation;
- real customer data;
- live messaging;
- live billing;
- production customer pilot;
- public launch;
- weakening RLS/authentication/authorization/tenant isolation;
- unrelated database changes;
- broad hosted database reset.

### Exit Evidence

The slice is complete only when:

- hosted migration history reports 26/26 including C5C2;
- replay functions exist with the intended restricted privileges;
- synthetic Case A replay succeeds when valid;
- malformed/unauthorized/contradictory replay attempts fail closed;
- post-replay C5C1 verifier returns truthful PASS/BLOCK results;
- Supabase security advisors are reviewed after migration;
- no unrelated hosted state or repository code is changed;
- evidence is recorded in the MR-7 execution handoff.

## 10. Owner Gate

**Audit slice:** ENGINEERING COMPLETE / READY FOR OWNER REVIEW.

Recommended next action:

**Approve MR-7C.5C2-H — Hosted Case A Migration & Verification.**

This recommendation does not activate Case B, MR-8, messaging, billing, pilot operation, or commercial release.
