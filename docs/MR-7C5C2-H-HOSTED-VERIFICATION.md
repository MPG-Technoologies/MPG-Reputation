# MR-7C.5C2-H — Hosted Case A Migration & Verification

| Metadata | Value |
|---|---|
| Date | 2026-10-11 |
| Milestone | MR-7 — Trust / Security / Compliance |
| Slice | MR-7C.5C2-H — Hosted Case A Migration & Verification |
| Status | ENGINEERING COMPLETE / HOSTED DATABASE VERIFIED / READY FOR OWNER REVIEW |
| Product Baseline | `d7e58efee9c72eb379a461f51749f35d3954c75d` |
| Company OS Baseline | `b62a7fea72c30eb8e768511815816b4de1ed1a3e` |
| Feature Branch | `chatgpt/mr7c5c2h-hosted-verification` |
| Hosted Supabase | `awvqtwkzprygsoyfspuz` (`mpg-reputation`, engineering/test only) |
| Data Boundary | Seed/test/synthetic fixtures only; zero real customer data |
| Case B | Explicitly out of scope / not implemented |

## 1. Objective

Move the already owner-accepted MR-7C.5C2 Case A restore-delta replay database boundary from repository/local PostgreSQL evidence to the current hosted engineering/test Supabase environment.

No product implementation code was changed. The existing accepted migration was applied exactly once and verified against bounded synthetic fixtures.

## 2. Remote Baseline

Before hosted mutation:

- Product `main`: `d7e58efee9c72eb379a461f51749f35d3954c75d`.
- Company OS `main`: `b62a7fea72c30eb8e768511815816b4de1ed1a3e`.
- Repository migrations: 26.
- Hosted Supabase migrations: 25.
- Hosted latest migration: `20261010010000_privacy_trigger_function_hardening`.
- `public.replay_customer_erasure_maintenance(uuid,uuid,timestamptz)`: absent.
- `public.replay_suppression_maintenance(uuid,text,text,text,timestamptz)`: absent.

## 3. Migration Application

Applied repository migration:

`supabase/migrations/20261011120000_mr7c5c2_restore_delta_replay.sql`

The Supabase management migration operation initially recorded the migration with execution-time version `20261011152107` and name `mr7c5c2_restore_delta_replay`.

To preserve repository/remote migration identity, the migration-history record was immediately repaired to the canonical repository version:

`20261011120000_mr7c5c2_restore_delta_replay`

The schema was not reapplied during the history repair.

Final hosted migration state: **26 / 26 aligned**.

## 4. Hosted RPC Security Verification

Hosted definitions were inspected after migration.

Both functions are:

- `SECURITY DEFINER`;
- fixed `search_path=public, pg_temp`;
- denied to `PUBLIC`;
- denied to `anon`;
- denied to `authenticated`;
- executable by `service_role`.

Verified functions:

- `public.replay_customer_erasure_maintenance(uuid,uuid,timestamptz)`;
- `public.replay_suppression_maintenance(uuid,text,text,text,timestamptz)`.

No tenant/browser invocation surface was introduced.

## 5. Hosted Synthetic Case A Proof

A bounded hosted SQL verification unit created synthetic tenant/customer fixtures, exercised the accepted maintenance RPCs, asserted state invariants, and deleted all synthetic state before completion.

The unit fails atomically on any unmet assertion.

Verified:

1. **Pre-replay fail-closed state**
   - synthetic customer contained raw test PII;
   - erasure certificate absent;
   - required suppression absent;
   - C5C1-equivalent restored-state predicates evaluated as BLOCK.

2. **Valid customer erasure replay**
   - customer tombstoned to `[Deleted Customer]`;
   - `last_name`, `email`, `phone` became `NULL`;
   - completion `contact` became exact `{}`;
   - `source_customer_id` became `NULL`;
   - `source_transaction_id` became `NULL`;
   - `source_event_id` remained present;
   - `review_requests.error_message` scrubbed to `NULL`;
   - `message_events.sanitized_error` scrubbed to `NULL`;
   - erasure certificate preserved the supplied historical `erased_at`;
   - certificate `actor_type='maintenance'`.

3. **Valid suppression replay**
   - valid email suppression inserted;
   - supplied `reason` and historical `created_at` preserved.

4. **Post-replay restored-state gate**
   - all persisted-state predicates used by `verifyRestoredPrivacyState` for the synthetic delta were satisfied;
   - equivalent hosted restored-state decision was PASS.

5. **Idempotency**
   - exact repeated erasure replay returned `already_erased=true`;
   - exactly one erasure certificate remained;
   - repeated suppression replay returned `inserted=false`;
   - no duplicate suppression state was created.

6. **Conflict fail-closed**
   - replay with a contradictory erasure certificate timestamp failed with `ERASURE_CERTIFICATE_MISMATCH`;
   - original certificate timestamp remained unchanged.

7. **Tenant isolation**
   - replaying an Org A customer under Org B failed with `CUSTOMER_NOT_FOUND`.

8. **Malformed suppression fail-closed**
   - invalid channel rejected;
   - invalid SHA-256 hash rejected;
   - blank/whitespace reason rejected.

9. **Unreconciled restored state**
   - a synthetic unreconciled customer remained a BLOCK condition.

10. **True mid-transaction rollback**
    - a test-only trigger forced `privacy.restore_replay_erasure` audit insertion to fail after earlier mutation steps;
    - customer raw synthetic PII remained unchanged;
    - completion contact and external IDs remained unchanged;
    - review/message error fields remained unchanged;
    - no erasure certificate remained;
    - no replay audit event remained.

## 6. C5C1 Verifier Boundary

The hosted connector does not expose the application runtime/service credential boundary required to invoke the TypeScript `verifyRestoredPrivacyState` function directly against hosted Supabase.

Therefore this hosted slice verified the exact persisted-state predicates from `src/domain/privacy/restore-verification.ts` directly in PostgreSQL before and after replay:

- pre-replay: BLOCK-equivalent;
- post-replay: PASS-equivalent;
- unreconciled fixture: BLOCK-equivalent.

The application verifier implementation itself remains covered by the previously accepted 72 dedicated C5C1 tests and the accepted C5C2 end-to-end local PostgreSQL suite.

No claim is made that the TypeScript verifier function itself was re-executed through a hosted application runtime during this slice.

## 7. Cleanup Verification

After the hosted proof:

- synthetic organizations remaining with `mr7c5c2h-%` slug: **0**;
- test-only failure trigger remaining: **false**;
- test-only failure function remaining: **false**.

No real customer data was used.

## 8. Supabase Advisor Review

Security Advisor after migration produced no new C5C2-H-specific finding.

Existing advisor set remains:

- 7 `RLS Enabled No Policy` INFO findings on intentionally server-owned tables; previously reconciled with zero anon/authenticated DML privileges;
- 5 authenticated `SECURITY DEFINER` WARN findings on existing onboarding/Quick Complete/RLS-helper functions; previously inspected and no demonstrated authorization bypass found in the MR-7 closeout audit;
- leaked-password protection disabled; current project is Free and Supabase documents this feature as Pro+.

The two new C5C2 replay RPCs do **not** appear in the authenticated-security-definer warning set because authenticated execution is revoked.

Performance Advisor was also reviewed after DDL. Its findings are existing performance optimization items (unindexed foreign keys, RLS init-plan optimization, unused-index observations) and are not introduced by C5C2-H. No out-of-scope index or RLS-policy changes were made.

## 9. Scope Integrity

Not changed or activated:

- Case B architecture;
- application implementation code;
- RLS/authentication/authorization/tenant-isolation policy;
- real customer data;
- live messaging;
- live billing;
- retention scheduling;
- MR-8 pilot;
- public launch;
- commercial activation.

## 10. Result

**MR-7C.5C2-H: ENGINEERING COMPLETE / HOSTED DATABASE VERIFIED / READY FOR OWNER REVIEW.**

Case A replay database support is now present and verified on the current hosted engineering/test Supabase environment.

MR-7 remains **ACTIVE / IN PROGRESS**.

Case B remains **UNRESOLVED / OUT OF SCOPE**.
