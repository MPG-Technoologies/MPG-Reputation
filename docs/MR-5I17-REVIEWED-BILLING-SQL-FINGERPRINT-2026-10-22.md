# MR-5I17 — Reviewed Candidate SQL Fingerprint and Migration Order Gate

**Date:** 2026-10-22  
**Status:** ENGINEERING / staged draft, subject to exact-head CI and owner review.  
**Authority:** Product main `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`; Company OS main `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`; held billing PR #67 candidate `699c8a9ad8d6c356eeb0e29affa83feeeac2a227`. Stacked after #86, #87 and #88.

## Objective

Before an owner-authorized isolated migration rehearsal, reject unreviewed changes to the exact 22 candidate billing migration SQL files and detect baseline/version/path/order drift. This is a **repository-source fingerprint check**, not an operator preflight, hosted database parity check, security certification, executable SQL semantics audit or migration authorization.

## Source inventory

The repository candidate contains **26 accepted baseline migration versions**, latest `20261011120000`, followed by **22 proposed billing SQL files** from `20261018150000` to `20261021110000`. An earlier metadata-only Supabase read of engineering project `awvqtwkzprygsoyfspuz` independently reported the same **26 applied versions**, but it did **not** compare the hosted SQL bodies or schema checksums. All 22 proposed migrations remain **UNAPPLIED to hosted**.

Each new SQL file was fetched from the exact held PR #67 candidate commit before recording its GitHub blob SHA-1 in `scripts/acceptance/mr5-reviewed-candidate-manifest.json`. This source inventory is grouped by purpose; each range contains multiple DB changes and is **not** a single atomic feature rollout:

| Candidate range | Source content / operational purpose | Rehearsal attention |
| --- | --- | --- |
| 01–05 | Subscription projection, webhook leases, fenced reconciliation, TEST recovery queue, checkout reservations | Legacy table references, lock ordering, constrained service-role EXECUTE, idempotent retry |
| 06–10 | TEST customer provisioning, action admission limits, diagnostics, recovery context, review intake | TEST-only enforcement, tenant binding and private recovery disclosures |
| 11–15 | Invoice reference/processing, synthetic paid-access *proposals*, ordering and exception reviews | Existing column assumptions, FK checks, **proposals never grant paid access** |
| 16–21 | Synthetic invoice evidence and quote snapshots, terminal-event quarantine and manual review recording | Append-only semantics, live payment disabled, consistency under retries |
| 22 | ACL hardening for four mutable internal tables | `REVOKE TRUNCATE, REFERENCES, TRIGGER` and fail-closed effective-grant checks |

Important: the final migration's `TRUNCATE` text is **within a REVOKE statement and privilege-name checks**, not a `TRUNCATE TABLE` data operation. The inventory contains DDL, functions, tables, constraints, triggers, indexes, GRANT/REVOKE and migration SQL bodies that must still be evaluated under actual isolated PostgreSQL 17 replay. A filename/blob match does not attest that the SQL is safe or compatible.

## Implemented guard

1. `scripts/acceptance/mr5-reviewed-candidate-manifest.json` stores the **22 exact sorted filenames + their Git blob IDs** pinned at the reviewed PR #67 candidate commit.
2. `scripts/acceptance/mr5-verify-reviewed-migrations.mjs --verify` scans the repository's SQL migration directory **only**, requires the 26 preexisting version IDs to pass MR-5I14's exact ledger check, and requires exactly the 22 expected filenames in strict chronological order.
3. It calculates the Git blob ID from each current SQL file's raw bytes and compares all 22 with the manifest. Changed bytes, extra/omitted SQL files, renamed versions or mismatched hashes stop verification.
4. `test/operator/mr5-reviewed-migration-fingerprint.test.mjs` uses synthetic SQL only to exercise the happy path, Git blob calculation, source tampering, renamed/extra/missing SQL and unsafe filenames.
5. Internal CI invokes the tests **and the actual candidate-directory fingerprint check**. This must fail if a future change modifies one of the pinned migration files without a deliberate new source review and manifest update.

**Limitations:** Git SHA-1 blob IDs are useful Git source-object change detectors, **not** signed authenticity proofs or collision-resistant independent integrity credentials. This check intentionally does not pin baseline SQL bytes, read the hosted database, create backups, or prove runtime privileges, locks or migration replay. A malicious coordinated edit to the SQL and manifest could pass; Git review and required approvals must protect both files. It is not a SQL parser or formal threat model.

## Exact next gate

- **PR #67 merge remains HOLD.** No production deploy, hosted migration, live payment/provider enablement, customer messaging, pilot or legal compliance claim.
- Require independently secured backup and authorized isolated restore of the hosted engineering/test database **only after data classification and owner approval**. Do not export customer rows to CI or this chat.
- Then run all 22 SQL files in manifest order on the isolated, outbound-disabled rehearsal target, with security/tenant/isolation/idempotency/queue and recovery checks; record exact-head results and adjust the candidate only on a scoped branch.
- Until those separate gates pass, passing the fingerprint suite means only **REPOSITORY_SQL_FINGERPRINTS_MATCH_ONLY**.

No existing migration content is edited by MR-5I17.
