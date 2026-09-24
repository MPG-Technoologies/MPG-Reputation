# MR-6 — Admin / Support / Observability: Execution Handoff

| Metadata | Value |
|---|---|
| Date | 2026-09-22 |
| Authority | Company OS `MPG-DEC-049` — ACCEPTED |
| Milestone | ACTIVE NEXT under the accepted sequencing exception |
| Handoff status | PREPARED; architecture below is RECOMMENDED; no MR-6 feature implemented in this reconciliation |
| Inspected product baseline | `d654656b59810877502d2e737dd236ae83b9c379` |
| Company stage | Stage 1; Stage 2 and later stages NOT ACTIVATED |
| Public safe | Yes; synthetic evidence only |

## 1. Current operational/admin capability inventory

This inventory is based on repository code and migrations, the passing local regression, and the production build route inventory. It does not establish hosted operational readiness.

| Capability | Existing evidence | Practical limit |
|---|---|---|
| Tenant authentication and role checks | `src/lib/supabase/server.ts`; initial schema `organization_users`, `user_has_role`; roles OWNER, ADMIN, OPERATOR, VIEWER | No MPG_ADMIN role or support-grant model. Membership has no active/revoked status column; current authorization is row presence plus role. Removing membership revokes that tenant relationship. |
| Organization/location and destination inspection | `/app/settings/location`, `/app/settings/review-destination`; `src/actions/locations.ts`, `src/actions/destinations.ts`; activation domain | Business-facing, tenant-scoped setup/recovery, not an internal support surface or global organization search. |
| Operational dashboard | `src/actions/dashboard.ts`; `/app/dashboard`; system-status, needs-attention and live-activity components | Setup readiness, request failures, outbox FAILED count, trial/eligibility and realtime signals exist. This is not a full platform/provider health check. Its customer activity projection includes contact data and tokens and must not be reused wholesale for support. |
| Completion integration troubleshooting | `/app/settings/integrations`; `src/actions/completion-credentials.ts`; `completion_ingestion_requests` | Membership-checked credential list/create/revoke and latest ingestion logs. System tables use server-side access; existing list functions can return empty arrays on query failure, so do not treat their output as proof of healthy ingestion. |
| Workflow recovery | `src/domain/outbox/dispatcher.ts`; `src/inngest/functions/outbox-recovery.ts` | Scheduled recovery scans PENDING records every five minutes, bounded batch 50 and concurrency 1. Dispatch errors increment attempts and remain PENDING, whereas the dashboard outbox error count queries FAILED. No general retry/support UI exists. |
| Email provider event processing | `/api/webhooks/resend`; `message_events.processed_at`; review-request transitions, suppression and reminder domains | Signed events, deduplication, processing completion and sanitized error fields exist. No unified deliverability telemetry/alerting or durable operator queue for every rejected/unmatched webhook is established. |
| Trial, usage and economics | `/app/settings/usage`; `src/actions/usage.ts`; entitlement domain, usage ledger and cost foundations | Tenant-scoped factual counters and trial actions exist; no paid-billing operation or full internal cost/support console. |
| Billing visibility foundation | `organization_billing_accounts`, `organization_subscriptions`, `billing_webhook_events`; Stripe intake and truth resolver | MR-5 paused; intake can return success for RECEIVED/unprocessed claims. Resolver is separate from intake. No processor, subscription projection or recovery completion is implied; unresolved events may have no organization. |
| Audit | `audit_events`; credential, trial and workflow audit writes | Existing reusable structure, not comprehensive support auditing. Credential auditing is best-effort; a support read must explicitly check persistence failure if audit is part of its access contract. |
| Support entry and monitoring | Support control in `src/components/ui/app-shell.tsx`; application/provider console logs | Support control is a placeholder alert, not a staffed channel, ticket system or SLA. No internal admin routes or dedicated monitoring integration found. |

## 2. Gaps against the MR-6 roadmap

| MR-6 requirement | Remaining gap | Proposed order |
|---|---|---|
| Internal MPG_ADMIN access | Explicit, revocable staff authorization distinct from business OWNER/ADMIN; tenant membership remains required | MR-6A |
| Organization/location inspection | Minimal internal read surface and explicit target authorization | MR-6A; broader search later |
| Admin/support auditability | Durable audit of authorized inspections, then atomic audit for later interventions | MR-6A foundation; mutations later |
| Failed webhook/stuck workflow queue | Source-specific states, sanitized correlation, bounded history, age/attempt signals and truthful unavailable states | Later MR-6 slice |
| Deliverability telemetry | Defined windows/denominators, provider acceptance versus delivery, bounce/complaint rates, missing data and alert thresholds | Later MR-6 slice |
| Troubleshooting without routine SQL | Inspection first; later guided recovery using existing domain gates and idempotency | Later MR-6 slices; milestone exit remains unmet |
| Overall operational health | Freshness, unavailable data, dependency/configuration status and action ownership | Later MR-6 slice; no readiness claims from absent errors |

## 3. Proposed MR-6 architecture

Use a small internal `/admin` route family, separate from business navigation. Every protected data loader must enforce server-verified identity, explicit support grant for the selected organization, and current `organization_users` membership. Business OWNER/ADMIN alone never implies MPG_ADMIN. No authorization comes from editable user metadata, request-supplied actor IDs or provider metadata.

For MR-6A, introduce `support_access_grants`: one row per `(organization_id, user_id)`, support role constrained to `MPG_ADMIN`, creation timestamp, mandatory expiry and nullable revocation timestamp. Use a composite foreign key to the existing unique organization membership pair, deleting the grant if membership is removed. Enable RLS; authenticated users may SELECT only their own unexpired, unrevoked grants with existing membership. Deny all anonymous access and all authenticated grant INSERT/UPDATE/DELETE. Grant provisioning/revocation is a trusted, controlled administrative operation, outside this feature's UI; do not add automatic membership creation, seed a real grant, or allow organization owners to designate themselves MPG staff. Use only synthetic fixtures in initial acceptance.

Read organization, location and destination status through the existing authenticated Supabase client and existing RLS. Explicit organization predicates remain required. Use an allowlisted support DTO; never call the existing customer-rich dashboard projection. Reuse `audit_events` through a narrow server-only audit writer after access checks. Its only privileged operation is inserting a fixed inspection event with server-derived actor and organization, target entity ID, timestamp and minimal structured metadata. Fail closed if audit persistence fails; never return the inspected snapshot without audit evidence. Record unavailable-data outcomes distinctly. No arbitrary audit metadata, customer payload or free-text support notes.

Future exception views can compose bounded read adapters over existing event stores. Do not introduce a generalized admin backend, new vendor, global service-role browser, or duplicate exception persistence before a concrete recovery lifecycle requires it. Billing processing stays paused; future visibility may report existing billing states but must not mutate, project or retry billing. Events with unknown tenant correlation must never appear in another tenant's queue.

Security reference: [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security), consulted 2026-09-22, distinguishes table grants from row policies and warns that service-role access bypasses RLS. Recheck current Supabase guidance and the installed Next.js guides before implementation; no database or framework APIs are changed by this handoff.

## 4. Smallest safe first implementation slice — MR-6A

Deliver one **audited, read-only organization/location inspection page** for an explicitly authorized internal operator targeting one known organization ID. Display organization ID/name/status, a bounded location list (ID/name/status), destination confirmation status and snapshot timestamp. Limit the first page to 50 locations with an explicit truncation notice; do not imply omitted locations are absent. Display unavailable/query-error states distinctly from an empty result. No customer records, contact fields, full destination URLs, review tokens, provider payloads, credential hashes, billing objects or raw errors are returned.

The page authorizes its target through a shared server loader before querying tenant data. Validate route IDs, enforce no shared caching or prefetch-driven audit claims, and recheck access on each explicit inspection/refresh. Return a generic denial for unauthorized and unknown organizations without leaking their existence. Initial synthetic acceptance covers a known target; global search, organization switching and routine support mutation remain deferred. A backend gate is mandatory even if navigation hides the route.

This slice proves one read-only support workflow without routine SQL for inspection. It does not meet the entire MR-6 exit requirement for support intervention/recovery. One-time trusted grant provisioning is separate from day-to-day troubleshooting and must have an auditable operational process before real support use.

## 5. Expected files, tables and routes

These are planned changes for a subsequent implementation task, not changes made by this reconciliation.

| Exact application/document/test path | Expected change |
|---|---|
| `src/lib/support/access.ts` | Server-only identity, target validation, grant, expiry/revocation and membership checks |
| `src/lib/support/organization-inspection.ts` | Bounded authenticated reads, allowlisted DTO and explicit unavailable states |
| `src/lib/support/audit.ts` | Fixed server-authored inspection audit insertion; fail closed on persistence error |
| `src/app/admin/layout.tsx` | Minimal internal shell, no public/business navigation entry or global data loader |
| `src/app/admin/organizations/[organizationId]/page.tsx` | Read-only inspection route; target access enforced by loader |
| `src/types/database.ts` | Generated types for the support-grant table |
| `test/integration/support-access.test.ts` | Real database grants/RLS and route-loader access denial matrix |
| `test/integration/support-organization-inspection.test.ts` | Projection, boundedness, audit and unavailable-state acceptance |
| `docs/MR-6-EXECUTION-HANDOFF.md` | Append actual slice evidence and remaining gaps |

One new migration under `supabase/migrations/` with suffix `_mr6_support_access.sql` is expected. Allocate its exact timestamped filename through the installed Supabase CLI when implementation starts; do not create or pretend to know a generated migration filename in this preparation. Its scope is only `public.support_access_grants`, its indexes, composite membership constraint, explicit grants and RLS policies. No existing tenant-table RLS broadening, new database views, privileged SQL RPC, or role-enum replacement is planned.

Existing tables read: `organization_users`, `organizations`, `locations`, `review_destinations`. Existing table written: `audit_events` only, with fixed inspection events. New table: `support_access_grants`. Only new page route: `GET /admin/organizations/[organizationId]`; no billing, recovery, public API or mutation route. `.gitignore` and billing implementation files stay outside this slice.

## 6. Security and tenant-isolation risks

- A service-role client bypasses RLS. Restrict it to the fixed audit insertion; use authenticated RLS reads for tenant data. Never reuse a generic privileged dashboard query or accept a client-provided actor.
- Existing membership permits broader business Data API reads, including customer data. A new support grant does not reduce those permissions. MR-6A must reuse an already authorized member, never auto-enroll staff; a future least-privilege support membership/data-access design is required before broad real support provisioning. UI field minimization is not a claim of database column isolation.
- There is no current membership-active flag. Check present membership and a current grant on every request; revoke by membership removal or grant revocation/expiry. Do not invent a nonexistent database field or cache a stale grant.
- New grant policies must prevent self-elevation, cross-tenant grants and grant reuse after membership removal/recreation. Test direct Data API access as well as server routes. Keep all exposed-table RLS enabled.
- Audit insertion can fail, and existing audit patterns are not a guaranteed delivery contract. Check database errors explicitly and withhold the snapshot on audit failure. General inspection logs are not yet a comprehensive incident/audit-retention system.
- Raw operational error strings, payloads, nonces, tokens, cost details and customer contacts may be sensitive. New DTOs must select only required fields; raw outbox errors are truncated strings, not proven safe redactions.
- Missing telemetry is not health. Existing dashboard FAILED counts do not capture all retrying PENDING outbox records; treat that as a later MR-6 observability gap. Intake success is not processing success for paused billing.
- Local regressions and a build do not prove deployed access controls, hosted email-domain readiness, billing acceptance or real-customer operational readiness.

## 7. Required tests

1. Authenticated internal member with a valid target grant succeeds; logged-out, ordinary OWNER/ADMIN/OPERATOR/VIEWER without support grant, foreign tenant, expired/revoked grant and grant without membership fail closed. Editable metadata cannot elevate access.
2. Direct database tests verify RLS enabled; anonymous access denied; users cannot list another user's grants or create/update/delete grants, including self-grant attempts. Composite membership deletion removes the grant; recreating membership does not restore it.
3. Test tampered and invalid organization/location IDs, membership/grant removal between requests, database errors and any caching behavior. Different tenants never share a snapshot.
4. Assert response DTO fields exactly; no customer table reads, contacts, provider secrets, raw errors, tokens, full destination URLs or private costs. More than 50 locations produces an explicit bounded result.
5. Verify audit actor/organization derive from verified access, a successful view records the inspection, audit failure returns no snapshot, and tenant records/entitlements/outbox state remain unchanged. Audit error handling must test returned database errors, not only thrown exceptions.
6. Synthetic browser walkthrough of permitted inspection, denied direct navigation, refresh and unavailable states; no reliance on hidden navigation for authorization.
7. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `git diff --check`; apply and verify the new migration only in the local synthetic database and include real RLS negative tests. Confirm `.gitignore` untouched and review exact staged scope.

## 8. First-slice exit criteria

MR-6A is locally complete only when all proposed grant/tenant boundaries and database denial tests pass; the one-organization read workflow is usable without inspection SQL; DTO minimization and durable audit success/failure are verified; the production build succeeds; no live messaging/billing flags or existing billing behavior change; and a clean atomic commit records the evidence. No real grants or hosted rollout are implied. MR-6 remains incomplete until the broader roadmap's secure troubleshooting, telemetry, exception and intervention exit evidence is met.

## 9. Intentionally deferred backlog

| Item | State / dependency |
|---|---|
| MR-5C remainder | PAUSED: processor wiring, subscription projection, ordering and recovery; provider/account dependency |
| MR-5D | DEFERRED / PAUSED: Checkout + Customer Portal |
| MR-5E | DEFERRED / PAUSED: Controlled entitlement synchronization |
| MR-5F | DEFERRED / PAUSED: Hosted billing-provider test-mode acceptance |
| Billing-provider/account decision/setup | Unresolved eligibility, verification and setup; research may continue separately; no automatic Stripe replacement |
| Later MR-6 exception queue | PENDING retries/age, incomplete message processing, sanitized ingestion errors and operational guidance |
| Later MR-6 intervention and telemetry | Audited idempotent recovery, support grant lifecycle tooling, meaningful deliverability windows, alert thresholds and operational health |
| Advanced support complexity | Global tenant search, impersonation, bulk replay, ticketing, SLA commitments, new monitoring vendors, unrestricted admin access and cross-tenant data aggregation excluded from MR-6A |
| MR-7 and later | Trust/compliance/retention work remains after MR-6; no implementation now. MR-8 remains gated pending deliberate reconciliation of all prerequisites, including MR-5 and MR-1B-H. Website/marketing remain out of scope. |

Company OS `docs/19-backlog.md` owns program-level backlog status; this handoff owns the bounded engineering proposal and later slice evidence. No final pricing, payment/refund/discount/grace policy, charging, live customer messaging, pilot, lifecycle ACTIVE, marketing, launch or later Company Stage authorization follows.

## 10. Recommended NEXT ACTION

Implement **MR-6A: the audited, read-only organization/location inspection page with explicit expiring support grants plus existing tenant membership**, using the bounded file/table/route scope and acceptance tests above, after both repositories' pause/status reconciliation is clean.

## 11. MR-6A local implementation evidence

**Implementation status:** IMPLEMENTED AND VERIFIED LOCALLY on 2026-09-22. This does not close MR-6 and does not authorize hosted support rollout, real support grants, public launch, live billing, live customer messaging, pilot operation, lifecycle ACTIVE, marketing, or Company Stage 2+.

### Implemented scope

- Added `public.support_access_grants` with `MPG_ADMIN`, expiry, revocation, unique organization/user identity, composite membership foreign key, cascade-on-membership-delete, RLS, authenticated read-only access, and service-role administration.
- Added server-only support authorization requiring both current `organization_users` membership and a current explicit `MPG_ADMIN` support grant.
- Added bounded organization inspection using authenticated tenant-scoped RLS reads only.
- Added a fixed server-authored support inspection audit event. The service-role client is restricted to the audit insert path.
- Added `/admin/organizations/[organizationId]` as a dynamic, read-only internal inspection route with no business navigation entry, no mutation controls, no search, no impersonation, no billing operation and no support-grant management UI.
- Added allowlisted organization/location/destination-state DTOs with 50-location bounded results and truthful truncation.
- Added real PostgreSQL/RLS integration coverage for grant boundaries, tenant isolation, self-elevation denial, membership deletion, expiry/revocation, audit behavior, unavailable states and data minimization.
- Updated generated database types for `support_access_grants`.

### Local migration evidence

Migration:

`supabase/migrations/20260922071808_mr6_support_access.sql`

Local Supabase migration history confirms `20260922071808` is applied to the local synthetic database. No hosted migration push, migration repair, or hosted migration-history modification was performed as part of this slice.

### Authorization evidence

Synthetic local browser acceptance used:

- organization: `MPG Synthetic Support Org`
- organization ID: `60000000-0000-4000-8000-000000000001`
- normal tenant role: `VIEWER`
- support role: `MPG_ADMIN`
- grant state: current, unrevoked and expiring
- location: `Synthetic HQ`

The authorized browser route loaded successfully and displayed only the bounded organization/location inspection surface. This demonstrates that business `VIEWER` membership alone is not the support authority; the separate `MPG_ADMIN` grant is required.

### Targeted security acceptance

`test/integration/support-access.test.ts`

- 24 / 24 tests passed.
- Valid member + grant succeeds.
- OWNER, ADMIN, OPERATOR and VIEWER without support grant are denied.
- Foreign-tenant, expired, revoked and missing-membership access is denied.
- Editable user metadata cannot elevate to MPG support access.
- Anonymous access and authenticated self-grant INSERT/UPDATE/DELETE are denied.
- Grant reads remain user-scoped.
- Membership deletion cascades the support grant.
- Recreated membership does not restore deleted support authorization.
- Invalid/tampered target IDs fail closed.
- Database lookup failures fail closed.

`test/integration/support-organization-inspection.test.ts`

- 20 / 20 tests passed.
- DTO fields are allowlisted and exclude customer/contact/token/URL/billing/cost/private payload data.
- Reads use authenticated tenant-scoped GETs with explicit target predicates.
- Results are capped at 50 locations with truthful truncation.
- Empty results remain distinct from database/query failure.
- Foreign and nonexistent organizations are denied generically.
- Audit actor and organization derive from verified access.
- Audit failure withholds the snapshot.
- Inspection does not mutate organization, location, destination, entitlement or outbox state.
- Authorization is rechecked after membership/grant removal and before audit.

### Full local regression evidence

On 2026-09-22:

- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — PASS: 53 test files, 635 tests
- `npx supabase db lint --local` — PASS: no schema errors
- `pnpm build` — PASS
- production route manifest contains dynamic `/admin/organizations/[organizationId]`
- `git diff --check` — PASS
- `.gitignore` — untouched

The Vitest/Vite native-config-loader message remains a future-compatibility warning and did not fail validation.

### Browser acceptance limitation

The permitted synthetic inspection path was manually walked in the browser and refreshed successfully. Denied, query-unavailable and audit-failure states are covered by the real integration suites; those failure states were not all manually induced in the browser because doing so would require deliberately altering otherwise-correct local infrastructure or introducing test-only runtime hooks.

### Remaining MR-6 work

MR-6A establishes the secure read-only support foundation only. MR-6 remains incomplete.

Next bounded slice:

**MR-6B — operational exception queue**

Initial focus should be truthful, bounded visibility into operational exceptions such as retrying/stuck outbox work and incomplete processing, with sanitized data, explicit age/attempt signals, tenant isolation, unavailable-state handling and no recovery mutation yet.

Later MR-6 slices remain responsible for deliverability/health telemetry, controlled audited recovery/support actions, final admin-workspace UX refinement and milestone-level acceptance.

## 12. MR-6B local implementation evidence

**Implementation status:** IMPLEMENTED AND VERIFIED LOCALLY on 2026-09-22. This does not close MR-6 and does not authorize hosted support rollout, public launch, live billing, live customer messaging, pilot operation, lifecycle ACTIVE, marketing, or Company Stage 2+.

### Implemented scope

- Added a read-only operational exception queue for an explicitly authorized organization.
- Added bounded visibility for retrying, stale and failed outbox work; incomplete persisted provider webhook processing; and failed review requests.
- Kept support reads organization-scoped and rechecked support authorization before audit and return.
- Added mandatory fixed support audit event `support.exception_queue_inspection`; queue data is withheld when audit persistence fails.
- Added minimized support DTOs that exclude customer names, email addresses, phone numbers, review tokens, destination URLs, provider message IDs, payloads, raw operational errors and private provider metadata.
- Limited each source category to 20 visible records plus truthful truncation detection.
- Kept MR-6B inspection read-only. No retry, replay, provider mutation, billing mutation, entitlement mutation or arbitrary support action was added.
- Added `/admin/organizations/[organizationId]/exceptions` and reciprocal navigation from the existing organization inspection page.
- No hosted database, hosted support grant, live provider configuration or billing configuration was changed.

### Operational classification

- Outbox `FAILED` records are surfaced as failed work.
- Outbox `PENDING` records with `attempt_count > 0` are surfaced as retrying work.
- Untouched outbox `PENDING` records older than 10 minutes are surfaced as stale work.
- Persisted provider message events with `processed_at IS NULL` older than 5 minutes are surfaced as incomplete processing.
- Review requests in `FAILED` status are surfaced as failed requests.
- Missing or failed source reads return `UNAVAILABLE`; absence of readable data is never reported as proof of health.

### Local acceptance evidence

- MR-6B targeted integration suite: 14/14 passed.
- Synthetic browser acceptance showed three safe operational exceptions: one outbox exception, one incomplete provider-processing exception and one failed review request, with sensitive fixture fields absent from the rendered support view.
- The existing eligibility query-error suite passed 33/33 in three consecutive isolated runs.
- The first default-concurrency full regression produced one failure in that pre-existing eligibility suite under 54-worker local load; MR-6B itself passed 14/14 in that run.
- The complete controlled regression then passed 54/54 test files and 649/649 tests with `--maxWorkers=4`.
- `next typegen` passed.
- `pnpm lint` passed.
- `pnpm typecheck` passed.
- Local Supabase schema lint passed with no schema errors.
- `pnpm build` passed and included both dynamic internal admin routes.
- `git diff --check` passed.
- `.gitignore` remained untouched.

### Remaining MR-6 work

MR-6B does not provide platform health telemetry or recovery mutations. The next slice is **MR-6C — health and deliverability observability**, followed by **MR-6D — bounded audited support/recovery actions**.

## 13. MR-6C local implementation evidence

**Implementation status:** IMPLEMENTED AND VERIFIED LOCALLY on 2026-09-22. This does not close MR-6 and does not authorize hosted support rollout, live customer messaging, live billing, pilot operation, lifecycle ACTIVE, marketing, public launch, or Company Stage 2+.

### Implemented scope

- Added a read-only, organization-scoped operational health snapshot for explicitly authorized MPG support operators.
- Reused the existing MR-6 support boundary requiring both current tenant membership and a current explicit `MPG_ADMIN` support grant.
- Added fixed mandatory audit event `support.health_snapshot_inspection`; health data is withheld when audit persistence fails.
- Reauthorized support access after telemetry reads and before audit/return.
- Added truthful 24-hour and 7-day stored messaging telemetry for send records and persisted Resend lifecycle events including delivered, delayed, bounced, complained, failed and suppressed outcomes.
- Added incomplete persisted provider-webhook counts using the existing `processed_at IS NULL` observation contract.
- Added organization-scoped outbox counts for untouched pending, retrying, stale untouched, dispatched and failed work plus oldest pending age.
- Added safe messaging-configuration state reporting without returning API keys, webhook secrets, sender values or other secret material.
- Added `/admin/organizations/[organizationId]/health` as a dynamic read-only internal route and reciprocal navigation between organization inspection, operational exceptions and operational health.
- No recovery, retry, replay, provider mutation, entitlement mutation, billing mutation or arbitrary support action was added.
- No database schema change was required.

### Truthfulness constraints

- Missing or failed required telemetry returns `UNAVAILABLE`; absence of readable data is never presented as proof of health.
- Deliverability percentages are intentionally reported as `UNKNOWN` with reason `COHORT_SAFE_DENOMINATOR_NOT_CALCULATED`.
- MR-6C does not divide raw lifecycle-event counts into a deliverability percentage because multiple provider lifecycle events can exist for one provider message.
- Messaging configuration reports only safe presence/state booleans and provider intent; secret values and sender addresses are not returned.
- Health telemetry does not read customer identity, completion payload, review token or raw outbox-error content.

### Local acceptance evidence

- MR-6C targeted integration suite passed 13/13 tests.
- Integration coverage verified factual 24-hour and 7-day telemetry, organization isolation, minimized data, safe configuration-state reporting, `UNKNOWN` deliverability ratios, required-source failure behavior, audit returned-error behavior, audit thrown-error behavior, post-read authorization recheck and read-only operation.
- Initial browser access correctly failed closed when the synthetic support grant had expired.
- The local synthetic grant was refreshed for browser acceptance only; no hosted grant or hosted database was changed.
- Browser acceptance then passed for the synthetic support organization with messaging mode `CONSOLE`, live email disabled, safe configuration presence reporting, outbox telemetry, 24-hour and 7-day telemetry, one stored synthetic bounce, one incomplete persisted webhook and an explicit `UNKNOWN` deliverability ratio.
- Reciprocal navigation between organization inspection, operational exceptions and operational health was verified in the browser.
- Sensitive customer data, tokens, raw payloads, raw operational errors, API keys, webhook secrets and sender values were not displayed in the accepted support views.
- Controlled complete regression passed 55/55 test files and 662/662 tests with `--maxWorkers=4`.
- Expected simulated provider and immediate Inngest dispatch failures remained inside passing recovery/failure-path tests.
- `next typegen` passed.
- `pnpm lint` passed.
- `pnpm typecheck` passed.
- Local Supabase schema lint passed with no schema errors.
- `pnpm build` passed and included all three dynamic internal organization support routes: inspection, exceptions and health.
- `git diff --check` passed.
- `.gitignore` remained untouched.
- No hosted application, database, support grant, billing configuration or live-email configuration was changed by MR-6C acceptance.

### Remaining MR-6 work

MR-6C provides truthful read-only operational observability but does not provide support intervention. The next engineering slice is **MR-6D — bounded, explicitly allowlisted and audited support/recovery actions**.

After MR-6D is implemented and stabilized, the functional internal admin workspace is ready for the separately controlled admin UI refinement stage. Visual refinement must not weaken authorization, audit, tenant isolation, minimized data contracts, read-only telemetry semantics or recovery-action safety.

## 14. MR-6D local implementation evidence

**Implementation status:** IMPLEMENTED AND VERIFIED LOCALLY on 2026-09-22. This does not close MR-6 and does not authorize hosted support rollout, live customer messaging, live billing, pilot operation, lifecycle ACTIVE, marketing, public launch, or Company Stage 2+.

### Implemented scope

- Added one bounded support recovery action for an explicitly targeted eligible `PENDING` `customer.completed` outbox event.
- Recovery is limited to `customer.completed` records with aggregate type `customer_completion_event`.
- A record is eligible only while `PENDING` and either already retried (`attempt_count > 0`) or old enough to qualify as stale under the existing operational queue threshold.
- Added exact outbox-ID targeting to the existing dispatcher while preserving its existing organization and `PENDING` constraints.
- Added mandatory `support.outbox_retry` REQUEST audit persistence before mutation.
- Added mandatory RESULT audit persistence after mutation with fixed allowlisted outcomes and no raw provider error, payload, customer contact, token or free-text support notes.
- Authorization is rechecked after inspection/request audit and immediately before mutation. The target record is reread before dispatch so a changed or no-longer-eligible record is not intentionally retried by the support action.
- The result contract distinguishes `DISPATCHED`, `RETRY_FAILED`, `NO_LONGER_ELIGIBLE`, `OUTCOME_UNKNOWN`, `OUTCOME_UNAVAILABLE`, authorization denial and unavailable/precondition states.
- If mutation may have occurred but the mandatory result audit cannot be persisted, the action returns `OUTCOME_UNAVAILABLE` rather than claiming a successful audited result.
- Added a server action requiring explicit confirmation before invoking the bounded recovery operation.
- Added the recovery control only to eligible RETRYING or STALE `customer.completed` exception rows. FAILED outbox records and non-allowlisted exception categories remain non-actionable.
- No webhook replay, FAILED-state reset, bulk outbox recovery, review-request resend, billing mutation, arbitrary event replay or generalized support mutation was added.

### Browser acceptance

Synthetic browser acceptance was completed against the local environment.

The selected RETRYING target was manually recovered through the MR-6D support control and changed from `PENDING` with `attempt_count = 2` to `DISPATCHED` with `attempt_count = 3`.

The manual action persisted exactly two `support.outbox_retry` audit records for the target:

- REQUEST / REQUESTED
- RESULT / DISPATCHED

Both audit records carried the same server-generated action ID.

A separate STALE sibling received no `support.outbox_retry` audit from the manual action. It remained visible immediately after the targeted browser recovery and was subsequently dispatched by the pre-existing five-minute automatic outbox recovery job. Inngest logs showed the scheduled timer and sibling dispatch at the later recovery boundary.

The FAILED control record remained FAILED and was not made recoverable by MR-6D.

This acceptance also confirmed that the existing automatic recovery worker can race with synthetic PENDING browser fixtures. MR-6D therefore relies on its exact-target eligibility recheck and truthful changed/outcome states rather than assuming a PENDING fixture remains stationary while an operator is viewing the queue.

### Automated recovery safety coverage

`test/integration/support-recovery.test.ts` adds seven real local-database integration scenarios covering:

1. exact eligible target dispatch while leaving another eligible pending event untouched by the support action;
2. invalid, foreign, fresh and FAILED target rejection without dispatch;
3. fail-closed behavior when the support grant is absent;
4. mandatory REQUEST audit persistence before mutation;
5. authorization recheck before mutation;
6. dispatch failure returning `RETRY_FAILED` without leaking provider error detail; and
7. successful dispatch with failed mandatory RESULT audit returning `OUTCOME_UNAVAILABLE`.

The existing automatic outbox recovery integration test continued to pass.

### Local acceptance and engineering gates

MR-6D passed the following final local gates:

- targeted recovery safety tests passed;
- browser recovery acceptance passed;
- corrected controlled full regression passed: **56 test files, 669 tests**;
- `next typegen` passed;
- `pnpm lint` passed;
- `pnpm typecheck` passed;
- local Supabase schema lint passed with no schema errors;
- `pnpm build` passed and included the internal inspection, exception and health routes;
- `git diff --check` passed;
- `.gitignore` remained untouched.

An earlier full-regression attempt produced four `ECONNREFUSED 127.0.0.1:3000` failures after the acceptance harness had stopped the Next.js development server. Those tests explicitly depend on the live local HTTP server. The server was restored and both affected suites passed before the complete 56-file / 669-test regression was rerun successfully.

No Inngest dev server was required for the final full regression. Expected immediate Inngest dispatch failures in tests continued to fall back to the existing durable outbox behavior.

### Synthetic acceptance cleanup

MR-6D used fixed synthetic IDs for browser acceptance. During cleanup, one proposed completion-event ID was found to collide with a pre-existing MR-6B synthetic fixture:

- source: `mr6b_browser_fixture`
- source event: `mr6b-browser-failure-v1`
- associated FAILED review request remained part of the MR-6B exception-queue fixture.

Cleanup therefore failed closed instead of deleting the collided record.

A targeted cleanup subsequently:

- preserved the MR-6B completion fixture;
- preserved the MR-6B FAILED review-request fixture;
- removed eight MR-6D workflow audit artifacts;
- removed two MR-6D `support.outbox_retry` audit artifacts;
- removed two MR-6D usage rows and any directly linked cost rows;
- removed the three MR-6D outbox fixture rows or verified they were already absent; and
- left the source worktree unchanged.

Future synthetic browser fixtures should use slice-specific non-overlapping ID namespaces rather than reusing fixed IDs across MR-6 slices.

### Security and operational limits

MR-6D does not create a generalized administrative mutation backend. It does not permit arbitrary replay, payload editing, provider-webhook reconstruction, FAILED-state rewriting, tenant bypass, impersonation, billing recovery or bulk actions.

The support action continues to require the existing MR-6A access contract: authenticated identity, current tenant membership and an explicit current `MPG_ADMIN` grant.

The recovery audit contains only fixed server-authored metadata required to correlate one action. Provider errors and customer payloads are not exposed through the support result.

Automatic scheduled outbox recovery remains active product behavior and may independently process eligible PENDING records. The support action is an additional narrowly targeted operational recovery path, not a replacement for the automatic worker.

### Remaining MR-6 work

The functional MR-6A through MR-6D internal admin/support workspace is now ready for the separately controlled **admin UI refinement stage**.

That refinement may improve layout, hierarchy, navigation, status presentation, tables, responsive behavior, accessibility and operator usability, but must not weaken or redesign:

- support authorization;
- tenant isolation;
- audit requirements;
- minimized support DTOs;
- health/exception truth semantics;
- recovery eligibility;
- exact-target dispatch;
- confirmation requirements; or
- recovery result handling.

After UI refinement is validated, **MR-6E — final acceptance, regression, durable documentation and owner review** remains before MR-6 can be considered complete.

MR-5 remains paused under the accepted provider/account dependency and is not resumed by MR-6D.

## 15. Admin UI refinement evidence

**Implementation status:** IMPLEMENTED, REVIEWED AND SYNCHRONIZED on 2026-09-24 at commit `e83ce38d22cb7e94825c8737ae38c7d592714e76` (`refactor(admin): refine internal operations UI`).

The refinement was presentation and operator-usability work only. It did not intentionally redesign or weaken the MR-6 authorization, tenant-isolation, audit, minimized DTO, telemetry-truth or bounded-recovery contracts.

### Refined scope

The accepted UI refinement changed exactly six application files:

- `src/app/admin/layout.tsx`
- `src/app/admin/organizations/[organizationId]/page.tsx`
- `src/app/admin/organizations/[organizationId]/health/page.tsx`
- `src/app/admin/organizations/[organizationId]/exceptions/page.tsx`
- `src/components/admin/admin-ui.tsx`
- `src/components/admin/admin-ui.module.css`

The refinement added a consistent internal operations shell, organization context, Inspection / Health / Exceptions navigation, reusable presentational primitives, clearer status presentation, compact operational tables, responsive behavior, accessibility improvements and restrained internal-operations styling.

No support authorization implementation, support-grant logic, recovery action implementation, audit persistence contract, dispatcher behavior, database migration, billing behavior, email/provider behavior, webhook behavior or tenant boundary was intentionally changed by the refinement.

### Recovery and truth-contract preservation

The exceptions view preserved the MR-6D bounded recovery contract:

- only RETRYING or STALE `customer.completed` records with aggregate type `customer_completion_event` are eligible;
- the action remains bound to the selected organization and exact outbox event ID;
- explicit confirmation remains required with `confirmation=retry`;
- the visible confirmation remains `Confirm one bounded retry`;
- the action remains `Retry pending event`;
- non-eligible records remain non-actionable;
- no webhook replay, FAILED reset, bulk recovery, review-request resend, billing mutation or generalized support mutation was introduced.

The health view continues to treat missing telemetry as unknown/unavailable rather than healthy and does not invent a deliverability percentage without a cohort-safe denominator.

### UI validation

The refinement was reviewed against the MR-6D checkpoint and browser-checked across desktop and mobile layouts.

Validation included:

- organization inspection;
- operational health;
- operational exceptions;
- reciprocal navigation;
- bounded recovery controls;
- recovery-result notices;
- empty states;
- denied and unavailable states;
- responsive layouts;
- semantic tables/headings;
- visible keyboard focus;
- accessible labels and interaction targets.

The six-file refinement was committed cleanly and synchronized to both the company mirror and isolated Vercel staging source at the same commit SHA.

## 16. MR-6E final acceptance evidence

**Engineering status:** FINAL LOCAL ENGINEERING VALIDATION PASSED on 2026-09-24.

**Owner status:** REVIEW PENDING. This evidence does not by itself mark MR-6 ACCEPTED, activate MR-7, authorize real support operations or change Company OS stage/status.

### Final regression

The final regression was run against the accepted UI checkpoint:

`e83ce38d22cb7e94825c8737ae38c7d592714e76`

Two parallel full-suite attempts using `--maxWorkers=4` each produced one different isolated integration failure:

1. `stripe-webhook-claim.test.ts` — one billing webhook claim scenario;
2. `outbox-recovery.test.ts` — one automatic outbox recovery scenario.

Each affected test passed immediately when rerun independently with one worker:

- Stripe webhook claim suite: 8 / 8 passed;
- automatic outbox recovery suite: 1 / 1 passed.

Because the failures moved between unrelated real-database integration tests under parallel local execution, the acceptance run was repeated deterministically with one worker.

The complete serial regression:

`pnpm exec vitest run --maxWorkers=1`

passed successfully.

No product code was changed to suppress, skip or weaken either test.

The parallel-run observation is treated as local shared-test-environment contention evidence, not as authorization to ignore deterministic failures. Future test-infrastructure work may improve isolation or concurrency safety separately.

### Final engineering gates

MR-6E passed:

- `next typegen`;
- `pnpm lint`;
- `pnpm typecheck`;
- deterministic complete Vitest regression with `--maxWorkers=1`;
- local Supabase schema lint with no schema errors;
- `pnpm build`;
- `git diff --check`;
- `.gitignore` unchanged;
- final clean-worktree verification.

The Supabase CLI was not available globally on PATH during the first schema-lint attempt. The required local lint was therefore run temporarily with:

`pnpm dlx supabase@2.117.0 db lint --local`

It reported:

`No schema errors found`

and did not modify the repository.

### Production-build evidence

The final Next.js 16.3.5 production build compiled successfully.

The build route inventory included all three dynamic internal support routes:

- `/admin/organizations/[organizationId]`
- `/admin/organizations/[organizationId]/exceptions`
- `/admin/organizations/[organizationId]/health`

The final verified repository HEAD remained:

`e83ce38d22cb7e94825c8737ae38c7d592714e76`

and the worktree remained clean after the engineering gates.

### MR-6 capability boundary at owner review

MR-6 now has local engineering evidence for:

- explicit internal `MPG_ADMIN` support authorization layered on current tenant membership;
- bounded organization/location inspection;
- mandatory support inspection auditing;
- truthful operational exception visibility;
- truthful health and deliverability telemetry;
- minimized support-facing data contracts;
- one explicitly allowlisted, exact-target, audited outbox recovery action;
- internal admin workspace navigation and operator-focused UI;
- final deterministic regression and production-build validation.

MR-6 still does **not** establish a generalized administrative backend, unrestricted tenant access, impersonation, arbitrary mutation, billing recovery, bulk replay, FAILED-state rewriting, customer support ticketing, SLA commitments or cross-tenant aggregation.

### Authorization boundary

This engineering evidence does not authorize:

- real support-grant rollout;
- production customer support operations;
- live billing or charging;
- live customer messaging;
- controlled pilot operation;
- lifecycle ACTIVE;
- public marketing;
- public launch;
- Company Stage 2 or later activation.

MR-5 remains paused under the accepted billing-provider/account dependency.

MR-7 Trust & Compliance must not be treated as activated until the owner explicitly accepts MR-6 completion and the Company OS source-of-truth documentation is reconciled.

### Owner review gate

The engineering work for MR-6A through MR-6E is ready for owner review.

The next governance action is an explicit owner decision to either:

- **ACCEPT MR-6 COMPLETE**, after which the Company OS project status and decision register should be updated and MR-7 may be activated under the accepted roadmap; or
- keep MR-6 open with a specifically identified remaining requirement.

No milestone transition is implied until that owner decision is made.

### Backlog observation

The Vite warning concerning future `configLoader: 'native'` behavior remains a non-blocking development-tooling compatibility item. It did not fail the accepted regression and should be handled separately rather than expanding MR-6 scope.