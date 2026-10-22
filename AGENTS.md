# Instructions for AI and Development Agents — MPG Reputation

| Metadata | Value |
|---|---|
| Document | MPG Reputation product repository instructions |
| Status | ACTIVE |
| Product / WIP subject | MPG Reputation / Review & Reputation Automation — `PROD-REP-001` |
| Scope | Market-Ready Build Program (MR-0 through MR-11) |
| Current Program | MPG Reputation Market-Ready Development |
| Current Engineering Milestone | MR-6 COMPLETE / OWNER ACCEPTED (`MPG-DEC-050`); MR-7 Trust / Security / Compliance ACTIVE / IN PROGRESS (`MPG-DEC-050`, `MPG-DEC-051`); MR-5 PAUSED / INCOMPLETE; MR-1B-H DEFERRED; MR-8 GATED |
| Governance Source of Truth | `E:\MPG` (Company OS) |
| Authority | Accepted Company OS decisions through `MPG-DEC-051`; latest explicit Owner decision controls |
| Public Safe | Yes |

These instructions apply to Codex, ChatGPT, Antigravity, Claude, Gemini, automated development tools, and all future agents working in this repository.

## 1. Authority and Governance

1. **Company OS is the Governance Source of Truth**: Business intent, commercial scope, product authorization, stage boundaries, and governance decisions are defined in `E:\MPG`. This repository contains the technical implementation code.
2. **Market-Ready Build Program Authorized**: Under `MPG-DEC-046` and `MPG-DEC-047`, MPG Reputation is developed independently through a complete market-ready build program (MR-0 through MR-11) before broad MPG company/brand development resumes.
3. **Market-Ready STATUS is Not Yet Achieved**: Market-ready development is authorized, but market-ready STATUS is not yet achieved. Building commercial infrastructure does NOT itself grant `PILOT_READY`, `DELIVERY_READY`, `MARKET_APPROVED`, `ACTIVE`, marketing approval, public launch, real-customer messaging, final pricing, or legal/compliance approval.
4. **MR-6 is COMPLETE / OWNER ACCEPTED; MR-7 is ACTIVE / IN PROGRESS (`MPG-DEC-050`, `MPG-DEC-051`)**:
   - Production messaging architecture (Resend email, domain authentication, bounce/complaint handling, delivery monitoring) is built with synthetic verification.
   - **LIVE customer messaging remains OFF** until separately authorized.
   - SMS remains strictly gated.
   - MR-5 remains INCOMPLETE, not accepted or closed. Preserve safe checkpoint `d654656b59810877502d2e737dd236ae83b9c379`; MR-5C processor/projection/recovery and MR-5D/E/F remain paused while billing-provider/account eligibility, verification and setup are unresolved. No automatic provider replacement.
   - The accepted MR-7 execution handoff and technical-control packet cover implemented technical controls. **Qualified US/Canada legal/compliance review remains outstanding**, so Terms/Privacy decisions and MR-7 closeout are not approved. The legal-intake PR #6 remains unmerged pending Owner action; do not infer legal conclusions from an Owner intake assumption.
   - Resume and complete remaining MR-5 before any gate materially dependent on billing or charging; MR-1B-H remains deferred. MR-8 stays gated until MR-7 legal review, MR-5, MR-1B-H and other prerequisites are deliberately reconciled and the Owner explicitly authorizes it. Case B catastrophic-loss privacy restoration remains **UNRESOLVED / OWNER-EXCLUDED / DO NOT IMPLEMENT**. No live billing, charging, messaging, real-customer data/pilot, final pricing/terms, marketing, launch or later Company Stage activation follows.
   - Do not prematurely implement unrelated roadmap phases.
5. **Remote-first continuation**: Before substantial work, inspect current `main` and relevant handoffs in both `techwithmpg/mpg-company-os` and `MPG-Technoologies/MPG-Reputation`; preserve accepted architecture and implement bounded changes on feature branches, not `main`. Never merge, deploy production, change Company Stage, or enable gated operations without explicit Owner authorization.
6. **Safe database/test boundaries**: Hosted Supabase is the default engineering/test environment and contains synthetic fixtures; bounded mutations in approved engineering slices are allowed, not broad resets or unrelated tenant changes. The existing unrestricted `pnpm test` includes database-mutating tests; do **not** run it on shared hosted Supabase. Use the reviewed no-database test allowlist in `.github/workflows/internal-ci.yml`, or a separately isolated/scoped database test plan. Do not treat CI success as legal approval, production deployment, or pilot readiness.
7. **No Unsupported Launch Claims**: Do not mark the product active, market-approved, delivery-ready, or publicly launched in code, documentation, or commits.

## 2. Non-Negotiable Operational Rules

1. **Review-Integrity Rules (Strictly Enforced)**:
   - Prohibit review gating, positive-only solicitation, fake reviews, paid reviewers, rating prediction filters, or sentiment-conditional incentives.
   - Review requests must remain strictly neutral: "If you'd like to share your experience, we'd appreciate your honest feedback."
   - Eligibility must never evaluate customer happiness, complaints, or predicted star ratings.
2. **Security & Data Isolation**:
   - Every exposed database table must have Row Level Security (RLS) enabled.
   - Database tenant isolation is mandatory: users access only rows for organizations where they hold active authorized membership in `organization_users`.
   - Never use editable user metadata for authorization.
   - Never expose Supabase service-role credentials or private provider API keys to the browser or in git.
3. **Public-Safety and Sensitive Data**:
   - Assume this repository and Git history are public. Never commit real customer, patient, client, or partner data.
   - No clinical records, diagnoses, medical notes, treatment records, or PHI/HIPAA data may ever be accepted or stored. Use synthetic test fixtures only (e.g. `Northstar Dental`, `Acme Plumbing`).
   - Never commit passwords, tokens, private keys, API keys, or live credentials.
4. **Idempotency & Concurrency**:
   - `customer.completed` event persistence must be strictly idempotent on `(organization_id, source, source_event_id)`.
   - Double-clicks, network retries, and workflow re-executions must never generate duplicate customer requests or duplicate emails.
5. **Open Redirect Prevention**:
   - The tracked link route `/r/[token]` resolves destinations strictly from verified, confirmed stored database records.
   - Never accept arbitrary destination URLs from query parameters or user-supplied input at redirect time.
6. **Provider Abstraction**:
   - Keep third-party integrations behind narrow domain provider interfaces (`EmailProvider`, etc.).
   - Local development defaults to `ConsoleEmailProvider`. In MR-1, production email architecture using `ResendEmailProvider` may be engineered, but live sending to real customers remains disabled until explicitly activated and authorized.
   - SMS (Twilio), CRM native connectors, Google OAuth review syncing, and billing are tied to their respective milestones in `docs/MARKET-READY-ROADMAP.md` and must not be added out of sequence.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
