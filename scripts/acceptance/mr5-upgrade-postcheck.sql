-- MR-5I11 post-upgrade assertions. Run only against disposable localhost PostgreSQL.
-- This transaction is read-only. Verify baseline rows survive and billing stays nonauthorizing.
BEGIN TRANSACTION READ ONLY;
DO $mr5_upgrade$
DECLARE
 v_expected_public_tables TEXT[] := ARRAY[
  'stripe_subscription_reconciliation_leases',
  'stripe_test_checkout_reservations',
  'stripe_test_customer_provisioning',
  'stripe_test_billing_action_limits',
  'stripe_test_billing_recovery_reviews',
  'billing_paid_entitlement_proposals',
  'billing_synthetic_subscription_exception_reviews',
  'billing_synthetic_invoice_evidence_drafts',
  'billing_synthetic_checkout_quote_snapshots',
  'billing_synthetic_invoice_reconciliation_reviews'
 ];
 v_restricted_mutable TEXT[] := ARRAY[
  'stripe_subscription_reconciliation_leases',
  'stripe_test_checkout_reservations',
  'stripe_test_customer_provisioning',
  'stripe_test_billing_action_limits'
 ];
 v_table TEXT;
 v_priv TEXT;
BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 48
 OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
                WHERE version='20261021110000') THEN
  RAISE EXCEPTION 'MR5_UPGRADE_MIGRATION_HISTORY_INCOMPLETE';
 END IF;
 IF (SELECT count(*) FROM public.organizations WHERE slug LIKE 'mr5-upgrade-synthetic-%') <> 4
 OR (SELECT count(*) FROM public.organization_entitlements
     WHERE organization_id IN (
      '11111111-1111-4111-8111-111111111111'::uuid,
      '22222222-2222-4222-8222-222222222222'::uuid,
      '33333333-3333-4333-8333-333333333333'::uuid)) <> 3
 OR (SELECT count(*) FROM public.organization_usage WHERE metric LIKE 'rehearsal_metric_%') <> 7 THEN
  RAISE EXCEPTION 'MR5_UPGRADE_BASELINE_DATA_LOST';
 END IF;
 IF EXISTS (SELECT 1 FROM public.organization_entitlements
   WHERE organization_id IN (
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid)
   AND (allocated_requests<>30 OR consumed_requests NOT IN (0,5))) THEN
  RAISE EXCEPTION 'MR5_UPGRADE_TRIAL_ALLOCATION_CHANGED';
 END IF;
 IF (SELECT count(*) FROM public.organization_billing_accounts) <> 0
 OR (SELECT count(*) FROM public.organization_subscriptions) <> 0
 OR (SELECT count(*) FROM public.billing_webhook_events) <> 0 THEN
  RAISE EXCEPTION 'MR5_UPGRADE_INVENTED_BILLING';
 END IF;
 FOREACH v_table IN ARRAY v_expected_public_tables LOOP
  IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname=v_table
     AND c.relkind IN ('r','p') AND c.relrowsecurity
  ) THEN
   RAISE EXCEPTION 'MR5_UPGRADE_NEW_TABLE_MISSING_RLS: %',v_table;
  END IF;
  FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF pg_catalog.has_table_privilege('anon',format('public.%I',v_table),v_priv)
   OR pg_catalog.has_table_privilege('authenticated',format('public.%I',v_table),v_priv) THEN
    RAISE EXCEPTION 'MR5_UPGRADE_CLIENT_DML_EXPOSED: % %',v_table,v_priv;
   END IF;
  END LOOP;
 END LOOP;
 FOREACH v_table IN ARRAY v_restricted_mutable LOOP
  FOREACH v_priv IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF pg_catalog.has_table_privilege('service_role',format('public.%I',v_table),v_priv) THEN
    RAISE EXCEPTION 'MR5_UPGRADE_SERVICE_PRIVILEGE_EXCESS: % %',v_table,v_priv;
   END IF;
  END LOOP;
 END LOOP;
 IF EXISTS (
  SELECT 1 FROM public.billing_paid_entitlement_proposals WHERE access_authorized
 ) OR EXISTS (
  SELECT 1 FROM public.billing_synthetic_invoice_evidence_drafts WHERE financial_finality OR access_authorized
 ) OR EXISTS (
  SELECT 1 FROM public.billing_synthetic_invoice_reconciliation_reviews WHERE financial_finality OR access_authorized
 ) THEN
  RAISE EXCEPTION 'MR5_UPGRADE_FINANCIAL_NONACTIVATION_BREACH';
 END IF;
END
$mr5_upgrade$;
COMMIT;
