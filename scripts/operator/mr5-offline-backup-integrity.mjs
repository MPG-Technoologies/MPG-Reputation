// MR-5I16: offline integrity check for an EXISTING owner-held backup package.
// No network, database connection, provider invocation, restore or file writes.
import { createHash, timingSafeEqual } from 'node:crypto'
import fs, { constants as fsConstants } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_REF = 'awvqtwkzprygsoyfspuz'
const MANIFEST = 'manifest.json'
const ARCHIVE = 'postgresql-17.backup'
const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!['--backup-dir', '--verify'].includes(arg)) throw new Error('UNKNOWN_ARGUMENT')
    if (Object.hasOwn(out, arg)) throw new Error('DUPLICATE_ARGUMENT')
    if (arg === '--verify') out[arg] = true
    else {
      const value = argv[++i]
      if (!value || value.startsWith('--')) throw new Error('MISSING_BACKUP_DIRECTORY')
      out[arg] = value
    }
  }
  if (!out['--verify'] || !out['--backup-dir']) throw new Error('EXPLICIT_VERIFY_AND_DIRECTORY_REQUIRED')
  return out
}

function outsideRepository(candidate, repo) {
  const relative = path.relative(repo, candidate)
  return relative !== '' && relative !== '..' &&
    !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

function isPrivateMode(info) {
  return process.platform === 'win32' || (info.mode & 0o077) === 0
}

export function checkBackupDirectory(dir, repositoryRoot = REPOSITORY) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('ABSOLUTE_BACKUP_DIR_REQUIRED')
  const info = fs.lstatSync(dir)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('BACKUP_DIR_NOT_PRIVATE_DIRECTORY')
  const backup = fs.realpathSync(dir)
  const repo = fs.realpathSync(repositoryRoot)
  if (backup === path.parse(backup).root || backup === repo || outsideRepository(backup, repo)) {
    throw new Error('BACKUP_INSIDE_REPOSITORY_OR_ROOT')
  }
  if (!isPrivateMode(info)) throw new Error('BACKUP_DIR_PERMISSIONS_TOO_OPEN')
  return backup
}

export function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MANIFEST')
  if (value.project_ref !== PROJECT_REF || value.postgres_major !== 17 ||
      value.baseline_migrations !== 26 || value.baseline_latest_version !== '20261011120000' ||
      value.archive_filename !== ARCHIVE ||
      value.restore_verified !== false ||
      value.status !== 'EXPORT_ONLY_NOT_YET_RESTORABLE_PROVEN' ||
      typeof value.archive_bytes !== 'number' || !Number.isSafeInteger(value.archive_bytes) ||
      value.archive_bytes <= 5 ||
      typeof value.archive_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.archive_sha256) ||
      typeof value.completed_at !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value.completed_at) ||
      !Number.isFinite(Date.parse(value.completed_at))) {
    throw new Error('BACKUP_MANIFEST_CONTRACT_MISMATCH')
  }
  return { archiveBytes: value.archive_bytes, archiveHash: value.archive_sha256 }
}

function regularPrivateFile(file) {
  const info = fs.lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink() || !isPrivateMode(info)) {
    throw new Error('BACKUP_PACKAGE_FILE_NOT_PRIVATE_REGULAR')
  }
  // No hard-link aliases of confidential backup bytes on POSIX.
  if (process.platform !== 'win32' && info.nlink !== 1) throw new Error('BACKUP_FILE_HARDLINK_FORBIDDEN')
  return info
}

export async function verifyBackupDirectory(dir, repositoryRoot = REPOSITORY) {
  const folder = checkBackupDirectory(dir, repositoryRoot)
  const manifestPath = path.join(folder, MANIFEST)
  const archivePath = path.join(folder, ARCHIVE)
  const manifestStat = regularPrivateFile(manifestPath)
  if (manifestStat.size > 16384 || manifestStat.size < 2) throw new Error('INVALID_MANIFEST_SIZE')
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) }
  catch { throw new Error('INVALID_MANIFEST_JSON') }
  const contract = validateManifest(manifest)
  const prior = regularPrivateFile(archivePath)
  if (prior.size !== contract.archiveBytes) throw new Error('BACKUP_ARCHIVE_SIZE_MISMATCH')

  // A held descriptor plus O_NOFOLLOW narrows symlink-swap exposure on supported OSes.
  const handle = await open(archivePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size !== contract.archiveBytes ||
        (process.platform !== 'win32' && before.nlink !== 1)) {
      throw new Error('BACKUP_ARCHIVE_CHANGED_DURING_OPEN')
    }
    const prefix = Buffer.alloc(5)
    const { bytesRead } = await handle.read(prefix, 0, 5, 0)
    if (bytesRead !== 5 || prefix.toString('ascii') !== 'PGDMP') {
      throw new Error('NOT_POSTGRES_CUSTOM_ARCHIVE')
    }
    const hash = createHash('sha256')
    let bytes = 0
    for await (const part of handle.createReadStream({ autoClose: false, start: 0 })) {
      bytes += part.length
      hash.update(part)
    }
    const after = await handle.stat()
    if (bytes !== contract.archiveBytes || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new Error('BACKUP_ARCHIVE_CHANGED_DURING_VERIFY')
    }
    const digest = Buffer.from(hash.digest('hex'), 'hex')
    const expected = Buffer.from(contract.archiveHash, 'hex')
    if (!timingSafeEqual(digest, expected)) throw new Error('BACKUP_ARCHIVE_SHA256_MISMATCH')
  } finally {
    await handle.close()
  }
  return { status: 'OFFLINE_INTEGRITY_MATCH_ONLY', restore_verified: false }
}

async function main() {
  if (process.env.CI || process.env.GITHUB_ACTIONS || process.env.VERCEL || process.env.VERCEL_ENV) {
    throw new Error('CI_OR_DEPLOYMENT_CONTEXT_FORBIDDEN')
  }
  const args = parseArgs(process.argv.slice(2))
  await verifyBackupDirectory(args['--backup-dir'])
  console.log('OFFLINE_INTEGRITY_MATCH_ONLY: local manifest, archive header, byte count and SHA-256 matched.')
  console.log('RESTORE_NOT_VERIFIED. No database connection, migration, restore or file change was made.')
  console.log('Do not upload the archive or private manifest to GitHub, CI or this chat.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // No paths, hashes, keys or raw archive details in error output.
    console.error('MR5_OFFLINE_INTEGRITY_STOP: verification failed; do not restore or migrate.')
    process.exitCode = 1
  })
}
