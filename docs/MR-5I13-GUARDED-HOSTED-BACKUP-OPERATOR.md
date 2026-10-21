# MR-5I13 — Guarded Hosted Backup Operator

**Status:** ENGINEERING / OWNER-OPERATED. PR #67 main merge HOLD remains. No hosted migration, production change or paid billing is authorized.

## Purpose

MR-5I12 verified a **disposable synthetic** backup/restore. This operator command prepares a **private logical export of the real MPG Reputation engineering/test database** when, and only when, the authorized owner executes it on their secured Windows workstation. The program is never invoked in CI and never performs migrations or restores.

Target: MPG Reputation Supabase project **awvqtwkzprygsoyfspuz**, on the Free plan. Expected existing migration history: **the exact ordered set of all 26 accepted `main` migration version IDs**, last version **20261011120000**. The tool reads this full ledger before and after the dump; merely matching the count and latest version is insufficient. The candidate has 22 additional migrations which remain unapplied.

Prerequisites: Node.js 20+, PostgreSQL 17 client tools (pg_dump, pg_restore, psql), BitLocker or other encrypted local storage, a restricted backup folder, sufficient disk space, a restricted PostgreSQL password file **outside the Git repository**, and the correct session-pooler host from Supabase Dashboard → Connect. Never paste passwords, database URLs, or backup files in this chat or GitHub.

## Windows PowerShell — manual steps (operator's PC only)

Get the **actual pooler host** from MPG Reputation → Connect; do not use CradleHub. Open a fresh PowerShell session. Example **without passwords**:

~~~powershell
$env:PGHOST = "<actual-session-pooler-host-from-dashboard>"
$env:PGPORT = "5432"
$env:PGUSER = "postgres.awvqtwkzprygsoyfspuz"
$env:PGDATABASE = "postgres"
$env:PGSSLMODE = "require"
$env:PGPASSFILE = "$env:USERPROFILE\PrivatePostgres\pgpass.conf"
$privateOutput = "$env:USERPROFILE\MPG-Private-Backups"
~~~

Before proceeding, ensure the PostgreSQL password file is present, matches the actual host/user/database, and has restrictive ACLs; the private output folder must already exist on encrypted storage with restrictive ACLs. On Linux/macOS, PGPASSFILE must have mode 0600. The program refuses wrong project references, database hosts/usernames, unsafe paths and inline secrets. A direct connection may instead use PGHOST=db.awvqtwkzprygsoyfspuz.supabase.co and PGUSER=postgres, if direct IPv6 is supported.

First run **preflight only**, without making a network call:

~~~powershell
node .\scripts\operator\mr5-hosted-backup.mjs `
  --project-ref awvqtwkzprygsoyfspuz `
  --confirm-project awvqtwkzprygsoyfspuz `
  --output-dir "$privateOutput"
~~~

Expect SAFE PREFLIGHT ONLY. No file or database operation occurs.

After confirming maintenance/no-write conditions, storage encryption, private file permissions and the correct project, deliberately add **--execute**:

~~~powershell
node .\scripts\operator\mr5-hosted-backup.mjs `
  --project-ref awvqtwkzprygsoyfspuz `
  --confirm-project awvqtwkzprygsoyfspuz `
  --output-dir "$privateOutput" `
  --execute
~~~

Execution reads only hosted migration-history metadata and performs a logical pg_dump to a private local directory. It checks the exact 26-migration baseline before and after, verifies the archive format locally with pg_restore --list, creates an SHA-256 digest and a minimal JSON manifest, and **does not print secrets or backup paths**. Failure removes the newly created partial directory. Never share the raw archive or PGPASSFILE.

## Explicit limits

- The PostgreSQL custom archive captures accessible database schema/data, including auth/storage metadata and migration ledger where permitted, but **does not capture global roles, Supabase Storage API object bytes, Vault encryption root keys, Edge Functions, external provider secrets, or project settings**. Managed role/extension restoration may require special handling.
- The manifest deliberately says restore_verified=false. Archive integrity and pg_restore --list do not establish a restorable backup.
- The actual backup can contain raw user data and sensitive records. Owner storage encryption, local ACLs, encrypted offsite copy and retention controls are essential.
- This command **never restores**, creates a Supabase project/branch, modifies live rows, invokes Stripe or deploys.
- **Next release gate** requires separate owner-approved isolated restore, workers and outbound messaging disabled, tenant/RLS/constraint/ledger verification and a documented rollback plan. Hosted 22 migrations and PR #67 main merge remain HOLD until all applicable gates pass.

## CI-only checks

Run: node --test test/operator/mr5-hosted-backup.test.mjs. Internal CI runs these pure validation tests but does **not** invoke the backup command or have any hosted secrets.

References: https://supabase.com/docs/guides/platform/backups and https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
