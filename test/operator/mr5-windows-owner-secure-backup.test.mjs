import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

const script = fs.readFileSync(new URL(
  '../../scripts/operator/mr5-windows-owner-secure-backup.ps1', import.meta.url), 'utf8')
const backup = fs.readFileSync(new URL(
  '../../scripts/operator/mr5-hosted-backup.mjs', import.meta.url), 'utf8')
const integrity = fs.readFileSync(new URL(
  '../../scripts/operator/mr5-offline-backup-integrity.mjs', import.meta.url), 'utf8')

// Source-level guardrails only. The PowerShell script is NEVER invoked in CI:
// running it with credentials would export potentially sensitive hosted data.
test('Windows owner wrapper requires explicit opt-in and has no default export', () => {
  assert.match(script, /#requires -Version 5\.1/)
  assert.match(script, /\[switch\]\$Execute/)
  assert.match(script, /Set-StrictMode -Version Latest/)
  assert.match(script, /if \(-not \$Execute\) \{/)
  assert.match(script, /NO_BACKUP_CREATED/)
  assert.match(script, /@common '--execute'/)
  assert.match(script, /CI','GITHUB_ACTIONS','VERCEL','VERCEL_ENV'/)
  assert.match(script, /OSVersion\.Platform/)
})

test('encryption, no-reparse-path, restricted Windows ACL and fixed local volume checks exist', () => {
  assert.match(script, /DriveType\]::Fixed/)
  assert.match(script, /Get-BitLockerVolume -MountPoint/)
  assert.match(script, /FullyEncrypted/)
  assert.match(script, /ProtectionStatus/)
  assert.match(script, /AreAccessRulesProtected/)
  // Root and passfile require noninherited ACLs; generated archive children may
  // inherit ONLY the already constrained parent grants.
  assert.match(script, /if \(-not \$AllowInheritedAcl -and -not \$acl\.AreAccessRulesProtected\)/)
  assert.match(script, /\$privateOutput = Assert-PrivateWindowsPath \$BackupDirectory \$true\b/)
  assert.match(script, /\$privatePassword = Assert-PrivateWindowsPath \$PasswordFile \$false\b/)
  assert.match(script, /\$package = Assert-PrivateWindowsPath \$newFolders\[0\]\.FullName \$true \$true/)
  assert.match(script, /postgresql-17\.backup'\) \$false \$true/)
  assert.match(script, /manifest\.json'\) \$false \$true/)
  assert.match(script, /REPARSE_ANCESTOR_NOT_ALLOWED/)
  assert.match(script, /\[System\.IO\.FileAttributes\]::ReparsePoint/)
  assert.match(script, /S-1-5-18/)
  assert.match(script, /S-1-5-32-544/)
  assert.match(script, /UNAPPROVED_NTFS_ACCESS_PRINCIPAL/)
  assert.match(script, /NETWORK_PATH_FORBIDDEN/)
})

test('exact MPG project and established backup+hash-manifest integrity tools are preserved', () => {
  assert.match(script, /mr5-hosted-backup\.mjs/)
  assert.match(script, /mr5-offline-backup-integrity\.mjs/)
  assert.ok((script.match(/awvqtwkzprygsoyfspuz/g)??[]).length===2)
  assert.match(script, /--confirm-project/)
  assert.match(script, /--backup-dir/)
  assert.match(script, /--verify/)
  assert.match(script, /EXPECTED_SINGLE_NEW_PRIVATE_BACKUP_PACKAGE/)
  assert.match(script, /MR5I22_OWNER_ENCRYPTED_VOLUME_BACKUP_INTEGRITY_PASS/)
  assert.match(script, /RESTORE_NOT_VERIFIED/)
  assert.match(backup, /--format=custom/)
  assert.match(backup, /parseMigrationInventory/)
  assert.match(integrity, /timingSafeEqual/)
  assert.match(integrity, /OFFLINE_INTEGRITY_MATCH_ONLY/)
})

test('no archive text or credentials can be exposed from the wrapper intentionally', () => {
  assert.doesNotMatch(script, /(?:Get-Content|Select-String|Format-Hex|Write-Host|Invoke-WebRequest|Invoke-RestMethod|curl|scp|aws\s+s3|gh\s+api|github\.com)/i)
  assert.doesNotMatch(script, /(?:Set-Content|Out-File|Add-Content)\s+-.*(?:manifest|archive|password)/i)
  assert.match(script, /MR5I22_BACKUP_STOP/)
  assert.match(script, /KEEP_ARCHIVE_AND_MANIFEST_PRIVATE/)
  assert.doesNotMatch(script, /(?:supabase\s+db\s+(?:push|reset)|\bmigration\s+up\b|pg_restore\s+--dbname|STRIPE_SECRET_KEY\s*=)/i)
})
