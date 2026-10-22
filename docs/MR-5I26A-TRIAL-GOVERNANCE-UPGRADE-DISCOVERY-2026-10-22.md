# MR-5I26A — Tenant Trial Governance + Paid Upgrade Discovery

**2026-10-22 | IN PROGRESS / not applied to hosted.**

## Source and owner authority

Latest Company OS `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`.
Latest product `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`.
Parent draft PR #98 exact commit `85c309dcb24c89f656c30bd7a13d7dcff386dca2`.
Billing integration #67 remains DRAFT/HOLD and hosted billing migrations are not approved for application.

Owner approved MPG platform-admin-exclusive trial adjustments, business OWNER/ADMIN eligible-trial activation and extension requests, server and database authorization, auditability and tests. Owner then approved an **upgrade-first** UI with Monthly, Yearly and Premium subscription categories so normal continued usage is paid rather than resetting free trials. No approval to publish pricing, define Premium limits, activate a provider, enable real messaging, merge main or apply hosted migrations.

## Existing authorization gap

The tenant-facing `provisionOrganizationTrialAction` accepted organization OWNER/ADMIN and then invoked `provision_organization_trial` with a service-role Supabase client. The original SQL RPC was service_role-only but that server action defeated the intended owner-only economic limit by letting tenants supply arbitrary request/day allocations. Merely hiding the UI does not solve it.

## Bounded implementation in this slice

1. Preserve eligible trial activation `startOrganizationTrialAction` and its readiness gate. Replace `provisionOrganizationTrialAction` with a deliberately denied compatibility response, **no auth/read/privileged-client path**, so stale clients cannot alter economic value.
2. Remove the business OWNER/ADMIN editing form. Add optional `Request a trial extension` form with reason only. `requestTrialExtensionAction` validates input, resolves real session/membership/role, and INSERTs using only cookie-scoped RLS client (never service-role). No entitlement or approval RPC is called.
3. Repository-only additive SQL migration: `trial_extension_requests` with one OPEN request per organization, requester and OWNER/ADMIN check under RLS, authenticated SELECT limited to requester, no UPDATE/DELETE grants for tenants or a review endpoint. A SECURITY DEFINER trigger writes minimal actor-attributed audit metadata and deliberately omits free-text reasons. Trial-provision EXECUTE remains `service_role` only.
4. Present three **informational** plan cards on Usage & Trial and Billing pages: Monthly, Yearly, Premium. Each includes a non-public-price statement and no entitlement/credit/feature promise. Usage cards navigate to Billing; all Billing CTA buttons are disabled. Existing two-plan pricing draft and local-only synthetic checkout controls remain separate and gated. Premium is NOT a configured SKU, offer, checkout plan or paid entitlement.
5. Add isolated mocked server-action tests, SSR cards + no-unapproved-payment tests and disposable SQL/RLS integration test for denied tenant/RPC access, unique outstanding request, actor attribution, and no allowance mutation. Register explicit allowlists in Internal CI and Synthetic E2E.

## Controls and residual scope

**No tenant can grant their own additional requests.** Approval and allowance mutation are **NOT** built in MR-5I26A. This is intentionally request intake only. A future separate, audited MPG admin adjustment slice must define explicit staff authorization, exact controls for allowable values, manual decision reason, concurrency/idempotency, immutable consumption, proof of DB rights, and rollback tests. Requests do not guarantee approval.

The new request table and action will not function on an existing hosted/local database until the corresponding migration is separately applied. **Do not apply hosted migrations** and do not operate the form on a hosted project before migration verification. Continue using the visual preview without pressing the trial activation button or submitting extension requests.

Commercial pricing (including previously discussed Monthly/Yearly), final tier benefits and Premium packaging remain unapproved. The phrase is **30 Free Review Requests** (not 30 Free Reviews). UI does not create checkout, charge customers, grant paid status, or activate messaging.

## Verification and Git policy

Requirements: Internal CI lint, route typegen, typecheck, domain + SSR tests and production build; disposable Supabase E2E incl. new RLS integration test; Billing browser acceptance and complete scoped diff review. No claim of ENGINEERING COMPLETE until checks actually pass. Draft PR on feature branch; no merge to main, hosted schema or environment mutation.
