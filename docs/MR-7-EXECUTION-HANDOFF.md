# MR-7 — Trust / Security / Compliance: Execution Handoff

| Metadata | Value |
|---|---|
| Date | 2026-10-09 |
| Authority | Owner direction (Company OS source of truth: techwithmpg/mpg-company-os; reconciliation outstanding) |
| Milestone | MR-7 (Trust / Security / Compliance) — ACTIVE |
| Milestone Slices | **MR-7B.1 — OWNER ACCEPTED**<br>**MR-7B.2 — OWNER ACCEPTED**<br>**MR-7B.3 — OWNER ACCEPTED / PRODUCTION VERIFIED**<br>**MR-7C.1 — OWNER ACCEPTED / HOSTED VERIFIED**<br>**MR-7C.2A — OWNER ACCEPTED / PRODUCTION VERIFIED**<br>**MR-7C.2B — IN PROGRESS (READY FOR OWNER REVIEW)** (NOT `MR-7 — COMPLETE`) |
| Current Bounded Slice | MR-7C.2B — Authorized Export Delivery Surface — IN PROGRESS (READY FOR OWNER REVIEW) |
| Inspected Product Baseline | `a2c3df3076b814dd74996d674dadfe400428c012` (on `main`) |
| Feature Branch | `chatgpt/mr7c2b-export-delivery` |
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
- **MR-7C.2B — AUTHORIZED EXPORT DELIVERY SURFACE (READY FOR OWNER REVIEW)**:
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
- **MR-7C.2A Production Activation**: Merged to `main` at `a2c3df3076b814dd74996d674dadfe400428c012` and production verified. This slice required no database migration.
- **MR-7C.2B Production Boundary**: Engineering completed on branch `chatgpt/mr7c2b-export-delivery`. Awaiting owner review. Requires no database migration. No production deployment, live messaging activation, or billing activation authorized.
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
2. **MR-7C.2**: Customer Privacy Export *(IN PROGRESS — MR-7C.2A OWNER ACCEPTED / PRODUCTION VERIFIED; MR-7C.2B READY FOR OWNER REVIEW)*
3. **MR-7C.3**: Controlled Customer Erasure / Anonymization
4. **MR-7C.4**: Retention + Automatic Aging/Purge Controls
5. **MR-7C.5**: Processor Deletion/Retention Reconciliation

---

## 6. Rollback Implications

If rollback of MR-7C.1 is required:
1. Re-grant `DELETE` on `public.customers` to `authenticated`.
2. Re-create policy `customers_delete` with `USING (user_has_role(organization_id, ARRAY['OWNER', 'ADMIN']))`.
3. No application code depends on client-side customer deletion, so application code remains stable.

---

## 7. Owner Gate

- **Milestone Status**: MR-7 is ACTIVE; MR-7B.1, MR-7B.2, and MR-7B.3 are **OWNER ACCEPTED**; MR-7C.1 is **OWNER ACCEPTED / HOSTED VERIFIED**; MR-7C.2A is **OWNER ACCEPTED / PRODUCTION VERIFIED**; MR-7C.2B is **READY FOR OWNER REVIEW**.
- **Live messaging remains disabled** (`ENABLE_LIVE_EMAIL=false`).
- **Live billing remains paused** under `MPG-DEC-049`.
- **Controlled Pilot (MR-8) remains strictly GATED**.
- Feature branch `chatgpt/mr7c2b-export-delivery` contains the MR-7C.2B implementation.
- MR-7C.2B requires no database migration. Customer erasure, hosted database mutation, live messaging activation, and billing activation remain unauthorized.
