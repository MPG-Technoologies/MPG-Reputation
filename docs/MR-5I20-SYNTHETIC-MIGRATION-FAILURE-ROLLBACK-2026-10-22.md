# MR-5I20 — Deliberate SQL Failure and Transactional Rollback Proof (Synthetic Local Only)

**Date:** 2026-10-22  
**Status:** IN PROGRESS until exact-head CI and populated-upgrade workflow succeed. Owner review and main merge remain separately gated.

## Authority and starting state

Authoritative Company OS `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`. Product `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`. Held PR #67 at `699c8a9ad8d6c356eeb0e29affa83feeeac2a227` contains 22 unapplied billing candidate migrations. Parent draft PR #91 `d5828e10b02b031d1d8130a797faefc1a809464b` passed Internal CI, Isolated Synthetic E2E and the populated 26→48 disposable database migration rehearsal.

MR-5I20 builds on the **existing** `.github/workflows/isolated-mr5-populated-upgrade.yml` (baseline → four invented organizations/trials/usage → synthetic public data export/restore → 22 candidate migrations → preservation/security postchecks). No new runner, hosted connector or real user database is involved.

## Incremental implementation and failure test

The workflow now inserts one **deliberate negative transaction test** between successful synthetic data restore and the normal 22-step replay:

1. Reassert localhost `127.0.0.1:54332`, `postgres` disposable fixture credentials, `CI/GITHUB_ACTIONS=true`, billing/email disabled and console email provider.
2. Confirm the accepted migration ledger still has **exactly 26 entries**, and the first candidate's `public.reconcile_stripe_subscription_projection` function has **not** been installed.
3. Calculate the existing seeded-fixture fingerprint without logging records.
4. Use `psql --single-transaction -v ON_ERROR_STOP=1` to execute **the exact first candidate SQL file** `20261018150000_mr5c2_atomic_subscription_projection.sql` and then a separate `scripts/acceptance/mr5-synthetic-injected-migration-abort.sql` that *always raises* `MR5I20_SYNTHETIC_ABORT_EXPECTED`.
5. This attempt **must fail** and the temporary private log must contain the exact expected sentinel. An error earlier in the first migration, or an unexpectedly successful command, causes the test to **FAIL**.
6. Confirm the migration ledger remains **26**, that the candidate function **does not exist**, and the synthetic data fingerprint remains **identical**. Otherwise stop the workflow; do not continue to normal migration application.
7. Only after these fail-closed checks, the **unchanged existing workflow** uses `supabase migration up --local` to apply all 22 candidate files on the disposable local instance and confirms the exact 48 migration IDs, tenant/trial preservation and paid-access nonactivation.

A first-migration source inspection confirmed that candidate SQL creates/replaces the named function and does **not** contain standalone SQL `BEGIN;`, `COMMIT;`, `ROLLBACK;` or `CREATE INDEX CONCURRENTLY`, which would defeat or invalidate the transactional test. PostgreSQL `psql --single-transaction` encloses multiple file inputs in one transaction and sends `ROLLBACK` upon an error with `ON_ERROR_STOP`. See https://www.postgresql.org/docs/17/app-psql.html .

## Verification scope

- New `test/operator/mr5-synthetic-migration-abort.test.mjs` provides static safety/regression checks for the injected exception, local-only constraints, exact expected-error verification, assertion order and before/after state checks. It is registered with Internal CI.
- The exact-head **Isolated MR5 Populated Upgrade Rehearsal** workflow is the necessary *runtime* proof; static tests alone are insufficient. It must show synthetic export/restore succeeded; injected abort reached the expected sentinel, failed as designed, rolled back; and the full ordered migration retry subsequently succeeded.
- The **Isolated Synthetic E2E** and **Internal CI** must also pass on the exact commit before reporting engineering-complete.
- Only four scoped files: one SQL fault fixture **not in `supabase/migrations`**, one existing synthetic upgrade workflow, one Node test, one Internal CI registration and this handoff (**five files total**).

## Explicit boundaries

- A transactional failed **first** migration is one bounded failure scenario; it does **not** establish recovery after a partially committed, multi-migration attempt or repair an incomplete hosted deployment. PostgreSQL transactional rollback is not a substitute for a real restorable backup.
- This does **not** test manual production rollback, Supabase-managed backup recovery, auth/users/session state, Storage API bytes, production credentials, external worker side effects or operational recovery point objectives.
- No real hosted rows copied, backed up or restored; no hosted migrations applied. No branch merge, production deployment, payment charge, provider activation, live messaging or customer pilot.
- Current hosted data classification, owner-authorized encrypted real backup and isolated restoration, and Vercel production-trigger access remain **OPEN**. PR #67 **HOLD**; no permission escalation via `service_role`.
- **Next:** record the exact-head results, reconcile any test failure within this slice, and ask the owner for the actual backup/restore data-handling and Vercel deployment-trigger gates when those consequential operations become appropriate. No real backup/restore occurs under this engineering slice.
