#!/usr/bin/env bash
# MR-5I21: intentionally commit 2 held migrations on disposable localhost, then
# abort the 3rd in a transaction. The calling workflow resumes the remaining
# 20 afterward. This script never performs a hosted database operation.
set -euo pipefail

test "${CI:-}" = 'true'
test "${GITHUB_ACTIONS:-}" = 'true'
test "${PGHOST:-}" = '127.0.0.1'
test "${PGPORT:-}" = '54332'
test "${PGUSER:-}" = 'postgres'
test "${PGPASSWORD:-}" = 'postgres'
test "${PGDATABASE:-}" = 'postgres'
test "${EMAIL_PROVIDER:-}" = 'console'
test "${ENABLE_LIVE_EMAIL:-}" = 'false'
test "${ENABLE_LIVE_BILLING:-}" = 'false'
test "${ENABLE_RETENTION_MAINTENANCE:-}" = 'false'
test -n "${RUNNER_TEMP:-}"
test -d "$RUNNER_TEMP"
for key in SUPABASE_ACCESS_TOKEN SUPABASE_DB_URL SUPABASE_SERVICE_ROLE_KEY \
  STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY TWILIO_AUTH_TOKEN \
  DATABASE_URL DIRECT_URL PGSERVICE PGHOSTADDR PGOPTIONS PGPASSFILE VERCEL_ENV; do
  if [ -n "${!key:-}" ]; then echo 'MR5I21_FORBIDDEN_CREDENTIAL_CONTEXT'; exit 1; fi
done

# Verify source, history and checksum pins BEFORE constructing a stage.
node candidate/scripts/acceptance/mr5-isolated-rehearsal-preflight.mjs --verify-synthetic-ci

files="$RUNNER_TEMP/mr5-candidate-files.txt"
test -f "$files"
test "$(wc -l < "$files")" -eq 48
first='20261018150000_mr5c2_atomic_subscription_projection.sql'
second='20261018163500_mr5c3a_webhook_processing_leases.sql'
third='20261018180500_mr5c3b2_fenced_subscription_reconciliation.sql'
test "$(sed -n '27p' "$files")" = "$first"
test "$(sed -n '28p' "$files")" = "$second"
test "$(sed -n '29p' "$files")" = "$third"

baseline_versions="$(psql -X -At -v ON_ERROR_STOP=1 \
  -c 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')"
test "$(printf '%s\n' "$baseline_versions" | wc -l)" -eq 26
diff -u <(head -n 26 "$files" | cut -d_ -f1) <(printf '%s\n' "$baseline_versions")

# Already-proved synthetic backup/restore is finished at this point; never
# copy hosted backups or embed credentials in runner artifacts.
before="$(psql -X -At -v ON_ERROR_STOP=1 \
  -f candidate/scripts/acceptance/mr5-local-baseline-fingerprint.sql \
  | sha256sum | cut -d' ' -f1)"
umask 077
stage="$(mktemp -d "$RUNNER_TEMP/mr5i21-partial-XXXXXX")"
log="$stage/expected-failure.log"
trap 'rm -rf -- "$stage"' EXIT
mkdir -m 700 "$stage/supabase"
mkdir -m 700 "$stage/supabase/migrations"
cp -- candidate/supabase/config.toml "$stage/supabase/config.toml"
head -n 28 "$files" | while IFS= read -r filename; do
  test -f "candidate/supabase/migrations/$filename"
  cp -- "candidate/supabase/migrations/$filename" "$stage/supabase/migrations/$filename"
  cmp -- "candidate/supabase/migrations/$filename" "$stage/supabase/migrations/$filename"
done
test "$(find "$stage/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | wc -l)" -eq 28
test ! -e "$stage/supabase/migrations/$third"

# CLI applies just the first two *real reviewed* candidate SQL migrations,
# each as a committed migration with its Supabase history entry. No source
# SQL or manifest bytes are changed, even temporarily.
(cd "$stage" && pnpm dlx supabase@2.117.0 migration up --local)
partial_versions="$(psql -X -At -v ON_ERROR_STOP=1 \
  -c 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')"
diff -u <(head -n 28 "$files" | cut -d_ -f1) <(printf '%s\n' "$partial_versions")

function_count="SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='reconcile_stripe_subscription_projection'"
test "$(psql -X -At -v ON_ERROR_STOP=1 -c "$function_count")" -eq 1
lease_function="SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='lease_stripe_webhook_processing'"
test "$(psql -X -At -v ON_ERROR_STOP=1 -c "$lease_function")" -eq 1
test "$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_webhook_events' AND column_name IN ('processing_lease_token','processing_lease_expires_at','processing_attempts')")" -eq 3
test "$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.stripe_subscription_reconciliation_leases') IS NULL")" = t

# Now attempt the THIRD exact reviewed migration. It would create the table;
# a deliberate sentinel in the same transaction forces rollback of the third
# but MUST NOT undo the two independently committed earlier migrations.
if psql -X -v ON_ERROR_STOP=1 --single-transaction \
  -f "candidate/supabase/migrations/$third" \
  -f candidate/scripts/acceptance/mr5-synthetic-injected-migration-abort.sql \
  > "$log" 2>&1; then
  echo 'MR5I21_UNEXPECTED_THIRD_MIGRATION_SUCCESS'; exit 1
fi
if ! grep -q 'MR5I20_SYNTHETIC_ABORT_EXPECTED' "$log"; then
  echo 'MR5I21_THIRD_FAILED_BEFORE_EXPECTED_SENTINEL'; exit 1
fi

# Assert the *partial committed state* is real and stable; any drift stops
# the normal replay. We do not assume a failed multi-step upgrade auto-reverts.
after_versions="$(psql -X -At -v ON_ERROR_STOP=1 \
  -c 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')"
diff -u <(head -n 28 "$files" | cut -d_ -f1) <(printf '%s\n' "$after_versions")
test "$(psql -X -At -v ON_ERROR_STOP=1 -c "$function_count")" -eq 1
test "$(psql -X -At -v ON_ERROR_STOP=1 -c "$lease_function")" -eq 1
test "$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.stripe_subscription_reconciliation_leases') IS NULL")" = t
after="$(psql -X -At -v ON_ERROR_STOP=1 \
  -f candidate/scripts/acceptance/mr5-local-baseline-fingerprint.sql \
  | sha256sum | cut -d' ' -f1)"
test "$before" = "$after"
echo 'MR5I21_TWO_COMMITTED_THIRD_ABORTED_PARTIAL_STATE_VERIFIED'
echo 'MR5I21_READY_TO_RESUME_REMAINING_20_DISPOSABLE_MIGRATIONS'
