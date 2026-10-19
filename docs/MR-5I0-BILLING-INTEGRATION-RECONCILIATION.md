# MR-5I0 — Billing Branch Integration Reconciliation (read-only preflight)

**Status: IN PROGRESS until remote compatibility preflight and final CI verification.** This checkpoint reports facts and tests whether two previously accepted engineering workstreams can be joined without textual merge conflicts. It does **NOT** integrate them, authorize operational payments, or change main.

## Verified remote governance (2026-10-19)

- Company OS authoritative `techwithmpg/mpg-company-os` `main`: `03a48a34481f1952a31cd5c4fb980bc381432d8d`.
- Product `MPG-Technoologies/MPG-Reputation` `main`: `6b7ac073432921789314315ec5fc624a81d8f699`.
- Company OS MR-5 is still PAUSED / INCOMPLETE under older governance, with subsequent owner authorization for narrowly scoped NON-LIVE engineering. MR-7 remains the approved security milestone; MR-8/pilot, pricing finality, production changes and billing remain gated.
- No Stripe or other payment provider API credentials have been provided. Real hosted provider acceptance is DEFERRED.

## The decisive branch graph

**The approved work is NOT one linear billing branch.** At this checkpoint, GitHub reports all PRs #18–#50 still OPEN / UNMERGED, with these distinct sequences:

1. **MR-5 pricing foundation** — [PR #18](https://github.com/MPG-Technoologies/MPG-Reputation/pull/18): configurable proposed PHP 1,500/month and PHP 1,000/year.
2. **MR-5C subscription webhook processing** — [PR #19](https://github.com/MPG-Technoologies/MPG-Reputation/pull/19) through [PR #25](https://github.com/MPG-Technoologies/MPG-Reputation/pull/25), stacked on product `main`, ending at `chatgpt/mr5c3c2a-recovery-operator-guard`. Includes separate migration/implementation for atomic tenant-safe subscription projection, webhook leases, event finalization, reconciliation worker and disabled recovery dispatch. **This chain was NOT inherited by MR-5D/E.**
3. **MR-5D/E client flow and proof/proposal workflow** — [PR #26](https://github.com/MPG-Technoologies/MPG-Reputation/pull/26) through [PR #50](https://github.com/MPG-Technoologies/MPG-Reputation/pull/50), stacked on **PR #18**, ending at `chatgpt/mr5e3c3c-support-exception-inspection` HEAD `483d939512cf8d4a6f1d72a2dcea685bf50cc7a6`.

GitHub compare of MR-5C head versus MR-5D/E head: `diverged`, **229 commits unique to MR-5D/E** and **56 unique to MR-5C** relative to the common main base. These numbers describe Git history, NOT amount of product engineering completed.

## User-facing billing path — what is and is not working

| Step | Present in remote evidence | Acceptance boundary |
|---|---|---|
| Business login and tenant membership | Existing shared app auth and tenant-scoped billing reads | Not a live billing launch |
| Subscription plan catalog | Configurable proposed monthly/yearly PHP prices | Final prices NOT APPROVED |
| Client Billing UI | `/app/settings/billing` read-only status, gated local-synthetic plan/actions | Real provider and hosted browser TEST acceptance not performed |
| Customer provisioning and checkout | Server-only TEST preflight, reservation and provider adapter contracts (MR-5D) | Not connected to credentials; no real Checkout |
| Stripe webhook intake | `POST /api/webhooks/stripe` verifies signature and durably stores Event ID/hash, invoice reference on MR-5D/E head | A 200 receipt means **claimed**, not processed or paid |
| Tenant-safe subscription projection worker | MR-5C branch has separate leased/serialized reconciliation worker and SQL migrations | **Absent from MR-5D/E branch; not unified/tested together** |
| Invoice financial evidence | MR-5E invoice inbox, provider evidence read port, synthetic proposals | Interface returns NOT_CONFIGURED without adapter; synthetic marker is never verified money |
| Actual paid entitlement and request quotas | Only synthetic `access_authorized=false` proposal/case storage added in MR-5E | No verified authoritative paid entitlement activation or usage enforcement |
| Refund, failed payment, cancellation, operator investigation | Synthetic-only exception classifications, bounded private cases and read-only audited MPG support inspection | No real financial finality, recovery action, case closure or hosted/provider acceptance |

The existing **30 Free Review Requests** trial, suppression/unsubscribe and tenant isolation must be preserved. There is no owner authorization to charge customers or deploy.

## MR-5I0 execution boundary

This slice adds ONLY an informative script plus GitHub Actions preflight workflow:

- Workflow uses an ephemeral GitHub-hosted runner and `contents: read` token.
- It fetches MR-5C source by its remote ref and takes its SHA, target SHA and merge base.
- In a **temporary detached worktree**, it runs `git merge --no-commit --no-ff` to inventory conflicts; it records any unmerged paths and **aborts and deletes the scratch worktree**. Nothing is pushed, merged to any shared branch or committed.
- Its output `NO_TEXT_CONFLICTS_NOT_INTEGRATED` or `CONFLICTS_NOT_INTEGRATED` means only a textual merge preview, NOT schema/behavior compatibility and NOT payment readiness.
- Conflicts are findings, not a signal to force or skip them. No changes to Stripe/payment code, auth, RLS, schema, production, hosted Supabase, customer data or Company OS.
- Standard inherited Internal CI and disposable PostgreSQL verification still run on this branch.

## Acceptance gates after MR-5I0

1. **Reconcile MR-5C into an isolated feature integration branch**, preserving additive MR-5D/E invoice identifier and processing-claim schema; review every overlapping webhook/API/type/workflow/test change. Do not blindly merge shared `main`, force-push or assume auto-merge means safe.
2. Test combined migrations with disposable PostgreSQL in exact order; ensure idempotent event lease, migration naming, tenant/RLS controls, cross-environment protections and organization erasure remain valid.
3. Wire and test one **synthetic, signed TEST event → durable inbox → trusted provider-state stub → tenant-safe atomic subscription projection**. Acknowledgment must not be mistaken for reconciliation. No hosted credentials needed.
4. Keep payment/entitlement **strictly separate**: after authentic provider TEST evidence exists, design a separately approved, atomic financial settlement and paid-access/usage policy that preserves the existing 30 Free Review Requests.
5. Validate owner/client billing UI and return states with browser tests, provider API adapters in TEST when credentials arrive, support exception workflow, cancellation/refund/dunning, and regression/security suites.
6. Seek **owner acceptance, integration branch PR review, and separate gated production/launch approvals**. Final plan prices and yearly-vs-monthly economics remain unapproved.

**This checkpoint deliberately prevents a false declaration that billing is “complete” merely because two separate chains have green tests.**
