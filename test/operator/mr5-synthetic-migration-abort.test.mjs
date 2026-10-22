import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

// These source-level tripwires complement the real disposable-Postgres
// workflow. They are not a SQL parser and NEVER execute the SQL fixture.
const fixture = fs.readFileSync(
  new URL('../../scripts/acceptance/mr5-synthetic-injected-migration-abort.sql', import.meta.url), 'utf8')
const workflow = fs.readFileSync(
  new URL('../../.github/workflows/isolated-mr5-populated-upgrade.yml', import.meta.url), 'utf8')

test('the injection fixture raises exactly the expected exception without an application mutation', () => {
  const sql = fixture.split('\n').filter(line => !/^\s*--/.test(line)).join('\n').trim()
  assert.match(sql, /^DO \$mr5i20_abort\$/)
  assert.match(sql, /RAISE EXCEPTION 'MR5I20_SYNTHETIC_ABORT_EXPECTED' USING ERRCODE = 'P0001';/)
  assert.match(sql, /\$mr5i20_abort\$;$/)
  assert.equal((sql.match(/RAISE EXCEPTION/g) ?? []).length, 1)
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COMMIT|ROLLBACK|COPY)\b/i)
})

test('the negative test runs after synthetic restore and before normal upgrade', () => {
  const positions = [
    'Backup + restore synthetic public data on disposable localhost',
    'Inject first migration failure and prove transactional rollback (synthetic only)',
    'Upgrade populated local baseline with candidate migrations (NEVER --linked)',
    'Assert exact migration ledger and preserved synthetic tenant/trial data',
  ].map(name => workflow.indexOf('- name: ' + name))
  assert.ok(positions.every(p => p >= 0))
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
})

test('failed first candidate migration must reach its injected sentinel, never accept any failure', () => {
  const start = workflow.indexOf('- name: Inject first migration failure')
  const end = workflow.indexOf('- name: Upgrade populated local baseline')
  const step = workflow.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.match(step, /--single-transaction/)
  assert.match(step, /ON_ERROR_STOP=1/)
  assert.match(step, /20261018150000_mr5c2_atomic_subscription_projection\.sql/)
  assert.match(step, /-f candidate\/scripts\/acceptance\/mr5-synthetic-injected-migration-abort\.sql/)
  assert.match(step, /if psql[\s\S]*?then\s*\n\s*echo 'MR5I20_NEGATIVE_TEST_UNEXPECTEDLY_SUCCEEDED'; exit 1/)
  assert.match(step, /if ! grep -q 'MR5I20_SYNTHETIC_ABORT_EXPECTED' "\$failure_log"; then/)
  assert.match(step, /MR5I20_NEGATIVE_TEST_FAILED_BEFORE_SENTINEL/)
  assert.match(step, /trap 'rm -f "\$failure_log"' EXIT/)
})

test('synthetic failure proof enforces isolated CI, 26 migrations, no function and unchanged fixture data', () => {
  const step = workflow.slice(workflow.indexOf('- name: Inject first migration failure'),
    workflow.indexOf('- name: Upgrade populated local baseline'))
  for (const required of ['CI','GITHUB_ACTIONS','PGHOST','PGPORT','PGUSER','PGPASSWORD',
    'PGDATABASE','ENABLE_LIVE_BILLING','ENABLE_LIVE_EMAIL','EMAIL_PROVIDER']) {
    assert.match(step, new RegExp('test "' + '\\$\\{' + required + ':-' + '\\}' + '"'))
  }
  assert.match(step, /127\.0\.0\.1/)
  assert.match(step, /54332/)
  assert.match(step, /reconcile_stripe_subscription_projection/)
  assert.ok((step.match(/supabase_migrations\.schema_migrations/g) ?? []).length >= 2)
  assert.ok((step.match(/test "\$\(psql .*?" = 26/g) ?? []).length >= 2)
  assert.match(step, /before="\$\(psql[\s\S]*?mr5-local-baseline-fingerprint\.sql/)
  assert.match(step, /after="\$\(psql[\s\S]*?mr5-local-baseline-fingerprint\.sql/)
  assert.match(step, /test "\$before" = "\$after"/)
  assert.match(step, /MR5I20_FAILED_SQL_TRANSACTION_ROLLED_BACK_NO_PARTIAL_STATE/)
})
