# MR-5I9 — Owner HOLD, deployment-trigger inspection, and safe hosted-migration rehearsal

**Checkpoint:** 2026-10-21; candidate `828f45dd7b311e33e54fbe815952c9b8665f1550`; Company OS `main` `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`; Product `main` `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`.

## Accepted owner decision

**HOLD PR #67 main merge.** Continue deployment-trigger verification and **non-destructive migration rehearsal planning**. No hosted database migrations without a **separate, explicit** owner authorization. This decision supersedes any previous conditional option to merge provider-OFF code now. No owner approval of billing/provider activation, commercial pricing, hosted migrations, production deploy, or a customer pilot.

## Deployment triggers — verified vs unresolved

Examined the candidate's three GitHub workflows and searched for a repository-root `vercel.json` (not found). No Vercel CLI production deployment, hosted Supabase project link, `supabase db push`, `supabase migration up`, or other hosted migration step is defined in those three workflows.

| Workflow | Trigger on `main` | Actual effect on `main` | Database/provider boundary |
| --- | --- | --- | --- |
| `.github/workflows/internal-ci.yml` | **YES**, `push: branches: [main]`; also PR/manual | Lint, typecheck, tests and Next.js build | Synthetic local URL/dummy key, no hosted credentials; no deploy |
| `.github/workflows/isolated-synthetic-e2e.yml` | **NO**, PR/manual only | Disposable local Supabase boot, SQL integration suites and cleanup | No hosted project link, remote migration or live provider |
| `.github/workflows/isolated-billing-browser.yml` | **NO**, path-filtered PR/manual only | Disposable local Supabase, local Next.js, Chromium acceptance | No hosted project link or live billing |
| **Vercel Git integration / deployments** | **UNKNOWN — likely production deployment on configured production branch** | **MUST VERIFY IN PROJECT SETTINGS** | Repository alone cannot establish Vercel production branch, ignored-build rules, deployment protection, env mapping, deploy hooks or automatic domain assignment |
| Other GitHub Apps/external CI/Supabase links | **UNKNOWN** | Requires connected admin inspection | Do not infer safety from absence of a repository YAML |

**Access blocker:** Connected Vercel API returned **403 forbidden** for `grovys-projects-793dd5b1` when inspecting the `mpg-reputation` project, listing projects and inspecting the last preview deployment. GitHub commit status **success** only proves a Vercel check succeeded; it is **not** proof that merging to `main` cannot deploy production. No production-branch setting was verified. Reconnect Vercel to the authorized team scope or have its authorized administrator review settings without exposing tokens.

### Required Vercel/GitHub release-readiness evidence (read-only)

1. In Vercel project settings: confirm team/project/repo, **Production Branch**, automatic deployment triggers for `main` pushes, ignored-build-step rules, deployment protection, production environment variables/targets (names and scopes, not secret values), deployment checks, custom production domains, and whether promotion/domain assignment is automatic.
2. In GitHub repository settings: verify branch protection/rulesets, required status checks, environments and reviewers, connected GitHub Apps/deployment webhooks, any additional workflows outside the three changed files, and production-triggering webhooks. Record evidence by settings screenshots or redacted settings export, not secrets.
3. Confirm any custom CI, Vercel integration or external Supabase migration automation tied to deployment. Confirm rollback/disable switches and the exact authorized operator. If any automatic production effect cannot be demonstrably stopped/controlled **continue HOLD**.
4. Never interpret a PR preview or CI success as explicit authorization to deploy or to run hosted migrations.

## Non-destructive hosted migration rehearsal — strict staging plan

**Planning state: NOT STARTED.** There are **22** candidate SQL migrations beyond `main`, each to be classified against the target's authoritative migration ledger, not blindly applied. The only verified E2E tested **fresh disposable PostgreSQL**, not a pre-existing populated hosted schema.

### Phase A: Owner-authorized read-only discovery (NO DDL, DML or secrets)

- Confirm exact Supabase **engineering/test** project identity, branch, owner, classification, and that it contains only synthetic/test records. Do not use unknown targets, production projects or real customer PII.
- Authorized operator inventories `supabase_migrations.schema_migrations` (version, status and checksums if independently tracked), relevant `pg_catalog` table/index/constraint/RLS/function/grant definitions, PostgreSQL/extensions versions, and non-PII aggregate row counts. Avoid viewing/exporting raw personal data and credentials.
- Compare each candidate migration version/content with committed migration history. Classify as **matched**, **pending**, **drifted**, **out-of-order**, or **unknown**. Stop on duplicate/divergent/partly applied history or insufficient permissions; never repair history automatically.
- Confirm current webhook/provider flags are OFF, messaging is OFF, and no real customer traffic points at this database. No account provisioning or background webhook dispatch.

### Phase B: Backup and independent clone (separate operation authorization required)

- Authorized DB operator verifies a **restorable** backup/PITR recovery point, retention and restore runbook. A successful backup status alone is insufficient: prove restore into isolated nonproduction clone without copying unapproved personal data.
- Prefer **schema-equivalent sanitized / synthetic baseline** built from the hosted *current* pre-candidate schema and privacy-safe aggregate distributions. Explicit approval and controlled environment are required before making this clone; no automatic dump/upload here.
- Reserve resources, verify credentials/URL point **only** to clone, ensure clone's outbound SMS/email/Stripe/webhooks/inngest workers disabled, and record baseline migration history, table counts, constraints, grants and expected app version.
- Never run `supabase db reset`, `db push`, `migration repair`, destructive `DROP`/`TRUNCATE`, or a migration against the original hosted target as part of rehearsal.

### Phase C: Replay candidate against clone ONLY (separately authorized)

- Apply the exact ordered **pending** repository migrations; require hash/version parity. Capture per-migration duration, locks, transactional outcome, DDL deviations, FK/check/index compatibility, and safe error/retry behavior. On any failure STOP and rebuild clone; do not force out-of-order migration repairs.
- Verify all ten new internal tables have RLS; function EXECUTE is service-only; restricted table ACLs after the final hardening migration deny `TRUNCATE`, `REFERENCES`, `TRIGGER` on the four mutable billing tables; six evidence/review ledgers resist UPDATE/DELETE.
- Execute synthetic replay and recovery scenarios for cross-tenant invoices, role/anon refusal, TEST webhook idempotency and lease fencing, paid-finality rejection, usage/trial no-change, legacy Quick Complete/review-destination flows, and authorized support inspection/auditing. **Never use provider live API or customer data.**
- Verify rollback: restore the clone to its baseline or rebuild; SQL migration files are not generally reversible. Recovery of the original hosted project remains a separate operational decision.

### Phase D: Later owner gate (not granted here)

Require: exact target/project ID, verified data classification, baseline/hash inventory, successful backup-restore proof, documented clone migration rehearsal, reviewed risk/lock window, rollback operator, post-apply acceptance plan, **explicit separate owner approval**. If any are absent, state **BLOCKED**. Even when granted for the ENGINEERING/TEST database, no production, live billing, live messaging or paid entitlements are implied.

## Checkpoint decision

- **PR #67:** HOLD / OPEN DRAFT / UNMERGED; latest prior verified candidate `828f45dd` had Internal CI #244, isolated SQL E2E #236, Chromium #8 and Vercel green. Any later doc/checkpoint commit requires refreshed exact-head verification.
- **Deployment trigger:** Repo GitHub checks do not publish production; **Vercel/main production trigger remains UNVERIFIED due to 403**.
- **Hosted migration rehearsal:** NOT STARTED; cannot proceed without exact target identity, safe clone/recovery controls and relevant separate authorization.
- **Owner next action:** Arrange authorized Vercel project settings inspection, then approve read-only engineering/test migration-history discovery when the target is identified. Neither is a merge or mutation approval.

**This record is a governance checkpoint and read-only release-risk assessment, not a migration execution or production launch.**
