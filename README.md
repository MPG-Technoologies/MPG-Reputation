# MPG Reputation

Automated, neutral review collection and reputation management for local businesses following legitimate completed transactions.

---

## Strategic Architecture

- **Relationship**: `MPG → MPG Reputation`
- **Identity**: MPG Reputation is a dedicated product platform subordinate to the MPG master company architecture (`MPG-DEC-043`).
- **Governance Source of Truth**: MPG Company OS
- **Local Workspace**: `E:\MPG`
- **Scope & Repository**: This repository (`techwithmpg/mpg-reputation`) contains the technical implementation code for the dedicated product application and website (`MPG-DEC-039`, `MPG-DEC-044`).

---

## Current Status & Program

| Dimension | Current State |
|---|---|
| **Program** | **Market-Ready Build Program** authorized under `MPG-DEC-046` |
| **Status** | V0.1 Technical Foundation Accepted (`MPG-DEC-045`); V0.2 Controlled Staging & Usability Proven Baseline |
| **Current Milestone** | **MR-1 Production Messaging Core (MR-1A, MR-1B, MR-1C locally accepted; MR-1D next)** |
| **Commercial Release** | **GATED** — The product is NOT yet publicly launched; commercial release and marketing approval remain gated |
| **Customer Messaging** | **OFF** — Live customer messaging remains disabled until separately authorized |

---

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
- Node.js 20+
- pnpm
- Supabase CLI (for local database migrations)
- Inngest CLI (for local workflow orchestration)

### Running Locally

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Start the Next.js development server**:
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

3. **Start the Inngest local development server**:
   ```bash
   pnpm inngest:dev
   ```
   Access the Inngest development dashboard at [http://localhost:8288](http://localhost:8288).

4. **Run tests and validation**:
   ```bash
   pnpm test           # Run Vitest test suite
   pnpm typecheck      # TypeScript typechecking
   pnpm lint           # ESLint analysis
   ```

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
