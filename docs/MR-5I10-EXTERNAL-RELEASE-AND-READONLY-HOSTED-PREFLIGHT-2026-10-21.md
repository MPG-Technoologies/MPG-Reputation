# MR-5I10 — External Release Trigger and Hosted Database Read-Only Evidence

**Date:** 2026-10-21  
**Status:** BLOCKED — account scope; OWNER HOLD remains in force.  
**Source of authority:** Owner directive: *HOLD main merge; inspect release automation and prepare a non-destructive hosted migration rehearsal. Do not apply hosted migrations without separate authorization.*  
**Product candidate:** `chatgpt/mr5i5-integrated-billing-review-20261020`, pre-document review head `be0ffd7598bcdcfa6836348a5e7edec48dbcd373`. Product `main` `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`. Company OS `main` `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`.

This document adds **evidence of actual connector visibility**, precise required evidence and optional SQL **read-only templates**. It does not approve a merge, production deployment, provider TEST, hosted database change, cloning/restore, billing activation, or use of another product's database.

## 1. Verified external connector access — NO MUTATIONS

- Supabase connector `list_projects` returned **only the unrelated CradleHub project**. No MPG Reputation Supabase project was returned. **Do not inspect, query, migrate, clone, or reset CradleHub for MPG Reputation.** No authenticated project ID for MPG Reputation is available here; any project ID inferred from a repository's local `supabase/config.toml` is **not** a hosted identifier.
- Vercel connector `list_projects(search="mpg-reputation")` without team scope returned **zero accessible projects**. Its previously identified team scope `grovys-projects-793dd5b1` returned **403 Forbidden** to project info, team project search and deployment inspection. This is a **connection/authorization blocker**, not evidence the project does not exist.
- GitHub `main` and the candidate were separately inspected, including `package.json`, `next.config.ts`, and the three candidate GitHub workflows. `pnpm build` is `next build`; no package build/postinstall migration/deployment side effect was found in the inspected scripts. The GitHub `Internal CI` workflow triggers on `main` pushes, with synthetic settings. The E2E and browser workflows are PR/manual and disposable local-only. No `vercel.json` or checked-in `.vercel/project.json` was found at the root. **This does not prove that GitHub Apps, other workflows, Vercel Git integration or external deployment hooks cannot deploy on `main`**.
- Vercel's Git integration can create a production deployment on pushes to the configured production branch. The actual MPG Reputation production-branch setting, ignored-build configuration, deployment checks, custom domains, production environment scopes and enabled hooks are **UNVERIFIED**. A green Vercel PR preview check is insufficient.
- This preflight **did not connect to or query any database**, whether hosted or local. No sensitive records, credentials, provider keys, or customer data were read.

## 2. Evidence required to resolve release-trigger HOLD (read-only)

An authorized administrator must use the **actual MPG Reputation Vercel team/project connection**, not the unrelated accessible account, and record redacted settings evidence:

| Question | Minimum redacted evidence | Current state |
| --- | --- | --- |
| Is the connected repo `MPG-Technoologies/MPG-Reputation`? | Vercel project Git repository mapping | UNKNOWN (403) |
| What branch deploys to production? | Vercel Git Production Branch | UNKNOWN (403) |
| Does `main` trigger an automatic production deployment? | Git integration, ignored build step, branch/deploy rules | UNKNOWN (403) |
| Are production deploys gated? | Deployment checks, reviewer/approval settings, manual promotion / domain assignment rules | UNKNOWN (403) |
| Is the current Vercel project using hosted DB credentials? | Names/scopes of environment variable bindings only (NO secret values) | UNKNOWN (403) |
| Are there external actions or deployment hooks? | GitHub Apps/webhooks/environments, Vercel deploy hooks, custom CD settings | UNKNOWN |
| Does code build auto-run migration/worker activation? | Package scripts, build settings, connected deploy hooks, worker orchestration | Repository scripts checked; external settings UNKNOWN |

**Stop on any unknown deployment behavior.** Do not temporarily change the production branch, disconnect Vercel, disable deployment protection, remove project access or perform a test push to `main` as a discovery method. Grant the authorized Vercel connector the correct scope (or have the administrator share **redacted settings evidence**). No token is to be pasted into ChatGPT, GitHub issues, CI logs or documents.

## 3. Hosted Supabase evidence required (read-only, no customer PII)

1. Owner/authorized operator identifies the **MPG Reputation** Supabase project by exact project reference, organization and purpose. Confirm that it is **engineering/test only**, without real customer traffic or production data. The currently connected Supabase account **cannot** provide this reference.
2. Check **only metadata**, without reading raw rows: Postgres version, Supabase migration ledger (versions), relevant schema/constraints/indexes, RLS policy definitions, function permissions, role grants, approximate table row counts (catalog estimates).
3. Compare the ledger and schema against the candidate's **22 additional chronological SQL migrations**. Classify each pending, matched, diverged, partly applied or unknown. Missing checksum support in the ledger is **not** a hash match; obtain independently tracked migration hashes or independently inspect deployed function/schema definitions before claiming parity.
4. Confirm backup/PITR/restore **capability** through read-only settings. No backup creation, database dump, clone or restore until the owner separately approves that operation and the exact target.
5. Never use the unrelated CradleHub project as a proxy for MPG schema or records.

### Example catalog-only SQL for a separately authorized database reader

The following are illustrative **SELECT-only** statements for an authorized MPG Reputation project and a read-only role. They were **not executed** here. Before use, independently verify the correct DB target, authorization, required catalog privileges and absence of production/customer data.

```sql
BEGIN TRANSACTION READ ONLY;

-- Metadata only: identity and version; do not display password or connection string.
SELECT current_database() AS db_name,
       current_setting('server_version') AS postgres_version,
       current_user AS reader_role;

-- Migration versions only; check existence and read authorization before use.
SELECT version
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- Relation metadata, RLS state and approximate row counts (NOT raw rows).
SELECT n.nspname AS schema_name,
       c.relname AS relation_name,
       c.relkind,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.reltuples::bigint AS estimated_rows
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
ORDER BY c.relname;

-- Effective function EXECUTE for API roles; does not execute any function.
SELECT p.proname AS function_name,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND
      (p.proname LIKE 'stripe_%' OR p.proname LIKE 'billing_%')
ORDER BY p.proname;

COMMIT;
```

These queries **do not** verify data compatibility, hashes, migration replay or rollback by themselves. Permissions may block catalog inspection; record that as BLOCKED, not a reason to elevate a user's role. No service-role access merely for inspection convenience.

## 4. Safe clone rehearsal — PLANNED, not performed or authorized

- First confirm *the actual hosted nonproduction schema baseline*, metadata-only row estimates, migration history, and safe data classification.
- In a separately authorized, isolated **synthetic/sanitized** host-equivalent clone with all outbound provider/messaging/worker connections disabled, reproduce existing baseline schema and synthetic row distributions. Require tested, restorable backup strategy and documented restore operator.
- Apply only **pending** migrations from the reviewed candidate in ascending order; abort immediately for drift, duplicates, unsafe DDL locks, FK/unique check failures or failed tenant/ACL tests. Preserve current history; do not use `supabase db reset`, `migration repair`, destructive DML or automatic rollback on the hosted target.
- Test service role privileges, RLS, anon/authenticated denials, tenant isolation, invoice/checkout idempotency, webhook quarantines, immutable synthetic ledgers and **no paid entitlement**; execute no real Stripe payments.
- Capture reviewed migration times, safe counts and schema-level after/before diff. If a test fails, rebuild the clone from baseline and correct the repository in a new scoped branch.
- **A successful rehearsal still does not authorize applying migrations to the hosted engineering/test target.** That requires a *separate owner decision* naming exact project, migration IDs, backup operator and maintenance window.

## 5. Status and exact next owner dependency

- **Main merge PR #67:** HOLD (explicit latest owner decision), draft/unmerged.
- **Code security acceptance:** conditional provider-OFF only at earlier pinned commits; refreshed exact-head verification required for later changes.
- **Vercel production automation:** BLOCKED BY WRONG/INSUFFICIENT CONNECTION SCOPE; no main push/deployment test conducted.
- **Hosted MPG Reputation database metadata:** BLOCKED BY WRONG/INSUFFICIENT CONNECTION SCOPE; zero queries run.
- **Hosted clone/rehearsal:** NOT STARTED. No authorization to change hosted environments.
- **Next:** Connect the **correct Vercel team** and **correct MPG Reputation Supabase project** with read-only permissions, or supply administrator-approved redacted metadata/settings. Recheck external triggers first; then classify migration drift/backup capability; request separate clone/rehearsal authorization if appropriate.

**Guardrail:** Do not infer authorization to merge, migrate, activate LIVE billing/messaging, price plans, run a real-customer pilot or change Company Stage from this checkpoint.
