# MR-7 — Trust / Security / Compliance: Execution Handoff

| Metadata | Value |
|---|---|
| Date | 2026-10-09 |
| Authority | Owner direction (Company OS source of truth: techwithmpg/mpg-company-os; reconciliation outstanding) |
| Milestone | MR-7 (Trust / Security / Compliance) — ACTIVE |
| Milestone Slices | **MR-7B.1 — OWNER ACCEPTED**<br>**MR-7B.2 — OWNER ACCEPTED**<br>**MR-7B.3 — OWNER ACCEPTED / PRODUCTION VERIFIED**<br>**MR-7C.1 — OWNER ACCEPTED / HOSTED VERIFIED**<br>**MR-7C.2A — OWNER ACCEPTED / PRODUCTION VERIFIED**<br>**MR-7C.2B — OWNER ACCEPTED**<br>**MR-7C.2 — OWNER ACCEPTED / COMPLETE**<br>**MR-7C.3A — COMPLETED / READY FOR OWNER REVIEW** (NOT `MR-7 — COMPLETE`) |
| Current Bounded Slice | MR-7C.3A — Erasure-Safe Unsubscribe Decoupling — COMPLETED / READY FOR OWNER REVIEW |
| Inspected Product Baseline | `a2c3df3076b814dd74996d674dadfe400428c012` (on `main`) |
| Feature Branch | `chatgpt/mr7c3a-erasure-safe-unsubscribe` (active; stacked on accepted C2B HEAD `e7c8f6b`) |
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
- **MR-7C.3A — ERASURE-SAFE UNSUBSCRIBE DECOUPLING (COMPLETED / READY FOR OWNER REVIEW)**:
  - Establishes immutable, server-owned suppression-contact hash (`suppression_contact_hash`) on `public.review_requests` to decouple historical unsubscribe links from mutable/erasable `customers.email`.
  - Check constraint enforcing 64-char lowercase hex SHA-256 format (`ck_review_requests_supp_contact_hash`).
  - Index `idx_review_requests_supp_contact_hash` on `(organization_id, suppression_contact_hash)`.
  - **Owner-Approved Conservative Rule & Historical Recipient Evidence**:
    - Prior to MR-7C.3A, review requests did not record an immutable recipient hash at send time.
    - Neither intake completion snapshots nor mutable customer rows prove the recipient actually delivered for historical communications.
    - To prevent fabricating recipient identities, historical delivered review requests created before C3A remain `suppression_contact_hash = NULL` rather than receiving guessed hashes. No broad or speculative backfill is claimed or performed.
  - **New / Future Send Immutability**:
    - New review requests obtain an immutable recipient suppression identity tied directly to fresh final authority immediately around provider dispatch and persisted upon confirmed delivery (`status = 'SENT'`).
    - Once initial delivery succeeds, `suppression_contact_hash` is permanent and cannot drift or be replaced.
    - Retry correctness before confirmed delivery is preserved (re-evaluates fresh authority and updates pending hash if recipient was corrected prior to delivery).
  - **Reminder Recipient Invariant (Drift Guard)**:
    - Re-reads fresh final dispatch authority immediately before reminder dispatch.
    - Computes `freshReminderHash` via canonical `hashSuppressionContact('email', freshReminderEmail)` and compares against the stored immutable `suppression_contact_hash`.
    - If recipient matches: reminder proceeds normally.
    - If recipient changed or is unproven: reminder dispatch is strictly blocked, `suppression_contact_hash` is NOT overwritten, historical request status remains intact, `reminded_at` remains NULL, and a zero-PII audit event (`review_request.reminder_blocked` with `decision: 'RECIPIENT_CHANGED'`) is recorded without email or hash in metadata.
  - **Legacy Null Linkage & C3B Erasure Gate**:
    - Legacy requests with `suppression_contact_hash = NULL` temporarily resolve unsubscribe via current customer email only while direct PII exists, but fail closed (404) if customer PII has been removed.
    - Explicit C3B Precondition: Customer erasure (MR-7C.3B) must fail closed and refuse erasure (`checkCustomerErasureEligibility` returns `BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS`) for any customer while an unresolved historical delivered review request still depends on customer PII for unsubscribe resolution.
  - Domain engine `processCustomerUnsubscribe()` resolves suppression contact hash from `review_requests.suppression_contact_hash`, completely eliminating the read dependency on `customers.email` for all decoupled requests.
  - Route handlers `GET /unsubscribe/[token]` and `POST /unsubscribe/[token]` operate without `customers.email`.
  - Server-owned and tenant-isolated: authenticated tenant roles cannot mutate `review_requests.suppression_contact_hash` directly (system-write-only RLS). Zero customer PII or raw contact hashes exposed in URLs, audit metadata, or client UI.
  - Verification: 29/29 integration tests in `test/integration/mr7c3a-erasure-safe-unsubscribe.test.ts` pass cleanly (including all 12 Owner Review correction cases). Full suite baseline attribution confirmed identical to canonical main.
- **MR-7C.3B — CONTROLLED CUSTOMER ERASURE / ANONYMIZATION (ACTIVE NEXT)**:
  - Authorized customer PII redaction engine operating under Invariants 1-8.
  - Precondition: Must enforce `checkCustomerErasureEligibility` gate refusing erasure when unresolved legacy delivered requests exist.
  - Gated until owner review and acceptance of MR-7C.3A.

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
| `pnpm vitest run test/integration/customer-privacy-export-delivery.test.ts` | **PASS** | 17 tests passed: OWNER/ADMIN download, OPERATOR/VIEWER denial, anon denial, forged/foreign org denial, foreign customer non-disclosure, nonexistent customer identical denial, malformed org/customer UUID rejection, valid JSON, application/json, attachment Content-Disposition, PII-free filename, Cache-Control: no-store, C2A schema 1.0 contract parity, zero payload on DENIED/UNAVAILABLE, mandatory privacy.customer_export audit, zero mutation outside audit, and verification that handler delegates purely to C2A without secondary authorization queries |
| `pnpm vitest run test/integration/customer-privacy-export.test.ts` | **PASS** | 7 tests passed: OWNER/ADMIN authorization, OPERATOR/VIEWER denial, cross-tenant denial, field allowlisting/secret exclusion, mandatory audit, fail-closed reads, authorization recheck, and no mutation outside audit |
| `pnpm vitest run test/integration/real-rls.test.ts` | **PASS** | 16 tests passed (enforces customer delete denial for OWNER, ADMIN, OPERATOR, VIEWER, anon, cross-tenant; verifies service_role deletion and tenant mutation preservation) |
| `pnpm vitest run test/integration/unsubscribe.test.ts` | **PASS** | 16 tests passed (unsubscribe flow and suppression invariants fully preserved) |
| `pnpm vitest run test/integration/mr7b1-authority-send-invariant.test.ts` | **PASS** | 5 tests passed (B1 regression clean) |
| `pnpm vitest run test/integration/mr7b2-sender-identity.test.ts` | **PASS** | 9 tests passed (B2 sender identity regression clean) |
| `pnpm vitest run test/domain/mr7b3-payload-minimization.test.ts` | **PASS** | 6 tests passed (B3 payload minimization domain regression clean) |
| `pnpm vitest run test/integration/mr7b3-payload-minimization.test.ts` | **PASS** | 3 tests passed (B3 payload minimization integration regression clean) |
| `pnpm dlx supabase@2.117.0 db lint --local` | **PASS** | Local Supabase schema clean (0 errors) |
| `pnpm build` | **PASS** | Production build succeeded; all routes compiled |
| Local PostgreSQL privilege check | **PASS** | `has_table_privilege('authenticated', 'public.customers', 'DELETE') = false`<br>`has_table_privilege('anon', 'public.customers', 'DELETE') = false`<br>`has_table_privilege('service_role', 'public.customers', 'DELETE') = true` |

---

## 5. Frozen MR-7C Sequence

1. **MR-7C.1**: Privacy Lifecycle Contract + Direct Delete Safety *(OWNER ACCEPTED / HOSTED VERIFIED)*
2. **MR-7C.2**: Customer Privacy Export *(OWNER ACCEPTED / COMPLETE)*
3. **MR-7C.3**: Controlled Customer Erasure / Anonymization
   - **MR-7C.3A**: Erasure-Safe Unsubscribe Decoupling *(COMPLETED / READY FOR OWNER REVIEW)*
   - **MR-7C.3B**: Controlled Customer Erasure Engine *(ACTIVE NEXT)*
4. **MR-7C.4**: Retention + Automatic Aging/Purge Controls
5. **MR-7C.5**: Processor Deletion/Retention Reconciliation

---

## 6. Rollback Implications

If rollback of MR-7C.3A is required:
1. Drop trigger `protect_recipient_evidence_immutability` and function `protect_recipient_evidence_immutability()` on `public.review_request_recipient_evidence`.
2. Drop table `public.review_request_recipient_evidence`.
3. Application code fails closed on legacy requests without recipient evidence.
4. No data is lost; existing review requests, tokens, and suppressions remain completely intact.

---

## 7. Owner Gate

- **Milestone Status**: MR-7 is ACTIVE; MR-7B.1, MR-7B.2, MR-7B.3, MR-7C.1, MR-7C.2A, and MR-7C.2B (MR-7C.2 Complete) are **OWNER ACCEPTED**; MR-7C.3A is **COMPLETED / READY FOR OWNER REVIEW**.
- **Live messaging remains disabled** (`ENABLE_LIVE_EMAIL=false`).
- **Live billing remains paused** under `MPG-DEC-049`.
- **Controlled Pilot (MR-8) remains strictly GATED**.
- Feature branch `chatgpt/mr7c3a-erasure-safe-unsubscribe` contains the finalized MR-7C.3A privacy hardening implementation stacked on accepted C2B HEAD (`e7c8f6b`).
- Local database migration `20261009000000_mr7c3a_erasure_safe_unsubscribe.sql` is tested and verified locally; **hosted application is NOT authorized**. Customer erasure, live messaging activation, and billing activation remain unauthorized.
