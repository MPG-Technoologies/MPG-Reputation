// MR-5I19 — fail-closed preflight for disposable, synthetic 26 -> 48 rehearsal only.
// No DB connections, backup reads, restore, SQL execution, provider calls or writes.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gitBlobSha1, verifyMigrationSet } from './mr5-verify-reviewed-migrations.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
const REPO = path.resolve(path.dirname(SCRIPT), '../..')
const EXPECTED_BASELINE_SHA = '2eac67089a2e9d9c0e95ed636d3dc8b040fe4823'
const BASELINE_LAST = '20261011120000'
const FORBIDDEN_ENV = Object.freeze([
  'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL', 'DATABASE_URL', 'DIRECT_URL', 'PGHOSTADDR', 'PGSERVICE',
  'PGSERVICEFILE', 'PGOPTIONS', 'PGPASSFILE', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY', 'TWILIO_AUTH_TOKEN',
  'VERCEL_ENV', 'VERCEL', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
])

export function assertIsolatedSyntheticEnv(env) {
  const required = {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    PGHOST: '127.0.0.1',
    PGPORT: '54332',
    PGUSER: 'postgres',
    PGPASSWORD: 'postgres', // Fixed, disposable Docker fixture ONLY.
    PGDATABASE: 'postgres',
    EMAIL_PROVIDER: 'console',
    ENABLE_LIVE_EMAIL: 'false',
    ENABLE_LIVE_BILLING: 'false',
    ENABLE_RETENTION_MAINTENANCE: 'false',
  }
  for (const [key, expected] of Object.entries(required)) {
    if (env[key] !== expected) throw new Error('SYNTHETIC_LOCAL_ENVIRONMENT_REQUIRED_' + key)
  }
  for (const key of FORBIDDEN_ENV) {
    if (env[key]) throw new Error('HOSTED_OR_PROVIDER_CREDENTIAL_CONTEXT_FORBIDDEN_' + key)
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL &&
      env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54331') {
    throw new Error('REMOTE_PUBLIC_SUPABASE_URL_FORBIDDEN')
  }
  return { isolated: true, providers: 'DISABLED', kind: 'DISPOSABLE_SYNTHETIC_ONLY' }
}

function sqlFilenames(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  if (entries.some(e => e.name.endsWith('.sql') && (!e.isFile() || !/^\d{14}_[a-z0-9_]+\.sql$/.test(e.name)))) {
    throw new Error('SQL_FILE_TYPE_OR_FILENAME_DRIFT')
  }
  return entries.filter(e => e.isFile() && e.name.endsWith('.sql')).map(e => e.name).sort()
}

export function verifyIsolatedSources(candidateRoot, baselineRoot, manifest) {
  const candidate = fs.realpathSync(candidateRoot)
  const baseline = fs.realpathSync(baselineRoot)
  if (candidate === baseline) throw new Error('BASELINE_AND_CANDIDATE_MUST_BE_SEPARATE')
  const configName = path.join('supabase','config.toml')
  for (const repo of [candidate, baseline]) {
    const config = fs.readFileSync(path.join(repo, configName), 'utf8')
    if (!/^project_id = "MPG-Reputation"$/m.test(config)) {
      throw new Error('UNEXPECTED_LOCAL_SUPABASE_PROJECT')
    }
  }
  // Preserve the frozen 22-MR5 reviewed SQL blobs unchanged. This one
  // additive MR-5I26A SQL file is separately byte-pinned and repository-only.
  const reviewed = verifyMigrationSet(candidate, manifest, {
    appendedReviewedMigration: {
      file: '20261022230000_mr5i26a_trial_extension_requests.sql',
      git_blob_sha1: '8188f2d48d15d8634d104dd301e058f3882b2ee6',
    },
  })
  const baselineFiles = sqlFilenames(path.join(baseline, 'supabase', 'migrations'))
  const candidateFiles = sqlFilenames(path.join(candidate, 'supabase', 'migrations'))
  if (baselineFiles.length !== 26 || candidateFiles.length !== 49 ||
      baselineFiles.some((name, i) => name !== candidateFiles[i] || name.slice(0, 14) > BASELINE_LAST)) {
    throw new Error('ACCEPTED_BASELINE_NOT_EXACT_PREFIX')
  }
  for (const filename of baselineFiles) {
    const rel = path.join('supabase', 'migrations', filename)
    if (gitBlobSha1(fs.readFileSync(path.join(baseline,rel))) !==
        gitBlobSha1(fs.readFileSync(path.join(candidate,rel)))) {
      throw new Error('ACCEPTED_BASELINE_SQL_BYTES_CHANGED')
    }
  }
  return {
    mode: 'SYNTHETIC_REHEARSAL_SOURCE_GUARD_PASS',
    baseline_versions: 26,
    pending_versions: reviewed.reviewed_pending_count,
    hosted_restore_verified: false,
    hosted_migrations_authorized: false,
  }
}

export function assertFrozenBaselineCheckout(baselineRoot) {
  const p = spawnSync('git', ['-C', baselineRoot, 'rev-parse', 'HEAD'], {
    stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', shell: false,
    timeout: 10000, maxBuffer: 4096,
  })
  if (p.error || p.status !== 0 || p.stdout.trim() !== EXPECTED_BASELINE_SHA) {
    throw new Error('FROZEN_MAIN_BASELINE_CHECKOUT_MISMATCH')
  }
  return EXPECTED_BASELINE_SHA
}

function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--verify-synthetic-ci') {
    throw new Error('NO_EXECUTION_MODE_ONLY_EXPLICIT_SYNTHETIC_CI_PREFLIGHT')
  }
  assertIsolatedSyntheticEnv(process.env)
  const baselineRoot = path.resolve(REPO,'../baseline')
  assertFrozenBaselineCheckout(baselineRoot)
  const manifest = JSON.parse(fs.readFileSync(
    path.join(REPO,'scripts','acceptance','mr5-reviewed-candidate-manifest.json'), 'utf8'))
  verifyIsolatedSources(REPO, baselineRoot, manifest)
  console.log('MR5I19_SYNTHETIC_SOURCE_AND_LOOPBACK_PREFLIGHT_PASS')
  console.log('NO_REAL_RESTORE_VERIFIED. NO_HOSTED_MIGRATION_AUTHORIZED.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  try { main() }
  catch {
    console.error('MR5I19_PREFLIGHT_STOP: synthetic-only isolation or source integrity not verified.')
    process.exitCode = 1
  }
}
