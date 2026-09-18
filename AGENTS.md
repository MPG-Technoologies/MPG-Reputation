# Instructions for AI and Development Agents — MPG Reputation

| Metadata | Value |
|---|---|
| Document | MPG Reputation product repository instructions |
| Status | ACTIVE |
| Product / WIP subject | MPG Reputation / Review & Reputation Automation — `PROD-REP-001` |
| Scope | V0.1 Vertical Slice Only |
| Governance Source of Truth | `E:\MPG` (Company OS) |
| Authority | `MPG-DEC-038` through `MPG-DEC-044` |
| Public Safe | Yes |

These instructions apply to Codex, ChatGPT, Antigravity, Claude, Gemini, automated development tools, and all future agents working in this repository.

## 1. Authority and Governance

1. **Company OS is the Governance Source of Truth**: Business intent, commercial scope, product authorization, stage boundaries, and governance decisions are defined in `E:\MPG`. This repository is the technical implementation repository.
2. **No Silent Business-Scope Changes**: Do not expand product boundaries, add unapproved service families, or alter business intent without an explicit accepted decision in `E:\MPG`.
3. **Current Scope is V0.1 Only**: The authorized target is the first synthetic vertical slice:
   `login → organization → location → Google review destination → Quick Complete → customer.completed → eligibility → Inngest workflow → development email → tracked link → click record → HTTP 302 redirect → dashboard`.
4. **No Public-Launch Claims**: Do not mark the product active, market-approved, delivery-ready, or publicly launched. No pricing, Stripe, or billing implementation in V0.1.

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
   - Local development defaults to `ConsoleEmailProvider`. Live sending via `ResendEmailProvider` requires explicit server configuration.
   - Do not implement SMS (Twilio), CRM native connectors, Google OAuth review syncing, or billing in V0.1.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
