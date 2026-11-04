# MR-9 → MR-10 Development Handoff — Owner-Directed Priority

**Date:** 2026-11-04  
**Status:** MR-9 ACTIVE (internal/staging engineering only); MR-10 NEXT (engineering preparation)  
**Authority:** Owner direction 2026-11-04; MPG Company OS `MPG-DEC-053` on draft PR #4; prior Company OS commercial/release restrictions remain in force.  
**Product baseline:** `main` `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`  
**Feature branch:** `chatgpt/mr9-site-foundation-20261104`

## Objective

Build an outstanding public-facing **product website experience** for MPG Reputation and then a professional, measurable marketing engine, without waiting for paused payment/provider/legal work **to develop and test safely**. Do not treat marketing development authorization as commercial publication authority.

## Public-site information architecture (planned)

- `/`: accessible, polished, factual homepage and authentic feature education; controlled internal preview.
- `/how-it-works`: business onboarding, completion sources, permission, neutral request and opt-out walkthrough, with provider activation gates plainly distinguished.
- `/faq`: customer/business FAQ that never promises published reviews or guarantees.
- Free Reputation Check: **local-only/synthetic questionnaire prototype** at first; no real contact submission, remote tracking, lead storage or automated email.
- `/pricing`: pricing explanation only when commercial terms are approved; **do not publish prices or live purchase actions now**.
- `/privacy` and `/terms`: not released until the appropriate qualified review and owner approval. Do not publish placeholder legal documents.

## MR-10 development backlog (not live campaigns)

1. Editorial content pillars: legitimate service completion, neutral reviews, reputation operations, responsible automation and business education.
2. SEO architecture: metadata, canonical and structured-data policy, indexability gate, sitemap strategy and truthful accessible landing pages.
3. Conversion measurement model: anonymous/synthetic funnel events and definition of a completed reputation check, trial intent and activation. No live tracking or real personal data.
4. Campaign drafting: landing page copy, content calendar, email nurture drafts and creative assets. Do not dispatch campaigns, buy ads or collect leads.
5. Review and publication checklist: claim substantiation, consent, privacy/tracking review, legal review, owner approvals and provider readiness.

## First MR-9 slice acceptance contract

- Uses the existing Next.js 16 / TypeScript / Tailwind application, not a second website stack.
- Replaces the implementation placeholder without changing `/login`, `/onboarding`, admin, tenant application, security or persistence.
- Responsive HTML, semantic landmarks, keyboard-visible focus, reduced-motion compatibility from existing global rules.
- Says **30 Free Review Requests** (not `30 Free Reviews`), and identifies the allowance as planned/not activated.
- No fabricated testimonials, star ratings, financial outcomes, customers, integrations, certifications, dates or subscription prices.
- Does not present a real sign-up or checkout button as available. Existing controlled-workspace sign-in may remain.
- `robots: noindex, nofollow` while only a preview; disable indexing only after independently approved publication.
- Static tests cover claims, safe links, no lead-capture form and metadata; then CI lint/typecheck/test/build and visual desktop/mobile browser verification before owner integration review.

## Paused dependencies

MR-5 billing: PAUSED / INCOMPLETE; existing drafts preserved. MR-1 hosted messaging verification: DEFERRED. MR-7 legal/compliance remainder: PAUSED but milestone IN PROGRESS. MR-8 and MR-11: GATED. No production deployment, public site release, live marketing/analytics, real messaging, real billing, real customer data, or Company Stage advancement authorized.
