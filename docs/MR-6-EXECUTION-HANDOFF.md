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
