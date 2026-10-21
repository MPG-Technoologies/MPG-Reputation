-- MR-5I12 synthetic-only baseline fingerprint input.
-- CI hashes stdout with SHA-256 without printing fixture rows to the console.
-- Must run only on the localhost disposable database before/after restore.
WITH snapshot AS (
  SELECT 'organizations' AS kind, o.id::text AS identifier,
         pg_catalog.to_jsonb(o)::text AS canonical_row
  FROM public.organizations AS o
  WHERE o.slug LIKE 'mr5-upgrade-synthetic-%'
  UNION ALL
  SELECT 'organization_entitlements', e.organization_id::text,
         pg_catalog.to_jsonb(e)::text
  FROM public.organization_entitlements AS e
  WHERE e.organization_id IN (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'
  )
  UNION ALL
  SELECT 'organization_usage', u.id::text,
         pg_catalog.to_jsonb(u)::text
  FROM public.organization_usage AS u
  WHERE u.metric LIKE 'rehearsal_metric_%'
)
SELECT kind || '|' || identifier || '|' || canonical_row
FROM snapshot ORDER BY kind, identifier;
