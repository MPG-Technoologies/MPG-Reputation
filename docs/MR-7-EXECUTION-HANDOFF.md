# MR-7 — Trust / Security / Compliance: Execution Handoff

| Metadata | Value |
|---|---|
| Date | 2026-10-09 |
| Authority | Owner direction (Company OS source of truth: techwithmpg/mpg-company-os; reconciliation outstanding) |
| Milestone | MR-7 (Trust / Security / Compliance) — ACTIVE |
| Milestone Slices | **MR-7B.1 — OWNER ACCEPTED**<br>**MR-7B.2 — OWNER ACCEPTED**<br>**MR-7B.3 — OWNER ACCEPTED / PRODUCTION VERIFIED**<br>**MR-7C.1 — OWNER ACCEPTED / HOSTED VERIFIED**<br>**MR-7C.2A — OWNER ACCEPTED / PRODUCTION VERIFIED**<br>**MR-7C.2B — OWNER ACCEPTED**<br>**MR-7C.2 — OWNER ACCEPTED / COMPLETE**<br>**MR-7C.3A — OWNER ACCEPTED** (`5bef1ae68309767b645415fb80e09f70da576e0d`)<br>**MR-7C.3B — OWNER ACCEPTED** (`856d7b8849b2576b92a4a7bf309cf7149a888c3a`)<br>**MR-7C.3C External Identifier Erasure Enforcement — OWNER ACCEPTED** (`8796b5e6fb89cea49a96c85917e4808ad5891fa6`)<br>**MR-7C.3C Customer Erasure Delivery Surface — COMPLETED / READY FOR OWNER REVIEW** (NOT `MR-7 — COMPLETE`) |
| Current Bounded Slice | MR-7C.3C — Customer Erasure Delivery Surface — COMPLETED / READY FOR OWNER REVIEW |
| Inspected Product Baseline | `a2c3df3076b814dd74996d674dadfe400428c012` (on `main`) |
| Feature Branch | `chatgpt/mr7c3c-erasure-delivery` (active; stacked on accepted C3C `8796b5e`) |
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
  - **Owner Acceptance**: Accepted at commit `856d7b8849b2576b92a4a7bf309cf7149a888c3a`.
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
- **MR-7C.3C — CUSTOMER ERASURE DELIVERY SURFACE (COMPLETED / READY FOR OWNER REVIEW)**:
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
| `pnpm vitest run test/integration/customer-erasure-delivery.test.ts` | **PASS** | 21 tests passed (MR-7C.3C delivery boundary: OWNER preflight & execution, ADMIN/OPERATOR/VIEWER/anon denial, foreign/nonexistent customer non-disclosure, legacy evidence preflight block and 409 rejection, typed 'ERASE' confirmation requirement, successful erasure state & audit, idempotency, server actions parity with cache revalidation, client code secret check, and UI role gating) |
| `pnpm vitest run test/integration/customer-privacy-export-delivery.test.ts` | **PASS** | 17 tests passed: OWNER/ADMIN download, OPERATOR/VIEWER denial, anon denial, forged/foreign org denial, foreign customer non-disclosure, nonexistent customer identical denial, malformed org/customer UUID rejection, valid JSON, application/json, attachment Content-Disposition, PII-free filename, Cache-Control: no-store, C2A schema 1.0 contract parity, zero payload on DENIED/UNAVAILABLE, mandatory privacy.customer_export audit, zero mutation outside audit, and verification that handler delegates purely to C2A without secondary authorization queries |
| `pnpm vitest run test/integration/customer-privacy-export.test.ts` | **PASS** | 7 tests passed: OWNER/ADMIN authorization, OPERATOR/VIEWER denial, cross-tenant denial, field allowlisting/secret exclusion, mandatory audit, fail-closed reads, authorization recheck, and no mutation outside audit |
| `pnpm vitest run test/integration/customer-erasure.test.ts` | **PASS** | 46 tests passed (all C3B engine foundation and C3C external identifier cases: OWNER-only authority in-transaction, TOCTOU race condition defense, ADMIN/OPERATOR/VIEWER/anon denial, foreign/nonexistent customer non-disclosure, service_role non-OWNER denial, legacy precondition gate, in-place customer retention with deterministic tombstone, last_name/email/phone erasure, source_customer_id/source_transaction_id erased to NULL, source_event_id retained, completion contact redaction, historical error text scrub for review_requests.error_message and message_events.sanitized_error, suppression/recipient evidence/review requests/events/authority survival, unsubscribe GET/POST post-erasure, audit persistence without PII/hashes, idempotency, plpgsql rollback on exception/injected scrub failure, RPC and table privilege lock-down, trigger preventing PII restoration, non-erased customer update preservation, future send/reminder blocking, re-import protection, no cascade delete, privacy export compatibility) |
| `pnpm vitest run test/integration/mr7c3a-erasure-safe-unsubscribe.test.ts` | **PASS** | 16 tests passed (C3A recipient evidence decoupling, immutability trigger, append-only service_role access, zero RPC helper leakage) |
| `pnpm vitest run test/integration/real-rls.test.ts` | **PASS** | 16 tests passed (enforces customer delete denial for OWNER, ADMIN, OPERATOR, VIEWER, anon, cross-tenant; verifies service_role deletion and tenant mutation preservation) |
| `pnpm vitest run test/integration/unsubscribe.test.ts` | **PASS** | 16 tests passed (unsubscribe flow and suppression invariants fully preserved) |
| `pnpm vitest run test/integration/mr7b1-authority-send-invariant.test.ts` | **PASS** | 5 tests passed (B1 regression clean) |
| `pnpm vitest run test/integration/mr7b2-sender-identity.test.ts` | **PASS** | 9 tests passed (B2 sender identity regression clean) |
| `pnpm vitest run test/domain/mr7b3-payload-minimization.test.ts` | **PASS** | 6 tests passed (B3 payload minimization domain regression clean) |
| `pnpm vitest run test/integration/mr7b3-payload-minimization.test.ts` | **PASS** | 3 tests passed (B3 payload minimization integration regression clean) |
| `pnpm dlx supabase@2.117.0 db reset` | **PASS** | Local Supabase cleanly resets and applies all 22 migrations from clean state |
| `pnpm dlx supabase@2.117.0 db lint --local` | **PASS** | Local Supabase schema clean (0 errors across extensions and public) |
| `pnpm build` | **PASS** | Production build succeeded; all routes compiled |
| `git diff --check` | **PASS** | Clean diff with zero whitespace / syntax errors |
| Local PostgreSQL privilege check | **PASS** | `has_table_privilege('authenticated', 'public.customers', 'DELETE') = false`<br>`has_table_privilege('service_role', 'public.customer_erasure_records', 'SELECT') = true`<br>`has_table_privilege('service_role', 'public.customer_erasure_records', 'INSERT') = true`<br>`has_table_privilege('service_role', 'public.customer_erasure_records', 'UPDATE') = false`<br>`has_table_privilege('service_role', 'public.customer_erasure_records', 'DELETE') = false`<br>`has_function_privilege('service_role', 'public.execute_customer_erasure(uuid, uuid, uuid, text)', 'EXECUTE') = true`<br>`has_function_privilege('authenticated', 'public.execute_customer_erasure(uuid, uuid, uuid, text)', 'EXECUTE') = false` |

---

## 5. Frozen MR-7C Sequence

1. **MR-7C.1**: Privacy Lifecycle Contract + Direct Delete Safety *(OWNER ACCEPTED / HOSTED VERIFIED)*
2. **MR-7C.2**: Customer Privacy Export *(OWNER ACCEPTED / COMPLETE)*
3. **MR-7C.3**: Controlled Customer Erasure / Anonymization
   - **MR-7C.3A**: Erasure-Safe Unsubscribe Decoupling *(OWNER ACCEPTED)*
   - **MR-7C.3B**: Controlled Customer Erasure Engine Foundation *(OWNER ACCEPTED)*
   - **MR-7C.3C**: External Identifier Erasure Enforcement *(OWNER ACCEPTED)*
   - **MR-7C.3C (Delivery)**: Customer Erasure Delivery Surface *(COMPLETED / READY FOR OWNER REVIEW)*
4. **MR-7C.4**: Retention + Automatic Aging/Purge Controls *(ACTIVE NEXT)*
5. **MR-7C.5**: Processor Deletion/Retention Reconciliation

---

## 6. Rollback Implications

If rollback of MR-7C.3C delivery is required:
1. Revert UI changes in `src/app/app/customers/customer-actions.tsx` and `src/app/app/customers/page.tsx`.
2. Remove actions `src/actions/customer-erasure.ts` and domain `src/domain/privacy/erasure-delivery.ts`.
3. The underlying engine RPC and schema remain intact.
4. No historical operational records or table schemas are lost.

---

## 7. Owner Gate

- **Milestone Status**: MR-7 is ACTIVE; MR-7B.1, MR-7B.2, MR-7B.3, MR-7C.1, MR-7C.2, MR-7C.3A, MR-7C.3B, and MR-7C.3C External Identifier Erasure Enforcement are **OWNER ACCEPTED**; MR-7C.3C Customer Erasure Delivery Surface is **COMPLETED / READY FOR OWNER REVIEW**.
- **Customer Erasure Authority**: Frozen by Owner Decision to **OWNER ONLY**.
- **External Identifier Erasure Policy**: Resolved by Owner Decision (`source_customer_id = NULL`, `source_transaction_id = NULL`, `source_event_id = RETAIN`).
- **Live messaging remains disabled** (`ENABLE_LIVE_EMAIL=false`).
- **Live billing remains paused** under `MPG-DEC-049`.
- **Controlled Pilot (MR-8) remains strictly GATED**.
- Feature branch `chatgpt/mr7c3c-erasure-delivery` contains the finalized MR-7C.3C customer erasure delivery surface stacked on accepted C3C (`8796b5e6fb89cea49a96c85917e4808ad5891fa6`).
- **Hosted application or migration is NOT authorized**. Live messaging activation, billing activation, bulk erasure, and deployment remain strictly unauthorized.
