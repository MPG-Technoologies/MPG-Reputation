# MPG Reputation

Automated, neutral review collection and reputation management for local businesses following legitimate completed transactions.

---

## Strategic Architecture

- **Relationship**: `MPG → MPG Reputation`
- **Identity**: MPG Reputation is a dedicated product platform subordinate to the MPG master company architecture (`MPG-DEC-043`).
- **Governance Source of Truth**: MPG Company OS
- **Local Workspace**: `E:\MPG`
- **Scope & Repository**: This repository (`MPG-Technoologies/MPG-Reputation`) contains the technical implementation code for the dedicated product application and website (`MPG-DEC-039`, `MPG-DEC-044`).

---

## Current Status & Program

| Dimension | Current State |
|---|---|
| **Program** | **Market-Ready Build Program** authorized under `MPG-DEC-046` |
| **Status** | V0.1 Technical Foundation Accepted (`MPG-DEC-045`); V0.2 Controlled Staging & Usability Proven Baseline |
| **Current Milestone** | **MR-6 COMPLETE / OWNER ACCEPTED (`MPG-DEC-050`); MR-7 Trust / Security / Compliance IN PROGRESS (`MPG-DEC-050`, `MPG-DEC-051`). MR-5 PAUSED / INCOMPLETE; MR-1B-H DEFERRED; MR-8 GATED.** |
| **Commercial Release** | **GATED** — The product is NOT yet publicly launched; commercial release and marketing approval remain gated |
| **Customer Messaging** | **OFF** — Live customer messaging remains disabled until separately authorized |

---

## Current execution handoff

MR-5 is **PAUSED AT SAFE ENGINEERING CHECKPOINT / EXTERNAL BILLING PROVIDER DEPENDENCY**, not complete or accepted. Checkpoint `d654656b59810877502d2e737dd236ae83b9c379` preserves billing persistence, signature/environment controls, durable webhook intake and the provider-truth organization resolver. MR-5C processor wiring, projection and recovery remain unfinished; MR-5D/E/F are deferred / paused. Billing-provider/account eligibility, verification and setup remain unresolved; Stripe has not been declared unavailable or automatically replaced.

Under accepted `MPG-DEC-050` and `MPG-DEC-051`, MR-6 is **COMPLETE / OWNER ACCEPTED** and MR-7 is the **ACTIVE / IN PROGRESS** milestone. The accepted [MR-7 execution handoff](docs/MR-7-EXECUTION-HANDOFF.md) and [MR-7 Technical-Control Packet](docs/MR-7-TECHNICAL-CONTROL-PACKET.md) document implemented technical controls. **Qualified US/Canada legal/compliance review has not been completed**; review-dependent Terms/Privacy decisions remain open. [PR #6](https://github.com/MPG-Technoologies/MPG-Reputation/pull/6) is a legal-intake document pending Owner merge approval, not a legal conclusion. Case B catastrophic-loss privacy restoration is unresolved and **OWNER-EXCLUDED / DO NOT IMPLEMENT**.

MR-5 stays **PAUSED / INCOMPLETE** pending the external billing-provider dependency; MR-1B-H hosted email-domain validation stays **DEFERRED**. MR-8 remains **GATED** until the accepted prerequisites and a separate Owner decision are reconciled. Company Stage 1 remains active. Live billing, real charging, final pricing/terms, real-customer data or pilots, live messaging, commercial marketing, public launch and Company Stage 2 remain unauthorized.

## Architecture Summary

- **Frontend & App Framework**: Next.js 16 (App Router, Server Actions, React Server Components) with TypeScript
- **Database & Auth**: Supabase PostgreSQL with strict Row Level Security (RLS) policies and `@supabase/ssr` authentication
- **Background Workflows**: Inngest 4.x for durable event-driven workflows, step delays, outbox processing, and bounded reminder lifecycle
- **Email Messaging Core**: `EmailProvider` interface (`ConsoleEmailProvider` for local dev; `ResendEmailProvider` for production messaging core)
- **Reminder Operations**: Strictly bounded single reminder (`MAX_REMINDERS = 1`), pre-reminder eligibility recheck, and hard stops on click, suppression, or cancellation
- **Security & Integrity**: Cryptographic opaque tokens for tracked review redirects (`/r/[token]`), RFC 8058 one-click unsubscribe headers, idempotent event ingestion, and real-time dashboard updates

---

## Development Setup

### Prerequisites
- Node.js 22 recommended (required by the current Supabase client test harness for native WebSocket support)
- pnpm
- Supabase CLI only when using an intentionally isolated, local synthetic database
- Inngest CLI (for local workflow orchestration)

### Running Locally

1. **Install dependencies** (Node.js 22 and pnpm 10.33.2 per `package.json`):
   ```bash
   pnpm install
   ```

2. **Configure a safe synthetic development environment**: supply the engineering/test Supabase URL and anon key through untracked `.env.local`, or use an explicitly isolated local Supabase stack. Hosted Supabase is the accepted default for bounded engineering; never run broad destructive resets against it. Keep `EMAIL_PROVIDER=console`, `ENABLE_LIVE_EMAIL=false`, and `ENABLE_RETENTION_MAINTENANCE=false`. Do not commit credentials.

3. **Start the Next.js development server**:
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

4. **Start the Inngest local development server** (only when testing local workflow orchestration):
   ```bash
   pnpm inngest:dev
   ```
   Access the Inngest development dashboard at [http://localhost:8288](http://localhost:8288).

5. **Run safe checks** (no database-backed tests):
   ```bash
   pnpm install --frozen-lockfile
   pnpm lint
   pnpm exec next typegen
   pnpm typecheck
   pnpm exec vitest run test/domain/activation-readiness.test.ts test/integration/redirect-safety.test.ts
   pnpm build
   ```
   The merged [Internal CI workflow](.github/workflows/internal-ci.yml) runs the reviewed 26-file allowlist and build automatically on pull requests. The separate [Isolated Synthetic E2E workflow](.github/workflows/isolated-synthetic-e2e.yml) runs one database-backed test on a disposable local Supabase stack. **Do not run unrestricted `pnpm test` against the shared hosted engineering database**: the suite contains tests that create, mutate, and delete database fixtures (including `test/domain/cas.test.ts`). Use a separately scoped, safe database test plan instead.

---

## Non-Negotiable Safety & Integrity Rules

1. **Neutral Review Solicitation**: Review gating, positive-only filtering, fake reviews, and rating-prediction filters are strictly prohibited. All review requests must remain neutral.
2. **Strict Tenant Isolation**: Database RLS is mandatory on all public tables; users may only access data belonging to organizations where they hold active membership in `organization_users`.
3. **No Sensitive Healthcare Data (Zero PHI)**: Never accept or store clinical, medical, diagnosis, or treatment records. Test fixtures must strictly use synthetic business data.
4. **Open Redirect Prevention**: Tracked redirect tokens resolve strictly to confirmed, stored Google review destinations. Arbitrary query-parameter redirects are rejected.
5. **Messaging Guards**: LIVE customer messaging remains OFF until separately authorized. Development defaults to console logging.
6. **Public Repository Warning**: Assume this repository and Git history are public. Never commit passwords, tokens, API keys, private credentials, or real customer personal information.

---

## Documentation & Governance References

- [`AGENTS.md`](./AGENTS.md) — Mandatory developer and AI agent operating instructions.
- [`docs/PRD.md`](./docs/PRD.md) — Product Requirements Document (V0.1 baseline).
- [`docs/MARKET-READY-ROADMAP.md`](./docs/MARKET-READY-ROADMAP.md) — Market-Ready Engineering Roadmap (MR-0 through MR-11).
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — System architecture, domain boundaries, and data flow.
- [`docs/SECURITY.md`](./docs/SECURITY.md) — Security policies, RLS controls, and secret hygiene.
