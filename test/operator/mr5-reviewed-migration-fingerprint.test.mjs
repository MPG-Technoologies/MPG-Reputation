import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  gitBlobSha1, validateManifest, verifyMigrationSet,
} from '../../scripts/acceptance/mr5-verify-reviewed-migrations.mjs'

const ACCEPTED = [
  '20260917000001', '20260918235000', '20260919003000',
  '20260919010000', '20260919020000', '20260919030000',
  '20260919031000', '20260919040000', '20260919040100',
  '20260919050000', '20260919060000', '20260919170000',
  '20260919180000', '20260921174500', '20260921203000',
  '20260921212000', '20260922071808', '20261007000000',
  '20261008000000', '20261008010000', '20261009000000',
  '20261009120000', '20261009140000', '20261010000000',
  '20261010010000', '20261011120000',
]

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr5i17-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const folder = path.join(root, 'supabase', 'migrations')
  fs.mkdirSync(folder, { recursive: true })
  for (const version of ACCEPTED) fs.writeFileSync(
    path.join(folder, version + '_baseline_synthetic.sql'), '-- baseline fixture only\n')
  const items = []
  for (let i = 0; i < 22; i++) {
    const file = String(20261018150000 + i) + '_synthetic_candidate_' + i + '.sql'
    const bytes = Buffer.from('-- synthetic candidate ' + i + '\nSELECT ' + i + ';\n')
    fs.writeFileSync(path.join(folder, file), bytes)
    items.push({ file, git_blob_sha1: gitBlobSha1(bytes) })
  }
  const manifest = {
    schema_version: 1,
    status: 'REVIEWED_REPOSITORY_CANDIDATE_ONLY_NO_HOSTED_APPLY',
    parent_candidate_commit: '699c8a9ad8d6c356eeb0e29affa83feeeac2a227',
    accepted_hosted_migration_count: 26,
    accepted_hosted_latest_version: '20261011120000',
    proposed_count: 22,
    items,
  }
  return { root, folder, manifest }
}

test('Git blob SHA-1 follows Git source-object identity, not plain SHA-1', () => {
  assert.equal(gitBlobSha1(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a')
})

test('exact 26 accepted baseline versions and 22 reviewed blobs match synthetic fixture', t => {
  const data = fixture(t)
  assert.deepEqual(verifyMigrationSet(data.root, data.manifest), {
    status: 'REPOSITORY_SQL_FINGERPRINTS_MATCH_ONLY',
    baseline_count: 26,
    reviewed_pending_count: 22,
    first_pending_version: '20261018150000',
    last_pending_version: '20261018150021',
    hosted_compatibility_verified: false,
  })
})

test('modified SQL bytes fail exact reviewed fingerprint even with same filename', t => {
  const data = fixture(t)
  const file = path.join(data.folder, data.manifest.items[9].file)
  fs.appendFileSync(file, '\n-- changed after review\n')
  assert.throws(() => verifyMigrationSet(data.root, data.manifest),
    /REVIEWED_SQL_BLOB_CHANGED_AT_INDEX_10/)
})

test('missing, renamed, additional candidate and baseline versions fail closed', t => {
  const data = fixture(t)
  const candidate = path.join(data.folder, data.manifest.items[5].file)
  fs.renameSync(candidate, candidate + '.temporarily_removed')
  assert.throws(() => verifyMigrationSet(data.root, data.manifest), /REVIEWED_PENDING_MIGRATION_SET_CHANGED/)
  fs.renameSync(candidate + '.temporarily_removed', candidate)

  const extra = path.join(data.folder, '20261022123456_unapproved_new.sql')
  fs.writeFileSync(extra, '-- unreviewed fixture\n')
  assert.throws(() => verifyMigrationSet(data.root, data.manifest), /REVIEWED_PENDING_MIGRATION_SET_CHANGED/)
  fs.unlinkSync(extra)

  const baseline = path.join(data.folder, ACCEPTED[10] + '_baseline_synthetic.sql')
  fs.renameSync(baseline, path.join(data.folder, '20260919060001_baseline_synthetic.sql'))
  assert.throws(() => verifyMigrationSet(data.root, data.manifest), /ACCEPTED_BASELINE_VERSION_DRIFT/)
})

test('manifest rejects extra items, wrong parent and ordering or fingerprint changes', t => {
  const data = fixture(t)
  const wrongCommit = { ...data.manifest, parent_candidate_commit: 'different' }
  assert.throws(() => validateManifest(wrongCommit), /REVIEWED_MIGRATION_MANIFEST_INVALID/)
  assert.throws(() => validateManifest({ ...data.manifest, proposed_count: 23 }),
    /REVIEWED_MIGRATION_MANIFEST_INVALID/)
  const swapped = data.manifest.items.map(item => ({ ...item }))
  ;[swapped[0], swapped[1]] = [swapped[1], swapped[0]]
  assert.throws(() => validateManifest({ ...data.manifest, items: swapped }),
    /REVIEWED_MIGRATION_MANIFEST_ORDER_OR_HASH_INVALID/)
  const invalidHash = data.manifest.items.map(item => ({ ...item }))
  invalidHash[8].git_blob_sha1 = 'z'.repeat(40)
  assert.throws(() => validateManifest({ ...data.manifest, items: invalidHash }),
    /REVIEWED_MIGRATION_MANIFEST_ORDER_OR_HASH_INVALID/)
})

test('non-SQL and symlink files cannot masquerade as a reviewed migration', t => {
  const data = fixture(t)
  const wrongName = path.join(data.folder, 'fake.sql')
  fs.writeFileSync(wrongName, 'SELECT 1;')
  assert.throws(() => verifyMigrationSet(data.root, data.manifest), /MIGRATION_FILE_TYPE_OR_NAME_DRIFT/)
  fs.unlinkSync(wrongName)
  if (process.platform !== 'win32') {
    const alias = path.join(data.folder, '20261022110000_symlink.sql')
    fs.symlinkSync(path.join(data.folder, data.manifest.items[0].file), alias)
    assert.throws(() => verifyMigrationSet(data.root, data.manifest), /MIGRATION_FILE_TYPE_OR_NAME_DRIFT/)
  }
})
