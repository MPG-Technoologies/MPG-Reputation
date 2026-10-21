import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  parseArgs, checkTarget, checkPrivatePaths, makeChildEnv, parseMigrationInventory,
} from '../../scripts/operator/mr5-hosted-backup.mjs'

const REF = 'awvqtwkzprygsoyfspuz'
const args = { '--project-ref': REF, '--confirm-project': REF, '--output-dir': '/private' }
const base = {
  PGHOST: 'aws-0-ap-south-1.pooler.supabase.com',
  PGPORT: '5432',
  PGUSER: 'postgres.' + REF,
  PGDATABASE: 'postgres',
  PGSSLMODE: 'require',
  PGPASSFILE: '/private/.pgpass',
}

test('explicit double project consent and no silent execution', () => {
  assert.deepEqual(parseArgs(['--project-ref', REF, '--confirm-project', REF]), {
    '--project-ref': REF, '--confirm-project': REF,
  })
  assert.throws(() => parseArgs(['--execute', '--execute']), /DUPLICATE_ARGUMENT/)
  assert.throws(() => parseArgs(['--project-ref']), /MISSING_ARGUMENT_VALUE/)
  assert.throws(() => parseArgs(['--unknown']), /UNKNOWN_ARGUMENT/)
  assert.equal(parseArgs(['--execute'])['--execute'], true)
  assert.equal(parseArgs([])['--execute'], undefined)
})

test('reject wrong or missing project and CI execution', () => {
  assert.deepEqual(checkTarget(args, base), {
    projectRef: REF, expectedCount: 26, expectedLast: '20261011120000',
  })
  assert.throws(() => checkTarget({ ...args, '--confirm-project': 'not-mpg' }, base),
    /PROJECT_CONFIRMATION_MISMATCH/)
  assert.throws(() => checkTarget(args, { ...base, CI: 'true' }),
    /CI_OR_DEPLOYMENT_CONTEXT_FORBIDDEN/)
  assert.throws(() => checkTarget(args, { ...base, GITHUB_ACTIONS: 'true' }),
    /CI_OR_DEPLOYMENT_CONTEXT_FORBIDDEN/)
})

test('accept only correct Supabase direct host or session pooler credentials', () => {
  assert.doesNotThrow(() => checkTarget(args, {
    ...base, PGHOST: 'db.' + REF + '.supabase.co', PGUSER: 'postgres', PGSSLMODE: 'verify-full',
  }))
  for (const bad of [
    { PGUSER: 'postgres.anotherproject' },
    { PGHOST: 'db.different.supabase.co' },
    { PGHOST: 'localhost' },
    { PGPORT: '54331' },
    { PGDATABASE: 'different' },
    { PGSSLMODE: 'disable' },
    { PGHOSTADDR: '127.0.0.1' },
    { PGSERVICE: 'another' },
    { PGOPTIONS: '-c search_path=public' },
    { PGPASSWORD: 'never-use-inline-secrets' },
    { DATABASE_URL: 'postgres://secrets' },
    { PGPASSFILE: '' },
    { PGPASSFILE: 'relative.file' },
  ]) assert.throws(() => checkTarget(args, { ...base, ...bad }))
})

test('never forward ambient provider credentials to PostgreSQL child processes', () => {
  const clean = makeChildEnv({
    ...base, STRIPE_SECRET_KEY: 'private-stripe-key',
    SUPABASE_ACCESS_TOKEN: 'private-supabase-token', RESEND_API_KEY: 'secret',
    PATH: '/usr/bin',
  })
  assert.equal(clean.PGHOST, base.PGHOST)
  assert.equal(clean.PGPASSFILE, base.PGPASSFILE)
  assert.equal(clean.STRIPE_SECRET_KEY, undefined)
  assert.equal(clean.SUPABASE_ACCESS_TOKEN, undefined)
  assert.equal(clean.RESEND_API_KEY, undefined)
  assert.equal(clean.DATABASE_URL, undefined)
})

test('abort on hosted migration ledger drift', () => {
  assert.deepEqual(parseMigrationInventory('26|20261011120000\n'), {
    count: 26, last: '20261011120000',
  })
  for (const result of ['25|20261011120000', '27|20261011120000',
    '26|20261018150000', '', '26|20261011120000\nextra',
  ]) assert.throws(() => parseMigrationInventory(result), /HOSTED_MIGRATION_HISTORY_DRIFT_STOP/)
})

test('backup and password files must be outside repository and private', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mr5-operator-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = path.join(root, 'repository')
  const outside = path.join(root, 'private-backups')
  mkdirSync(repo)
  mkdirSync(outside)
  const pass = path.join(outside, '.pgpass')
  writeFileSync(pass, 'synthetic-only-test', { mode: 0o600 })
  if (process.platform !== 'win32') chmodSync(pass, 0o600)
  assert.deepEqual(checkPrivatePaths(outside, pass, repo), {
    output: outside, pass,
  })
  const accidental = path.join(repo, 'wrong.pgpass')
  writeFileSync(accidental, 'test-only', { mode: 0o600 })
  assert.throws(() => checkPrivatePaths(outside, accidental, repo), /PRIVATE_FILES_MUST_NOT_BE_IN_REPOSITORY/)
  assert.throws(() => checkPrivatePaths(repo, pass, repo), /PRIVATE_FILES_MUST_NOT_BE_IN_REPOSITORY/)
  assert.throws(() => checkPrivatePaths('relative/path', pass, repo), /ABSOLUTE_OUTPUT_PATH_REQUIRED/)
  if (process.platform !== 'win32') {
    chmodSync(pass, 0o644)
    assert.throws(() => checkPrivatePaths(outside, pass, repo), /PGPASSFILE_PERMISSIONS_TOO_OPEN/)
  }
})
