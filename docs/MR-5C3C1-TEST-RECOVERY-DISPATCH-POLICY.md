# MPG Reputation — MR-5C3C1 TEST Recovery Queue Policy

| Item | Status |
|---|---|
| Slice | MR-5C3C1 — bounded retry cooldown, queue inspection, disabled-by-default dispatcher |
| Base | MR-5C3B2 [PR #23](https://github.com/MPG-Technoologies/MPG-Reputation/pull/23), `78997db1473a4eb0f8ed277c0de11ef151dba464` |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Company OS main | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Billing mode | TEST ONLY; no Stripe credentials used or hosted migrations applied |
| Current status | ENGINEERING COMPLETE / READY FOR OWNER REVIEW; PR remains unmerged |
| Activation | NOT ACTIVATED; no scheduled trigger, no public API |

## Background

MR-5C3A already added service-only, fenced event processing leases (five-attempt maximum). MR-5C3B1 retrieves Stripe Event identity and current Subscription state, and MR-5C3B2 fences the entire subscription-level Stripe fetch→DB projection + Event finalization. Still missing was *which durable Event to recover next*, a persisted retry delay enforced against every claim, and counts that tell operators when work is backlogged or exhausted.

## MR-5C3C1 changes

1. **New migration** `supabase/migrations/20261018225000_mr5c3c1_test_recovery_queue.sql`. Adds nullable `next_processing_attempt_at`, a narrow partial TEST queue index, and replaces both MR-5C3A processing functions in-place WITHOUT expanding permissions. Every TEST processing claim now honors the persisted deadline, maximum attempts, and conservative Event-age limit. Failed Event finalization sets deadlines:
   - Attempt 1 failure → 30 seconds.
   - Attempt 2 failure → 2 minutes.
   - Attempt 3 failure → 5 minutes.
   - Attempt 4 failure → 15 minutes.
   - Attempt 5 failure → exhausted; no automatic retry.
2. **Service-only queue inventory RPC** `public.inspect_stripe_test_webhook_recovery(p_limit)`, strictly max 10. Returns only internal record UUIDs and aggregate counts: `ready`, `cooldown`, `in_flight`, `exhausted`, `aged_out`. It does not lease or modify rows; the existing atomic lease remains authoritative. Only TEST Stripe events are considered.
3. **New server-only batch orchestrator** `src/lib/billing/stripe-test-recovery-dispatcher.ts`. Disabled unless the **server-side-only** `ENABLE_STRIPE_TEST_RECOVERY_DISPATCHER=true` flag is deliberately set in an authorized environment. When explicitly invoked it selects at most 10 candidates, calls the verified MR-5C3B2 worker sequentially, and returns aggregate counts. It never creates a privileged client, never starts a scheduler, never sends external messages, does not know Stripe credentials, and never exposes raw provider error/PII.
4. Existing lease and worker disposable-DB tests updated to respect the new retry deadline. A new isolated DB test suite checks queue categorization, service-only RPC denial, conservatively aged-out events, cooldown bypass rejection, dispatcher default-disabled behavior, and bounded test-only processing of an unsupported Event type. The queue-specific suite runs separately from existing DB test files to avoid cross-test fixture interference.

## Age-out / historical Stripe Event caveat

Stripe's Event retrieval API allows fetching Events only during the first 30 days after creation. Because the persisted event body is intentionally not replayable from a hash, we **conservatively stop automated Event-ID recovery at 29 days**, measured from the stored provider-created timestamp when present and otherwise received timestamp. This is NOT a guarantee that the provider retains every Event within the window. `aged_out` is a visible operations metric; owners must plan a separate manual reconciliation path that uses trusted Stripe Customer/subscription inventory.

Reference: https://docs.stripe.com/api/events/retrieve

## Security and governance invariants

- All new/replaced SQL functions: **SECURITY INVOKER**, fixed empty search path, explicit `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE TO service_role`; no tenant-owner global billing authority.
- No RLS policies removed or weakened. No raw payment information, raw event payload, credentials, customer email or phone numbers stored. No LIVE processing; all selection and claims hard-block LIVE.
- This change does not automatically run. There is **no scheduler, background deployment, monitoring notification or production job**. The optional server-only flag simply enables an explicit bounded invocation of the unexposed function. This is a *dispatcher engineering checkpoint*, not an activated service.
- No hosted test/production Supabase migration applied, no real Stripe API account connected, no provider charging, checkout, entitlements, marketing, customer pilot, live messaging, MR-8 activation, merge or Company Stage change. Pricing PR #18 remains independent and unpublished (owner engineering proposal: ₱1,500/month, ₱1,000/year total).

## Still required before declaring MR-5C3 complete

**MR-5C3C2:** decide/implement a secured trigger and cadence, confirm alert delivery/owner support visibility for `exhausted` and `aged_out`, build recovery/runbook for unavailable/old Stripe Events, test burst handling and misconfigured credentials, and complete real Stripe **TEST** environment/provider acceptance. Any deployment/hosted mutation/production-key dependencies require separate owner approval. Then proceed to MR-5D customer checkout, MR-5E access enforcement, MR-5F hosted test-mode acceptance. MR-5 remains INCOMPLETE.

## Verification

GitHub Actions verified 2026-10-18 on `fc72ca64236e0ad5f07b0196d3319a80a5c74fcf`:
- [Internal CI #39138431637](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39138431637) — **SUCCESS**: lint, route type generation, TypeScript, synthetic production build, **479/479 synthetic application tests**.
- [Isolated Synthetic E2E #39138431615](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39138431615) — **SUCCESS**: **39/39 previous disposable PostgreSQL integration tests**, followed by **6/6 dedicated TEST recovery queue tests**, cleanup. No hosted DB credentials or provider keys used.
- Review found eight intended files, no production/public billing route change, no real credentials or RLS weakening. This file's verification text update is documentation-only.
