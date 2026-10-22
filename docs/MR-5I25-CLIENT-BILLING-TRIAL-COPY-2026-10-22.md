# MR-5I25 — Client-Facing Billing and Trial Copy Review

**Date:** 2026-10-22
**Scope:** Provider-OFF Stage 3 presentation slice from user-supplied authenticated local screenshots.
**State:** IN PROGRESS pending exact-head automated checks and complete diff review.

## Remote baseline and current owner direction

- Company OS main `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`.
- Product main `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`.
- MR-5 held integration PR #67 remains draft; MR-5I24 PR #97 `8fb36d1fdfa12ca4043f0577ea30bcd597aa9169` has all three exact-head workflows passing.
- Screenshots from authenticated local testing show a provisioned, not-yet-started test trial and read-only billing without a linked Stripe TEST account. Neither screenshot proves payment integration.
- Owner prefers continuing provider-independent billing software development while secure workstation backup, hosted migrations, external payment connection and live operational tests remain deferred or separately gated.

## User-visible findings and fixes

1. Root `src/app/layout.tsx` shipped Next.js boilerplate metadata (`Create Next App`, generic description) in browser tabs. Change only title and description to MPG Reputation; no branding certifications, customers or launch claims.
2. Usage & Trial page used internal engineering terminology (`VALIDATION HYPOTHESIS — MR-4`, `MPG-DEC-048`, `Server-authoritative`, `Trial Entitlement Allowance`) on a client screen. Replace above-the-fold copy with plain English explaining the **review-request allowance** and duration, and state that messaging remains eligibility/configuration gated.
3. Trial activation success feedback incorrectly stated review automation was active without verifying provider/messaging activation. New text confirms only trial activation while message delivery remains separately controlled. Trial server action/RPC stays unchanged.
4. Billing banner showed `Engineering preview`; now says `Billing not yet available`, retaining explicit payment/checkout restrictions and trial independence. No offer or proposed price is published.
5. Automated customer copy test uses an SSR-rendered synthetic usage view to protect labels, no delivery claim and unchanged OWNER-only trial button, plus a source metadata check; registered in synthetic Internal CI.

## Security observation requiring separate owner scoping

Existing `UsageClient` also exposes a `Configure Entitlement Allowance (Pilot Operator)` form to tenant OWNER/ADMIN. The server-side `provisionOrganizationTrialAction` permits a tenant OWNER/ADMIN to invoke service-role `provision_organization_trial` for their organization. Although this may be deliberately enabled for engineering/pilot operation, before real customer access the owner must decide whether trial allowance/reprovision is platform-only, and ensure the server action and database RPC enforce the decided ceiling and authorization. **Do not treat hiding the form as a security fix.** No authorization or entitlement behavior changed by this presentation slice.

## Verification / release gates

Run Internal CI lint, typecheck, SSR tests, and build; isolated Synthetic E2E and existing billing browser acceptance. Diff only intended UI/copy, metadata, tests, CI and documentation. No RLS/grants, elevated credentials, hosted Supabase mutation, billing provider access, entitlement mutations, hosted backup/restore, production deployment or main merge.

MR-5 Stage 1 financial settlement, Stage 2 paid entitlement, Stage 3 full client/admin/tenant review and Stage 4 external TEST provider acceptance remain open. `30 Free Review Requests` remains the public-facing phrase.
