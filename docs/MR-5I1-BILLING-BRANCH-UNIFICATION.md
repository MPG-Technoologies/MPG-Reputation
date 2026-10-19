# MR-5I1 — Isolated integration of MR-5C and MR-5D/E billing branches

**Status: IN PROGRESS — combined verification required.**

## Remote source
Company OS main `03a48a34481f1952a31cd5c4fb980bc381432d8d` governs MR-5 incomplete, MR-7 security active; later owner directives approve non-live engineering only. Product main `6b7ac073432921789314315ec5fc624a81d8f699` is unchanged. MR-5C source PR #25 `fd10ecde5d15283a3421de89e3d3dc2e4e2fec09`; MR-5D/E source PR #50 `483d939512cf8d4a6f1d72a2dcea685bf50cc7a6`; both unmerged. PR #51 established four textual conflicts.

## Scoped two-parent integration merge
- Feature branch `chatgpt/mr5i1-billing-branch-unification`; first parent MR-5D/E, second MR-5C. Never merge or deploy main.
- Incorporates all **27 MR-5C-only files** using exact Git blob IDs: lease/worker modules, four migrations, domain/integration tests and handoff documentation.
- Preserves MR-5D/E webhook store as it already contains MR-5C's `Pick`-narrowed claim row (MR-5C's only unique edit to this file) **plus** MR-5E2C signature-verified invoice identifier.
- Combines DB types with MR-5C subscription leases, `processing_attempts`, `next_processing_attempt_at`, and 7 MR-5C RPCs while retaining the MR-5E `provider_invoice_id`/invoice attempt counter/customer-review types.
- Combines allowlisted internal tests, disposable DB tests and isolated recovery-queue/operator suites.
- MR-5C created the shared `processing_lease_token` and `processing_lease_expires_at`; MR-5E2D2 now uses `ADD COLUMN IF NOT EXISTS` for those two, **without resetting lease state**. Its distinct `processing_attempt_count` column remains; shared lease fencing must be regression-tested.

## Gates and limitations
Run lint, typecheck, synthetic build, combined full disposable PostgreSQL migration chain and all original MR-5C/MR-5D/E security/tenant/replay suites; investigate/fix any integration failures. This branch merge alone does **not** establish a complete operational payment system or connect the subscription worker to the HTTP webhook.
No Stripe credentials or real provider proof; no live charges, hosted DB migrations, production changes, paid-entitlement writes, final price approval, or customer messaging. The 30 Free Review Requests trial is unchanged.
