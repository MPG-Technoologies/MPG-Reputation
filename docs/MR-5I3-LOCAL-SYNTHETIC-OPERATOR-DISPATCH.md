# MR-5I3 — Local synthetic signed webhook → sealed operator dispatch

**State: ENGINEERING COMPLETE / READY FOR OWNER REVIEW — not OWNER ACCEPTED.**

## Verified remote
- Company OS `techwithmpg/mpg-company-os` main: `03a48a34481f1952a31cd5c4fb980bc381432d8d`; MR-5 remains incomplete, MR-7 trust/security is owner-approved under governance. Owner later approved bounded non-live payment preparation.
- Product `MPG-Technoologies/MPG-Reputation` main: `6b7ac073432921789314315ec5fc624a81d8f699` (unchanged).
- Parent PR #53 MR-5I2: `47c839556e74c2106a80e3e74135871718bc5822`, verified and unmerged.
- **No actual Stripe or other payment provider API, hosted acceptance, production deployment or final pricing approval.**

## Important pre-existing implementation fact

MR-5C already implemented `dispatchStripeTestRecoveryBatch`, a queue-inventory-driven batch invoking the existing fenced `processDurableStripeTestEvent`, and the token-sealed `runAuthorizedLocalStripeRecoveryOperation`. These are **manual, server-only, TEST-only** utilities. We must reuse, not duplicate, this architecture. The public webhook route only persists authenticated events; it does not invoke or schedule workers. A signed payload is NOT verified settlement.

## Bounded changes

1. Add `process.env.NODE_ENV === 'production'` to the existing operator's pre-dispatch exclusion checks. Existing local database, Vercel, explicit ENABLE flags, LIVE flag and timing-safe operator token guards remain unchanged. This prevents accidental operation from a production Node build even when a loopback database happens to be configured.
2. Add a focused unit regression for NODE_ENV production refusal before any provider/DB call.
3. Add **real signed webhook → existing token-checked operator → queue selector → event+subscription fenced worker → atomic TEST projection** disposable PostgreSQL acceptance. Provider API retrievers remain **in-memory fakes**. Tests cover:
   - Disabled and incorrect-token denial before queue reads or provider retrieval; then explicit authorized dispatch;
   - One worker claims an actual signed durable TEST event, processes and projects only mapped tenant/customer, observes replay as zero new work;
   - Provider failure leaves the event FAILED with cooldown; no immediate retry, then **test-only database clock override** lets the existing worker recover using the *current* fake subscription state, not event metadata;
   - Concurrent operator invocations cannot double process one durable event;
   - Unresolved foreign provider Customer fails closed even when event metadata lies;
   - Paid entitlement proposal ledger stays empty and **30 Free Review Requests** remain unchanged.
4. Add a separate disposable database CI step after other suites, because the queue selector is global and should not consume unrelated fixture rows.

## Limits and remaining gates

- This does NOT introduce a new dispatcher, payment provider adapter, HTTP worker route, cron, live scheduling, paid access, messaging or hosted database mutations.
- Only isolated test/manual operator invocation triggers processing. The existing public webhook response still means **durable receipt**, not processed.
- Existing MR-5C operator accepts a caller-injected privileged database client and provider retrievers: this is an internal engineering contract, not an authenticated platform support UI.
- We are still using in-memory fake provider data, not financial settlement proof. MR-5E invoice evidence and paid entitlements remain separately gated. No commercial launch, external API or charge.
- This integration is stacked and unmerged; `main` is unchanged.

## Verification

Require Internal CI lint/typecheck/682+ tests/build, disposable combined 184+ PostgreSQL tests plus the new operator path, clean teardown and scoped diff. Next engineering should tackle **provider-independent processing-to-evidence orchestration** with explicit security and receipt-versus-settlement boundaries; credential-backed TEST acceptance remains deferred.

## Verified engineering checkpoint
- Initial CI exposed an invalid direct assignment to the read-only `process.env.NODE_ENV` type in the test fixture; replaced with Vitest `vi.stubEnv` and restored automatically after the test. No production-control relaxation.
- [Internal CI #39236325820](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39236325820): PASS — lint, Next route generation, TypeScript, **682/682 application tests in 47 files**, synthetic build.
- [Isolated Synthetic E2E #39236326037](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39236326037): PASS — **176/176 scoped disposable PostgreSQL tests in 24 files**, **6/6 retry dispatcher**, **2/2 prior sealed operator**, **4/4 new signed operator-dispatch**, total **188/188**; local DB teardown PASS. Superseded earlier DB workflow was canceled in favor of corrected commit.
- Diff review: only five intended files — existing operator production guard, operator domain test, new isolated signed dispatcher integration test, workflow test stage, and this handoff. No new API, migrations, RLS, provider calls, hosted Supabase or paid entitlement modification.
- Live billing, real Stripe API credentials, provider settlement verification, and production deployment remain disabled/unavailable. The webhook still does not trigger an automatic worker invocation; the sealed operator must be called explicitly.
