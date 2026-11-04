# MR-10I — Prelaunch Application Signup Boundary (Hosted Signup Still Open)

**Date:** 2026-11-04
**Status:** IN PROGRESS — remote engineering prepared; owner-local verification and deployment impact review pending
**Product main baseline:** `5f5a0982ab630e0ab2b2380ec97d482f6444541d` (MR-10H PR #108 merged)
**Company OS main:** `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c`
**Owner evidence:** Hosted MPG Reputation Supabase **Allow new users to sign up = ENABLED**, supplied 2026-11-04.
**Branch:** `chatgpt/mr10i-prelaunch-app-signup-guard-20261104`

## Bounded objective

Prevent the **existing application** from offering or executing development self-signup when its Next.js runtime is not explicitly in development mode and connected to the isolated local Supabase CLI instance. Preserve existing sign-in, sign-out, RLS, organization membership, onboarding and the `dev:bootstrap` workflow.

**This is defense-in-depth and is NOT a hosted Supabase signup shutdown.** The owner verified hosted signup is enabled. The publicly addressable Supabase Auth endpoint may still accept direct Auth signup calls without passing through our Next.js UI or server action. Hosted registration remains an **external-exposure blocker** until separately remediated and verified.

## Implementation

1. `src/lib/auth/local-development-signup.ts`: pure, deterministic gate; returns true **only** if `NODE_ENV === "development"` and a **nonempty, exact**, parsed Supabase origin of `http://127.0.0.1:54331` or `http://localhost:54331` is configured. URL must have no user credentials, path beyond `/`, query or fragment. Everything else fails closed. No public override flag.
2. `src/app/login/page.tsx`: retains the existing sign-in form and server action; renders the **Create Development Account** button only if the gate allows. Otherwise shows a prelaunch explanatory message. No new account capture.
3. `src/actions/auth.ts`: enforces the identical server-side gate **before** reading form credentials, creating a Supabase client, or calling `auth.signUp`. A blocked call redirects back to login with a generic message. Authentication and sign-out logic remain unchanged.
4. `test/integration/mr10i-prelaunch-signup-guard.test.ts`: unit tests for local, hosted, malformed, production and staging environments; source contract confirms server guard precedes the Supabase call and UI preserves sign-in.

## Conditions and limitations

- Do not infer the hosted platform is secure against registration from a hidden button or a server-action check. **Direct calls to the hosted Auth API bypass the application** while hosted signup is enabled.
- Do not expose `pnpm dev` to untrusted networks. Even a local Supabase instance can create development accounts, and the local CLI Auth configuration intentionally permits signup for synthetic tests.
- The project has no sanctioned public trial signup or paid-plan intake yet; enabling email confirmation alone does not solve unwanted account creation.
- This slice does not change hosted Supabase settings, public API keys, sender configuration, auth providers, migrations, production deployment or real user records.
- Separate owner approval is required for hosted Auth configuration changes. Before changing hosted signup, reconcile existing engineering/test account provisioning and any authorized future invite/pilot workflows.
- Do not weaken tenant isolation or use the service-role key as a workaround.
- MR-5 billing, MR-7 qualified privacy/legal work, MR-8 real pilot and MR-11 commercial release remain separately gated; draft MPG-DEC-053 is not accepted Company OS policy.

## Owner-local verification

Safely fetch the feature branch after confirming a clean worktree. From the branch run:

```powershell
pnpm lint
pnpm exec next typegen
pnpm typecheck
pnpm exec vitest run test/integration/mr10i-prelaunch-signup-guard.test.ts test/integration/mr9-public-website-contract.test.ts test/integration/mr10f-integrated-marketing-workspace.test.ts
pnpm build
git diff --check origin/main...HEAD
git status -sb
```

**Targeted expected:** 20 tests (7 MR-10I + 5 MR-9 + 8 MR-10F). Run the checks; never record a pass just from this expected number.

In a production `next start` run, GET `/login` (with an unauthenticated test session), assert the page **does not render** `Create Development Account`, and that an existing permitted user can still sign in. **Do not actually call `auth.signUp` or create a user against the hosted project.** In a development run pointing to hosted Supabase, the Create Development Account button should likewise be absent. In a trusted local-only CLI development setup, the button can appear, but user creation need not be tested to verify visibility.

## Owner-controlled hosted dependency

**Blocker:** hosted MPG Reputation Supabase currently has `Allow new users to sign up` enabled (per owner). To eliminate direct external Auth API self-registration, the owner must separately authorize an appropriate hosted-level signup restriction and have it implemented and independently confirmed, including provider-specific, OAuth/OTP and anonymous signup paths as applicable.

Do **not** claim that a production build or merge of this feature resolves that hosted-level blocker.

## Next

When remote CI and owner-local checks pass, prepare the feature for owner review. No main merge or production deployment without separate approval. Keep a visible follow-up on disabling hosted public signup / establishing controlled account issuance before exposing the website to external audiences.
