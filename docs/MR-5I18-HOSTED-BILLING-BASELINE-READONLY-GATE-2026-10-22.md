# MR-5I18 — Hosted Billing Baseline Schema Preflight (Read-Only)

**Date:** 2026-10-22  
**Status:** ENGINEERING EVIDENCE / draft, subject to exact-head CI. **No hosted migration, restore, backup, merge, live billing or deployment authority.**

## Verified authorities and starting point

Company OS `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`. Product `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`. The held billing candidate PR #67 is at `699c8a9ad8d6c356eeb0e29affa83feeeac2a227`. This slice stacks after reviewed candidate SQL manifest PR #89 at `97e07a312d8f21bb54be09201d18f265fe247db0`.

The connected MPG Reputation engineering/test Supabase project is exactly `awvqtwkzprygsoyfspuz`, PostgreSQL 17.6. It contains application records; their synthetic-only classification cannot be proved via metadata alone. **No raw application records were retrieved.**

## Bounded accomplishment

The committed `scripts/acceptance/mr5-hosted-billing-baseline-readonly-gate.sql` returns a **single row of seven boolean values**, not application data. It is a single `WITH ... SELECT` statement reading only Supabase migration-history versions, `information_schema` column metadata, and `pg_catalog` constraints, relation metadata, effective grants and policy expressions.

Six individually measurable gates were executed using the connected, correctly identified hosted Supabase project, and all returned `true` on **2026-10-22**:

| Gate | Required condition | Hosted result |
| --- | --- | --- |
| `exact_26_baseline_versions` | Exact set of all 26 accepted historical versions; no additional or missing versions | PASS |
| `exact_four_table_column_contracts` | Exact 46 observed names, types and nullable flags over three base billing tables and `organization_entitlements` | PASS |
| `required_fk_and_unique_constraints` | Six critical tenant-scoped FK/UNIQUE constraint names/kinds | PASS |
| `baseline_billing_rls_and_direct_grants` | Three existing billing tables have RLS; anon cannot SELECT/INSERT; authenticated can SELECT billing account/subscription only and cannot INSERT | PASS |
| `baseline_tenant_select_policies` | Exactly two owner/admin SELECT policies, one on each tenant-visible billing table, with the exact catalog predicate `user_has_role(organization_id, ARRAY['OWNER','ADMIN'])` | PASS |
| `no_candidate_only_billing_tables` | Ten candidate-only billing tables remain absent | PASS |

`narrow_catalog_gate_pass` was `true` (conjunction of all six). This exact query was fetched back from the feature branch and executed through the authenticated Supabase connector. **It was not executed from CI and did not run a migration.**

## How it is used

Authorized operator, after independently confirming the project identity and least-privilege read access, may run the exact committed SQL as a **read-only metadata diagnostic** before a separately authorized isolated restore/rehearsal. It must be run against the correct project; a generic database name of `postgres` does **not** prove project identity. Treat any false result, missing read privilege, or SQL error as **STOP/INVESTIGATE**, not automatic migration repair or permission elevation.

Unit tests in `test/operator/mr5-hosted-billing-baseline-gate.test.mjs` enforce source-level safety: one SELECT statement, only catalog relations and expected CTEs, no schema/data mutation verbs, exact historical count and bounded column/key expectations, plus drift of the tenant-read predicate. Internal CI runs these source checks **offline only**, without Supabase credentials. Source-level regex is not a formal SQL parser or runtime authorization proof.

## Explicit nonclaims and external blockers

- A PASS is a **narrow metadata snapshot of the existing hosted baseline**, not a full schema checksum, verified SQL function body, live tenant-role enforcement test, restore readiness, backup consistency or proof that the 22 pending migrations will apply without error.
- Pinned column types and six constraints do not cover every schema object, index, function definition, trigger, extension, grant or unique check on the full hosted project. The function `public.user_has_role` is referenced by predicate name only; its security behavior is **not** established by this gate.
- The expected predicate is intentionally pinned to the accepted current SQL rendering. PostgreSQL catalog formatting may change between versions; a false positive stop requires independent review, not weakening tenant authorization checks.
- An altered baseline that also changes this feature's SQL must undergo code review; this gate is not a signed source authenticity proof.
- `organization_entitlements` is the existing trial-allowance authority. Candidate synthetic paid-entitlement *proposals* must never grant paid access.
- Real hosted backup export, access-controlled isolated restore, migration rehearsal, hosted migration, main merge, Vercel production-trigger settings and Stripe account activation remain independently owner-gated. Vercel access remains 403/UNKNOWN, and PR #67 main merge stays **HOLD**.
- The repository contains the same 22 held candidate SQL files; this slice edits **no migration files**, production code, customer records or database grants.

## Next consequential gate

Confirm the hosted data classification and owner-controlled encrypted backup/isolated restore setup. When separately approved, restore safely with all outbound integrations disabled and run the exact 22 candidate SQL migrations in order on the isolated rehearsal target. Re-run the RLS, tenant isolation, idempotency and no-paid-entitlement suites. Never infer authorization to apply the 22 SQL files to the hosted project merely because this read-only preflight passes.
