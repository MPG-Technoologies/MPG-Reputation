# MR-5I19 — Isolated Restore and 22-Migration Rehearsal Readiness

**Date:** 2026-10-22  
**Status:** ENGINEERING IN PROGRESS / owner-reviewed recovery gates pending. This is **not** an executed real hosted backup, an approved isolated restore, a hosted migration, or a deployment authorization.

## Authority / frozen evidence

- Company OS `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`; product `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`. MPG-DEC-052 accelerates bounded development, not owner-gated hosted/database actions.
- Integration candidate: held PR #67 at `699c8a9ad8d6c356eeb0e29affa83feeeac2a227`. The 22 additional billing SQL files remain unapplied to the hosted project.
- Reviewed migration fingerprint PR #89 and hosted catalog gate PR #90 are staged upstream; PR #90 exact-head Internal CI and isolated Synthetic E2E passed at `6eedfdade042045cac7074cebd3358e3b1cbcdb3`.
- Exact MPG Reputation engineering/test Supabase project is `awvqtwkzprygsoyfspuz`, PostgreSQL 17.6. The read-only catalog gate yielded all six true values (26 historical versions, 46 base columns, six critical constraints, RLS/grants, narrow tenant SELECT policies, no ten candidate-only billing tables). Its scope is catalog metadata only.

## MR-5I19 bounded implementation

We **reuse** the existing `.github/workflows/isolated-mr5-populated-upgrade.yml`: it already creates 4 synthetic organizations, exports/restores synthetic public data and applies the pending 22 migrations to **a disposable local Supabase** (not a hosted project). Do not replace it with an uncontrolled second restore runner.

A new source/env preflight `scripts/acceptance/mr5-isolated-rehearsal-preflight.mjs --verify-synthetic-ci` now runs **before any disposable Supabase container starts**. It strictly requires:

1. `CI=true` and `GITHUB_ACTIONS=true`; PostgreSQL target exactly `127.0.0.1:54332`, role `postgres`, database `postgres`, fixed disposable credential `postgres` (synthetic CI only).
2. `EMAIL_PROVIDER=console`, `ENABLE_LIVE_EMAIL=false`, `ENABLE_LIVE_BILLING=false`, and `ENABLE_RETENTION_MAINTENANCE=false`; forbid ambient hosted, provider, Vercel and connection-override credentials. Optional public Supabase URL is permitted only when pointing at `http://127.0.0.1:54331`.
3. A **separate** accepted-main checkout at exactly `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`; both `supabase/config.toml` files must identify the local `MPG-Reputation` project.
4. Exactly 26 historical migrations in accepted-main; exactly 48 files in candidate; accepted 26 filenames and raw SQL bytes must match across checkouts. Reuse MR-5I17's independently reviewed source manifest and all **22 exact Git blob fingerprints** rather than relying on filenames or counts alone.
5. Fail closed on any disagreement, before any fixture insertion, data export, migration or database start. The preflight itself performs **no database connection, SQL execution, backup, filesystem mutation, Stripe calls or deployment**.

Synthetic Node tests cover unsafe environment variables, production hosts/provider secrets, local source changes, wrong baseline project, same-checkout aliases and missing frozen Git evidence. Internal CI runs only these pure tests. The separate populated-upgrade GitHub workflow executes the real preflight before its already-existing disposable local rehearsal; it never contacts the hosted Supabase project or handles its records.

## Real hosted-equivalent recovery evidence — mandatory owner-controlled gate

The following are **independent requirements**. The fact that our synthetic replay and source checks pass does not satisfy the real-backup/real-restore rows.

| Decision/evidence | Verified status as of this slice | Stop condition |
| --- | --- | --- |
| Owner confirms data classification and lawful use/handling of engineering/test hosted records | **OPEN**; 4 orgs, 23 customer records and other test-like data exist, but metadata cannot classify them as non-personal | Any uncertain or unauthorized real-record transfer |
| Owner separately authorizes a real backup export | **NOT AUTHORIZED BY THIS SLICE** | No express consent or documented destination |
| Secure operator-controlled private encrypted archive; restricted local/remote access; checksum manifest | **NOT DONE** | Missing or unverifiable encryption, ACL, permitted storage, retention plan |
| `mr5-offline-backup-integrity.mjs` applied to an actual owner-held backup | **NOT DONE** | No archive, manifest mismatch, unverified source |
| Independent isolated restore target with no external egress and independent identity; PostgreSQL 17 and required Supabase runtime compatibility | **NOT PROVISIONED / NOT APPROVED** | Target can connect to live provider, hosted source, or real users |
| Restoration of necessary schema, auth data, privileges, Supabase migration ledger, storage object references/bytes where relevant | **NOT VERIFIED** | Role, extension, auth/storage/secret/object limitations not reconciled |
| Verification of restored source: exact 26 migration versions; RLS/grants, FK/UNIQUE; row-count aggregates without raw PII | **NOT RUN** | Drift, missing roles, privilege escalation, skipped original records |
| Run exactly 22 pinned candidate migrations in order on that **restored isolated target** and prove 48 exact versions | **NOT RUN** | Any SQL error, drift, unexpected lock/mutation or mismatched input |
| After-replay tenant authorization, webhook idempotency, suppression/no live providers, 30 Free Review Requests and paid-entitlement nonactivation | **NOT RUN against real-restored baseline** | Any tenant leak, live send, paid access, finance ambiguity |
| Rollback/recovery from failed rehearsal, private archive lifecycle and disposal evidence | **NOT DONE** | Recovery incomplete, orphaned clone, unapproved retention |
| Vercel production-deployment trigger and required merge authorization | **UNKNOWN / blocked 403**; PR #67 **HOLD** | Uncontrolled deployment on main push |

**Owner decision needed only for real-world operations:** approve and identify the class of data, acceptable encrypted backup destination, exact independently provisioned isolated environment, and boundaries for real copy/restore. Do not place backup bytes, paths if sensitive, credentials, customer names, auth records or project-private identifiers beyond the public Supabase project reference into GitHub/CI/this chat.

## Stop/go language and next action

- A green synthetic rehearsal means **ENGINEERING COMPLETE — SYNTHETIC LOCAL EVIDENCE ONLY**, not real hosted disaster-recovery readiness.
- A green MR-5I19 preflight is **not** permission to create or restore a real backup, to migrate hosted, to activate paid access, or to merge/deploy.
- While the owner-controlled gates remain open, continue non-sensitive synthetic hardening and incident-recovery analysis on draft feature branches. Real owner-operated backup/restore and subsequent 22-step rehearsal require explicit separate authorization.
- PR #67 stays **HOLD**, MR-5 billing is not commercially complete, and live billing/messaging remain inactive.
