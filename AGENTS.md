# Instructions for AI and Development Agents — MPG Reputation

| Metadata | Value |
|---|---|
| Document | MPG Reputation product repository instructions |
| Status | ACTIVE |
| Product / WIP subject | MPG Reputation / Review & Reputation Automation — `PROD-REP-001` |
| Scope | Market-Ready Build Program (MR-0 through MR-11) |
| Current Program | MPG Reputation Market-Ready Development |
| Current Engineering Milestone | MR-3 — Completion Source Platform ACCEPTED (`MPG-DEC-047`); MR-4 — Trial / Usage / Economics COMPLETE / READY FOR OWNER REVIEW |
| Governance Source of Truth | `E:\MPG` (Company OS) |
| Authority | `MPG-DEC-038` through `MPG-DEC-047` |
| Public Safe | Yes |

These instructions apply to Codex, ChatGPT, Antigravity, Claude, Gemini, automated development tools, and all future agents working in this repository.

## 1. Authority and Governance

1. **Company OS is the Governance Source of Truth**: Business intent, commercial scope, product authorization, stage boundaries, and governance decisions are defined in `E:\MPG`. This repository contains the technical implementation code.
2. **Market-Ready Build Program Authorized**: Under `MPG-DEC-046` and `MPG-DEC-047`, MPG Reputation is developed independently through a complete market-ready build program (MR-0 through MR-11) before broad MPG company/brand development resumes.
3. **Market-Ready STATUS is Not Yet Achieved**: Market-ready development is authorized, but market-ready STATUS is not yet achieved. Building commercial infrastructure does NOT itself grant `PILOT_READY`, `DELIVERY_READY`, `MARKET_APPROVED`, `ACTIVE`, marketing approval, public launch, real-customer messaging, final pricing, or legal/compliance approval.
4. **MR-3 Completion Source Platform is ACCEPTED (`MPG-DEC-047`); MR-4 Trial / Usage / Economics is COMPLETE / READY FOR OWNER REVIEW; MR-5 Billing is NEXT / STRICTLY GATED**:
   - Production messaging architecture (Resend email, domain authentication, bounce/complaint handling, delivery monitoring) is built with synthetic verification.
   - **LIVE customer messaging remains OFF** until separately authorized.
   - SMS remains strictly gated.
   - Billing (Stripe) belongs to milestone MR-5 and must not be implemented prematurely.
   - Do not prematurely implement unrelated roadmap phases.
5. **No Unsupported Launch Claims**: Do not mark the product active, market-approved, delivery-ready, or publicly launched in code, documentation, or commits.

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
