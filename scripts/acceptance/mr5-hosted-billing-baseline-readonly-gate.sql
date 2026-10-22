-- MR-5I18: READ-ONLY catalog gate; source baseline recorded 2026-10-22.
-- Returns booleans ONLY. Does not fetch app records, install functions, repair ledger or migrate.
-- A PASS describes a narrow catalog snapshot, NOT database restore/compatibility approval.
WITH expected_versions(version) AS (
  VALUES ('20260917000001'),
         ('20260918235000'),
         ('20260919003000'),
         ('20260919010000'),
         ('20260919020000'),
         ('20260919030000'),
         ('20260919031000'),
         ('20260919040000'),
         ('20260919040100'),
         ('20260919050000'),
         ('20260919060000'),
         ('20260919170000'),
         ('20260919180000'),
         ('20260921174500'),
         ('20260921203000'),
         ('20260921212000'),
         ('20260922071808'),
         ('20261007000000'),
         ('20261008000000'),
         ('20261008010000'),
         ('20261009000000'),
         ('20261009120000'),
         ('20261009140000'),
         ('20261010000000'),
         ('20261010010000'),
         ('20261011120000')
), expected_columns(table_name,column_name,udt_name,is_nullable) AS (
  VALUES ('billing_webhook_events','id','uuid','NO'),
         ('billing_webhook_events','provider','text','NO'),
         ('billing_webhook_events','provider_event_id','text','NO'),
         ('billing_webhook_events','event_type','text','NO'),
         ('billing_webhook_events','processing_status','text','NO'),
         ('billing_webhook_events','payload_hash','text','NO'),
         ('billing_webhook_events','organization_id','uuid','YES'),
         ('billing_webhook_events','provider_created_at','timestamptz','YES'),
         ('billing_webhook_events','received_at','timestamptz','NO'),
         ('billing_webhook_events','processed_at','timestamptz','YES'),
         ('billing_webhook_events','error_code','text','YES'),
         ('billing_webhook_events','created_at','timestamptz','NO'),
         ('billing_webhook_events','environment','text','NO'),
         ('organization_billing_accounts','id','uuid','NO'),
         ('organization_billing_accounts','organization_id','uuid','NO'),
         ('organization_billing_accounts','provider','text','NO'),
         ('organization_billing_accounts','provider_customer_id','text','NO'),
         ('organization_billing_accounts','environment','text','NO'),
         ('organization_billing_accounts','created_at','timestamptz','NO'),
         ('organization_billing_accounts','updated_at','timestamptz','NO'),
         ('organization_entitlements','organization_id','uuid','NO'),
         ('organization_entitlements','status','text','NO'),
         ('organization_entitlements','allocated_requests','int4','NO'),
         ('organization_entitlements','consumed_requests','int4','NO'),
         ('organization_entitlements','duration_days','int4','NO'),
         ('organization_entitlements','started_at','timestamptz','YES'),
         ('organization_entitlements','expires_at','timestamptz','YES'),
         ('organization_entitlements','status_reason','text','YES'),
         ('organization_entitlements','created_at','timestamptz','NO'),
         ('organization_entitlements','updated_at','timestamptz','NO'),
         ('organization_subscriptions','id','uuid','NO'),
         ('organization_subscriptions','organization_id','uuid','NO'),
         ('organization_subscriptions','billing_account_id','uuid','NO'),
         ('organization_subscriptions','provider','text','NO'),
         ('organization_subscriptions','provider_subscription_id','text','NO'),
         ('organization_subscriptions','provider_price_id','text','YES'),
         ('organization_subscriptions','provider_status','text','NO'),
         ('organization_subscriptions','normalized_status','text','NO'),
         ('organization_subscriptions','current_period_start','timestamptz','YES'),
         ('organization_subscriptions','current_period_end','timestamptz','YES'),
         ('organization_subscriptions','cancel_at_period_end','bool','NO'),
         ('organization_subscriptions','canceled_at','timestamptz','YES'),
         ('organization_subscriptions','provider_state_updated_at','timestamptz','YES'),
         ('organization_subscriptions','created_at','timestamptz','NO'),
         ('organization_subscriptions','updated_at','timestamptz','NO'),
         ('organization_subscriptions','environment','text','NO')
), expected_keys(table_name,constraint_name,kind) AS (
  VALUES ('billing_webhook_events','billing_webhook_events_provider_env_event_key','u'),
         ('organization_billing_accounts','organization_billing_accounts_org_provider_env_key','u'),
         ('organization_billing_accounts','organization_billing_accounts_id_org_provider_env_key','u'),
         ('organization_billing_accounts','organization_billing_accounts_provider_customer_key','u'),
         ('organization_subscriptions','organization_subscriptions_account_org_provider_env_fkey','f'),
         ('organization_subscriptions','organization_subscriptions_provider_env_subscription_key','u')
), actual_columns AS (
  SELECT table_name::text,column_name::text,udt_name::text,is_nullable::text
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN
    ('billing_webhook_events','organization_billing_accounts','organization_subscriptions','organization_entitlements')
), actual_keys AS (
  SELECT c.relname::text AS table_name,con.conname::text AS constraint_name,con.contype::text AS kind
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
), gate AS (
 SELECT
   (SELECT COUNT(*) FROM supabase_migrations.schema_migrations)=26
     AND NOT EXISTS (SELECT version FROM expected_versions EXCEPT SELECT version FROM supabase_migrations.schema_migrations)
     AND NOT EXISTS (SELECT version FROM supabase_migrations.schema_migrations EXCEPT SELECT version FROM expected_versions)
     AS exact_26_baseline_versions,
   (SELECT COUNT(*) FROM actual_columns)=46
     AND NOT EXISTS (SELECT * FROM expected_columns EXCEPT SELECT * FROM actual_columns)
     AND NOT EXISTS (SELECT * FROM actual_columns EXCEPT SELECT * FROM expected_columns)
     AS exact_four_table_column_contracts,
   NOT EXISTS(SELECT * FROM expected_keys EXCEPT SELECT * FROM actual_keys)
     AS required_fk_and_unique_constraints,
   (SELECT COUNT(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname IN
     ('billing_webhook_events','organization_billing_accounts','organization_subscriptions'))=3
    AND COALESCE((SELECT bool_and(c.relrowsecurity
      AND NOT pg_catalog.has_table_privilege('anon',c.oid,'SELECT')
      AND NOT pg_catalog.has_table_privilege('anon',c.oid,'INSERT')
      AND NOT pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT')
      AND (CASE WHEN c.relname='billing_webhook_events'
            THEN NOT pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT')
            ELSE pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') END))
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname IN
     ('billing_webhook_events','organization_billing_accounts','organization_subscriptions')),false)
    AS baseline_billing_rls_and_direct_grants,
   (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='public'
        AND tablename IN ('billing_webhook_events','organization_billing_accounts','organization_subscriptions'))=2
    AND (SELECT count(DISTINCT tablename) FROM pg_catalog.pg_policies
         WHERE schemaname='public' AND tablename IN ('organization_billing_accounts','organization_subscriptions')
         AND cmd='SELECT' AND roles::text='{authenticated}'
         AND qual = 'user_has_role(organization_id, ARRAY[''OWNER''::text, ''ADMIN''::text])')=2
    AS baseline_tenant_select_policies,
   NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname IN ('stripe_subscription_reconciliation_leases','stripe_test_checkout_reservations','stripe_test_customer_provisioning','stripe_test_billing_action_limits','stripe_test_billing_recovery_reviews','billing_paid_entitlement_proposals','billing_synthetic_subscription_exception_reviews','billing_synthetic_invoice_evidence_drafts','billing_synthetic_checkout_quote_snapshots','billing_synthetic_invoice_reconciliation_reviews'))
     AS no_candidate_only_billing_tables
)
SELECT *, (exact_26_baseline_versions AND exact_four_table_column_contracts AND required_fk_and_unique_constraints AND baseline_billing_rls_and_direct_grants AND baseline_tenant_select_policies AND no_candidate_only_billing_tables) AS narrow_catalog_gate_pass
FROM gate;
