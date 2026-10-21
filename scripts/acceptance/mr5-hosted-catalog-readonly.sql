-- MR-5I15: READ-ONLY METADATA INVENTORY. Does not validate target project identity.
-- Authorized operator MUST independently confirm Supabase project awvqtwkzprygsoyfspuz in dashboard
-- and use approved credentials. NO CUSTOMER DATA / NO SCHEMA OR DATA MUTATIONS.
-- This SQL is NOT a backup, restore, migration or grant/tenant penetration test.
BEGIN TRANSACTION READ ONLY;

-- Server and accepted migration inventory (only migration metadata is read).
SELECT current_database() AS database_name,
       current_setting('server_version') AS postgres_version;
SELECT version
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- Public relation metadata, not table contents. reltuples may be -1 / stale.
SELECT c.relname AS table_name,
       c.relkind AS relation_kind,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.reltuples::bigint AS estimated_rows
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

-- The three already-deployed MR-5 billing tables: effective role grants.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       pg_catalog.has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       pg_catalog.has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
       pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('billing_webhook_events',
                    'organization_billing_accounts',
                    'organization_subscriptions')
ORDER BY c.relname;

-- Catalog policy predicates and constraints only; no raw rows.
SELECT tablename, policyname, cmd, roles, qual
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('billing_webhook_events',
                    'organization_billing_accounts',
                    'organization_subscriptions')
ORDER BY tablename, policyname;

SELECT c.relname AS table_name, co.conname AS constraint_name, co.contype AS constraint_kind
FROM pg_catalog.pg_constraint AS co
JOIN pg_catalog.pg_class AS c ON c.oid = co.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('billing_webhook_events',
                    'organization_billing_accounts',
                    'organization_subscriptions')
ORDER BY c.relname, co.conname;

-- Always terminate without persisting any session changes.
ROLLBACK;
