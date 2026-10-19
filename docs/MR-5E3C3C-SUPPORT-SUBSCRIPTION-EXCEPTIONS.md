# MR-5E3C3C — Scoped read-only subscription exception support inspection

Status: IN PROGRESS pending CI and final diff review.

## Remote sources
- Company OS `techwithmpg/mpg-company-os` main: `03a48a34481f1952a31cd5c4fb980bc381432d8d`. MR-5 PAUSED / INCOMPLETE under accepted governance; the owner has later directed bounded non-live provider-ready feature work. MR-7 remains current owner-approved security milestone.
- Product `MPG-Technoologies/MPG-Reputation` main: `6b7ac073432921789314315ec5fc624a81d8f699`.
- Parent: MR-5E3C3B PR #49, `c0b2411d46747cff06c9a380a1ea331955f6586b`, ENGINEERING COMPLETE / READY FOR OWNER REVIEW, not merged.

## Existing architecture reused
- MR-6 `authorizeSupportAccess`: authenticated actor must be tenant member **and** hold an unexpired, unrevoked per-org MPG_ADMIN support grant. Business OWNER/ADMIN alone is insufficient. No broad global billing operator power was added.
- MR-5D3D3B read-only recovery inspection: private bounded query, fresh support authorization check after the read and mandatory fixed actor-attributed audit before returning data. We mirror it for existing MR-5E3C3B private exception cases.
- `stripe_test_billing_recovery_reviews` remains reserved for customer setup and checkout. The separate subscription exception reviews retain one-case-per-source-event deduplication and database hard-false `access_authorized=false`.

## Slice implementation
- Server-only `src/lib/support/subscription-exceptions.ts` provides default-disabled `getSupportSubscriptionExceptionCases`. Feature gate: explicit local-only opt-in, exact disposable Supabase loopback URL, nonproduction, no Vercel and LIVE billing disabled.
- Query only the authorized tenant's `OPEN` records, oldest first, 20 maximum plus a truncation marker. Validate tenant ID, UUIDs, recognized review reasons, synthetic/TEST/UNVERIFIED and the hard-false access flag before releasing a sanitized snapshot of case ID, internal subscription record ID, reason and timestamp. No webhook IDs, provider IDs, customer PII, invoice amount, raw payloads or financial evidence are returned.
- Add `support.subscription_exception_inspection` to the existing fixed MR-6 audit machinery, with actor UUID, organization UUID and AVAILABLE/UNAVAILABLE only. Fresh support grant checked after the private read. Audit must succeed before the result becomes available. If it fails, case data is not returned.
- New internal read-only page `/admin/organizations/[organizationId]/subscription-exceptions` mirrors the existing admin view with strict prefetch suppression, disabled/denied/unavailable pages, minimal synthetic case table and an explicit disclaimer. Navigation only appears when local synthetic support inspection gate is enabled.
- No mutation controls, case closure, financial resolution, provider connector, real billing, paid entitlement changes, schema/RLS changes, role grants, production deployment or hosted database writes.

## Known limits and next
An MR-6 MPG_ADMIN scoped grant permits *inspection only*, not billing investigation approvals, refunds, payment overrides or decisions. A case is still synthetic, UNVERIFIED and OPEN. No real provider API account/credentials are present. No audit of financial action was introduced; every inspection is auditable, but a future approval protocol requires independent owner authorization, authenticated provider TEST evidence, conflict handling and operational tests. Existing **30 Free Review Requests** trial and suppression remain authoritative and untouched.

Verify Internal CI lint/typecheck/625+ synthetic tests/build, disposable PostgreSQL support tenant/grant revocation/audit denial tests, full diff and security review. No merge to main until separately authorized.
