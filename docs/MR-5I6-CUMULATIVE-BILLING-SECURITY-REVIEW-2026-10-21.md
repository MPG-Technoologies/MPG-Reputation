# MR-5I6 — Consolidated Billing Security and Integration Review Checkpoint

**Date:** 2026-10-21  
**Status:** INVESTIGATING / READY FOR INDEPENDENT REVIEW; **NOT OWNER ACCEPTED**.  
**Scope:** Provider-OFF cumulative candidate review, security hardening, GitHub-diff inventory and exact-tip synthetic CI evidence. **No production release, customer charge, provider TEST attestation, hosted migration, paid entitlement, or `main` merge.**

## Remote authority and exact checkpoint

- Company OS `techwithmpg/mpg-company-os` `main`: `7a1fb412c5640ee95273f86dcdd4bff5a13a6b9c` (MPG-DEC-052 accelerated engineering, without weakening release gates).
- Product `MPG-Technoologies/MPG-Reputation` `main`: `2eac67089a2e9d9c0e95ed636d3dc8b040fe4823`.
- Consolidated engineering candidate: `chatgpt/mr5i5-integrated-billing-review-20261020`, merge checkpoint `5104efd57547431b2145e8b3de00e01c4299ad29`. At this checkpoint it was **461 commits ahead / 0 behind `main`**; **223 unique changed files**. The main-base review is [draft PR #67](https://github.com/MPG-Technoologies/MPG-Reputation/pull/67). Branch merges below were **only into this candidate**, never `main`.
- Exact integration-head checks: [Internal CI #238](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39535098717) **PASS**; [Isolated Synthetic E2E #230](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39535098737) **PASS**; [isolated real-Chromium acceptance #4](https://github.com/MPG-Technoologies/MPG-Reputation/actions/runs/39535098760) **PASS**; GitHub Vercel check **SUCCESS**. All were run against `5104efd5`.

## Cumulative 223-file patch inventory

The full GitHub PR #67 per-file patch listing was fetched, including all 223 changes and **zero missing patches**. This is a complete **inventory and static pattern scan** of that change set, **not a line-by-line independent security certification**.

| Group | Changed files | Review performed |
| --- | ---: | --- |
| `.github` CI workflows | 3 | Scope, secrets/credential-free execution, localhost-only browser tests |
| `docs` | 51 | Count/inventory and earlier accepted handoff/gates |
| `scripts` | 1 | Synthetic browser script; disposable-only DB and local UI guard |
| `src` | 75 | All filenames scanned for sensitive patterns; targeted analysis of shared-file patches, billing route, worker, projection persistence and provider adapters |
| `supabase` migrations | 21 | All function/table/RLS/grant declaration lines inspected; focused examination of invoice, reconciliation and access-boundary contracts |
| `test` | 72 | Coverage inventory plus targeted Auth/RLS, replay, tenant, invoice, grant and browser regression verification |

### Static security findings, bounded to the fetched diff

1. **10 added `CREATE TABLE public.*` declarations**, each with `ENABLE ROW LEVEL SECURITY` in its corresponding candidate migration. All new SQL function declarations are `SECURITY INVOKER` (or default invoker where applicable). **No added `SECURITY DEFINER` execution statement** found after excluding comments.
2. The only **four `GRANT ALL` declarations** in newly added migrations target the internal `service_role` on mutable operational tables: subscription reconciliation leases, TEST checkout reservations, TEST customer provisioning and TEST billing action limits. Immutable evidence/review tables instead use SELECT/INSERT grants, and the existing isolated privilege tests cover denied client access and service-role mutation. No new GRANT ALL to `PUBLIC`, `anon` or `authenticated` found in the scanned additions.
3. The added patch lines did not contain hard-coded `sk_live_...`, `whsec_...` or `sb_secret_...` credential-shaped secrets. No new `'use client'` module with direct imports of service-role Supabase admin, Stripe, `server-only` or Node cryptography was flagged by the targeted pattern check. **Regex scanning cannot establish absence of all secrets or data-leak paths.**
4. Targeted manual diff inspection of **eight shared application/source patch paths** included usage reporting, legacy Usage and navigation, shared admin UI, webhook invoice reference handling, billing exports and mandatory support inspection audit. The inspected changes were fail-closed tenant/error handling, additive navigation or non-authorizing metadata. Full independent review of all 75 application-source patches remains an owner-acceptance gate.
5. The local billing HTTP action route checks `LOCAL_SYNTHETIC`, `NODE_ENV`, `VERCEL_ENV`, disposable localhost Supabase URL and live-billing status **before** constructing its privileged Supabase client. TEST provider adapters additionally reject non-`sk_test_` credentials and enforce the local disposable runtime. Signed synthetic events and TEST subscription state remain distinct from actual invoice settlement and authorized paid product access.
6. Important known limitation: the Stage 1 quarantine does not fully prohibit a **privileged, tenant-attributed synthetic `PROCESSED` invoice INSERT** used by historical non-authorizing fixtures. It confers **no actual settlement or paid entitlement**; a real owner-accepted provider-authenticated ledger/finalizer must close this as part of the financial design. Do not misinterpret a signed local webhook, invoice draft, ACTIVE projection or test invoice review as proof of funds.

## Security hardening performed in this checkpoint

[PR #77](https://github.com/MPG-Technoologies/MPG-Reputation/pull/77) merged as `5104efd57547431b2145e8b3de00e01c4299ad29`. Audit found the older exported `persistVerifiedStripeSubscriptionCandidate` helper lacked the local-only runtime check present on newer TEST workers, even though its SQL rejects LIVE candidates. The helper now denies hosted/preview, `NODE_ENV=production`, `ENABLE_LIVE_BILLING=true`, and non-disposable Supabase URLs before any privileged RPC. The existing CI-allowlisted worker-environment matrix asserts these failures have **zero RPC/provider calls**. Disposable SQL E2E verifies legitimate localhost TEST projection continues functioning. No RLS, grant, account, deployment, provider or entitlement behavior was broadened.

Recent earlier combined-candidate hardening remains included: immutable invoice review replay ([PR #70](https://github.com/MPG-Technoologies/MPG-Reputation/pull/70)); append-only six-table mutation test ([PR #71](https://github.com/MPG-Technoologies/MPG-Reputation/pull/71)); anonymous recovery-review refusal ([PR #73](https://github.com/MPG-Technoologies/MPG-Reputation/pull/73)); authenticated cross-tenant action admission ([PR #74](https://github.com/MPG-Technoologies/MPG-Reputation/pull/74)); audited client-vs-support journey ([PR #75](https://github.com/MPG-Technoologies/MPG-Reputation/pull/75)); real desktop/mobile Chromium journey ([PR #76](https://github.com/MPG-Technoologies/MPG-Reputation/pull/76)).

## Outstanding gates and specific owner decisions

| Gate | State | Evidence still required |
| --- | --- | --- |
| Independent full code and release security acceptance | **OPEN** | Reviewer sign-off on remaining cumulative source/RPC/tenant/data-flow semantics, connected PR lineage, migration replay/rollback and client/admin scope; sampled/static review is not acceptance |
| Provider-OFF engineering `main` integration | **NOT AUTHORIZED** | Owner approval **after** independent review of draft PR #67; historical stacked branches must not be merged separately as shortcuts |
| Stage 1 financial settlement | **IN PROGRESS** | Provider-attested invoice/charge → Customer/Checkout/Subscription/Price association; immutable accepted terms and one atomic settlement/reversal ledger; zero false positive paid finality |
| Stage 2 paid entitlement lifecycle | **NOT STARTED** beyond proposals | Accepted Stage 1 money truth, policy for renewals, failed invoices, cancel, refund and disputes; independent idempotent RLS-safe authorization |
| Stage 3 product operational acceptance | **IN PROGRESS** | Browser CI now passes scoped desktop/mobile billing/usage and MPG recovery review, but complete signup/onboarding/Quick Complete/delivery/customer portal and all UI permutations remain unverified |
| Stage 4 real provider TEST acceptance | **BLOCKED** | Owner-authorized eligible provider TEST account and environment; actual authenticated Stripe Price/checkout/portal/webhook/settlement/refund tests |
| Commercial/privacy/production activation | **NOT AUTHORIZED** | Approved prices/tax/refund terms, MR-7 qualified legal/privacy review, hosted operational gates, pilot decision and explicit production approval |

**Decision separation:** A = owner consent to merge **provider-OFF** engineering after independent review; B = separately authorized real **provider TEST** verification; C = separately authorized **production/live payments, subscriptions and launch**. No decision implies another. Do not publish the proposed monthly/yearly amounts as accepted pricing; use **30 Free Review Requests**.

## Next safe action

Send draft PR #67 and this checkpoint to an independent reviewer for remaining cumulative security sign-off and migration/release-gate approval. Continue focused non-live repairs only when concrete findings are identified. Keep the provider, financial finalizer, entitlement activation, hosted migrations, production, billing charges and `main` protected.
