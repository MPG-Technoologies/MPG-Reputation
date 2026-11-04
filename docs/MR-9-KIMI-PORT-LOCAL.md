# MR-9 Kimi Public Site — Local Next.js Port

Scope: Static / local-only marketing pages, product demos, and in-browser Reputation Check. Designed to run on the owner-approved MR-9 feature branch. No billing, messaging, hosted database, customer data or deployment changes.

Imported from supplied Kimi website code under owner's direction, adapted to Next.js App Router and existing MPG Reputation application:
- Existing /login, /app, /admin and /api routes remain intact.
- Kimi OAuth, Vite, Hono/tRPC, MySQL and analytics sinks intentionally omitted.
- Trial CTA explains prelaunch status without recording interest.
- Report is derived locally in React state and disappears on refresh; /reputation-report displays synthetic example only.
- Next metadata `robots.noindex` retained until separate publication approval.
- Marketing CSS runtime tokens scoped to `.mr9-site`; global Tailwind theme tokens added by a single additive stylesheet import.

Review changed file paths; test and inspect browser at mobile and desktop widths before staging or owner acceptance. No public deployment or PR merge is included.

## Source and verification limits

Source port syntax and local import paths checked in ChatGPT container. Full Next.js lint/typecheck/build were not run there because the live repository dependencies and local Supabase environment are only on the owner machine. Owner must run the installer checks and review UI before acceptance.
