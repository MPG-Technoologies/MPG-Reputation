# MPG Reputation — Security Policy & Controls v0.1

| Metadata | Value |
|---|---|
| Product | MPG Reputation (`PROD-REP-001`) |
| Version | 0.1 |
| Status | ACTIVE SECURITY SPECIFICATION |
| Date | 2026-09-17 |

## 1. Security Architecture Principles

1. **Row Level Security (RLS) by Default**: All tables exposed to the Supabase Data API must enable RLS. Every access policy requires active tenant membership.
2. **Server-Verified Authentication**: Web requests to protected routes `/app/*` verify authentication on the server through `@supabase/ssr`. Never trust client-controlled user metadata for authorization.
3. **No Service-Role Key in Browser**: The `SUPABASE_SERVICE_ROLE_KEY` is strictly server-only and reserved for non-RLS operations (such as token resolution in `/r/[token]`, workflow background execution, or initial user onboarding).
4. **Defense Against Open Redirects**: The tracked redirect endpoint `/r/[token]` resolves strictly to verified, confirmed Google review URLs stored in `review_destinations`. Arbitrary query parameters are ignored.
5. **Neutral Review Requests (No Gating)**: System-level controls forbid filtering or biasing requests based on sentiment, rating forecasts, or complaints.
6. **Zero PHI / Sensitive Data**: No health information, medical records, diagnosis, or clinical notes may enter the database. Test fixtures must use synthetic business data only.
7. **Idempotent Execution**: Concurrency controls and unique database constraints prevent duplicate message sending on retries, double-clicks, or workflow replay.

## 2. Environment Variables & Secret Hygiene

- `NEXT_PUBLIC_SUPABASE_URL`: Public Supabase API endpoint.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Public anonymous API key (subject to RLS).
- `SUPABASE_SERVICE_ROLE_KEY`: Secret administrative key (server-only).
- `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`: Workflow orchestration keys (server-only).
- `RESEND_API_KEY`: Opt-in production email sending key (server-only).
- `EMAIL_PROVIDER`: Defaults to `console` in development. Live email sending requires explicit configuration.
