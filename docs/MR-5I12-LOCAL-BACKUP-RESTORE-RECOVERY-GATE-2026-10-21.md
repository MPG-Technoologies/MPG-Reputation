# MR-5I12 — Disposable Backup/Restore Proof and Hosted Free-plan Recovery Gate

**Scope:** provider-OFF engineering, local disposable tests only.  
**Owner state:** PR #67 **HOLD** for `main`. Hosted MPG Reputation is designated **ENGINEERING/TEST** by owner, although the Supabase dashboard labels its `main` DB branch `PRODUCTION`. No production deploy, hosted migration, live payment, paid entitlement, messaging or real-customer pilot is authorized here.

## Why this slice exists

The MPG Reputation Free-plan hosted project `awvqtwkzprygsoyfspuz` (Supabase PostgreSQL 17) currently has 26 applied migrations, with 22 additional MR-5 migrations in the draft integration candidate. Its billing webhook, billing account and subscription tables were empty in the read-only audit, but it contains 4 organizations, 3 trial entitlements and 7 usage records. Supabase Free has no conventional downloadable daily backup/PITR. The owner previously authorized hosted migrations **subject to backup/rollback safeguards**, which are still unmet.

The preceding MR-5I11 job proved a 26 → 48 migration replay after seeding 4 synthetic orgs, 3 trial entitlements and 7 usage rows. **MR-5I12 now proves that an exported synthetic application-data backup can be used to actually re-create the pre-upgrade fixture** before the migration test begins. This does not prove full managed Supabase backup recovery.

## Added synthetic-only CI proof

The existing `.github/workflows/isolated-mr5-populated-upgrade.yml` remains manual/PR-only and checks out the accepted 26-migration baseline at `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`. It runs `supabase@2.117.0` on an isolated Ubuntu runner with localhost Postgres `127.0.0.1:54332`, provider-OFF environment and no hosted Supabase credentials.

After seeding **invented fixture records only**:

1. Calculate a deterministic SHA-256 fingerprint of the entire set of synthetic organization, trial and usage rows (including generated IDs and timestamps), without logging raw rows.
2. Run **`supabase db dump --local --schema public --data-only --use-copy`** into `$RUNNER_TEMP` with `umask 077`. Gzip and integrity-check the local export. The SQL and archive are never uploaded as CI artifacts and are removed on exit.
3. Verify the exact accepted migration-history count and the expected synthetic row cardinalities; only then delete the 4 known synthetic organizations (with their related trial/usage fixture rows) **inside the disposable local instance**.
4. Restore the exported SQL to localhost with `psql --single-transaction -v ON_ERROR_STOP=1`; fail if any restore statement fails.
5. Recalculate the row fingerprint and compare it with the pre-export fingerprint. Mismatches fail the job.
6. Only after a successful restore, apply the 22 pending SQL migrations using `supabase migration up --local`. Reverify 48 migration IDs, preserved synthetic data, RLS, narrow role ACLs and absence of paid/financial activation.

**Never run the fixture deletion against a hosted database.** The workflow checks DB host/port, prior migration count, seed IDs/cardinalities, and the absence of nonfixture organizations before any scoped fixture deletion. No `--linked`, `db push`, remote project link, live Stripe, hosted backup download or other nonlocal operation is present.

**Limitation:** The CI exercise uses public-schema data only and an already-provisioned Supabase local baseline. It does **not** capture or restore auth users/session identities, storage objects, provider secrets, roles, extensions, Vault encryption keys, database webhooks, project settings or an actual hosted backup. A synthetic restore passing CI is not itself permission to change the hosted project.

## Safe manual backup of the REAL ENGINEERING/TEST project: separate authorization required

An operator with permission to handle the project's potentially sensitive raw data must perform this step on their **own secured workstation**, not in GitHub Actions, this chat, the ChatGPT container, or the repository. No database URL, password, access token, dump or real-record export should be pasted into a GitHub issue or chat.

1. **Identify and freeze the target.** Check the exact project reference `awvqtwkzprygsoyfspuz` in the Supabase dashboard, confirm it still contains **engineering/test only** records and arrange a maintenance/no-write window. Freeze background senders, providers, webhooks and concurrent test writes to minimize inconsistent backups.
2. **Prepare secured backup storage.** Use an owner-controlled machine and filesystem, an encrypted volume, restricted filesystem ACLs, sufficient disk space, and an encrypted offsite copy. Ensure the output path is outside the Git checkout. `.gitignore` is a *secondary accident barrier*, not confidentiality.
3. **Create a version-appropriate logical export.** Supabase's official manual-backup procedure uses the Supabase CLI's `db dump` command for roles, schema and data, and **separate migration-history schema/data** as documented in the references below. Use a project-appropriate connection method (session pooler is often preferred), and never print or paste credentials. Do not link/migrate or run destructive CLI commands while backing up. PostgreSQL 17-compatible client/CLI versions are needed.
4. **Record nonsecret evidence only.** Record date/time, exact project reference, dump method/CLI version, dump sizes and SHA-256 checksums, expected migration count (26 before upgrade), row-count aggregates, encryption and backup location *without revealing file paths if sensitive*. Do not store the dump in the code repository.
5. **Independently verify restoration on an authorized isolated environment.** A SHA-256 match only proves an unchanged file, not a restorable database. Restore roles/schema/data/migration history into a newly provisioned approved disposable environment, with all outbound integrations and messaging disabled. Verify migrations/constraints/RLS, identity relationships and non-PII row-count aggregates. Securely dispose of the restored copy after review. Do **not** put raw auth/customer data into CI, a public GitHub runner or an unprotected developer laptop.
6. **Escalate special objects.** Supabase's backup excludes Storage API object bodies and may need extra work for Vault/encryption, auth/storage modifications, extensions, privileges and project configuration. A public-only dump is **not** a full disaster-recovery backup. If complete recovery of relevant systems cannot be demonstrated, **BLOCKED**.
7. **Separate deployment decision.** Even with a verified backup, review remaining hosted-schema drift, exact candidate SHA, SQL lock/rollback plan and worker/provider flags before any authorization to apply 22 migrations. PR #67 remains HOLD for `main`. The owner-controlled hosted migration gate is distinct from any local rehearsal or source merge.

References: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups), [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [Supabase CLI command reference](https://supabase.com/docs/reference/cli/supabase-db-dump).

## Verification checklist

| Evidence | Required result | Current status |
| --- | --- | --- |
| Exact accepted-main schema plus synthetic baseline | 26 migration IDs and four/three/seven fixture rows | Tested in MR-5I11 |
| Synthetic export and reimport | Exact row fingerprint after restore; no raw row output in CI | Pending MR-5I12 CI |
| Subsequent candidate upgrade | 48 migration IDs; RLS/ACL/trial preserved, billing remains nonauthorizing | Tested in MR-5I11; rerun after restore proof |
| Actual hosted secure logical backup | Encrypted artifact outside source control and restorable independently | **NOT DONE** |
| Actual hosted-equivalent restore rehearsal | Distinct isolated environment and owner-approved data handling | **NOT DONE** |
| Hosted 22 migration application | Requires full approval and backed-up/rehearsed recovery | **NOT AUTHORIZED TO PROCEED UNTIL GATES PASS** |
| Main merge | Explicit owner HOLD | **HOLD** |

No customer data is needed to validate the CI proof. A failed synthetic restore must be diagnosed and corrected within this slice rather than bypassed.
