# MR-5I8 — PR #69 reconciliation, hosted migration gates and owner decision packet

**As of:** 2026-10-21  
**Status:** IN PROGRESS — owner decision packet; not an owner ACCEPTED or production-ready release.  
**Authority:** Company OS `main` `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c` (MPG-DEC-052); Product `main` `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`.  
**Base:** Draft [PR #67](https://github.com/MPG-Technoologies/MPG-Reputation/pull/67), engineering branch `chatgpt/mr5i5-integrated-billing-review-20261020` at `945ffdf8d5d907332081bb30dd70f3bc69c495fa`.  
**Other work:** Draft [PR #69](https://github.com/MPG-Technoologies/MPG-Reputation/pull/69) at `4a3bfd57a1fa17ee9e2a6d4a84ec33e777acd9b3`. PR #69 is independent client activation / Quick Complete tenant-hardening engineering, NOT payment settlement.

## 1. PR #69 reconciliation — exact scope and limits

Reviewed full PR #69 patch, consisting of ten changed files. Only common file with PR #67: `.github/workflows/internal-ci.yml`. The other shared-existing app files matched the current product `main` before reconciliation; `operational-page-context.ts` and two new tests did not exist on `main` or the billing candidate.

The reconciliation feature branch `chatgpt/mr5i8-pr69-candidate-reconciliation-20261021` is based on **the reviewed billing candidate**, not `main`. It applies the **nine nonoverlapping PR #69 source/test files** without alterations and merges only the two additional CI test entries into the *current billing candidate* CI workflow:

- Quick Complete action refuses anonymous sessions and any role other than OWNER, ADMIN, OPERATOR; existing user-scoped organization/location checks stay intact.
- Quick Complete and Review Destination server pages refuse ambiguous/missing/malformed membership before tenant-specific reads; VIEWER cannot obtain forms; same guard prevents a global modal from becoming a writable first-organization shortcut.
- The rest of the shared application layout retains its existing first-membership behavior; this reconciliation **does not authorize a global selector or claim to fix all app-wide multi-tenant selection**.
- Test files cover page context, real server action role refusal, and staging readiness. CI retains **all pre-existing billing allowlist tests** and adds PR #69's two suites (no replacement of billing workflow or decrease in scope).
- No Stripe activation, billing mutation, payment authorization, RLS reduction, schema change, hosted data or real customer action is introduced by PR #69.
- **Separate PR #69 is still DRAFT/unmerged.** Its old Vercel status showed a build-rate restriction; do not mislabel as a verified code failure. Use current combined PR exact-head checks for new acceptance instead.

**Reconciliation acceptance criterion:** combined Internal CI lint/typecheck/tests/build, isolated disposable SQL E2E, isolated real Chromium acceptance, final ten-file PR #69 parity review, and full integration-branch exact-head recheck after merging child PR. Record latest branch SHA and all check links before requesting owner's mainline decision. A future PR #69 edit must be reviewed as new evidence; do not merge the separate draft PR independently into `main`.

## 2. Hosted database migration safety plan — planning only, NOT authorization to apply

There are **22 additional chronologically ordered candidate migrations** relative to the accepted product `main`, from `20261018150000_mr5c2_atomic_subscription_projection.sql` through `20261021110000_mr5i7_mutable_billing_table_acl_hardening.sql`. They contain ten new RLS-enabled internal tables, TEST webhook invoice columns/constraints, explicit service-role RPC grants, trigger-protected immutable synthetic evidence, and follow-on fixes. Applying them to a fresh disposable Supabase passed existing CI. **This is NOT evidence that they are safe to run on a populated hosted engineering/test database.** Never automatically apply a branch migration merely because a PR builds.

### Preflight 0 — isolate authority and target (NO CHANGE)

1. Owner/authorized operator identifies the **exact nonproduction Supabase project ID**, database branch/region, data classification (synthetic only or other), and whether its migration history is canonical. Reconcile source-of-truth ownership and Company OS approval; **never guess** target from environment variables or use a production project.
2. Confirm actual backend project is still designated **ENGINEERING/TEST**, has no real customer data, active billing, or active messaging. If classification cannot be confirmed, **BLOCKED** until clarified. No elevated service-role convenience access to inspect personal records.
3. Verify product `main`, approved candidate exact commit, migration files and immutable checksums. Preserve original migration ordering. Do **not** rewrite or repair previously applied migration versions by substituting new contents.
4. Obtain a **read-only migration inventory** (Supabase migration history), current relevant schema/constraint/index/function/grant/RLS metadata and non-PII aggregate row counts; capture DB/extensions/PostgreSQL versions. Use owner-authorized DB-reader credentials, not API service role. Do not copy credentials into chat or GitHub logs.
5. Compare remote history to the 22 candidate migrations, documenting each as pending/applied-with-matching-hash/divergent/unknown. **STOP** on missing, out-of-order, changed-history or drifted schema; no blind `db push` or automatic history repair.

### Preflight 1 — compatibility and reversible operational plan (NO CHANGE)

1. Obtain **verified, restorable** hosted project backup/PITR recovery capability and authorized restore procedure with retention window, or refuse application. Existing engineering/test data must not be discarded for convenience. Document responsible human and maintenance window.
2. Against a fresh isolated Supabase **or an authorized, sanitized/schema-equivalent clone** (not a raw customer dump), first recreate the **current hosted baseline**, then apply only pending chronological migrations exactly as committed. A fresh-from-zero reset **alone is insufficient**.
3. Inspect existing rows using **non-PII aggregates** for added NOT NULL/check constraints, uniqueness/FK coverage, invoice reference shape, leasing pair constraints, provider/environment values and lifecycle event statuses. Any incompatible rows → **BLOCKED** with additive remediation migration requiring review (no destructive auto-cleanup).
4. Verify no unexpected privilege inheritance or default PUBLIC grants; the last migration `20261021110000` explicitly asserts absence of `TRUNCATE`, `REFERENCES`, `TRIGGER` effective rights for `service_role` on four internal mutable tables, and no client DML rights. Confirm new tables' RLS, private RPC function execution rights, reference and identity constraints.
5. Bound database lock/transaction risk for ALTER TABLE/add constraints/indexes on **actual row cardinalities**. Assess migration tool transaction semantics, long-running session contention, migration runtime, retry and timeout behavior. Do not infer zero lock exposure because fresh disposable DB passes.
6. Test idempotent event/replay, lease fence/cooldown, invoice terminal INSERT/UPDATE quarantine, immutable evidence/reviews, auth/anon/tenant policy and **unmodified trial/usage** with disposable synthetic tenants, including restart after an interrupted rehearsal. Compare schema + effective grants and record logs without sensitive payloads.
7. If any rehearsal fails: **STOP**. Rebuild test clone, correct code/migrations only on a new feature branch, rerun independent check. Do **not** drop tables, truncate history, disable triggers/RLS or bypass tenant rules.

### Apply/rollback gate — separately authorized only

**Do not execute this plan in response to PR #67 merge approval.** A specific **hosted ENGINEERING/TEST migration authorization** must identify project ID, branch SHA, list of migration IDs, planned window, backup/restore operator, rollout and verification checklist. Only then: apply each pending migration in the controlled approved environment, track transaction outcomes, validate exact migration history + schema grants and synthetic workflows afterward, and record a checkpoint. No PROD. No actual provider charges or paid entitlements.

**Rollback strategy:** pre-approved recovery to the verified backup/PITR or **new forward-only compensating migration** after reviewing data written since application. Existing Supabase SQL migrations are not assumed reversible; `CREATE TABLE`/constraints/RPC replacements and written data preclude a general automatic DOWN. No destructive reversion, forced migration-history edit, or forced code reset. Stop billing/worker execution (which is currently provider-OFF) while investigating discrepancies.

### Hosted-migration go/no-go matrix

| Gate | Minimum evidence | If missing |
| --- | --- | --- |
| Target classification | Exact nonproduction project, no real customer data | BLOCKED |
| History and drift | Migration-ID/hash match, schema/grants baseline | BLOCKED |
| Recoverability | Tested backup/PITR + operator/window | BLOCKED |
| Clone rehearsal | Host-baseline replay of all pending changes; no data loss | BLOCKED |
| Security | RLS, service-only RPC/ACL, tenant/anon tests PASS | BLOCKED |
| Financial gates | No LIVE payment keys, no paid grant, no invoice finalizer | BLOCKED |
| Owner authorization | Separate hosted TEST DB scope and owner approval | BLOCKED |

## 3. Explicit owner decision — what may be accepted separately

**A — Provider-OFF source integration:** Conditional technical acceptance review for the original PR #67 pinned `945ffdf8` is recorded in its GitHub review. The merged activation-reconciled candidate requires **fresh exact-head checks and diff/security review** before owner could approve any `main` merge. Owner may approve *provider-OFF code integration only*, explicitly **without authorizing hosted migrations, production deployment or paid/live billing**. The product's normal main CI/release discipline still applies.

**B — Hosted engineering/test database migration:** A **separate** explicit owner authorization only after all hosted preflight gates above pass. Code merge approval is **not** DB deployment permission.

**C — Real Stripe TEST provider testing:** Requires actual available TEST account, merchant/geographic checks, authorized secrets and independent provider verification. No real Stripe identity/charges have been validated by disposable mocks.

**D — Production, pricing, paid entitlements, subscriptions, real messaging, real pilot, commercial release, stage change:** **NOT AUTHORIZED**; explicitly separate owner action. Default product trial language: **30 Free Review Requests**. Proposed amounts are NOT commercially accepted.

**Recommended decision at this checkpoint:** accept the reconciliation work as *engineering to review and verify*, retain **HOLD on `main` merge** until combined post-reconciliation CI/review and hosted migration go/no-go are satisfied. Owner may then make an explicit provider-OFF code-only merge decision, without permitting hosted DB changes.

## 4. Record of unresolved product constraints

- Historical tenant-attributed synthetic `PROCESSED` invoice INSERT remains **untrusted**, deliberately non-authorizing for financial settlement; cannot be elevated to money truth.
- No immutable provider-attested settled-invoice ledger, tax/proration/discount/refund policy, real provider finalizer, or automated paid entitlement grant.
- 22 candidate SQL migrations were validated on disposable fresh DB, **not** a populated hosted baseline or rollback rehearsal.
- PR #69's operational scope does **not** eliminate existing first-membership selection throughout the rest of the legacy app; different site-wide selector milestone remains.
- The original independent security review was at `945ffdf8`. Any new reconciled integration SHA must be evaluated on its own merits. No external auditor signature is claimed.

**Execution boundary:** Feature branch/PR changes and disposable CI only. No main merge, hosted/production schema change, service-role shortcuts, live payment, live messaging, commercial price decision or deployment.
