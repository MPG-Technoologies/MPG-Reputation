# MR-10F — Integrated Marketing Workspace (Prelaunch Simulation)

**Date:** 2026-11-04
**Status:** IN PROGRESS — scoped remote implementation complete; local checks and owner review pending
**Feature branch:** `chatgpt/mr10f-integrated-marketing-workspace-20261104`
**Accepted product baseline:** `main` at `58b48ab4d6f32164f084c3ecf81eaea0fd129623` (MR-10E merged)
**Company OS:** `main` at `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`; owner-directed MPG-DEC-053 still on draft governance PR #4.

## Bounded objective

Connect the **existing** MR-10C static campaign drafts, MR-10D example calendar and MR-10E publication-readiness packet inside their **existing development-only route**, without adding a public management surface, database, registration, send or scheduled publication.

This is a demo of the editorial reasoning and review journey, not an internal operations system with real approvals.

## Implemented scope

- `src/components/marketing/workspace-model.ts`: pure `buildMarketingWorkspaceSnapshot` composition function; validates an existing `DRAFT_ONLY` campaign, matches its own `SAMPLE_ONLY` calendar placements, creates its unchanged, fail-closed readiness packet, and always reports `canPublish: false`.
- `src/components/marketing/CampaignWorkspace.tsx`: lightweight client-side selector for existing campaigns; selected brief, allowlisted **informational** CTA destination, example calendar placement, review notes and the seven readiness requirements.
- Six example evidence checkboxes are browser-memory-only. They can mark `EVIDENCE_DRAFTED` in an ephemeral snapshot but never assert validation, approval, transmission, scheduling or publication. Changing campaign resets these checkboxes; browser refresh also resets them.
- The seventh owner-release requirement is locked and does not provide an approval checkbox. Every snapshot always has `canPublish: false` and `ownerReleaseAuthorized: false`.
- `src/app/mr10-campaign-preview/page.tsx`: mounts the integrated panel without moving the production guard, changing robots metadata or removing MR-10C/D reference sections.
- `test/integration/mr10f-integrated-marketing-workspace.test.ts`: eight model and source-contract tests, including simulation isolation, cross-campaign references, invalid evidence rejection, owner lock, accessibility markers, guard and forbidden side effects.

No client data is uploaded, cached, stored or tracked. The only interactive changes are React state in the current tab; no publish, send, approval, channel or billing action exists.

## Verification checklist

From the MR-10F feature branch, after fetching it safely and confirming no local changes:

```powershell
pnpm lint
pnpm exec next typegen
pnpm typecheck
pnpm exec vitest run test/integration/mr10f-integrated-marketing-workspace.test.ts test/integration/mr10e-publication-readiness.test.ts test/integration/mr10d-editorial-calendar.test.ts test/integration/mr10c-campaign-preview.test.ts test/integration/mr10b-synthetic-conversion-model.test.ts test/integration/mr10a-editorial-foundation.test.ts test/integration/mr9-public-website-contract.test.ts test/integration/mr9b-conversion-journey.test.ts test/integration/mr9b-website-polish.test.ts
pnpm build
git diff --check origin/main...HEAD
```

**Expected targeted total:** 60 tests across 9 files (8 new MR-10F plus 52 previously passing tests). Do not record passes until checks actually run.

Start `pnpm dev` locally and review `http://localhost:3000/mr10-campaign-preview` with desktop/mobile viewports. Try switching campaigns; each should show its own draft, one example calendar placement and the seven review requirements. Check and uncheck sample evidence boxes, switch campaigns to confirm reset and refresh the page to confirm no storage.

**Production gate must be retested after this page change:** after a passing build, run `pnpm exec next start -p 3100` in a separate terminal, then from another terminal assert HTTP 404 at `http://127.0.0.1:3100/mr10-campaign-preview`. The route is unavailable outside `NODE_ENV === "development"` and carries `noindex,nofollow,nocache`. Do not expose a local development server to untrusted networks.

## Owner-controlled restrictions

- No content or launch authorization: `EVIDENCE_DRAFTED` is not a review finding, approval, or claim substantiation.
- No production release, marketing campaign, published posts, purchased ads, sales signup, tracking, customer messaging, commercial offer or billing activation.
- Preserve MR-1 hosted provider verification, paused MR-5 billing, MR-7 qualified legal/compliance review, gated MR-8 real pilot and gated MR-11 market release.
- Draft MPG-DEC-053 governance work is not accepted Company OS policy. No Company Stage change.

## Next

After the owner-local verification and full diff review, prepare a **draft PR** to `main`; do not merge automatically. Then conduct an MR-10 engineering audit across claims, accessibility, indexing, route protection, exact CTAs, and missing provider/legal/commercial gates. Do not add a real publication capability to complete this milestone.
