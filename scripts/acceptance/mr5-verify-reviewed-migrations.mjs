// MR-5I17: repository-only validation of the 22 reviewed SQL migration blobs.
// This command NEVER opens a database, modifies files, contacts Supabase, or applies migrations.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMigrationInventory } from '../operator/mr5-hosted-backup.mjs'

const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MANIFEST_FILE = path.join(REPOSITORY, 'scripts/acceptance/mr5-reviewed-candidate-manifest.json')
const VERSION_PATTERN = /^(\d{14})_[a-z0-9_]+\.sql$/
const BASELINE_LAST = '20261011120000'

// Git object identity for source-change review, not proof of hosted SQL or archive authenticity.
export function gitBlobSha1(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  return createHash('sha1').update(Buffer.from('blob ' + data.length + '\0')).update(data).digest('hex')
}

export function validateManifest(manifest) {
  if (!manifest || manifest.schema_version !== 1 ||
      manifest.status !== 'REVIEWED_REPOSITORY_CANDIDATE_ONLY_NO_HOSTED_APPLY' ||
      manifest.parent_candidate_commit !== '699c8a9ad8d6c356eeb0e29affa83feeeac2a227' ||
      manifest.accepted_hosted_migration_count !== 26 ||
      manifest.accepted_hosted_latest_version !== BASELINE_LAST ||
      manifest.proposed_count !== 22 ||
      !Array.isArray(manifest.items) || manifest.items.length !== 22) {
    throw new Error('REVIEWED_MIGRATION_MANIFEST_INVALID')
  }
  let prior = BASELINE_LAST
  const unique = new Set()
  for (const item of manifest.items) {
    const version = typeof item?.file === 'string' ? item.file.match(VERSION_PATTERN)?.[1] : null
    if (!version || version <= prior || unique.has(item.file) ||
        typeof item.git_blob_sha1 !== 'string' ||
        !/^[a-f0-9]{40}$/.test(item.git_blob_sha1)) {
      throw new Error('REVIEWED_MIGRATION_MANIFEST_ORDER_OR_HASH_INVALID')
    }
    prior = version
    unique.add(item.file)
  }
  return manifest.items
}

export function verifyMigrationSet(repositoryRoot, manifest) {
  const expected = validateManifest(manifest)
  const folder = path.join(repositoryRoot, 'supabase', 'migrations')
  const entries = fs.readdirSync(folder, { withFileTypes: true })
  const sqlEntries = entries.filter(entry => entry.name.endsWith('.sql'))
  if (sqlEntries.some(entry => !entry.isFile() || !VERSION_PATTERN.test(entry.name))) {
    throw new Error('MIGRATION_FILE_TYPE_OR_NAME_DRIFT')
  }
  const files = sqlEntries.map(entry => entry.name).sort()
  const baseline = files.filter(file => file.slice(0, 14) <= BASELINE_LAST)
  const pending = files.filter(file => file.slice(0, 14) > BASELINE_LAST)
  try {
    parseMigrationInventory(baseline.map(file => file.slice(0, 14)).join('\n'))
  } catch {
    throw new Error('ACCEPTED_BASELINE_VERSION_DRIFT')
  }
  if (files.length !== 48 || pending.length !== expected.length ||
      pending.some((file, i) => file !== expected[i].file)) {
    throw new Error('REVIEWED_PENDING_MIGRATION_SET_CHANGED')
  }
  for (const [index, file] of pending.entries()) {
    const bytes = fs.readFileSync(path.join(folder, file))
    if (gitBlobSha1(bytes) !== expected[index].git_blob_sha1) {
      throw new Error('REVIEWED_SQL_BLOB_CHANGED_AT_INDEX_' + (index + 1))
    }
  }
  return { status: 'REPOSITORY_SQL_FINGERPRINTS_MATCH_ONLY',
    baseline_count: 26, reviewed_pending_count: expected.length,
    first_pending_version: pending[0].slice(0, 14),
    last_pending_version: pending.at(-1).slice(0, 14),
    hosted_compatibility_verified: false }
}

function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--verify') {
    throw new Error('EXPLICIT_REPOSITORY_VERIFY_ONLY')
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
  const result = verifyMigrationSet(REPOSITORY, manifest)
  console.log('REPOSITORY_SQL_FINGERPRINTS_MATCH_ONLY: ' +
    result.baseline_count + ' accepted version IDs and ' +
    result.reviewed_pending_count + ' reviewed SQL blobs.')
  console.log('HOSTED_COMPATIBILITY_NOT_VERIFIED. No database was accessed or changed.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() }
  catch {
    console.error('MR5_MIGRATION_FINGERPRINT_STOP: review exact SQL and migration versions before rehearsal.')
    process.exitCode = 1
  }
}
