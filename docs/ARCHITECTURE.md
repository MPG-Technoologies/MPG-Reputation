# MPG Reputation — System Architecture v0.1

| Metadata | Value |
|---|---|
| Product | MPG Reputation (`PROD-REP-001`) |
| Version | 0.1 |
| Status | IMPLEMENTATION ARCHITECTURE |
| Date | 2026-09-17 |

## 1. System Overview

MPG Reputation V0.1 provides an automated, neutral review collection loop for local businesses. It automates review requests following genuine customer completions without review gating or sentiment manipulation.

### Core Lifecycle
```text
[Business User] 
       │
       ▼ Authenticates & Onboards
[Organization & Location & Google Review Destination]
       │
       ▼ Submits via Quick Complete
[customer.completed Event Persisted (Idempotent)]
       │
       ▼ Inngest Workflow Triggered
[Server-Side Eligibility Engine]
       │
       ▼ (Configurable Delay & Recheck)
[Create Review Request & Tracked Link]
       │
       ▼ EmailProvider (Console / Resend)
[Email Delivered with Opaque Tracked Link]
       │
       ▼ Customer Clicks Link (/r/[token])
[Safe HTTP 302 Redirect to Confirmed Stored Google URL]
       │
       ▼ Clicks & Events Recorded
[Dashboard Reflects Truthful Metrics]
```

## 2. Technology Stack

- **Framework**: Next.js 16.3.5 (App Router, Turbopack, React Server Components, Server Actions)
- **Language**: TypeScript 5.x
- **Database & Auth**: Supabase Postgres with Row Level Security (RLS) & Supabase Auth (`@supabase/ssr`)
- **Workflow Engine**: Inngest 4.x (`serve` handler via Next.js App Router API route)
- **Email Abstraction**: `EmailProvider` interface
  - `ConsoleEmailProvider` (default for local development & synthetic tests)
  - `ResendEmailProvider` (opt-in via explicit server environment flag)
- **Testing**: Vitest for pure domain logic, tenant isolation, and integration checks

## 3. Layered Design

```text
src/
├── app/                  # Next.js App Router routes
│   ├── (auth)/login/     # Supabase Auth sign-in
│   ├── (dashboard)/app/  # Authenticated product workspace
│   │   ├── dashboard/    # Truthful activity dashboard
│   │   ├── quick-complete/ # Manual completion ingestion form
│   │   └── settings/     # Locations & Google destination setup
│   ├── api/inngest/      # Inngest workflow serve endpoint
│   └── r/[token]/        # Public tracked redirect handler
├── domain/               # Pure business domain logic
│   ├── eligibility/      # Pure eligibility engine & rules
│   ├── completion/       # Canonical completion event normalization
│   ├── destination/      # Google review destination URL validator
│   └── tracking/         # Cryptographic token generator & validator
├── providers/            # Vendor abstractions
│   ├── email/            # EmailProvider, ConsoleEmailProvider, ResendEmailProvider
│   └── workflow/         # Workflow event dispatcher interface
├── lib/                  # Shared utilities & database clients
│   └── supabase/         # Server client, browser client, service client (restricted)
└── types/                # Core domain and database schemas
```

## 4. Key Security & Operational Principles

1. **Multi-Tenant Isolation via RLS**: Every table holding tenant data enforces RLS requiring active membership in `organization_users`.
2. **Server-Verified Identity**: Routes and actions verify Supabase user session on the server.
3. **Open Redirect Prevention**: `/r/[token]` exclusively resolves to validated, owner-confirmed Google review URLs stored in the database.
4. **Idempotency**: Completion submissions enforce uniqueness on `(organization_id, source, source_event_id)` to prevent duplicate requests.
5. **No Review Gating**: Eligibility checks never evaluate customer sentiment, satisfaction, complaints, or expected ratings.
