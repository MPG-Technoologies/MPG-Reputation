# MR-10H — Hosted Auth Self-Signup Exposure: Read-Only Evidence Check

**Date:** 2026-11-04
**Status:** INVESTIGATING — hosted signup flag NOT VERIFIED; no settings changed
**Product main baseline:** `f211873f943e3db8d48e9c07d6245a638cf13878` (MR-10G PR #107 merged, green post-merge CI)
**Company OS main baseline:** `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`
**Scope:** MR10-AUD-01 only, without changes to live Supabase Auth, tenant membership, application authentication, billing or deployment.

## Findings

1. `src/components/marketing/site/SiteNav.tsx` and `SiteFooter.tsx` link to `/login`.
2. `src/app/login/page.tsx` contains a **Create Development Account** action, wired to the server-side `signUp` implementation in `src/actions/auth.ts`.
3. `signUp` directly calls `supabase.auth.signUp` with email and password. The current action contains no separate prelaunch allowlist or deny condition.
4. `supabase/config.toml` contains `[auth] enable_signup = true` and `[auth.email] enable_signup = true`. **This is the repository's LOCAL-CLI configuration; it does not prove the hosted project has the same setting.** Preserve it as local testing evidence, not a hosted diagnosis.
5. The connected Supabase account lists an active and healthy project named `mpg-reputation` (engineering/test). The installed Supabase MCP exposes project details and database inspection, but **does not expose a direct hosted Auth general-configuration read action**. No hosted signup enable/disable value has been obtained through this audit.
6. Supabase's current Auth general-configuration documentation states that **Allow new users to sign up** is the relevant setting: when disabled, only existing users can sign in. The Supabase Auth project's public, read-only `GET /auth/v1/settings` endpoint may return `disable_signup`. This should be checked without creating a user, and only after confirming the target is the MPG Reputation hosted project.
7. Even if hosted signup is enabled, that establishes potential Auth account creation, **not** automatic access to an organization, tenant data or working product features. Any authorization issue would require its own distinct proof. Conversely, email confirmation is not an adequate substitute for denying new account creation.

## Required read-only host verification

Use the owner-authorized Supabase dashboard for **mpg-reputation**:

- Open **Authentication → General configuration** (or **Authentication → Sign In / Providers**, if the dashboard moves the control).
- Read **Allow new users to sign up**; record the displayed enabled/disabled value, the project identity and the date.
- Check whether separate email signup or OAuth/anonymous signup methods are enabled; a single provider switch is not equivalent to the global signup gate.
- **Do not toggle, save, invite, create accounts, send test emails, or modify any configuration** as part of this read-only inspection.

An optional safe technical cross-check is a **GET only** of the project's `/auth/v1/settings` endpoint with its **public publishable/anon API key** supplied as a request header, not pasted into URLs, chat, commits or logs. Inspect only the `disable_signup` boolean (if returned); treat an absent field or unsuccessful request as **unverified**. Never call `signUp` to test the setting. The project URL and public key can be read from the owner-local `.env.local`; do not disclose key material in audit evidence.

## Decision matrix

| Verified hosted value | Implication | Safe next step |
| --- | --- | --- |
| Global signup **disabled** (or `disable_signup: true`) | General public self-signup is disabled; product's Create Development Account button becomes misleading but does not by itself establish successful account creation. | Plan a scoped UI wording/visibility improvement. Keep existing authentication intact. Verify any provider-specific exceptions before an external staging audience. |
| Global signup **enabled** (or `disable_signup: false`) | The existing visible signup action can potentially create Auth accounts. Account activation/verification rules and later tenant permissions remain separate. | Raise a **prelaunch external-exposure blocker**. Propose a bounded, fail-closed account-intake design for owner approval, including hosted-config and app-route controls and regressions; do not change settings without explicit authorization. |
| Hosted value unavailable, wrong project, or conflicting signals | Exposure is **not verified**. | Keep external signup/marketing/pilot blocked. Obtain owner dashboard evidence before any implementing change. |

## Boundaries and follow-ups

- No production deployments or hosted Auth changes; no account creation, real-user data reads, database SQL or privilege escalation.
- Do not disable an existing internal sign-in flow without a scoped impact analysis. A later implementation must preserve current internal testing, account recovery, tenant isolation, auditability and all RLS and admin controls.
- MR-10 marketing engineering may be integrated while **MR-11 market release remains GATED**; MPG Company OS Stage 6 is not activated; Company OS decision PR #4 remains draft.
- Audit is **not a penetration test or independent authentication assessment**.

## Verification record

**Source-read checks completed:** Company OS main, product main, actual client login, server sign-up action, local Supabase configuration, and connected hosted project identity/status.
**Hosted Auth allow-signup setting:** NOT VERIFIED as of this report.
**Application code changes:** NONE.
**Next:** owner-provided read-only hosted flag or safe public-settings GET result, then owner-reviewed disposition of MR10-AUD-01.
