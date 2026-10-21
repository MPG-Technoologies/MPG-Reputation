-- MR-5I12. DESTRUCTIVE TO SYNTHETIC FIXTURES. Must only run in the
-- localhost-owned, disposable CI Supabase project. NEVER on hosted Supabase.
-- This scoped removal makes it possible to prove that a pg_restore really
-- restores rows; replaying a dump into a still-populated DB proves nothing.
BEGIN;
DO $local_only_fixture$
BEGIN
  IF (SELECT COUNT(*) FROM supabase_migrations.schema_migrations) <> 26
    OR (SELECT COUNT(*) FROM public.organizations) <> 4
    OR (SELECT COUNT(*) FROM public.organizations
        WHERE id IN (
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
          '44444444-4444-4444-8444-444444444444'
        ) AND slug LIKE 'mr5-upgrade-synthetic-%') <> 4
    OR (SELECT COUNT(*) FROM public.organization_entitlements) <> 3
    OR (SELECT COUNT(*) FROM public.organization_usage) <> 7
    OR (SELECT COUNT(*) FROM public.organization_billing_accounts) <> 0
    OR (SELECT COUNT(*) FROM public.organization_subscriptions) <> 0
    OR (SELECT COUNT(*) FROM public.billing_webhook_events) <> 0
  THEN
    RAISE EXCEPTION 'MR5_BACKUP_RESTORE_FIXTURE_OR_BASELINE_MISMATCH';
  END IF;
END
$local_only_fixture$;

DELETE FROM public.organizations
WHERE id IN (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);

DO $verify_empty$
BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations)
     OR EXISTS (SELECT 1 FROM public.organization_entitlements)
     OR EXISTS (SELECT 1 FROM public.organization_usage)
  THEN RAISE EXCEPTION 'MR5_BACKUP_RESTORE_DELETE_NOT_ISOLATED';
  END IF;
END
$verify_empty$;
COMMIT;
