import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

// A source-level safeguard, not a full PostgreSQL SQL parser or permission proof.
const file = new URL('../../scripts/acceptance/mr5-hosted-billing-baseline-readonly-gate.sql', import.meta.url)
const source = fs.readFileSync(file, 'utf8')

function checkReadOnlyCatalogQuery(sql) {
  const uncommented = sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n').trim()
  const statements = uncommented.split(';').filter(x => x.trim())
  if (statements.length !== 1) throw new Error('MULTI_STATEMENT_CATALOG_QUERY_FORBIDDEN')
  if (!/^WITH\s+expected_versions\(version\)\s+AS\s*\(/i.test(uncommented) ||
      !/FROM\s+gate\s*;\s*$/i.test(uncommented)) {
    throw new Error('NOT_A_SINGLE_READ_ONLY_CATALOG_QUERY')
  }
  const tokens = uncommented.replace(/'(?:''|[^'])*'/g, "''")
  if (/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|TRUNCATE|ALTER|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|PERFORM)\b/i.test(tokens)) {
    throw new Error('CATALOG_QUERY_MUTATION_FORBIDDEN')
  }
  const relations = [...tokens.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z_0-9.]*)/gi)]
    .map(m => m[1].toLowerCase())
  const allowed = new Set(['pg_catalog.pg_constraint','pg_catalog.pg_class',
    'pg_catalog.pg_namespace','pg_catalog.pg_policies',
    'information_schema.columns','supabase_migrations.schema_migrations',
    'expected_versions','actual_columns','expected_columns','expected_keys','actual_keys','gate'])
  for (const relation of relations) {
    if (!allowed.has(relation)) throw new Error('UNREVIEWED_CATALOG_RELATION: ' + relation)
  }
  return relations
}

test('committed hosted billing baseline probe is a single metadata-only SELECT', () => {
  const relations = checkReadOnlyCatalogQuery(source)
  assert.ok(relations.length >= 10)
  assert.ok(relations.includes('supabase_migrations.schema_migrations'))
  assert.ok(relations.includes('pg_catalog.pg_policies'))
  assert.ok(relations.includes('information_schema.columns'))
})

test('fails source review if DML/DDL or app-record source is inserted', () => {
  assert.throws(() => checkReadOnlyCatalogQuery(source.replace('FROM gate;', 'FROM gate; DELETE FROM public.customers;')),
    /MULTI_STATEMENT_CATALOG_QUERY_FORBIDDEN/)
  assert.throws(() => checkReadOnlyCatalogQuery(source.replace('FROM gate;', 'FROM public.customers;')),
    /NOT_A_SINGLE_READ_ONLY_CATALOG_QUERY/)
  assert.throws(() => checkReadOnlyCatalogQuery(source.replace('FROM gate;', 'FROM public.customers UNION ALL SELECT * FROM gate;')),
    /UNREVIEWED_CATALOG_RELATION/)
  assert.throws(() => checkReadOnlyCatalogQuery(source.replace('FROM gate;', 'FROM gate; DROP TABLE public.billing_webhook_events;')),
    /MULTI_STATEMENT_CATALOG_QUERY_FORBIDDEN/)
})

test('all historical version IDs are pinned once with the accepted final ID', () => {
  const versionsSection = source.split('WITH expected_versions(version) AS (')[1].split('), expected_columns')[0]
  const versions = [...versionsSection.matchAll(/'([0-9]{14})'/g)].map(x => x[1])
  assert.equal(versions.length, 26)
  assert.equal(new Set(versions).size, 26)
  assert.equal(versions[0], '20260917000001')
  assert.equal(versions.at(-1), '20261011120000')
  assert.deepEqual(versions, [...versions].sort())
})

test('four base tables pin 46 complete column contracts and six required keys', () => {
  const columnsSection = source.split('expected_columns(table_name,column_name,udt_name,is_nullable) AS (')[1]
    .split('), expected_keys')[0]
  const tableCounts = Object.fromEntries(
    ['billing_webhook_events','organization_billing_accounts','organization_entitlements','organization_subscriptions']
      .map(t => [t, (columnsSection.match(new RegExp("\\('"+t+"',", 'g')) ?? []).length]))
  assert.deepEqual(tableCounts, {
    billing_webhook_events: 13,
    organization_billing_accounts: 7,
    organization_entitlements: 10,
    organization_subscriptions: 16,
  })
  const keySection = source.split('expected_keys(table_name,constraint_name,kind) AS (')[1]
    .split('), actual_columns')[0]
  assert.equal((keySection.match(/\('(?:billing_webhook_events|organization_billing_accounts|organization_subscriptions)'/g) ?? []).length, 6)
})

test('tenant policies are checked by exact predicate for both organizations', () => {
  assert.match(source, /count\(DISTINCT tablename\)/i)
  assert.match(source, /qual = 'user_has_role\(organization_id, ARRAY\[''OWNER''::text, ''ADMIN''::text\]\)'/)
  assert.match(source, /roles::text='\{authenticated\}'/)
  assert.match(source, /no_candidate_only_billing_tables/)
  assert.match(source, /narrow_catalog_gate_pass/)
})

test('the query has no storage contents, auth users or service-role row access', () => {
  assert.doesNotMatch(source, /\b(?:auth\.users|storage\.objects|public\.customers|public\.review_requests)\b/i)
  assert.doesNotMatch(source, /\b(?:pg_read_file|pg_ls_dir|pg_sleep|dblink|http_get)\b/i)
})
