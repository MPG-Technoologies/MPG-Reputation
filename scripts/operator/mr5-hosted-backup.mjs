// MR-5I13 — local owner-operated backup of the hosted ENGINEERING/TEST Postgres.
// This file is never invoked by CI; it never runs migrations or restores data.
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_REF = 'awvqtwkzprygsoyfspuz'
const BASELINE_COUNT = 26
const BASELINE_LAST = '20261011120000'
const BASELINE_VERSIONS = Object.freeze([
  '20260917000001',
  '20260918235000',
  '20260919003000',
  '20260919010000',
  '20260919020000',
  '20260919030000',
  '20260919031000',
  '20260919040000',
  '20260919040100',
  '20260919050000',
  '20260919060000',
  '20260919170000',
  '20260919180000',
  '20260921174500',
  '20260921203000',
  '20260921212000',
  '20260922071808',
  '20261007000000',
  '20261008000000',
  '20261008010000',
  '20261009000000',
  '20261009120000',
  '20261009140000',
  '20261010000000',
  '20261010010000',
  '20261011120000',
])
// Inspect every historical migration ID: count and MAX(version) alone can miss a substituted row.
const SQL = 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version'
const SCRIPT = fileURLToPath(import.meta.url)
const REPOSITORY = path.resolve(path.dirname(SCRIPT), '../..')

export function parseArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!['--project-ref', '--confirm-project', '--output-dir', '--execute'].includes(key)) {
      throw new Error('UNKNOWN_ARGUMENT')
    }
    if (Object.hasOwn(result, key)) throw new Error('DUPLICATE_ARGUMENT')
    if (key === '--execute') {
      result[key] = true
    } else {
      const value = argv[++i]
      if (!value || value.startsWith('--')) throw new Error('MISSING_ARGUMENT_VALUE')
      result[key] = value
    }
  }
  return result
}

export function checkTarget(args, env) {
  if (env.CI || env.GITHUB_ACTIONS || env.VERCEL || env.VERCEL_ENV) throw new Error('CI_OR_DEPLOYMENT_CONTEXT_FORBIDDEN')
  if (args['--project-ref'] !== PROJECT_REF || args['--confirm-project'] !== PROJECT_REF) {
    throw new Error('PROJECT_CONFIRMATION_MISMATCH')
  }
  if (env.PGPASSWORD || env.DATABASE_URL || env.SUPABASE_DB_URL ||
      env.PGSERVICE || env.PGHOSTADDR || env.PGOPTIONS) {
    throw new Error('PASSWORD_URL_OR_UNVERIFIED_CONNECTION_OVERRIDE')
  }
  const host = env.PGHOST ?? ''
  const user = env.PGUSER ?? ''
  const direct = host === 'db.' + PROJECT_REF + '.supabase.co' && user === 'postgres'
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) &&
    user === 'postgres.' + PROJECT_REF
  if (!direct && !pooler) throw new Error('HOST_OR_POSTGRES_USER_WRONG_PROJECT')
  if (env.PGPORT !== '5432' || env.PGDATABASE !== 'postgres') {
    throw new Error('HOSTED_PORT_OR_DATABASE_NOT_VERIFIED')
  }
  if (!['require', 'verify-full'].includes(env.PGSSLMODE)) {
    throw new Error('TLS_REQUIRED')
  }
  if (!env.PGPASSFILE || !path.isAbsolute(env.PGPASSFILE)) {
    throw new Error('PRIVATE_PGPASSFILE_REQUIRED')
  }
  return { projectRef: PROJECT_REF, expectedCount: BASELINE_COUNT, expectedLast: BASELINE_LAST }
}

export function checkPrivatePaths(outputDir, passwordFile, repositoryRoot = REPOSITORY) {
  if (!outputDir || !path.isAbsolute(outputDir)) throw new Error('ABSOLUTE_OUTPUT_PATH_REQUIRED')
  const repo = fs.realpathSync(repositoryRoot)
  const out = fs.realpathSync(outputDir)
  const pass = fs.realpathSync(passwordFile)
  const outside = other => {
    const relative = path.relative(repo, other)
    return relative !== '' && relative !== '..' &&
      !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
  }
  if (out === repo || outside(out) || pass === repo || outside(pass)) {
    throw new Error('PRIVATE_FILES_MUST_NOT_BE_IN_REPOSITORY')
  }
  if (out === path.parse(out).root) throw new Error('OUTPUT_DIRECTORY_CANNOT_BE_DISK_ROOT')
  if (!fs.statSync(out).isDirectory() || !fs.statSync(pass).isFile()) {
    throw new Error('OUTPUT_DIRECTORY_OR_PGPASSFILE_INVALID')
  }
  if (process.platform !== 'win32' && (fs.statSync(pass).mode & 0o077)) {
    throw new Error('PGPASSFILE_PERMISSIONS_TOO_OPEN')
  }
  return { output: out, pass }
}

export function makeChildEnv(env) {
  // Explicit allowlist: no Stripe keys, Supabase tokens, arbitrary DB URLs,
  // GitHub deployment secrets or user PGOPTIONS cross this subprocess boundary.
  const clean = {
    PGHOST: env.PGHOST, PGPORT: env.PGPORT, PGUSER: env.PGUSER,
    PGDATABASE: env.PGDATABASE, PGSSLMODE: env.PGSSLMODE,
    PGPASSFILE: env.PGPASSFILE, PGCONNECT_TIMEOUT: '10',
  }
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'HOME', 'USERPROFILE']) {
    if (env[key]) clean[key] = env[key]
  }
  if (env.PGSSLROOTCERT) clean.PGSSLROOTCERT = env.PGSSLROOTCERT
  return clean
}

export function parseMigrationInventory(value) {
  const actual = value.trim().split(/\r?\n/)
  if (actual.length !== BASELINE_COUNT ||
      actual.some((version, index) => version !== BASELINE_VERSIONS[index])) {
    throw new Error('HOSTED_MIGRATION_HISTORY_DRIFT_STOP')
  }
  return { count: BASELINE_COUNT, last: BASELINE_LAST }
}

function runTool(tool, args, env, options = {}) {
  const p = spawnSync(tool, args, {
    env, shell: false, timeout: 180000, maxBuffer: 256 * 1024,
    stdio: ['ignore', options.captureStdout ? 'pipe' : 'ignore', 'pipe'],
  })
  if (p.error || p.status !== 0) {
    // Never surface database tool stderr; it can contain host/user details.
    throw new Error('DATABASE_TOOL_FAILED_' + tool.replace(/[^a-z]/ig, '').toUpperCase())
  }
  return options.captureStdout ? p.stdout.toString('utf8') : ''
}

async function sha256(file) {
  const { createReadStream } = await import('node:fs')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const intent = checkTarget(args, process.env)
  const safe = checkPrivatePaths(args['--output-dir'], process.env.PGPASSFILE)
  if (!args['--execute']) {
    console.log('SAFE PREFLIGHT ONLY: exact MPG project and private output paths validated.')
    console.log('No network connection, backup, migration or database change was made.')
    return
  }
  const env = makeChildEnv(process.env)
  // Fail before copying any raw data if the workstation lacks PostgreSQL 17 tools.
  const dumpVersion = runTool('pg_dump', ['--version'], env, { captureStdout: true })
  const restoreVersion = runTool('pg_restore', ['--version'], env, { captureStdout: true })
  if (!/PostgreSQL\)\s+17\./.test(dumpVersion) || !/PostgreSQL\)\s+17\./.test(restoreVersion)) {
    throw new Error('POSTGRES_17_CLIENT_TOOLS_REQUIRED')
  }
  const inspect = () => parseMigrationInventory(runTool(
    'psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', SQL], env, { captureStdout: true },
  ))
  inspect() // Read-only migration ledger check on the intended hosted project.
  const now = new Date().toISOString().replace(/[:.]/g, '-')
  const folder = path.join(safe.output, 'mpg-reputation-' + now + '-' + randomBytes(4).toString('hex'))
  fs.mkdirSync(folder, { mode: 0o700 })
  const archive = path.join(folder, 'postgresql-17.backup')
  try {
    // Custom format captures DB schema and data including auth and migration
    // ledger (where allowed), but not global role definitions or Storage objects.
    runTool('pg_dump', ['--format=custom', '--no-subscriptions', '--file', archive], env)
    const st = fs.statSync(archive)
    if (!st.isFile() || !st.size) throw new Error('BACKUP_EMPTY')
    runTool('pg_restore', ['--list', archive], env)
    inspect() // Detect migration-ledger movement during the export.
    const digest = await sha256(archive)
    const manifest = {
      project_ref: intent.projectRef,
      postgres_major: 17,
      baseline_migrations: intent.expectedCount,
      baseline_latest_version: intent.expectedLast,
      archive_filename: path.basename(archive),
      archive_bytes: st.size,
      archive_sha256: digest,
      completed_at: new Date().toISOString(),
      restore_verified: false,
      status: 'EXPORT_ONLY_NOT_YET_RESTORABLE_PROVEN',
      note: 'Contains sensitive database records. No role globals, Storage API object bytes or project settings.',
    }
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    console.log('PRIVATE_BACKUP_CREATED: project match and migration ledger verified.')
    console.log('Restore verification is STILL REQUIRED in a separate, authorized isolated environment.')
    console.log('No backup contents, passwords, hashes or private local paths are printed.')
  } catch {
    fs.rmSync(folder, { recursive: true, force: true })
    throw new Error('BACKUP_FAILED_REMOVED_INCOMPLETE_FILES')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  main().catch(error => {
    console.error('MR5_BACKUP_STOP: ' + error.message)
    process.exitCode = 1
  })
}
