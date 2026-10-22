# MR-5I24 — Shared Billing Snapshot Integrity

2026-10-22. **Stage 3 provider-OFF engineering, NOT financial settlement approval.**

Latest Company OS main: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`; product main: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`. Held integration PR #67 remains draft/unmerged, 22 candidate migrations unapplied to hosted. Parent MR-5I23 PR #95 is engineering-complete with Internal CI and isolated Synthetic E2E passing. The owner requested progressing with software while deferring workstation encryption/backup and manual hosted setup. Deferral does not waive those requirements for production or mainline release.

## Finding

The two read-only billing pages duplicated TEST billing account/subscription matching logic. One page offered developer action props based on raw subscription fields and the other had separate ambiguous/mismatch checks. Neither centralizes defense against malformed envelopes (e.g. a non-array row set or an account record with invalid ID). This makes future changes to one page vulnerable to differences in behavior and accidental false-positive subscription status.

## Implementation

Shared `resolveTestBillingSnapshot` in the existing `src/domain/billing/ui-state.ts` is a pure read boundary, not a new authorization policy. It requires a null or object-shaped account, a non-empty account ID for a linked account, an array of **zero or one** subscription, matching billing_account_id, expected TEST fields, and success query status. It delegates all provider status/date/boolean checking to MR-5I23's shared TEST projection validator. Invalid or ambiguous rows yield `UNAVAILABLE` with no paid access or local TEST checkout controls. Both the legacy `/app/settings/billing` and scoped `/workspace/organizations/[id]/billing` page now consume exactly this shared result. Existing user session, role/membership validation, tenant-ID restrictions and Supabase RLS queries are unchanged.

Added model cases for matched, absent, ambiguous, orphan and malformed accounts/subscriptions. Existing SSR page tests and synthetic integration tests remain active. No SQL migrations, provider calls, real customer data, provider TEST/LIVE activation, financial finality or commercial pricing changed.

## Verification gates

Exact-head Internal CI (lint, typecheck, domain tests, build) and Isolated Synthetic E2E must be checked before **ENGINEERING COMPLETE**. Diff limited to the two pages, shared domain helper, tests, and handoff. No production deployment, hosted migration, backup/export, main merge or payment activation permitted.

## Next

Continue Stage 3 role/tenant/customer-admin billing integration review and independent cumulative PR #67 security acceptance. Stages 1/2 trusted money and paid entitlement require separate owner decisions; Stage 4 external TEST account access remains blocked.
