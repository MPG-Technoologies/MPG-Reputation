import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  parseArgs, checkBackupDirectory, validateManifest, verifyBackupDirectory,
} from '../../scripts/operator/mr5-offline-backup-integrity.mjs'

const PROJECT = 'awvqtwkzprygsoyfspuz'
const ARCHIVE = 'postgresql-17.backup'

function packageFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mpg-i16-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const repo = path.join(root, 'repo')
  const backup = path.join(root, 'private-backup')
  fs.mkdirSync(repo, { mode: 0o700 })
  fs.mkdirSync(backup, { mode: 0o700 })
  const bytes = Buffer.from('PGDMP' + 'SYNTHETIC-FIXTURE-ONLY-NOT-A-RESTORABLE-BACKUP')
  const archive = path.join(backup, ARCHIVE)
  fs.writeFileSync(archive, bytes, { mode: 0o600 })
  const manifest = {
    project_ref: PROJECT,
    postgres_major: 17,
    baseline_migrations: 26,
    baseline_latest_version: '20261011120000',
    archive_filename: ARCHIVE,
    archive_bytes: bytes.length,
    archive_sha256: createHash('sha256').update(bytes).digest('hex'),
    completed_at: '2026-10-22T07:00:00.000Z',
    restore_verified: false,
    status: 'EXPORT_ONLY_NOT_YET_RESTORABLE_PROVEN',
  }
  const manifestPath = path.join(backup, 'manifest.json')
  const save = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 })
  save()
  return { root, repo, backup, archive, manifestPath, manifest, bytes, save }
}

test('requires explicit local backup path and verification intent', () => {
  assert.deepEqual(parseArgs(['--backup-dir', '/private/archive', '--verify']), {
    '--backup-dir': '/private/archive', '--verify': true,
  })
  for (const args of [[], ['--verify'], ['--backup-dir', '/a'], ['--bad'],
    ['--verify', '--verify', '--backup-dir', '/a'], ['--backup-dir'],
    ['--backup-dir', '--verify']]) assert.throws(() => parseArgs(args))
})

test('valid synthetic package checks integrity only and never asserts recovery', async t => {
  const p = packageFixture(t)
  assert.equal(checkBackupDirectory(p.backup, p.repo), fs.realpathSync(p.backup))
  assert.deepEqual(await verifyBackupDirectory(p.backup, p.repo), {
    status: 'OFFLINE_INTEGRITY_MATCH_ONLY', restore_verified: false,
  })
})

test('fails closed for wrong project, unsafe basename, altered contract and fake restore claim', t => {
  const p = packageFixture(t)
  for (const change of [
    { project_ref: 'other' }, { archive_filename: '../backup.sql' },
    { archive_filename: 'manifest.json' }, { restore_verified: true },
    { baseline_migrations: 25 }, { baseline_latest_version: '20261018150000' },
    { status: 'COMPLETE' }, { postgres_major: 16 },
    { archive_bytes: -1 }, { archive_sha256: 'X'.repeat(64) },
  ]) assert.throws(() => validateManifest({ ...p.manifest, ...change }),
    /BACKUP_MANIFEST_CONTRACT_MISMATCH/)
})

test('fails for tampered bytes, sizes, non-custom archive and corrupt manifest', async t => {
  const p = packageFixture(t)
  fs.writeFileSync(p.archive, Buffer.from('PGDMP' + 'ALTERED-FIXTURE-CONTENT-ONLY'))
  await assert.rejects(verifyBackupDirectory(p.backup, p.repo), /BACKUP_ARCHIVE_SIZE_MISMATCH/)
  p.manifest.archive_bytes = fs.statSync(p.archive).size
  p.save()
  await assert.rejects(verifyBackupDirectory(p.backup, p.repo), /BACKUP_ARCHIVE_SHA256_MISMATCH/)
  const invalidMagic = Buffer.from('xxxxx' + 'ALTERED-FIXTURE-CONTENT-ONLY')
  fs.writeFileSync(p.archive, invalidMagic)
  p.manifest.archive_bytes = invalidMagic.length
  p.manifest.archive_sha256 = createHash('sha256').update(invalidMagic).digest('hex')
  p.save()
  await assert.rejects(verifyBackupDirectory(p.backup, p.repo), /NOT_POSTGRES_CUSTOM_ARCHIVE/)
  fs.writeFileSync(p.manifestPath, '{broken-json')
  await assert.rejects(verifyBackupDirectory(p.backup, p.repo), /INVALID_MANIFEST_JSON/)
})

test('rejects missing/symlink paths, repo nesting, and world-readable POSIX files', async t => {
  const p = packageFixture(t)
  assert.throws(() => checkBackupDirectory(p.repo, p.repo), /BACKUP_INSIDE_REPOSITORY_OR_ROOT/)
  assert.throws(() => checkBackupDirectory('relative/backup', p.repo), /ABSOLUTE_BACKUP_DIR_REQUIRED/)
  const nested = path.join(p.repo, 'nested')
  fs.mkdirSync(nested)
  assert.throws(() => checkBackupDirectory(nested, p.repo), /BACKUP_INSIDE_REPOSITORY_OR_ROOT/)
  const alias = path.join(p.root, 'linked-backup')
  if (process.platform !== 'win32') {
    fs.symlinkSync(p.backup, alias, 'dir')
    assert.throws(() => checkBackupDirectory(alias, p.repo), /BACKUP_DIR_NOT_PRIVATE_DIRECTORY/)
    fs.chmodSync(p.archive, 0o644)
    await assert.rejects(verifyBackupDirectory(p.backup, p.repo), /BACKUP_PACKAGE_FILE_NOT_PRIVATE_REGULAR/)
  }
})

test('rejects archive and manifest symlink aliases', async t => {
  if (process.platform === 'win32') return
  const p = packageFixture(t)
  const aliasArchive = path.join(p.backup, 'alias.archive')
  fs.renameSync(p.archive, aliasArchive)
  fs.symlinkSync(aliasArchive, p.archive)
  await assert.rejects(verifyBackupDirectory(p.backup, p.repo), /BACKUP_PACKAGE_FILE_NOT_PRIVATE_REGULAR/)
  fs.unlinkSync(p.archive)
  fs.renameSync(aliasArchive, p.archive)
  const aliasManifest = path.join(p.backup, 'manifest-original.json')
  fs.renameSync(p.manifestPath, aliasManifest)
  fs.symlinkSync(aliasManifest, p.manifestPath)
  await assert.rejects(verifyBackupDirectory(p.backup, p.repo), /BACKUP_PACKAGE_FILE_NOT_PRIVATE_REGULAR/)
})
