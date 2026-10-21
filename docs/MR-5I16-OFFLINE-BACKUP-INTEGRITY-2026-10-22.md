# MR-5I16 — Private Backup Package Integrity Recheck (2026-10-22)

**State:** ENGINEERING / staged draft, subject to exact-head CI and owner review. **Not** a real backup, actual restore, Vercel deployment clearance or permission to apply the 22 hosted billing migrations.

## Scope and rationale

MR-5I13 already writes an owner-operated PostgreSQL 17 custom-format logical archive with a private local JSON manifest (project reference, archive size, SHA-256, 26-migration baseline, and hard-false `restore_verified`). MR-5I14 tightened the backup operator's version history check to the exact 26 approved IDs; MR-5I15 confirmed the **existing hosted engineering/test schema metadata only**. Neither workflow verifies an *existing offline backup package* after it has been moved or stored. The separate new `scripts/operator/mr5-offline-backup-integrity.mjs` closes just that bounded integrity-check gap.

## Operating sequence (owner-controlled workstation only)

Prerequisite: an **already-created**, owner-approved, securely held and access-controlled `mpg-reputation-...` backup folder from MR-5I13 containing both `postgresql-17.backup` and `manifest.json`. Do not create a real backup merely to execute this development slice.

On the authorized Windows machine, from the review branch/worktree and without pasting credentials:

~~~powershell
$privateBackupDir = '<absolute-existing-private-backup-package-folder>'
node .\scripts\operator\mr5-offline-backup-integrity.mjs --backup-dir "$privateBackupDir" --verify
~~~

The command has **no Supabase connection, PostgreSQL CLI requirement, backup-generation function, database writes, network fetch, checkout, payment or restore**. It reads the manifest and archive from local storage only. It refuses CI/deployment execution, missing explicit arguments, nonabsolute or repository-contained folders, wrong project identity, wrong baseline, unsafe archive basename/manifest state, mismatched file byte counts, wrong `PGDMP` prefix, mismatched SHA-256 and symlinked/nonregular package files. On POSIX it also refuses files and folders with group/world-accessible permissions and hard-linked package files.

Success prints only `OFFLINE_INTEGRITY_MATCH_ONLY` and **`RESTORE_NOT_VERIFIED`**, not archive contents, raw PII, checksum, local folder path or secret values. Failed execution prints a generic error and makes no changes. Tests exclusively generate fake synthetic bytes (not real archives), exercise a successful manifest/hash match and deliberately broken packages; they do not prove an archive is restorable. CI invokes only the unit tests, never the CLI with a real backup path.

## Hard security and recovery boundaries

- **Integrity is not recoverability.** A matching SHA-256 and the `PGDMP` prefix cannot establish archive completeness, valid PostgreSQL objects, correct roles/permissions, restore success, recovery point, Storage object coverage, Vault/Edge Function/settings recovery, or that an approved clone can accept the 22 candidate migrations.
- **A mutable manifest is not an independent authenticity signature.** If an attacker can replace both the backup and manifest, the checksum alone does not prove provenance. Independently safeguarded manifests and controlled encrypted storage are separate owner responsibilities.
- **On Windows, Node does not prove NTFS ACLs, encryption/BitLocker state or physical drive security.** The owner/operator must independently verify restricted ACLs, encrypted storage, retention and data handling. The verifier cannot prove historical hosted records are synthetic.
- The archive may contain raw sensitive customer/auth data. Do **not** upload it to ChatGPT, any plugin, public CI, GitHub, cloud test runner, an unencrypted laptop or an unapproved clone.
- This code rejects obvious symlinks and certain swaps but does not guarantee against a malicious local actor who simultaneously mutates the filesystem.
- The real engineering/test project **`awvqtwkzprygsoyfspuz`** is not changed. PR #67 **HOLD**, 22 candidate migrations **UNAPPLIED**, provider activation/paid access **OFF**, Vercel auto-deploy configuration **UNKNOWN/403**, and independent authorized restore **NOT DONE**.
- A real backup export, isolated restore, clone migration rehearsal, or hosted migration requires its own applicable approval and security controls.

## Verification and implementation scope

Exactly four proposed source files relative to parent PR #87: the new read-only local operator, new synthetic-only unit tests, one existing Internal CI job update to run those tests, and this handoff. Expected checks: `node --test test/operator/mr5-offline-backup-integrity.test.mjs`, the existing backup-operator suite, `pnpm lint`, `pnpm typecheck`, `pnpm test` as scoped by the existing CI allowlist, `pnpm build`, and disposable synthetic database E2E. Do not claim an actual hosted restore test.

**Next release gate remains externally controlled:** establish actual data classification, owner-protected backup and separately authorized isolated restore with all outbound workers OFF. Only afterward assess whether the 22 pending migrations can be rehearsed and proposed for hosted application.
