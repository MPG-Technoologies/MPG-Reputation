# MR-5I22 Phase A — Owner-Authorized Private Backup (Guarded Windows Execution)

**Date:** October 22, 2026  
**Owner scope:** explicit owner authorization was given for secure backup preparation and execution **only** on an approved, access-controlled environment for MPG Reputation project `awvqtwkzprygsoyfspuz`. No hosted migrations, resets, isolated restores, payments, messaging, deployment, PR #67 merge, or real-record uploads to GitHub/ChatGPT/CI.

## Verified live state (metadata only)

- Company OS `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`; product `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`; held billing PR #67: `699c8a9ad8d6c356eeb0e29affa83feeeac2a227`.
- Connected Supabase secondary account, project **`awvqtwkzprygsoyfspuz`**, name `mpg-reputation`, status `ACTIVE_HEALTHY`, region `ap-south-1`, PostgreSQL `17.6`.
- `list_migrations` returned all **26 exact historical versions**, latest `20261011120000`, with **zero** of the 22 pending billing versions applied.
- The committed catalog-only `mr5-hosted-billing-baseline-readonly-gate.sql` was rerun via the connected project and all **six** baseline Boolean checks passed (versions, 46 columns, six key constraints, RLS/grants, tenant read policies, absence of pending-only tables).
- No application rows, raw customer PII, passwords, archive bytes, or database URL were fetched or passed to ChatGPT.

## Important environment boundary

The connected Supabase chat plugin supports administrative metadata and SQL operations but **does not provide an approved method to export a private archive directly into an owner-controlled encrypted volume**. A chat/cloud runner, Supabase SQL query returning records, GitHub Actions or an agent-managed public CI machine is **not** an approved substitute. We do NOT execute a real backup here and do NOT report a backup as created.

The existing owner-operated `scripts/operator/mr5-hosted-backup.mjs` already checks the project twice, PostgreSQL 17 tooling, the full 26-version ledger before and after `pg_dump`, custom-archive structural readability with `pg_restore --list`, and SHA-256 plus manifest. `scripts/operator/mr5-offline-backup-integrity.mjs` verifies a private package separately without a network connection.

The gap addressed here is **Windows host security preflight** before invoking the existing export tool.

## Owner-workstation wrapper (no real data in Git or CI)

`scripts/operator/mr5-windows-owner-secure-backup.ps1` requires Windows PowerShell 5.1+ on the actual owner-controlled workstation, not on CI. Default mode is **PRECHECK ONLY**.

- Refuses CI, GitHub Actions, Vercel/cloud contexts; no auth tokens in the runner.
- Requires existing absolute local folder and pgpass paths, not symlink/junction paths and no symlink ancestors, outside the checkout, on a **fixed local drive** with BitLocker `ProtectionStatus=On` and `VolumeStatus=FullyEncrypted`.
- The pre-existing backup root and password file must have NTFS ACL inheritance disabled and **no allow ACE beyond the current Windows user, SYSTEM and local Administrators**; owner SID must be one of the same. Newly created package/archive/manifest files may inherit the *already restricted* parent ACL, but each allow ACE is checked again. An accessible but broadly shared user-profile folder **must STOP**, even if the user can write to it. Unsupported/unverifiable BitLocker or ACL status is a **STOP**, not a waiver.
- Never accepts inline DB passwords or URLs; reads a local `PGPASSFILE` path privately. Exact target credentials remain guarded by the existing operator.
- Optional `-Execute` explicitly invokes the established project-pinned backup operator on the **owner workstation**. Only if one new package is observed, the wrapper rechecks its local files' encryption/ACL properties and invokes the offline hash/manifest verifier.
- The script does **not** change ACLs, enable BitLocker, create a new Supabase instance, modify database rows, execute migrations, or print file paths, archive hashes, customer records or credentials.
- A custom-format `pg_dump` archive on BitLocker is encrypted **at rest on that volume**, but it is **not a separately password-encrypted portable archive**. Anyone granted read permission while the volume is unlocked can access contents. Any offsite copy requires **independent protected encryption and restricted access**; do not copy the plaintext archive to a cloud folder.

## Owner-only execution sequence

Perform only on a workstation you control after approving local BitLocker, NTFS ACLs and private destination; never paste actual values or any password here. Use a privately stored pgpass file with the correct host:port:database:user:password entry and no extra account access. PostgreSQL 17 `pg_dump`, `pg_restore`, `psql` and Node.js 20+ must be installed. No password is placed in shell history.

~~~powershell
# Use the actual session-pooler hostname shown under
# Supabase MPG Reputation -> Connect (do NOT use CradleHub).
$env:PGHOST = '<actual-mpg-session-pooler-host>'
$env:PGPORT = '5432'
$env:PGUSER = 'postgres.awvqtwkzprygsoyfspuz'
$env:PGDATABASE = 'postgres'
$env:PGSSLMODE = 'require'
$privateOutput = '<existing-private-folder-on-BitLocker-fixed-disk>'
$privatePasswordFile = '<existing-private-pgpass-file-on-BitLocker-fixed-disk>'

# From the checked-out, review-approved MR-5I22 branch:
powershell -NoProfile -File .\scripts\operator\mr5-windows-owner-secure-backup.ps1 `
  -BackupDirectory "$privateOutput" -PasswordFile "$privatePasswordFile"
# The above command MUST print PRECHECK ONLY and create no archive.

# After a passing preflight and an owner-controlled no-write window,
# execution is allowed only on that same secured workstation:
powershell -NoProfile -File .\scripts\operator\mr5-windows-owner-secure-backup.ps1 `
  -BackupDirectory "$privateOutput" -PasswordFile "$privatePasswordFile" -Execute
~~~

Use a restricted locally held checklist for BitLocker recovery keys, encryption/ACL state, destination capacity, no-write/maintenance arrangement and offsite encryption. Neither script has authority to interrupt live app traffic or stop background workers: schedule a no-write window operationally before the export. If any check fails or concurrent backup folders appear, STOP and investigate; do not paste logs containing secrets.

**Successful local evidence marker** (safe to report to the owner without sharing files): `MR5I22_OWNER_ENCRYPTED_VOLUME_BACKUP_INTEGRITY_PASS` and `RESTORE_NOT_VERIFIED`. If the execution operator reports success but the wrapper's post-run checks fail, the archive may exist in owner-controlled private storage and **must not be assumed valid or deleted blindly**.

## Verification and explicit limitations

- Internal CI runs a source-level test `test/operator/mr5-windows-owner-secure-backup.test.mjs` and parses the PowerShell syntax on an ephemeral runner **without invoking the script**. These do not establish that the owner's Windows drive is encrypted, accessible, or that the backup exists.
- The real backup remains **NOT CREATED / not verified here** until the owner-workstation execution reports the success markers; do not claim the backup or private ACL/BitLocker gates have passed in reality before that execution.
- Logical PostgreSQL archives may include sensitive auth and organization records; these records are treated as potentially sensitive even if the project has engineering/test designation.
- A `pg_dump` custom archive **does not capture** PostgreSQL role globals and passwords, Supabase Storage object bytes, Edge Functions, external provider secrets, project settings or Vault master keys. Supabase guidance separately discusses roles, schema/data, migration history and restored encryption keys. This is one guarded logical export, **not** a complete project recovery proof.
- The operator's checksum proves local package integrity but is not independent cryptographic authenticity or proof of a successful restore. An **isolated restore** remains separately owner-gated.
- The held 22 migrations, Vercel production trigger investigation, PR #67 main merge, payments and messaging stay independently gated.

## Outcomes / next action

Phase A is **PREPARED / BLOCKED ON EXECUTION ENVIRONMENT** until the actual owner-controlled Windows execution occurs. Once the owner reports only the safe local success markers, reconcile any encrypted-storage/offsite evidence in an owner-controlled audit, then request **separate authorization** for isolated restore. Never send the archive or credential file through any app connector or this chat.

References: https://supabase.com/docs/guides/platform/backups and https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
