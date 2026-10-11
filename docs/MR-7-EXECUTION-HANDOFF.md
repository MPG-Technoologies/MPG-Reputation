# MR-7 — Trust / Security / Compliance: Execution Handoff

| Metadata | Value |
|---|---|
| Date | 2026-10-11 |
| Authority | Owner direction (Company OS source of truth: techwithmpg/mpg-company-os at `72aeef0757a277051cff57a7c9ee9f7a3e1f7c97`; `MPG-DEC-050`) |
| Milestone | MR-7 (Trust / Security / Compliance) — ACTIVE |
| Milestone Slices | **MR-7B.1 — OWNER ACCEPTED**<br>**MR-7B.2 — OWNER ACCEPTED**<br>**MR-7B.3 — OWNER ACCEPTED / PRODUCTION VERIFIED**<br>**MR-7C.1 — OWNER ACCEPTED / HOSTED VERIFIED**<br>**MR-7C.2A — OWNER ACCEPTED / PRODUCTION VERIFIED**<br>**MR-7C.2B — OWNER ACCEPTED**<br>**MR-7C.2 — OWNER ACCEPTED / COMPLETE**<br>**MR-7C.3A — OWNER ACCEPTED** (`5bef1ae68309767b645415fb80e09f70da576e0d`)<br>**MR-7C.3B — OWNER ACCEPTED** (`856d7b87425413da481211313716fbbabb9d5948`)<br>**MR-7C.3C External Identifier Erasure Enforcement — OWNER ACCEPTED** (`8796b5e6fb89cea49a96c85917e4808ad5891fa6`)<br>**MR-7C.3C Customer Erasure Delivery Surface — OWNER ACCEPTED** (`50e1bcf0fa833d9be16471c3b748a464e9ea5b76`)<br>**MR-7C.4A Retention Requirements + Data-Class Decision Matrix — OWNER ACCEPTED / FROZEN** (`924a7f009d18bfeadd0944f5bca082548eac9e54`)<br>**MR-7C.4B1 Initial Retention Controls Foundation — OWNER ACCEPTED** (`dd9af1a7630da5c802b10b9c2345b8b525542d63`)<br>**MR-7C.4B2 Bounded Retention Maintenance Workflow — OWNER ACCEPTED** (`17ff5bc331b225eb589694607754ac58f30e2473`)<br>**MR-7C.5A External Processor Retention Map — OWNER ACCEPTED** (`707f89a072a5593541cfc906e0c19595578bda1c`)<br>**MR-7C.5B Inngest / Provider Privacy Hardening — OWNER ACCEPTED**<br>**MR-7C.5C1 Post-Restore Privacy Verification Foundation — OWNER ACCEPTED** (`9263b6a589795ccb17c8bbe24c61735419ebea26`)<br>**MR-7C.5C2 Controlled Restore-Delta Replay Engine — ENGINEERING COMPLETE / READY FOR OWNER REVIEW** (NOT `MR-7 — COMPLETE`) |
| Current Bounded Slice | MR-7C.5C2 — Controlled Restore-Delta Replay Engine — ENGINEERING COMPLETE / READY FOR OWNER REVIEW |
| Feature Branch | `chatgpt/mr7c5c2-restore-delta-replay` |
| Product Main Baseline | `d2c9aa8c1db41dd06d584b8da7c4a86f43b18827` |
| Company OS Main Baseline | `72aeef0757a277051cff57a7c9ee9f7a3e1f7c97` |
| Public Safe | Yes; local synthetic fixtures only for verification; no real customer data used |

---

## 1. Slice History & Authority Tracking

- **MR-7B.1 — OWNER ACCEPTED**:
  - Authority evidence foundation table (`public.messaging_authority_evidence`) and trigger on `customer_completion_events`.
  - Suppression table delete hardening (direct tenant DELETE revoked).
  - Final send-time permission and suppression invariant in `checkFinalEmailDispatchAuthority`.
  - Merged into `main` at commit `07e83fd368e2f262a116f1f09dd105b71fc0043f`.
- **MR-7B.2 — OWNER ACCEPTED**:
  - Sender identity enforcement: real email provider dispatch (`provider.name === 'resend'`) requires usable business postal address from the tenant location (`public.locations.address`).
  - Fail-closed invariant on missing address (marks review request `FAILED`, records zero-PII audit event `review_request.dispatch_blocked` with `decision: 'SENDER_IDENTITY_INCOMPLETE'`, zero send attempts, zero cost).
  - Retry-compatible: when location address is subsequently configured, retry claims the `FAILED` request and dispatches cleanly.
  - Reminder parity: freshly validates sender identity before reminder invocation; missing address blocks reminder without regressing historical status (`SENT`/`DELIVERED`/`CLICKED`).
  - Synthetic path compatibility: `ConsoleEmailProvider` continues operating for local dev/testing without hard blocking, rendering the address when present.
  - Merged into `main` at commit `02c85f9a410a08608f1204fd8bac03ac05c4c130`.
- **MR-7B.3 — OWNER ACCEPTED / PRODUCTION VERIFIED**:
  - Messaging payload minimization: outbox and Inngest payloads constrained to the canonical 5 operational keys (`eventId`, `organizationId`, `locationId`, `customerId`, `sourceEventId`). Transient contact/permission PII stripped from transport payloads.
  - Authoritative records preserved in Supabase tables.
  - Fail-closed historical outbox scrub migration `20261008000000_mr7b3_payload_minimization.sql`.
  - Merged into `main` at commit `014ed995e8fccb6be899c68bacfedc65f56b4367`.
  - Production application deployed and verified on Vercel deployment `6930523415` (`https://mpg-reputation.vercel.app`).
  - Hosted Supabase migration `20261008000000` was applied and independently verified during MR-7B.3 production acceptance.
- **MR-7C.1 — OWNER ACCEPTED**:
  - Comprehensive privacy lifecycle contract and data classification map created (`docs/MR-7C-PRIVACY-LIFECYCLE-CONTRACT.md`).
  - Direct delete hazard analyzed: confirmed `customers_delete` policy previously allowed authenticated tenant `OWNER`/`ADMIN` to execute hard deletes that cascaded through `customer_completion_events`, `review_requests`, `message_events`, and `messaging_authority_evidence`.
  - Confirmed zero application UI or actions require direct client `DELETE`.
  - Bounded database migration `supabase/migrations/20261008010000_mr7c1_customer_delete_guard.sql`:
    - Drops `customers_delete` RLS policy.
    - Revokes `DELETE` on `public.customers` from `PUBLIC`, `anon`, and `authenticated`.
    - Grants `DELETE` on `public.customers` to `service_role` only for trusted server workflows.
  - Retains all existing `SELECT`, `INSERT`, and `UPDATE` capabilities for tenant users.
  - Invariants 1 through 8 frozen for subsequent MR-7C slices.
- **MR-7C.2A — OWNER ACCEPTED / PRODUCTION VERIFIED**:
  - Owner decision freezes privacy-export authority to tenant `OWNER` and `ADMIN` only. `OPERATOR` and `VIEWER` are denied.
  - Adds the per-customer structured JSON export foundation in `src/domain/privacy/customer-export.ts`.
  - Tenant-visible customer, completion, review, event, and suppression reads use the authenticated Supabase client and existing RLS boundaries.
  - `service_role` is limited to reading system-owned `messaging_authority_evidence` and writing the mandatory privacy-export audit event.
  - Every export is explicitly scoped to `organizationId` + `customerId`; foreign and nonexistent customer targets fail without cross-tenant disclosure.
  - Authorization is checked before data collection and rechecked immediately before release.
  - Required read failures or audit persistence failures withhold the complete export rather than returning partial data.
  - Export fields are explicitly allowlisted. Review/unsubscribe bearer tokens and hashes, provider IDs, raw event metadata, suppression hashes, credentials, outbox payloads, and other internal secrets are excluded.
  - Suppression membership is resolved with the canonical suppression hash function, but the pseudonymous `contact_hash` itself is not exported.
  - Successful exports write `privacy.customer_export` to `audit_events` with schema version and aggregate counts only; customer name, email, phone, raw PII, and export payloads are not copied into audit metadata.
  - Merged into `main` at commit `a2c3df3076b814dd74996d674dadfe400428c012` and production verified.
  - No schema migration was required by MR-7C.2A.
- **MR-7C.2B — OWNER ACCEPTED; MR-7C.2 — OWNER ACCEPTED / COMPLETE**:
  - Exposes the C2A per-customer privacy export foundation to authorized tenant users via single authenticated product route `GET /api/organizations/[organizationId]/customers/[customerId]/export`.
  - Target input is explicit `organizationId` and `customerId`. The browser-supplied input is target input only, not authority.
  - Gated by authoritative domain engine `getCustomerPrivacyExport(organizationId, customerId)`: tenant `OWNER` and `ADMIN` only. `OPERATOR` and `VIEWER` are denied (403, zero payload).
  - Anonymous sessions are denied (403, zero payload).
  - Forged/foreign organizationId, foreign customer IDs, and nonexistent customer IDs fail identically without disclosing customer or organization existence (403).
  - Delivery contract: `Content-Type: application/json; charset=utf-8`, `Content-Disposition: attachment; filename="mpg-customer-privacy-export-<customerId>.json"`, `Cache-Control: no-store`. Zero customer PII in filename.
  - Fail-closed error contract: returns `UNAVAILABLE` (503) without partial data on read or audit failure.
  - UI integration: Added `CustomerPrivacyExportButton` in `src/app/app/customers/customer-actions.tsx` requiring `organizationId` and `customerId`, integrated into `src/app/app/customers/page.tsx` for desktop table and mobile cards. UI visibility is role-gated, while backend route handler strictly enforces authorization via C2A.
  - No duplicate v1 endpoint; single internal product route with minimal attack surface.
  - No database migration required.
  - Verification & Attribution: Full repository suite has pre-existing canonical-main failures; no MR-7C.2B regression was found. (Known baseline issues outside C2B: `completion-source-platform` test 22; two `staging-readiness` `useRouter` mock failures; one parallel-only eligibility query concurrency flake.)
- **MR-7C.3A — ERASURE-SAFE UNSUBSCRIBE DECOUPLING (OWNER ACCEPTED)**:
  - Accepted HEAD: `5bef1ae68309767b645415fb80e09f70da576e0d`.
  - Feature branch `chatgpt/mr7c3a-erasure-safe-unsubscribe` pushed to `canonical`.
  - Separates recipient suppression evidence into durable server-owned table `public.review_request_recipient_evidence` (`suppression_contact_hash` column).
  - Append-only access model: `service_role` has `SELECT` + `INSERT` only (`UPDATE`, `DELETE`, `TRUNCATE` revoked); tenant roles (`OWNER`, `ADMIN`, `OPERATOR`, `VIEWER`) and `anon` have zero access.
  - Immutability trigger `protect_recipient_evidence_immutability` blocks post-delivery recipient mutation.
  - Test helper RPCs cleanly removed from production schema; privilege verification performed directly via `has_table_privilege`.
  - Verification: 16/16 tests in `test/integration/mr7c3a-erasure-safe-unsubscribe.test.ts` pass cleanly.
- **MR-7C.3B — CONTROLLED CUSTOMER ERASURE / ANONYMIZATION ENGINE FOUNDATION (OWNER ACCEPTED)**:
  - **Owner Acceptance**: Accepted at commit `856d7b87425413da481211313716fbbabb9d5948`.
  - **Owner Authority Decision (Frozen & Transactionally Enforced)**:
    - Customer erasure / anonymization authority is **OWNER ONLY** (`organization_users.role === 'OWNER'`). `ADMIN`, `OPERATOR`, `VIEWER`, and anonymous requests are denied. Export authority remains unchanged: `OWNER` + `ADMIN`. Foreign-tenant and nonexistent customer targets fail closed without existence leakage.
    - **In-Transaction Authority Enforcement**: The atomic PostgreSQL function `execute_customer_erasure(p_org_id, p_customer_id, p_actor_id, p_actor_type)` directly re-verifies inside the database transaction that `p_actor_id` exists, belongs to `p_org_id`, and currently holds the `'OWNER'` role in `organization_users`. This completely closes any TOCTOU race condition (e.g. role revoked between app preflight and RPC execution) and prevents direct `service_role` RPC invocation from bypassing OWNER authority.
  - **No Hard Deletes**: The customer row in `public.customers` is retained in-place. `DELETE FROM customers` is strictly forbidden to prevent foreign-key cascade deletions across `customer_completion_events`, `review_requests`, `message_events`, `review_request_events`, and `messaging_authority_evidence`.
  - **Field-Level Anonymization, Redaction & Error Scrubbing Map**:
    - `customers.first_name`: ANONYMIZE to deterministic non-PII tombstone `'[Deleted Customer]'` (`first_name` is `NOT NULL`).
    - `customers.last_name`: ERASE (`NULL`).
    - `customers.email`: ERASE (`NULL`).
    - `customers.phone`: ERASE (`NULL`).
    - `customers.permission_*`: RETAIN operational compliance state.
    - `customer_completion_events.contact`: ERASE raw PII (`'{}'::jsonb`).
    - `customer_completion_events.source_event_id`: RETAIN (deduplication idempotency key).
    - `review_requests.error_message`: ERASE (`NULL` for erased customer's review requests; eliminates potential raw email/name leaks from provider exceptions).
    - `message_events.sanitized_error`: ERASE (`NULL` for message events of erased customer's review requests; scrubs historical provider error text).
    - `suppressions.contact_hash`: RETAIN (byte-for-byte; preserves suppression across future re-imports).
    - `review_request_recipient_evidence.suppression_contact_hash`: RETAIN (byte-for-byte; preserves unsubscribe resolution).
    - `review_requests`, `message_events`, `review_request_events`, `messaging_authority_evidence`, `audit_events`, `organization_usage`: RETAIN non-PII operational records, status, provider, timestamps, review_request_id.
  - **Durable Tombstone & Database Immutability Guard**:
    - Durable server-owned table `public.customer_erasure_records` records `organization_id`, `customer_id`, `erased_at`, `actor_type`, `actor_id` with unique constraint `(organization_id, customer_id)`.
    - Append-only for `service_role` (`SELECT` + `INSERT` only); revoked from `PUBLIC`, `anon`, `authenticated`.
    - Database trigger `protect_erased_customer_immutability` on `public.customers` enforces that an erased customer cannot have `email`, `phone`, `last_name` restored or `first_name` changed away from `'[Deleted Customer]'`. Non-erased customer editing is completely unaffected.
  - **Atomic Transactional RPC**:
    - Plpgsql function `public.execute_customer_erasure(p_org_id, p_customer_id, p_actor_id, p_actor_type)` runs in a single transaction with `SECURITY DEFINER` and `SET search_path = public, pg_temp`.
    - Granted strictly to `service_role`; revoked from `PUBLIC`, `anon`, `authenticated`.
    - Atomically performs in-transaction OWNER authority verification, row locking (`FOR UPDATE`), idempotency check, legacy recipient evidence gate, erasure record insertion, customer PII anonymization, completion event contact redaction, historical error text scrubbing (`review_requests.error_message = NULL` and `message_events.sanitized_error = NULL`), and mandatory zero-PII audit event insertion in a single unit. Any failure rolls back all mutations.
  - **Mandatory Minimized Audit Event**:
    - Inserts `privacy.customer_erasure` audit record with `entity_type: 'customer'`, `schema_version: '1.0'`, `decision: 'ERASED'`, `fields_anonymized`, `fields_erased`, `completion_events_redacted_count`, `review_request_errors_scrubbed_count`, and `message_event_errors_scrubbed_count`. Strictly zero customer PII, zero contact hashes, and zero historical error strings in metadata.
  - **Precondition Legacy Gate**:
    - `checkCustomerErasureEligibility` fails closed with `BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS` if any historical review request lacks immutable recipient evidence in provider-ambiguous or delivered states (`SENDING`, `FAILED`, `SENT`, `DELIVERED`, `CLICKED`, or `sent_at != null` or with `message_events`).
  - **Verification**: 45/45 integration tests in `test/integration/customer-erasure.test.ts` pass cleanly.
- **MR-7C.3C — EXTERNAL IDENTIFIER ERASURE ENFORCEMENT (OWNER ACCEPTED)**:
  - **Authoritative Owner Decision**:
    - MR-7C.3B is **OWNER ACCEPTED**.
    - MR-7C.3C External Identifier Erasure Enforcement is **OWNER ACCEPTED** (Accepted C3C commit: `8796b5e6fb89cea49a96c85917e4808ad5891fa6`).
    - The external identifier policy is **FROZEN & AUTHORITATIVE**:
      - `customer_completion_events.source_customer_id` MUST be erased to `NULL`.
      - `customer_completion_events.source_transaction_id` MUST be erased to `NULL`.
      - `customer_completion_events.source_event_id` MUST be **RETAINED** as the event/idempotency/deduplication key.
      - Hashing or pseudonymization of `source_customer_id` and `source_transaction_id` is NOT approved (hashing is not an approved substitute).
    - **Precise Rationale**: `source_customer_id` and `source_transaction_id` maintain external person/transaction linkability and have no approved post-erasure purpose; `source_event_id` is retained to prevent duplicate ingestion of completed events.
  - **Atomic Transactional Enforcement**:
    - Migration `supabase/migrations/20261009140000_mr7c3c_external_id_erasure.sql` updates `public.execute_customer_erasure` to atomically set `source_customer_id = NULL` and `source_transaction_id = NULL` alongside `contact = '{}'::jsonb`.
    - Audit event `fields_erased` metadata array updated to include `'source_customer_id'` and `'source_transaction_id'`.
    - Zero non-atomic application-side cleanups; single transactional RPC execution.
    - Schema constraints verified: `source_customer_id` and `source_transaction_id` are nullable (`TEXT NULL`).
    - Preserves all C3B controls: OWNER-only authority, in-transaction role recheck, row locking, idempotency, atomic rollback, suppression and recipient evidence preservation, zero hard deletes.
  - **Verification**: 46/46 customer erasure integration tests pass cleanly.
- **MR-7C.3C — CUSTOMER ERASURE DELIVERY SURFACE (OWNER ACCEPTED)**:
  - **Owner Acceptance**: Explicitly accepted by Owner under commit `50e1bcf0fa833d9be16471c3b748a464e9ea5b76`.
  - **Objective & Scope**:
    - Exposes the accepted controlled erasure engine (`8796b5e6fb89cea49a96c85917e4808ad5891fa6`) to the authenticated product application.
    - Strictly OWNER-only: `organization_users.role === 'OWNER'`. `ADMIN`, `OPERATOR`, `VIEWER`, and anonymous requests are denied with safe denied responses.
    - Single-customer erasure only: strictly one customer per explicit request. Zero bulk erasure, zero CSV-driven erasure, zero automated purging.
  - **Delivery Architecture & Server Boundary**:
    - Dedicated server delivery domain module: `src/domain/privacy/erasure-delivery.ts` provides `handleCustomerErasurePreflight` and `handleCustomerErasureExecution`.
    - Authenticated Server Actions boundary: `src/actions/customer-erasure.ts` exports `checkCustomerErasurePreflightAction` and `executeCustomerErasureAction`, serving as the single dashboard delivery boundary and wrapping Next.js `revalidatePath('/app/customers')` for automatic cache invalidation upon completion.
    - Attack surface minimized: redundant HTTP route `src/app/api/.../erase/route.ts` eliminated; all client interaction routes strictly through typed Server Actions.
  - **Preflight Eligibility Check**:
    - Verifies user authentication, organization membership, and strict OWNER authority.
    - Validates customer existence and tenant boundaries (foreign/nonexistent returns safe denied without existence leakage).
    - Invokes domain eligibility logic `checkCustomerErasureEligibility`: checks for already-erased state and fails closed (`BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS`) if any historical review request lacks immutable recipient evidence in provider-ambiguous/delivered states.
    - Returns safe non-PII preflight response (`eligible: boolean`, `status`, `message`).
  - **Explicit Confirmation Contract**:
    - Action strictly enforces explicit typed confirmation: input must provide confirmation matching `'ERASE'`.
    - Empty or mismatched confirmation fails with safe `CONFIRMATION_REQUIRED` error.
  - **Minimal Non-PII Response Contract**:
    - Execution returns strictly `{ success: true, status: 'ERASED', erasedAt }` (and optional `alreadyErased`). Target `customerId` is omitted from response payload to prevent redundant identification.
    - Never leaks database exceptions, SQL text, plpgsql stack traces, service-role keys, contact hashes, provider payloads, or suppression internals.
    - Safe error mapping: safe denied response for unauthorized / cross-tenant / nonexistent, blocked response for unresolvable legacy evidence, unavailable response for unexpected errors.
  - **UI Integration & Tombstone Representation**:
    - `CustomerErasureButton` in `src/app/app/customers/customer-actions.tsx`: accessible only to OWNERs, opens accessible modal dialog detailing irreversible anonymization, runs preflight check, displays non-PII status, requires typing `ERASE`, and executes via server action.
    - `src/app/app/customers/page.tsx`: evaluates `isOwner = userRole === 'OWNER'` and conditionally renders `CustomerErasureButton` in desktop table and mobile card views for OWNER only.
    - Post-erasure tombstone rendering: displays `[Deleted Customer]`, muted styling, `—` for email/phone, and `Erased` badge. Already-erased customers display disabled `Erased` button preventing duplicate execution.
  - **Security & Privilege Separation**:
    - Zero service-role credentials or raw RPC calls exposed to browser/client bundle.
    - Database transaction performs final authoritative OWNER check inside `execute_customer_erasure` plpgsql function, closing TOCTOU race conditions.
  - **Verification**: 21/21 integration tests in `test/integration/customer-erasure-delivery.test.ts` pass cleanly.
- **MR-7C.4A — RETENTION REQUIREMENTS & DATA-CLASS DECISION MATRIX (OWNER ACCEPTED / FROZEN — `924a7f009d18bfeadd0944f5bca082548eac9e54`)**:
  - Authoritative standalone specification: [`docs/MR-7C4-RETENTION-DECISION-MATRIX.md`](./MR-7C4-RETENTION-DECISION-MATRIX.md).
  - Complete 25-table PostgreSQL database audit covering all tables and foreign key relationships.
  - Catastrophic cascade deletion hazard identified; hard delete of `customers` strictly forbidden; in-place anonymization/redaction tombstones mandated.
  - Suppression and unsubscribe continuity verified independent of customer PII.
  - 12 authoritative Owner decisions reviewed and frozen.
- **MR-7C.4B1 — INITIAL RETENTION CONTROLS FOUNDATION (OWNER ACCEPTED — `dd9af1a7630da5c802b10b9c2345b8b525542d63`)**:
  - Implemented the three executable retention mechanisms authorized by the Owner:
    1) **Completion Contact Redaction (30 Days)**: Safely identifies `customer_completion_events` with `created_at` older than 30 days and redacts `contact` to `'{}'::jsonb`. Preserves completion rows, `source_event_id`, timestamps, relationships; idempotent; tenant-safe; records aggregate audit event with zero raw PII.
    2) **Review Link Expiration (90 Days)**: Route handler `/r/[token]` derives expiration deterministically from authoritative request timestamp (`sent_at ?? created_at`) without schema changes. After 90 days, fails closed, rendering a clean, user-friendly HTTP 410 Gone page with zero internal IDs. Unsubscribe capability remains operational indefinitely.
    3) **Dispatched Outbox Aging (30 Days)**: Safely purges `domain_event_outbox` records where `status = 'DISPATCHED'` and `dispatched_at` is older than 30 days. Hard code guard guarantees `PENDING` and failed/unresolved records are never purged. Bounded batching and zero-payload aggregate audit evidence.
  - **Permanent-Retention Protections**: Hard code guards (`assertProtectedClassImmunity`) and tests verify all 9 permanent retention classes (`suppressions`, `review_request_recipient_evidence`, `messaging_authority_evidence`, `customer_erasure_records`, `audit_events`, `usage_ledger`, `cost_ledger`, `organization_usage`, `customer_completion_events.source_event_id`) can never be targeted by purge operations. Zero generic purge infrastructure.
  - **Verification**: 25 domain tests in `test/domain/retention-controls.test.ts` and 15 PostgreSQL integration tests in `test/integration/retention-controls.test.ts` pass cleanly. Zero production scheduler activation.
- **MR-7C.4B2 — BOUNDED MULTI-TENANT RETENTION MAINTENANCE WORKFLOW (ENGINEERING COMPLETE / CORRECTIONS APPLIED / READY FOR OWNER REVIEW)**:
  - **Server-Side Orchestration Coordinator**: `src/domain/privacy/retention-maintenance.ts` (`executeMultiTenantRetentionMaintenance`) safely orchestrates the accepted C4B1 retention operations (`redactAgedCompletionContacts`, `purgeDispatchedDomainOutbox`) across organizations without duplicating SQL or rewriting retention policy.
  - **Defense-in-Depth Inngest Registration Boundary (Correction 1)**:
    - `src/inngest/functions/index.ts` (`getInngestFunctions`) conditionally registers `retentionMaintenanceWorkflow` only when `ENABLE_RETENTION_MAINTENANCE === 'true'`.
    - When disabled (default), the retention cron function is omitted from registration with `serve({ client, functions })` in `src/app/api/inngest/route.ts`. Zero retention cron metadata is synced or scheduled.
    - Secondary runtime/handler guard in `executeMultiTenantRetentionMaintenance` and `executeRetentionMaintenanceHandler` remains fail-safe, returning `SKIPPED_DISABLED` immediately.
  - **Bounded Execution Limits & Cursor Pagination**:
    - Default organization page size: 50 (capped at 200).
    - Default per-organization contact batch size: 100 (capped at 500).
    - Default per-organization outbox batch size: 100 (capped at 500).
    - Deterministic cursor pagination with `id > lastSeenOrgId` ordering.
  - **Tenant & Failure Isolation**:
    - Evaluates each organization independently; one organization's failure is caught without rolling back or failing unrelated organizations.
    - Preserves soft-deactivation (evaluates ACTIVE, INACTIVE, and SUSPENDED tenants without deleting any organization).
  - **Fixed Safe Failure Categories (Correction 2)**:
    - Replaced free-form error messages and regex sanitization with fixed failure categories: `ORGANIZATION_QUERY_FAILED`, `CONTACT_REDACTION_FAILED`, `OUTBOX_PURGE_FAILED`, `TENANT_MAINTENANCE_FAILED`.
    - Errors contain strictly `{ organizationId, code }`. Zero raw `error.message` is ever returned, audited, or logged.
    - Adversarial privacy tests prove emails, phones, UUIDs, tokens, hashes, SQL statements, connection strings, and PostgreSQL error texts never leak.
  - **Zero PII Aggregate Reporting**: Returns safe operational summary counters (`organizationsEvaluated`, `organizationsSucceeded`, `organizationsFailed`, `totalContactsRedacted`, `totalOutboxRowsPurged`, `batchesProcessed`). Strictly zero customer emails, names, phone numbers, tokens, hashes, payloads, or internal stack traces.
  - **Scheduled Inngest Function**: Defined in `src/inngest/functions/retention-maintenance.ts` (`retentionMaintenanceWorkflow`).
  - **Concurrency Note**: Configured with `concurrency: 1`. Inngest concurrency limits concurrent step execution; because the coordinator executes bounded work within one maintenance step, this serializes execution (not a universal distributed lock).
  - **Cadence Separation & Retention-Policy Wording (Correction 3)**:
    - Conservative daily cron cadence (`'0 3 * * *'`) defined as an implementation default.
    - Scheduler cadence does not alter frozen MPG retention-policy cutoffs (30-day contact redaction, 30-day dispatched outbox purge, 90-day review-link expiration; these are owner-approved MPG product policy, not statutory retention periods).
  - **Security & Privilege Boundary**: Server/system only; zero browser/client invocation surface. Normal tenant users cannot trigger global multi-tenant maintenance.
  - **Verification**: 18 domain unit tests (`test/domain/retention-maintenance.test.ts`) and 5 PostgreSQL integration tests (`test/integration/retention-maintenance.test.ts`) pass cleanly. Production build, lint, and typecheck pass with zero errors. Zero production scheduler activation.
- **MR-7C.5A — EXTERNAL PROCESSOR DATA MAP & RETENTION / DELETION CONTRACT (OWNER ACCEPTED — `707f89a072a5593541cfc906e0c19595578bda1c`)**:
  - Authoritative specification: [`docs/MR-7C5-EXTERNAL-PROCESSOR-RETENTION-MAP.md`](./MR-7C5-EXTERNAL-PROCESSOR-RETENTION-MAP.md).
  - Comprehensive audit of all external processors (Resend, Inngest, Supabase, Vercel, Stripe).
  - Identified Inngest step output PII leakage for MR-7C.5B remediation.
  - Documented Case A vs Case B restore resurrection hazards. Case B (catastrophic database loss) identified as having zero offsite delta source.
  - Confirmed zero public deletion APIs for Resend, Inngest, Vercel.
- **MR-7C.5B — INNGEST & PROVIDER PRIVACY HARDENING (OWNER ACCEPTED)**:
  - Inngest step return values minimized: direct PII (`customerName`, `customerEmail`) and rendered email content (`renderedSubject`, `renderedBody`) completely stripped from durable step outputs.
  - Fixed error categories via `classifySafeDispatchError` eliminating arbitrary error and token leaks into logs and traces.
  - Fail-closed production safety guard on `ConsoleEmailProvider`.
  - Verified across 19 proof integration tests and regression suite.
- **MR-7C.5C1 — POST-RESTORE PRIVACY VERIFICATION FOUNDATION (CASE A) (OWNER ACCEPTED)**:
  - **Owner Acceptance**: Explicitly accepted by Owner under commit `9263b6a589795ccb17c8bbe24c61735419ebea26` and merged into `main`.
  - **Versioned Restore Delta Contract**: Implemented `PrivacyRestoreDeltaV1` schema representing post-backup operational privacy evidence (`erasures`, `suppressions`) with zero raw contact PII; suppression contact hashes are retained as pseudonymous privacy evidence needed to verify suppression continuity (`src/domain/privacy/restore-verification.ts`). Strict schema allowlists on top-level keys, erasure items, and suppression items reject any unknown properties. Contact hashes strictly validated to SHA-256 format (`^[a-f0-9]{64}$`).
  - **Deterministic Post-Backup Delta Collection & Cap-Safe Pagination**: `collectPrivacyRestoreDelta` extracts erasures from `customer_erasure_records` and suppressions from `suppressions` strictly within the frozen window `(backupCreatedAt, exportedAt]`. Implements cap-safe pagination where offsets advance by actual returned rows (`nextOffset += data.length`) rather than requested `pageSize`, and enumeration terminates strictly on an explicit empty page (`data.length === 0`). A short non-empty page is never treated as exhaustion, guaranteeing complete collection even when server caps (e.g. PostgREST `max_rows = 1000`) are lower than requested `pageSize`. Fails closed on any query error or null data.
  - **Fail-Closed Restored State Verification**: `verifyRestoredPrivacyState` and `evaluateRestoreDecision` check the restored database against post-backup privacy requirements with cap-safe pagination across all multi-row queries:
    - Verifies customer record is tombstoned (`first_name = '[Deleted Customer]'`, `last_name IS NULL`, `email IS NULL`, `phone IS NULL`).
    - Verifies durable erasure certificate exists in `customer_erasure_records` for `(organization_id, customer_id)`.
    - Verifies completion events have exact empty contact JSON (`{}`), failing closed on any non-empty JSON or non-object values.
    - Verifies external identifiers are scrubbed (`source_customer_id IS NULL`, `source_transaction_id IS NULL`), while `source_event_id` is retained as deduplication key.
    - Verifies historical review request error text (`review_requests.error_message IS NULL`) across paginated requests.
    - Hardens message events verification by chunking collected review request IDs into bounded batches (`REVIEW_REQUEST_ID_CHUNK_SIZE = 100`) to prevent query/URL limit overflows, verifying `sanitized_error IS NULL` across all chunks with cap-safe pagination.
    - Verifies corresponding suppressions are present by composite key `(organization_id, channel, contact_hash)`.
  - **Aggregate Safe Metrics & Truthful Counters**: Result contains aggregate safe metrics (`ok`, `decision: 'PASS' | 'BLOCK_RESTORE_ACTIVATION'`, `schemaVersion`, `erasureRecordsChecked`, `suppressionRecordsChecked`, `missingErasureProtections`, `missingSuppressions`, `reason`). Counters truthfully reflect only records successfully evaluated before any failure. Zero raw customer PII or raw provider errors returned or logged.
  - **Operational & Security Boundaries**:
    - Server/maintenance only (`import 'server-only'`). Zero browser UI, zero public API routes, zero tenant Server Actions, zero cron/Inngest registration.
    - **No Automatic Mutation / Replay in C5C1**: Pure collection + verification. Mutation/replay authority remains in a future bounded slice.
    - **Case B Explicitly Unresolved**: Catastrophic database loss with no pre-restore DB readable still lacks an independent offsite delta ledger. Documented honestly as unresolved.
  - **Verification**: 72 dedicated unit and domain-level tests pass cleanly (`test/domain/restore-privacy-verification.test.ts`).
- **MR-7C.5C2 — CONTROLLED RESTORE-DELTA REPLAY ENGINE (CASE A) (ENGINEERING COMPLETE / READY FOR OWNER REVIEW)**:
  - **Status**: Engineering complete on feature branch `chatgpt/mr7c5c2-restore-delta-replay`; ready for independent Owner review (NOT yet Owner Accepted; NOT `MR-7 — COMPLETE`).
  - **Objective & Scope**: Reapplies post-backup privacy states (customer erasure tombstones and suppressions) from a validated `PrivacyRestoreDeltaV1` to an isolated restored database during disaster-recovery maintenance (Case A). C5C2 itself does NOT activate infrastructure.
  - **Authority & Maintenance Boundary**:
    - Strictly server-only (`import 'server-only'`) and maintenance-only. Zero browser UI, zero tenant Server Actions, zero public API routes, zero schedulers, zero Inngest jobs, zero automatic restore hooks.
    - Does NOT reuse or weaken live `execute_customer_erasure` RPC (which requires active tenant OWNER authority, live preflight eligibility checks, and sets `erased_at = now()`).
    - Dedicated atomic maintenance RPCs implemented in migration `supabase/migrations/20261011120000_mr7c5c2_restore_delta_replay.sql`:
      - `public.replay_customer_erasure_maintenance(p_org_id, p_customer_id, p_erased_at)`
      - `public.replay_suppression_maintenance(p_org_id, p_channel, p_contact_hash, p_reason, p_created_at)`
    - Privilege lockdown: `SECURITY DEFINER` with fixed `search_path = public, pg_temp`; execution strictly revoked from `PUBLIC, anon, authenticated`; granted strictly to `service_role`.
  - **Strict Delta Validation**:
    - Validates delta strictly against `isPrivacyRestoreDeltaV1` before ANY mutation. Malformed or unknown properties fail closed with `BLOCK_RESTORE_ACTIVATION` with zero writes.
  - **Erasure Replay Invariants**:
    - Smallest safe transaction unit: Each customer's erasure is replayed in a single atomic database transaction locking the customer row `FOR UPDATE`.
    - Truthful chronology: Inserts `customer_erasure_records` with the exact `erasedAt` from the delta artifact (`actor_type = 'maintenance'`, `actor_id = NULL`), preserving unique constraint `(organization_id, customer_id)` via `ON CONFLICT DO NOTHING`.
    - Direct PII tombstoned: `customers.first_name = '[Deleted Customer]'`, `last_name = NULL`, `email = NULL`, `phone = NULL`.
    - Completion events redacted: `contact = '{}'::jsonb`, `source_customer_id = NULL`, `source_transaction_id = NULL`, while permanently retaining `source_event_id` as the deduplication key.
    - Error scrubbing: `review_requests.error_message = NULL` and `message_events.sanitized_error = NULL`.
    - Minimized maintenance audit: Inserts `privacy.restore_replay_erasure` on initial replay with aggregate counts and truthful timestamp.
  - **Suppression Replay Invariants**:
    - Replays email and SMS suppressions with truthful `created_at` and `reason` using `ON CONFLICT (organization_id, channel, contact_hash) DO NOTHING`.
    - Validates channel allowlist (`'email'`, `'sms'`) and contact hash regex (`^[a-f0-9]{64}$`).
  - **Idempotency & Resumability**:
    - Replaying identical delta twice is completely idempotent: zero duplicate erasure certificates, zero duplicate suppressions, zero duplicate audit events.
    - Partial failure halts execution, fails closed to `BLOCK_RESTORE_ACTIVATION`, and allows safe resumption.
  - **Mandatory Verification Gate**:
    - Immediately calls C5C1 `verifyRestoredPrivacyState()`. Only a clean verifier PASS yields `PASS`. Any replay failure, database error, or verifier failure returns `BLOCK_RESTORE_ACTIVATION`.
  - **Case B Explicitly Unresolved & Out of Scope**: Catastrophic database loss with unreadable pre-restore database remains unresolved; zero offsite storage providers or external ledgers introduced.
  - **Verification**: 42 unit/domain tests pass cleanly (`test/domain/restore-delta-replay.test.ts`), plus 72 C5C1 verification tests (`test/domain/restore-privacy-verification.test.ts`). Clean local database validation passed: `pnpm dlx supabase@2.117.0 db reset` recreated database and applied the complete 26-migration chain including `20261011120000_mr7c5c2_restore_delta_replay.sql`; `pnpm dlx supabase@2.117.0 db lint --local` reported 0 errors. Live PostgreSQL integration verification passed across 32 dedicated tests (`test/integration/restore-delta-replay-postgres.test.ts`) covering RPC execution, strict privilege boundaries (denied to PUBLIC/anon/authenticated, granted to service_role), atomicity, idempotency, certificate timestamp conflict detection, and end-to-end verifier gate. `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `git diff --check` pass with zero errors.

---

## 2. MR-7C.1 Architecture & Design Decisions

### 2.1 The Direct Delete Hazard Remediation
- Direct hard deletes by tenant users risked catastrophic cascade deletion across foreign keys (`ON DELETE CASCADE`):
  - `customers` $\to$ `customer_completion_events`
  - `customers` $\to$ `review_requests` $\to$ `message_events` & `review_request_events`
  - `customers` $\to$ `messaging_authority_evidence`
- Hard deletes would also destroy unsubscribe link resolution for previously delivered emails and risk re-solicitation if contact details were re-imported.
- MR-7C.1 eliminates this attack vector and operational hazard by removing tenant `DELETE` capability at both the RLS policy and PostgreSQL table privilege levels.

### 2.2 Privilege Enforcement
- Table privilege `DELETE` revoked from `authenticated`, `anon`, `PUBLIC`.
- Policy `customers_delete` dropped.
- Table privilege `DELETE` granted to `service_role`.
- Tenant `SELECT`, `INSERT`, and `UPDATE` policies remain strictly preserved.

### 2.3 Frozen Invariants (Summary)
1. **No Uncontrolled Hard Delete**: All future erasure must use dedicated `service_role` workflows.
2. **Suppression Survives Erasure**: Pseudonymous contact hashes in `suppressions` must not be deleted.
3. **Erasure Must Not Destroy Delivery History by Cascade**: Controlled erasure will redact/anonymize PII rather than cascading row deletion.
4. **Unsubscribe Must Continue to Work**: Historical unsubscribe links must remain resolvable without breaking.
5. **Export Precedes Destructive Erasure**: MR-7C.2 (export) precedes MR-7C.3 (erasure).
6. **Authority/Audit History is Not Raw PII Storage**: Proof of authority retained without unbounded raw PII.
7. **No Retention Periods Invented**: Specific retention timelines await owner/legal policy.
8. **External Processors Are Separate**: Provider data reconciliation treated as explicit external dependencies.

### 2.4 MR-7C.2A Privacy Export Boundary
- Privacy exports are customer-scoped, not bulk tenant dumps.
- Export authority is restricted to `OWNER` and `ADMIN`.
- Normal authenticated/RLS reads remain the default data-access path.
- Elevated access is intentionally narrow: system-only authority evidence plus mandatory audit persistence.
- The export is assembled from an explicit allowlist instead of forwarding database rows or arbitrary JSON metadata wholesale.
- Suppression evidence remains privacy-safe: subject-associated suppressions may be represented, but raw pseudonymous contact hashes are not disclosed.
- Security-sensitive bearer tokens, token hashes, provider identifiers, raw webhook/event metadata, ingestion credentials, billing records, support/admin records, and unrelated tenant records remain outside the export contract.
- MR-7C.2A establishes the server-side export foundation only. Destructive erasure remains gated behind MR-7C.3.

---

## 3. Scope Boundaries & Non-Goals

- **No Destruction / Erasure Execution**: MR-7C.1 and MR-7C.2 do not execute any customer erasures or deletions.
- **Privacy Export Boundary**: MR-7C.2A implements the server-side per-customer export foundation; MR-7C.2B adds the authorized delivery surface via GET `/api/organizations/[organizationId]/customers/[customerId]/export` and customer workspace UI. It does not add bulk tenant export, destructive erasure, or a public self-service export surface.
- **No Retention Cron / Purge**: Automated purging is scheduled for MR-7C.4.
- **MR-7C.1 Production Activation**: Owner explicitly authorized the hosted migration, merge to main, and automatic Vercel deployment associated with the main merge. Hosted migration `20261008010000` was applied and verified before merge.
- **MR-7C.2B Production Boundary**: OWNER ACCEPTED on branch `chatgpt/mr7c2b-export-delivery`. MR-7C.2 is OWNER ACCEPTED / COMPLETE. Requires no database migration. No production deployment, live messaging activation, or billing activation authorized.
- **MR-7C.3A Boundary & Launch Invariant**:
  - Erasure-Safe Unsubscribe Decoupling completed on `chatgpt/mr7c3a-erasure-safe-unsubscribe`.
  - **Launch Invariant**: C3A must be deployed to hosted production and verified BEFORE live customer messaging (`ENABLE_LIVE_EMAIL=true`) or any real-customer pilot (MR-8) can be enabled.
  - **Pre-C3A Legacy State**: Any pre-C3A review request lacking immutable recipient evidence in `review_request_recipient_evidence` is strictly treated as synthetic / pre-production legacy state and remains permanently blocked from customer erasure (`checkCustomerErasureEligibility` returns `BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS`).
  - **No False Safety Claims**: Unresolved legacy unsubscribe links are explicitly NOT claimed to be erasure-safe, and repository evidence does not fabricate or guess historical recipient identities.
  - **Append-Only Access Model**: `public.review_request_recipient_evidence` is strictly append-only for `service_role` (SELECT + INSERT only; UPDATE, DELETE, TRUNCATE revoked). Tenant roles (`OWNER`, `ADMIN`, `OPERATOR`, `VIEWER`) and `anon` have zero access.
- **Live Messaging**: Remains completely OFF (`ENABLE_LIVE_EMAIL=false`).
- **Billing**: Unchanged and paused under `MPG-DEC-049`.
- **MR-6**: Admin/support route code is present, but hosted support-access database/authorization activation remains intentionally not enabled for production.

---

## 4. Verification Matrix

| Command | Result | Notes |
|---|---|---|
| `pnpm lint` | **PASS** | ESLint passes with zero warnings, zero errors |
| `pnpm typecheck` | **PASS** | TypeScript cleanly passes with zero errors |
| `pnpm vitest run test/domain/restore-privacy-verification.test.ts` | **PASS** | 72 tests passed (C5C1: delta schema validation, cap-safe pagination, customer tombstone verification, certificate check, completion contact exact {} verification, external ID scrub, error scrubbing, suppression check, aggregate safe metrics) |
| `pnpm vitest run test/domain/customer-erasure.test.ts` | **PASS** | Customer erasure engine unit tests pass (14 tests) |
| `pnpm vitest run test/domain/suppression.test.ts` | **PASS** | 4 tests passed (suppression hashing and normalization clean) |
| Historical clean db reset (MR-7C.3/C.4) | **PASS** | Local Supabase cleanly reset and applied all 22 migrations from clean state (historical baseline) |
| MR-7C.5C2 clean db reset (`pnpm dlx supabase@2.117.0 db reset`) | **PASS** | Local Supabase cleanly reset and applied all 26 migrations including `20261011120000_mr7c5c2_restore_delta_replay.sql` from clean state |
| MR-7C.5C2 db lint (`pnpm dlx supabase@2.117.0 db lint --local`) | **PASS** | Local Supabase schema clean (0 errors across extensions and public schemas) |
| `pnpm build` | **PASS** | Production build succeeded; all routes compiled |
| `git diff --check` | **PASS** | Clean diff with zero whitespace / syntax errors |
| Local PostgreSQL privilege check (MR-7C.1 / MR-7C.3) | **PASS** | `has_table_privilege('authenticated', 'public.customers', 'DELETE') = false`<br>`has_table_privilege('service_role', 'public.customer_erasure_records', 'SELECT') = true`<br>`has_table_privilege('service_role', 'public.customer_erasure_records', 'INSERT') = true`<br>`has_table_privilege('service_role', 'public.customer_erasure_records', 'UPDATE') = false`<br>`has_table_privilege('service_role', 'public.customer_erasure_records', 'DELETE') = false`<br>`has_function_privilege('service_role', 'public.execute_customer_erasure(uuid, uuid, uuid, text)', 'EXECUTE') = true`<br>`has_function_privilege('authenticated', 'public.execute_customer_erasure(uuid, uuid, uuid, text)', 'EXECUTE') = false` |
| `pnpm vitest run test/domain/restore-delta-replay.test.ts` | **PASS** | 42 tests passed (MR-7C.5C2: valid empty delta, invalid schema fail-closed with zero writes, customer tombstoning, completion contact exact {}, source_customer_id NULL, source_transaction_id NULL, source_event_id retained, review_requests.error_message scrubbed, message_events.sanitized_error scrubbed, missing certificate restored with truthful chronology, certificate deduplication, missing email/SMS suppression replay, suppression deduplication, idempotency on repeated replay, organization scoping, foreign/nonexistent customer fail-closed, DB error fail-closed, partial replay BLOCK, mandatory C5C1 verification execution, verifier BLOCK propagation, zero raw PII/hashes in operational result, server-only boundary, migration privilege verification, temporal window validation, contradictory duplicate evidence rejection, certificate exact match idempotency, certificate timestamp conflict ERASURE_CERTIFICATE_MISMATCH fail-closed, adversarial error message PII masking, BIGINT row count variable, suppression reason trimmed non-empty check) |
| `pnpm vitest run test/integration/restore-delta-replay-postgres.test.ts` | **PASS** | 32 tests passed against real PostgreSQL: RPC existence under service_role; privilege restrictions (denied to PUBLIC, anon, authenticated; granted to service_role); customer tombstoning, contact redaction to exact `{}`, external IDs NULLed, source_event_id retained, error messages scrubbed to NULL, certificate preservation, exact repeat idempotency, timestamp mismatch fail-closed (`ERASURE_CERTIFICATE_MISMATCH`), atomic rollback on failure, cross-tenant fail-closed; suppression email/SMS replay, idempotency, reason trimming rejection (empty & whitespace denied), invalid channel/hash/org rejection, created_at preservation; end-to-end replay with C5C1 `verifyRestoredPrivacyState()` gate (PASS on clean fixture, BLOCK_RESTORE_ACTIVATION on unreconciled fixture) |

---

## 5. Frozen MR-7C Sequence

1. **MR-7C.1**: Privacy Lifecycle Contract + Direct Delete Safety *(OWNER ACCEPTED / HOSTED VERIFIED)*
2. **MR-7C.2**: Customer Privacy Export *(OWNER ACCEPTED / COMPLETE)*
3. **MR-7C.3**: Controlled Customer Erasure / Anonymization *(OWNER ACCEPTED / COMPLETE)*
   - **MR-7C.3A**: Erasure-Safe Unsubscribe Decoupling *(OWNER ACCEPTED)*
   - **MR-7C.3B**: Controlled Customer Erasure Engine Foundation *(OWNER ACCEPTED)*
   - **MR-7C.3C**: External Identifier Erasure Enforcement *(OWNER ACCEPTED)*
   - **MR-7C.3C (Delivery)**: Customer Erasure Delivery Surface *(OWNER ACCEPTED — `50e1bcf0fa833d9be16471c3b748a464e9ea5b76`)*
4. **MR-7C.4**: Retention + Automatic Aging/Purge Controls
   - **MR-7C.4A**: Retention Requirements + Data-Class Decision Matrix *(OWNER ACCEPTED / FROZEN — `924a7f009d18bfeadd0944f5bca082548eac9e54`)*
   - **MR-7C.4B1**: Frozen Retention Controls Foundation *(OWNER ACCEPTED — `dd9af1a7630da5c802b10b9c2345b8b525542d63`)*
   - **MR-7C.4B2**: Multi-Tenant Maintenance Workflows & Bounded Scheduling *(OWNER ACCEPTED — `17ff5bc331b225eb589694607754ac58f30e2473`)*
5. **MR-7C.5**: Processor Deletion/Retention Reconciliation
   - **MR-7C.5A**: External Processor Data Map + Retention / Deletion Contract *(OWNER ACCEPTED at `707f89a072a5593541cfc906e0c19595578bda1c` — Authoritative specification in `docs/MR-7C5-EXTERNAL-PROCESSOR-RETENTION-MAP.md`; audited Resend, Inngest, Supabase, Vercel, Stripe; identified Inngest step output PII leakage for MR-7C.5B remediation; identified Case B Restore Privacy Gap; verified zero public deletion APIs for Resend/Inngest/Vercel; confirmed Stripe paused)*
   - **MR-7C.5B**: Inngest / Provider Privacy Hardening *(OWNER ACCEPTED — Inngest step output minimization: stripped `customerName`, `customerEmail`, `renderedSubject`, `renderedBody`, tokens; static error classification via `classifySafeDispatchError` eliminating raw error leakage into logs/audits/traces; fail-closed production guard on `ConsoleEmailProvider`; verified across 19 proof integration tests and regression suite)*
   - **MR-7C.5C1**: Post-Restore Privacy Verification Foundation (Case A) *(OWNER ACCEPTED at `9263b6a589795ccb17c8bbe24c61735419ebea26` — `PrivacyRestoreDeltaV1` strongly typed schema; `collectPrivacyRestoreDelta` deterministic collector from readable pre-restore DB; `verifyRestoredPrivacyState` restored DB verifier checking customer tombstones, zero PII, scrubbed errors, empty completion contact payloads, and present suppressions; `evaluateRestoreDecision` fail-closed gate returning safe aggregate metrics; Case B catastrophic database loss explicitly remains unresolved and separate)*
   - **MR-7C.5C2**: Controlled Restore-Delta Replay Engine (Case A) *(ENGINEERING COMPLETE / READY FOR OWNER REVIEW — branch `chatgpt/mr7c5c2-restore-delta-replay`)*

---

## 6. Rollback Implications

If rollback of MR-7C.5C2 is required:
1. Revert or remove `src/domain/privacy/restore-replay.ts` and `test/domain/restore-delta-replay.test.ts`.
2. Revert `src/types/database.ts` RPC types.
3. If migration `supabase/migrations/20261011120000_mr7c5c2_restore_delta_replay.sql` was applied to a database, rollback by dropping the two maintenance functions:
   ```sql
   DROP FUNCTION IF EXISTS public.replay_customer_erasure_maintenance(UUID, UUID, TIMESTAMPTZ);
   DROP FUNCTION IF EXISTS public.replay_suppression_maintenance(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ);
   ```

---

## 7. Owner Gate

- **Milestone Status**: MR-7 is ACTIVE; MR-7B.1, MR-7B.2, MR-7B.3, MR-7C.1, MR-7C.2, MR-7C.3A, MR-7C.3B, MR-7C.3C External Identifier Erasure, MR-7C.3C Customer Erasure Delivery Surface, MR-7C.4A Retention Requirements + Data-Class Decision Matrix, MR-7C.4B1 Initial Retention Controls Foundation (`dd9af1a7630da5c802b10b9c2345b8b525542d63`), MR-7C.4B2 Bounded Retention Maintenance Workflow (`17ff5bc331b225eb589694607754ac58f30e2473`), MR-7C.5A External Processor Retention Map (`707f89a072a5593541cfc906e0c19595578bda1c`), MR-7C.5B Inngest / Provider Privacy Hardening, and MR-7C.5C1 Post-Restore Privacy Verification Foundation (`9263b6a589795ccb17c8bbe24c61735419ebea26`) are **OWNER ACCEPTED**.
- **MR-7C.5C2 Status**: **ENGINEERING COMPLETE / READY FOR OWNER REVIEW** (NOT yet Owner Accepted; real PostgreSQL verification passed across 32 integration tests; NOT `MR-7 — COMPLETE`).
- **Customer Erasure Authority**: Frozen by Owner Decision to **OWNER ONLY**.
- **External Identifier Erasure Policy**: Resolved by Owner Decision (`source_customer_id = NULL`, `source_transaction_id = NULL`, `source_event_id = RETAIN`).
- **Frozen Retention Policy**:
  - Active customer PII: retained until explicit Owner erasure (no automatic aging).
  - Completion contact payload: redacted to `'{}'::jsonb` after 30 days.
  - Ingestion deduplication key: `source_event_id` retained permanently.
  - Review request routing links: expire after 90 days (fails closed, HTTP 410 HTML, unsubscribe remains operational).
  - Unsubscribe capability & recipient evidence: retained indefinitely.
  - Messaging authority evidence: retained indefinitely.
  - Suppression registry: retained permanently per organization.
  - Erasure certificates: retained permanently.
  - Audit events: retained indefinitely in initial stage.
  - Financial & usage ledgers: retained indefinitely while MR-5 billing is paused.
  - Inactive tenants: soft deactivation only (no hard tenant delete).
  - Domain event outbox: PENDING never purged; DISPATCHED eligible after 30 days.
- **Inngest & Provider Data Minimization (MR-7C.5B)**:
  - Application-controlled Inngest step outputs strictly minimized; Direct PII (`customerName`, `customerEmail`) and rendered email content (`renderedSubject`, `renderedBody`) eliminated from durable step state.
  - Error and log outputs hardened to safe fixed categories; arbitrary provider errors, tokens, and hashes scrubbed.
  - Fail-closed production guard on `ConsoleEmailProvider` active.
- **Disaster Recovery Backup-Restore Reconciliation**:
  - **Case A (Pre-restore DB readable)**: Executable collection + verification foundation implemented in `MR-7C.5C1` (`src/domain/privacy/restore-verification.ts`). Controlled restore-delta replay engine implemented in `MR-7C.5C2` (`src/domain/privacy/restore-replay.ts`), invoking mandatory verification and enforcing fail-closed gate.
  - **Case B (Catastrophic DB loss)**: Remains explicitly **UNRESOLVED AND SEPARATE AND OUT OF SCOPE** because the primary PostgreSQL cluster holds both data and erasure evidence. An independent durable offsite privacy ledger/storage boundary requires owner architecture selection before pilot launch.
- **Zero Production Scheduling**: Zero cron jobs, pg_cron routines, or production background schedulers activated. Production scheduling strictly guarded via `ENABLE_RETENTION_MAINTENANCE=false`.
- **Live messaging remains disabled** (`ENABLE_LIVE_EMAIL=false`).
- **Live billing remains paused** under `MPG-DEC-049`.
- **Controlled Pilot (MR-8) remains strictly GATED**.
- Feature branch `chatgpt/mr7c5c2-restore-delta-replay` active.
- **Hosted application or migration is NOT authorized**. Live messaging activation, billing activation, automated purging, and deployment remain strictly unauthorized.
