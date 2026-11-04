# MR-10B — Synthetic-Only Conversion Measurement Architecture

**Status:** IMPLEMENTED ON MR-10 FEATURE BRANCH — AWAITING LOCAL VERIFICATION AND OWNER REVIEW  
**Date:** 2026-11-04  
**Source branch:** `chatgpt/mr10a-editorial-foundation-20261104` (draft PR #102)  
**Scope:** Pure offline model, deterministic synthetic fixture, tests, and measurement definitions. **Not live analytics.**

## Objective

Define credible conversion questions and calculation semantics before any live marketing measurement or personal-data collection is authorized. Preserve the existing no-op `track()` function in `src/components/marketing/funnel.ts`; do **not** connect an analytics SDK, event endpoint, database, cookies, local storage, user identifiers or remote collector.

## Canonical synthetic journey

| Stage | Intended meaning | Existing event taxonomy example |
|---|---|---|
| `discovery` | A synthetic visitor encounters the product website | `page.view` |
| `education` | Explores product features | `features.viewed` |
| `assessment` | Completes the local-only Free Reputation Check | `check.completed` |
| `trial-information` | Opens prelaunch trial-information dialog | `trial.dialog_opened` |

This is a **canonical demonstration path**, not a claim that all future website visitors must follow this order, and not a real registration, lead, subscription, or trial-activation funnel. In particular, opening a dialog is **not** a registered trial interest signal. The older `trial.interest_registered` taxonomy name is not an observed business event while the tracker is disabled.

## Deterministic calculations

`summarizeSyntheticFunnel()` accepts **only developer-supplied synthetic fixture IDs** matching `synthetic-...`, each with a contiguous, unique stage history. Duplicate synthetic IDs and skipped/reversed/repeated stages are rejected.

The report contains:
- `count`: unique synthetic journeys reaching each stage;
- `fromPreviousRate`: stage count divided by previous-stage count;
- `fromDiscoveryRate`: stage count divided by discovery count;
- `null` conversion rate where the denominator is zero (undefined, **not 0%**);
- a `mode: synthetic-only` label for explicit test/preview provenance.

No real outcomes, emails, website URLs, business names, IP addresses, session IDs, published reviews, invoices, messages, or customer data should be supplied to this model. It is **not a policy or privacy enforcement engine for future live telemetry** and must not be exposed as a live client-event ingestion mechanism.

## Explicit non-goals

- No browser tracking activation or analytics calls.
- No persisted visitor IDs, cookie banners, consent flows or attribution cookies.
- No new Supabase tables, migrations, Row Level Security changes, API routes, event collectors, webhooks, or privileged access.
- No live email/marketing campaigns, prospect lead capture, trial enrollment, checkout, subscription changes or deployment.
- No unreviewed marketing metrics, success claims or guarantees.

## Future live-measurement gate (separate owner decision)

Before real telemetry, agree on data minimization and purpose, consent/legal basis and regional requirements, retention and deletion, analytics-provider contract, attribution limitations, RLS/tenant boundaries where relevant, disclosure/opt-out, user experience and independent security tests. The paused MR-7 legal/compliance work must be explicitly reconciled. Do not silently reuse the synthetic ID field for real user or device identifiers.

## Verification checklist

- `pnpm lint`
- `pnpm exec next typegen`
- `pnpm typecheck`
- `pnpm exec vitest run test/integration/mr10a-editorial-foundation.test.ts test/integration/mr10b-synthetic-conversion-model.test.ts`
- `pnpm build`
- Diff review confirms no tracking, data persistence, new API, or production changes.

**Acceptance:** Pure model and tests demonstrably pass; no evidence of live analytics is claimed. Engineering completion does not imply release approval.
