import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

const script = fs.readFileSync(new URL(
  '../../scripts/acceptance/mr5-synthetic-partial-forward-recovery.sh', import.meta.url), 'utf8')
const workflow = fs.readFileSync(new URL(
  '../../.github/workflows/isolated-mr5-populated-upgrade.yml', import.meta.url), 'utf8')

test('failure scenario runs after data restore and MR5I20 rollback, before forward-resume', () => {
  const labels = [
    'Backup + restore synthetic public data on disposable localhost',
    'Inject first migration failure and prove transactional rollback (synthetic only)',
    'MR5I21 prove partial-commit failure and stable 28-step ledger',
    'Upgrade populated local baseline with candidate migrations (NEVER --linked)',
    'Assert exact migration ledger and preserved synthetic tenant/trial data',
  ]
  const p = labels.map(x => workflow.indexOf('- name: ' + x))
  assert.ok(p.every(x => x >= 0))
  assert.deepEqual(p, [...p].sort((a,b) => a-b))
})

test('partial rehearsal is bound to local GitHub CI and provider-disabled environment', () => {
  assert.match(script, /^#!\/usr\/bin\/env bash/)
  assert.match(script, /set -euo pipefail/)
  for (const word of ['CI','GITHUB_ACTIONS','PGHOST','PGPORT','PGUSER',
    'PGPASSWORD','PGDATABASE','EMAIL_PROVIDER','ENABLE_LIVE_EMAIL',
    'ENABLE_LIVE_BILLING','ENABLE_RETENTION_MAINTENANCE']) {
    assert.ok(script.includes('test "${' + word + ':-}"'), word)
  }
  assert.match(script, /127\.0\.0\.1/)
  assert.match(script, /54332/)
  for (const word of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_URL','SUPABASE_SERVICE_ROLE_KEY',
    'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','RESEND_API_KEY','DATABASE_URL',
    'TWILIO_AUTH_TOKEN','PGHOSTADDR','VERCEL_ENV']) assert.ok(script.includes(word), word)
  assert.match(script, /mr5-isolated-rehearsal-preflight\.mjs --verify-synthetic-ci/)
})

test('the two staged candidate migrations are exact reviewed bytes and only in private temporary directory', () => {
  assert.match(script, /20261018150000_mr5c2_atomic_subscription_projection\.sql/)
  assert.match(script, /20261018163500_mr5c3a_webhook_processing_leases\.sql/)
  assert.match(script, /20261018180500_mr5c3b2_fenced_subscription_reconciliation\.sql/)
  assert.match(script, /sed -n '27p'/)
  assert.match(script, /sed -n '28p'/)
  assert.match(script, /sed -n '29p'/)
  assert.match(script, /mktemp -d "\$RUNNER_TEMP\/mr5i21-partial-XXXXXX"/)
  assert.match(script, /trap 'rm -rf -- "\$stage"' EXIT/)
  assert.match(script, /head -n 28 "\$files" \| while IFS= read -r filename/)
  assert.match(script, /cmp -- "candidate\/supabase\/migrations\/\$filename" "\$stage\/supabase\/migrations\/\$filename"/)
  assert.match(script, /\(cd "\$stage" && pnpm dlx supabase@2\.117\.0 migration up --local\)/)
  assert.doesNotMatch(script, /migration up --linked|db push|db reset|apply_migration|pg_restore|supabase link/i)
})

test('third migration must reach expected abort and preserve earlier committed schema', () => {
  assert.match(script, /--single-transaction/)
  assert.match(script, /ON_ERROR_STOP=1/)
  assert.match(script, /-f "candidate\/supabase\/migrations\/\$third"/)
  assert.match(script, /-f candidate\/scripts\/acceptance\/mr5-synthetic-injected-migration-abort\.sql/)
  assert.match(script, /MR5I21_UNEXPECTED_THIRD_MIGRATION_SUCCESS/)
  assert.match(script, /grep -q 'MR5I20_SYNTHETIC_ABORT_EXPECTED'/)
  assert.match(script, /MR5I21_THIRD_FAILED_BEFORE_EXPECTED_SENTINEL/)
  assert.ok((script.match(/diff -u <\(head -n 28 "\$files"/g) ?? []).length === 2)
  assert.match(script, /reconcile_stripe_subscription_projection/)
  assert.match(script, /lease_stripe_webhook_processing/)
  assert.ok((script.match(/to_regclass\('public\.stripe_subscription_reconciliation_leases'\) IS NULL/g) ?? []).length === 2)
  assert.match(script, /test "\$before" = "\$after"/)
  assert.match(script, /MR5I21_TWO_COMMITTED_THIRD_ABORTED_PARTIAL_STATE_VERIFIED/)
})

test('forward recovery verifies exact final history, data, RLS, and third migration table', () => {
  const end=workflow.slice(workflow.indexOf('- name: Upgrade populated local baseline'))
  assert.match(end, /migration up --local/)
  assert.match(end, /mr5-upgraded-expected\.txt/)
  assert.match(end, /mr5-upgraded-applied\.txt/)
  assert.match(end, /mr5-upgrade-postcheck\.sql/)
  assert.match(end, /to_regclass\('public\.stripe_subscription_reconciliation_leases'\) IS NOT NULL/)
  assert.match(end, /MR5I21_PARTIAL_MIGRATION_FORWARD_RECOVERY_28_TO_48_VERIFIED/)
})
