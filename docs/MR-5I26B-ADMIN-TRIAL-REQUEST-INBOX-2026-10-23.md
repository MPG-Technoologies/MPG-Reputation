# MR-5I26B — Local MPG Admin Trial Request Inbox

**Slice:** Read-only MPG internal inspection of MR-5I26A trial-extension requests.
**Target:** local, disposable, synthetic Supabase only.
**Status:** IN PROGRESS until exact-head CI verification; no hosted execution.

## Verified inheritance
- Company OS `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`.
- Product `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`.
- Feature parent PR #99: `078cdd335efe6a6cd3e118eabc4578007da69013`, draft and unmerged.
- PR #67 remains on HOLD; no merge to main, hosted migrations, live billing, messaging, pilot, real data, or deployment.

## Implementation
- Route: `/admin/organizations/[organizationId]/trial-requests`, dynamic and prefetch-safe.
- Adds a conditional Trial requests navigation item to the existing organization-scoped internal operations layout.
- Reuses accepted `authorizeSupportAccess` semantics (verified authenticated actor, current membership, current explicit, unrevoked `MPG_ADMIN` grant scoped to the target organization).
- Feature enablement is denied unless all conditions hold:
  - `ENABLE_LOCAL_TRIAL_REQUEST_SUPPORT_VIEW=true`
  - `MPG_TRIAL_REQUEST_SUPPORT_TARGET=LOCAL_SYNTHETIC`
  - `NODE_ENV` is not production, `VERCEL_ENV` absent
  - `NEXT_PUBLIC_SUPABASE_URL` is `http://127.0.0.1:54331` or `http://localhost:54331`
  - live billing and live email both OFF
- A newly created server-only loader reads up to 21 rows, returns at most 20 OPEN requests, strictly verifies tenant IDs and row data, and fetches the tenant's name/entitlement snapshot. No cross-organization or batch scanning.
- No requester UUID, email, provider credentials, tokens or unnecessary PII are returned to the page; the free-text reason is shown only within authorized MPG internal inspection and not logged.
- Every successful private read is followed by fresh support authorization and a required actor-attributed `audit_events` insert; if it fails, the result remains unavailable.
- Only renders organization name, used/allocated requests, trial state/duration/expiry and bounded OPEN request reasons. **No approval, denial, request edit, allowance change, Stripe action, subscription activation, or approval API exists** in this slice.

## Local prerequisites & limitations
- PR #99 includes the repository-only `trial_extension_requests` migration. This route is correctly disabled when pointed at the already connected hosted engineering/test Supabase project, because **hosted migration application is separately owner-gated**.
- For full local integration a disposable Supabase instance must apply the repository migrations using only the local CLI. Tests must be executed exclusively in local isolated CI. The application server must be started with the local-only flags and test users granted current explicit `MPG_ADMIN` membership-scoped access through synthetic fixture provisioning. Never construct a manual grant on hosted or real user data.
- A new local environment flag may require restart of the *existing* dev server to be picked up. No new worktree, port or second server required.
- A passing Next.js build does not imply the protected page can display hosted records.

## Required verification
- Lint, Next route typegen, TypeScript typecheck, no-DB unit security tests and Next.js build.
- Synthetic-only hosted-protection checks and existing E2E/upgrade rehearsal (unchanged migration set from #99).
- Full diff inspection for intended changes, credentials, authorization and provider gates before marking ENGINEERING COMPLETE.

## Deferred next slice
MR-5I26C may design **separate** MPG administrator approve/deny and transactional allowance adjustment controls with restrictive staff authorization, mandatory reason, idempotency, immutable usage, audit record, and failure rollback tests. This slice does not authorize those operations.
