# MR-5I15 — Hosted Engineering/Test Catalog Read-Only Preflight (2026-10-22)

**Status:** ENGINEERING EVIDENCE / READY FOR OWNER REVIEW after exact-head CI. No merge, backup, hosted migration, restore, paid access, provider activation or production deployment is authorized.

## Authority and target

Latest Company OS `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`. Product `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`. Parent billing candidate PR #67 at `699c8a9ad8d6c356eeb0e29affa83feeeac2a227`, held for main merge. MR-5I14 draft #86 at `b72a31d1d8d4c425e3128493e004bd1feea1d5ab` is the base for this stacked evidence slice.

Correct connected Supabase account: `cryptogrovy@gmail.com`, project **mpg-reputation**, exact ref `awvqtwkzprygsoyfspuz`, region `ap-south-1`, PostgreSQL **17.6**, status ACTIVE_HEALTHY. This resolves **the Supabase account-access blocker** described historically in MR-5I10. It does **not** resolve the separate Vercel 403/deployment-trigger blocker.

Only metadata was inspected with the authenticated Supabase connector: project listing, applied migration versions, table RLS flags and counts, `pg_catalog` relation/policy/constraint/effective role-grant metadata. Catalog SQL consisted of `SELECT` statements. No raw customer, auth, completion, message, billing or other application row was selected. **A connector SQL call is not evidence of a dedicated low-privilege read-only database account.**

## Observed hosted baseline

| Metric | Observed value | Limit |
| --- | --- | --- |
| Applied schema migrations | **26**, final `20261011120000` | Version identity, **not** deployed SQL hash/body parity |
| Exact 26-version sequence | Matches MR-5I14 operator list, checked independently via connector | Does not establish absence of schema drift |
| Public tables | **25** | Only `public` inspected |
| Public tables reporting RLS enabled | **25/25** | Does not prove correct effective policy behavior |
| Existing `organization_billing_accounts` | **0 rows** | Count from connector, not transactional migration proof |
| Existing `organization_subscriptions` | **0 rows** | Same limitation |
| Existing `billing_webhook_events` | **0 rows** | Same limitation |
| Other records exist | **4 organizations, 23 customers, 35 completion events, 18 review requests, 3 entitlements, 7 usage summaries** | Aggregates only; their test-only classification remains **UNVERIFIED** |
| Candidate-only billing migrations | **22** pending in held PR #67 | None applied to this target |

### Billing authorization metadata

- All three existing billing tables have RLS enabled.
- `anon` has no direct SELECT or INSERT privilege on those tables.
- `authenticated` has SELECT privilege on billing accounts/subscriptions, but not INSERT. Corresponding `SELECT` policies require `user_has_role(organization_id, ARRAY['OWNER','ADMIN'])`; mere `authenticated` role membership is **not** the row-level business authorization.
- `billing_webhook_events` exposes no direct SELECT or INSERT privilege to `authenticated`. Its public-policy listing has no tenant-facing policy.
- Existing three-table PK/FK/UNIQUE/CHECK constraint *names/types* were read; no error surfaced. No inserted fixture, constraint enforcement runtime, GRANT changes, or privileged execution was attempted.
- The narrowly selected public function-name patterns `billing_%`, `stripe_%`, `reconcile_%` and `%subscription%` returned **no rows**; this is not a claim about all public functions or candidate-only functions.

## Reproducible metadata-only operator aid

Added `scripts/acceptance/mr5-hosted-catalog-readonly.sql`, intentionally limited to `BEGIN TRANSACTION READ ONLY`, six metadata SELECT statements and `ROLLBACK`. The SQL reports version ledger, public RLS/table metadata and the three existing billing tables' effective role grants, policy predicates and constraints. It deliberately does not read application data, create backup files, execute a migration, repair migration history or invoke business RPCs.

**Operator guard:** Before using it, independently confirm the exact target project `awvqtwkzprygsoyfspuz` via the authorized Supabase dashboard/connection and use approved credentials. PostgreSQL's database name alone is `postgres` and **cannot** prove which Supabase project is connected. The file does not verify target identity or privilege level. The SQL file was **not executed through an operator connection** in this slice; equivalent read-only catalog queries were executed through the connected project tool.

The operator test suite adds a **static regression tripwire** against accidental DML/DDL and direct application-table sources. It is not a complete SQL parser, transactional execution proof, authorization test or replacement for the earlier disposable database integration suites.

## Release and recovery gate status

1. **Supabase visibility:** RESOLVED for read-only metadata verification of the identified MPG Reputation project.
2. **Historical migration version list:** MATCHED (26/26); application-level SQL hashes and full schema equivalence **NOT VERIFIED**.
3. **Billing base table security:** CURRENT CATALOG SNAPSHOT appears consistent with RLS and tenant-scoped OWNER/ADMIN read policies; no tenant-auth runtime test against hosted rows performed.
4. **Data classification:** **OPEN**. Hosted has customer/completion/review records. The owner's previous designation is engineering/test, but a metadata inventory cannot establish that every row is synthetic or non-personal.
5. **Real encrypted owner-operated backup:** **NOT DONE**; requires appropriate data-handling authorization, secure storage and restricted operator credentials.
6. **Independent authorized isolated restore of the real backup:** **NOT DONE**; do not copy any sensitive hosted data into CI or the ChatGPT container.
7. **Host-baseline clone replay of 22 pending migrations:** **NOT DONE**; disposable synthetic CI replay is separate evidence.
8. **Vercel external automatic production deployment triggers:** **UNKNOWN/403**; no merge to `main`.
9. **Hosted migrations, financial/provider finality, paid entitlements, messaging and launch:** **NOT AUTHORIZED**.

## Next safe action

Review this exact-head evidence and test results, then have the authorized owner/operator establish the **data classification, private backup location/encryption, permissioned isolated restore target and a no-write window**. Neither PR #67 nor this preflight is a hosted-migration approval. The next consequential deployment/restore step still requires separate explicit owner authorization. Avoid raw PII, secret values, archive exports, service-role convenience queries and uncontrolled clone creation.

Historical source: `docs/MR-5I10-EXTERNAL-RELEASE-AND-READONLY-HOSTED-PREFLIGHT-2026-10-21.md` documented an earlier connector-access blocker; this evidence **supersedes only its Supabase-access finding**, not its Vercel and release warnings.
