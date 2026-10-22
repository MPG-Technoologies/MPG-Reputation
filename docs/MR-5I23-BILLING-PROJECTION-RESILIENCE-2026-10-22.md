# MR-5I23 — Fail-Closed Customer Billing Projection Rendering

**Date:** 2026-10-22  
**Workstream:** Owner-approved four-stage MR-5 billing engineering, Stage 3 integration/security/UX groundwork.  
**Status:** IN PROGRESS until exact-head CI and scoped diff verification; NOT owner-accepted billing settlement or release.

## Latest verified remote and owner priority

- Company OS `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`.
- Product `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`.
- Owner-held integrated billing PR #67 `699c8a9ad8d6c356eeb0e29affa83feeeac2a227`, DRAFT / unmerged. It retains 22 unapplied candidate billing migrations.
- MR-5I21 synthetic rollback/forward-resume PR #93 `5358f1fecb4bf035497282f025ee3427a40f4e62`, with prior exact-head CI passed. This slice branches directly from #93; the separate MR-5I22 Phase A backup wrapper PR #94 is **not** included in this billing change.
- Latest owner instruction is to **DEFER manual Windows encrypted backup, real hosted restore and hosted migration prerequisites while completing provider-independent billing code**, without weakening those release gates. No authorization to apply migrations, merge main, change production or activate payment providers.

## Verified concrete code defect

The read-only TEST billing status helper `src/domain/billing/ui-state.ts` trusted TypeScript-normalized PostgREST fields at runtime. Its status switch used `details[current.normalized_status]` and dereferenced `chosen.headline` without a runtime check. An unexpected normalized status could throw during both legacy and organization-scoped billing rendering.

The organization-scoped server page also directly renders `new Date(summary.periodEnd).toISOString()`; an invalid database period-end value can throw `RangeError` and take down the page. A malformed cancellation-at-period-end value could also be treated as truthy text.

## Smallest bounded change

- Validate the provider TEST status against the existing shared `isBillingNormalizedStatus` policy; allow only PENDING, ACTIVE, GRACE, SUSPENDED and ENDED. Do not coerce unknown strings to supported state.
- Accept period end only if null or a valid explicit-timezone ISO timestamp; reject raw nonstrings, missing timezone, invalid offsets and impossible/nonfinite dates.
- Require `cancel_at_period_end` to be an actual boolean, not a truthy string or numeric value.
- Any invalid projection renders the existing `UNAVAILABLE` state, generic unverified message, `supportRequired=true`, `periodEnd=null`. No subscription action or paid access becomes enabled; legacy gated local-only action preview is also disabled.
- Add pure model negative tests, SSR legacy billing tests verifying disabled TEST actions on corrupt projections, and SSR scoped-view tests verifying safe UTC rendering, bad-date survival and zero billing reads for non-owner/admin or unverified membership. Register scoped test in explicit Internal CI allowlist.

No SQL migration, new RLS/privileges, provider integration, public price, reset, external calls, payment finality or entitlement activation.

## Verification requirements

The exact-head Internal CI must pass lint, route typegen, typecheck, the relevant Vitest domain+page suites and build. Isolated Synthetic E2E must pass without hosted data. Review the final complete diff before marking **ENGINEERING COMPLETE / READY FOR OWNER REVIEW**. CI does not simulate a real paid user checkout or prove browser/mobile end-to-end acceptance.

## Remain blocked / deferred

Actual Stage 1 financial payment attestation and accepted immutable settlement policy; Stage 2 paid entitlement lifecycle; Stage 3 full product/browser/role and independent security review; Stage 4 provider TEST credentials and acceptance; hosted recovery/backup/migration and `main` merge; live messaging/billing, commercial pricing, pilot and release. The earlier owner authorization for secure Phase A backup is not reinterpreted as a waiver of encrypted-at-rest storage or data-handling requirements.

**Next provider-independent work:** continue scoped client/admin billing acceptance and review the complete cumulative PR #67 integration for remaining concrete code vulnerabilities, without activating financial finality until the owner signs its contract.
