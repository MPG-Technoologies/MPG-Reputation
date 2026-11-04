# MR-10D — Editorial Calendar Planning (Internal Preview)

**Date:** 2026-11-04
**Status:** IN PROGRESS — remote feature implementation prepared; local checks and owner review pending
**Branch:** `chatgpt/mr10d-editorial-calendar-20261104`
**Base commit:** `035793db4e94f90230e8e126cc4deceae0133c09` (MR-10C merged)

## Objective

Extend MR-10C's existing local development-only campaign preview with an **illustrative** editorial calendar and explicit copy/owner-review checkpoints. This is planning data only, not a publishing platform.

## Implemented scope

- `src/components/marketing/editorial-calendar.ts`: typed example slots linked to existing MR-10C campaign briefs; proposed dates, compatible draft surfaces and **sample-only** review stages.
- `src/app/mr10-campaign-preview/page.tsx`: a calendar section below the existing briefs with readable dates, draft-channel labels and review checkpoints. Existing `NODE_ENV !== "development"` 404 guard and `noindex,nofollow,nocache` preserved.
- `test/integration/mr10d-editorial-calendar.test.ts`: eight regression checks covering synthetic input guards, date integrity, unique placement, campaign linkage, sequential in-memory checkpoint transitions, no publication approval, and no external side effects.
- This handoff.

Sample proposed dates (2026-11-09, 2026-11-16, 2026-11-23) are **fictional planning fixtures**. They are not deadlines, production configuration, campaign sends, or approval to publish. They must not be treated as live schedules.

## Review-state semantics

Example checkpoints are:
1. `COPY_DRAFT` — needs drafting;
2. `NEEDS_INTERNAL_REVIEW` — editorial check is required;
3. `NEEDS_OWNER_REVIEW` — separately authorized owner review is required.

The helper `simulateEditorialReviewProgress` returns a new sample object; it does not persist changes, record real approvals, schedule sends, or provide a publish transition. It is deliberately impossible to reach an `APPROVED` or `PUBLISHED` state through this model.

## Safety and release gates

No Supabase migrations, provider integrations, campaigns, signups, outgoing messages, billing, visitor data, cookies, analytics, remote tracking, real editorial approval database or scheduled automation. All MR-5, MR-1 hosted-provider, MR-7 legal/compliance, MR-8 pilot and MR-11 release gates remain unchanged.

The Company OS owner-priority sequencing proposal MPG-DEC-053 remains a draft (Company OS PR #4). Do not merge, deploy, or commercially publish without owner authority.

## Owner-local verification checklist

From the new feature branch:

```powershell
pnpm lint
pnpm exec next typegen
pnpm typecheck
pnpm exec vitest run test/integration/mr10d-editorial-calendar.test.ts test/integration/mr10c-campaign-preview.test.ts test/integration/mr10b-synthetic-conversion-model.test.ts test/integration/mr10a-editorial-foundation.test.ts test/integration/mr9-public-website-contract.test.ts test/integration/mr9b-conversion-journey.test.ts test/integration/mr9b-website-polish.test.ts
pnpm build
git diff --check origin/main...HEAD
```

**Expected targeted total:** 44 tests (8 new MR-10D plus the 36 previously passing tests). Do not mark verified until checks run.

Local visual review: `http://localhost:3000/mr10-campaign-preview` from `pnpm dev`. The same route **must still return HTTP 404** when served via `pnpm exec next start -p 3100` using a production build. The previous production 404 verification was for MR-10C; MR-10D requires repeat runtime validation.

## Next after verification

Review diff, confirm the demo does not imply live publication schedules, then prepare a **draft PR**. No merge, marketing launch, or live scheduling is included in this slice.
