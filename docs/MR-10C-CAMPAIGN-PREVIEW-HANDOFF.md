# MR-10C — Campaign Briefs and Local-Only Preview

**Date:** 2026-11-04

**State:** IN PROGRESS — remote engineering prepared, local tests and owner review pending

**Branch:** `chatgpt/mr10c-campaign-preview-20261104`

**Base:** accepted product `main` at `b230595a7b95ca6cd7194bb527fef3578111f8ca`


## Purpose

Create a reusable **internal editorial campaign-planning surface** from actual MPG Reputation product capabilities, without implementing a campaign execution platform, buying ads, collecting visitors, or activating any provider.

This is the smallest safe MR-10C slice after MR-10A educational resources and MR-10B synthetic conversion measurement.

## What exists

- `src/components/marketing/campaign-briefs.ts`: three typed `DRAFT_ONLY` educational briefs (service completion consistency, trustworthy measurement, browser-only Free Reputation Check), allowed destination routes, review notes and conservative copy/CTA checks.
- `src/app/mr10-campaign-preview/page.tsx`: responsive, existing navy/blue theme, simple card-based comparison of those draft concepts. Uses `notFound()` unless `NODE_ENV === "development"`; force-dynamic with `noindex,nofollow,nocache`.
- `test/integration/mr10c-campaign-preview.test.ts`: seven targeted tests for draft state, allowed links, no false claims, duplicate IDs, forbidden claims, development-only gate, and no side-effect code.

**Development-only local route:** `http://localhost:3000/mr10-campaign-preview`

This local route contains no proprietary secrets. It is not an authenticated MPG admin page. Do not expose a development server to untrusted networks.

## Scope and terminology

- Any `social-copy-draft` or `nurture-copy-draft` entry is an editorial writing surface, **not** a connected distribution channel.
- No send, schedule, publish, campaign storage, lead capture, analytics, email APIs, hosted Supabase tables, Stripe, or customer data.
- CTA destinations lead only to already implemented public **prelaunch** informational pages.
- No invented customer logos, ratings, positive-review guarantees, testimonials, pricing, or certification claims.
- The `30 Free Review Requests` phrase refers to planned request allowance, not published reviews, and does not authorize a public trial.

## Review and verification

Run on the owner machine after fetching the feature branch:

```powershell
pnpm lint
pnpm exec next typegen
pnpm typecheck
pnpm exec vitest run test/integration/mr10c-campaign-preview.test.ts test/integration/mr10b-synthetic-conversion-model.test.ts test/integration/mr10a-editorial-foundation.test.ts
pnpm build
git diff --check
```

Expected MR-10C test file: 7 tests. Do not claim passes until they run.

Preview the local page on desktop/mobile using `pnpm dev`. To validate the **production** access gate, run `pnpm build`, then `pnpm start` on a separate free port, and verify `/mr10-campaign-preview` returns HTTP 404. Build success alone does not prove production route unavailability.

## Separate gates still closed

Company OS sequencing decision `MPG-DEC-053` remains on draft Company OS PR #4. MR-5 billing, remaining MR-1 sender/provider work and MR-7 trust/compliance legal work remain paused. MR-8 pilot and MR-11 public/commercial launch remain gated.

Do not merge to `main`, deploy, turn on trial/signup, send messages, schedule posts or gather marketing data without explicit owner approval. Full legal/privacy, provider, campaign claims and commercial launch approval are external follow-on requirements.

## Next candidate slice

After MR-10C review: content-calendar management as static typed planning fixtures, or a detailed approved future campaign-activation gate. Neither should introduce real marketing telemetry or dispatch.
