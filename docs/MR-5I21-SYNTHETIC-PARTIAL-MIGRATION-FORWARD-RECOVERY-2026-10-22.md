# MR-5I21 — Synthetic Partial-Migration Failure and Forward Recovery

**Date:** 2026-10-22  
**Status:** IN PROGRESS until exact-head CI plus the populated-upgrade disposable database workflow pass. **Not** an approved hosted restore, hosted migration, Vercel deployment, commercial billing activation or main merge.

## Remote authority

- Company OS `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c` (MPG-DEC-052 bounded accelerated engineering).
- Product `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`.
- Integration PR #67 at `699c8a9ad8d6c356eeb0e29affa83feeeac2a227`: owner **HOLD**, no `main` merge.
- MR-5I20 parent PR #92 `8cea682b59becbef51ce7db41dd2228bf69dbe0c`: all three workflows PASS (Internal CI, Isolated Synthetic E2E and populated 26→48 migration rehearsal), not owner accepted/merged.
- Hosted MPG Reputation engineering/test Supabase database `awvqtwkzprygsoyfspuz` has 26 historical migration versions; 22 candidate billing SQL files remain unapplied there. We did **not** access, back up, restore or mutate hosted data in this slice.

## What new failure mode this tests

MR-5I20 proved transactional rollback **within the first migration attempt**, leaving all 26 historical migrations intact. That is necessary but insufficient: normal migration tools often commit earlier files **one at a time**. If a later migration fails, previously committed migrations must not be implicitly assumed to roll back.

MR-5I21 tests a **partial committed chain followed by forward recovery** inside the existing `.github/workflows/isolated-mr5-populated-upgrade.yml`. No new hosted account, CI credential or database runner is created.

1. Start from the accepted 26-migration disposable Supabase baseline; create only invented synthetic organizations, trial records and usage; export and restore synthetic public data. MR-5I19's exact baseline/source/localhost safeguards and MR-5I20's first-migration abort tests run first.
2. Run `scripts/acceptance/mr5-synthetic-partial-forward-recovery.sh`, which strictly requires GitHub synthetic CI, PostgreSQL `127.0.0.1:54332`, console mail, disabled billing/email/retention workers and no hosted/provider credential overrides. It reruns the frozen source and Git blob preflight.
3. Inside `$RUNNER_TEMP` only, stage a temporary project containing the unchanged accepted 26 migrations plus only the **first two real reviewed candidate SQL files**:
   - `20261018150000_mr5c2_atomic_subscription_projection.sql`
   - `20261018163500_mr5c3a_webhook_processing_leases.sql`
   Source bytes are copied and compared unchanged; the actual repository/22-migration manifest is never edited.
4. Run pinned `supabase@2.117.0 migration up --local` against the already-running disposable localhost Supabase stack. This must **commit** both candidate migrations and record their versions in `supabase_migrations.schema_migrations`. Check the full 28-version ordered ledger (not just count), and assert that the first two functions and webhook lease columns persist.
5. Attempt the **third exact reviewed candidate migration**, `20261018180500_mr5c3b2_fenced_subscription_reconciliation.sql`, followed by the MR-5I20 synthetic exception sentinel **in one `psql --single-transaction` invocation**. The attempt must fail *specifically at the sentinel*. Any unexpected success or unrelated SQL error causes a failing test.
6. Confirm that the entire third migration rolled back: the new `public.stripe_subscription_reconciliation_leases` table remains absent. **Crucially, the previously committed first two functions and the full 28-version migration ledger must still exist.** Verify that the synthetic organization/trial/usage fingerprint remains unchanged.
7. Only after this positive proof of a genuine partially committed database does the **existing** workflow use pinned `supabase@2.117.0 migration up --local` from the intact candidate to apply the **remaining 20** candidate migrations. The final ordered migration ledger must contain exactly 48 versions; postchecks continue to enforce synthetic tenant/trial preservation, RLS, grants and nonactivation. The third migration's table must now exist.
8. Clean the temporary staged directory and failure log via shell exit trap. Cleanup of the disposable local Supabase stack remains in the existing workflow's `always()` step.

This is **forward resume/reconciliation**, **not an automatic rollback** of earlier committed migrations. Source-only tests in Internal CI verify workflow/source guardrails; a passing **Isolated MR5 Populated Upgrade Rehearsal** workflow is the necessary runtime evidence that the staged Supabase CLI migration and recovery actually work.

## Important operational limits

A successful synthetic forward recovery does **not** prove a live hosted migration can be repaired by unconditionally rerunning `migration up`. A real failed upgrade could involve out-of-band DB changes, data shape differences, migrations that include nontransactional operations, application traffic, long-running locks, real auth/Storage objects, write concurrency and external-provider effects. Any such ambiguity requires STOP and owner-controlled diagnosis; never repair hosted migration history manually by guessing.

A full real backup/restore rehearsal remains separately gated on verified engineering/test data classification, appropriate owner consent, encrypted private backup storage, authorized disconnected restore environment and independent recovery evidence. Never paste hosted dump, credentials or raw user records into CI/chat. The Vercel production deployment trigger is still unverified (403). PR #67 stays HOLD, no live Stripe/messaging activation, and this feature PR is stacked on the preceding draft PR #92, not on `main`.

## Success/STOP

Success evidence requires **three exact-head GitHub workflow PASS states** (Internal CI, Isolated Synthetic E2E and Isolated MR5 Populated Upgrade Rehearsal), including both explicit stdout markers:

- `MR5I21_TWO_COMMITTED_THIRD_ABORTED_PARTIAL_STATE_VERIFIED`
- `MR5I21_PARTIAL_MIGRATION_FORWARD_RECOVERY_28_TO_48_VERIFIED`

If either marker, expected SQL catalog/ledger state, the exact synthetic data fingerprint, or any RLS/nonactivation assertion is absent or fails, report **INVESTIGATING/IN PROGRESS**, do not declare recovery complete.

**Next gated action:** owner decision on real engineering-data classification, encrypted backup, permitted isolated restore and controlled Vercel deployment triggers; no real hosted schema change is authorized by this synthetic-only proof.
