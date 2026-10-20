# MPG Reputation — Accelerated Engineering Delivery Playbook

**State:** OWNER-DIRECTED PROCESS IMPLEMENTATION / READY FOR REVIEW ON A PRODUCT FEATURE BRANCH.  
**Date:** 2026-10-20  
**Scope:** Faster feature delivery within existing Company OS governance. This is an engineering workflow change, **not** permission to merge `main`, change Company Stage, deploy, run real messaging, activate payments, use real customer data, or bypass existing owner/security/commercial gates.

## Why this change

MPG Reputation is an **existing Next.js / TypeScript / Supabase** product; preserving accepted working architecture is mandatory. We accumulated an exceptionally long series of stacked billing slices without mainline integration or authenticated browser journeys. The cumulative billing candidate is already available as [draft PR #67](https://github.com/MPG-Technoologies/MPG-Reputation/pull/67), not another slice to rebuild. Its integration review is separate from this process change. The founder has explicitly accepted accelerating delivery by grouping related feature work, validating real user workflows and eliminating unnecessary repeated checks while maintaining security and reversibility.

**Current remote baseline when this proposal was authored:** `techwithmpg/mpg-company-os` main `03a48a34481f1952a31cd5c4fb980bc381432d8d`; `MPG-Technoologies/MPG-Reputation` main `6b7ac073432921789314315ec5fc624a81d8f699`. Reread both before each substantial workstream. Company OS `MPG-DEC-049/050/051` still records MR-5 formally PAUSED / INCOMPLETE for external provider readiness, MR-6 OWNER ACCEPTED, MR-7 active/legal gate, MR-8 gated. Later owner instructions authorize bounded provider-independent engineering only; do not label MR-5 owner accepted, billing live or production ready.

## Delivery model — one coherent branch/PR per owner-approved workstream

1. **FETCH / INSPECT:** verify the latest Company OS `main`, product `main`, latest commits, relevant handoff and existing implementation. Confirm accepted architectural decisions and detect concurrent PR branches. Do not reopen already accepted features or assume a prior chat snapshot remains current.
2. **DEFINE THE OUTCOME:** name one real **customer or MPG admin journey**, acceptance criteria, trust boundaries and blockers. A feature is not defined by a collection of disconnected helpers. Examples: *client can onboard, set a review link, and complete a synthetic request*; *MPG support can inspect audited TEST billing recovery*. Keep provider credentials and host dependencies explicitly gated.
3. **USE ONE WORKSTREAM PR:** create one feature/integration branch for an approved coherent goal, not one PR per test/helper/document. Commit **small, scoped, reversible changes** within that branch, stage only intended paths, and do not use `git add .` or `git add -A`. Existing approved PR #67 remains the billing integration review surface. Do **not** independently merge its prior stacked PRs. Unrelated work uses an independent feature branch, without pretending it is integrated.
4. **IMPLEMENT AND VERIFY IN LOOP:** inspect current code; make one bounded implementation change; run the narrowest relevant tests, lint/types where appropriate; fix any failures; repeat. New SQL/RLS/tenant/billing authority requires disposable/approved TEST database integration and security tests **even during development**. Do not defer tests that determine whether the change is safe.
5. **INTEGRATE AT A MEANINGFUL CHECKPOINT:** test complete API-to-UI flows using **synthetic identities**. Run full repository CI, disposable DB migration/replay, tenant isolation, idempotency, suppression, audit and browser/device verification for changed user-facing journeys. Review the **whole diff** and migration order for the PR—not just the last commit. For PR #67, this includes comprehensive review of its accumulated SQL and financial authority and an explicit owner merge decision.
6. **REPORT EVIDENCE, NOT PROGRESS THEATER:** concise summary of actual UX, code/route changes, exact checks run, branch/commit/PR, remaining P0 blockers, and the next product-user journey. Label `ENGINEERING COMPLETE` only after verification; `READY FOR OWNER REVIEW` is not `OWNER ACCEPTED`; owner acceptance is not deployment.
7. **OWNER ACTIONS REMAIN SEPARATE:** no merge to `main`, production deploy, hosted infrastructure/destructive action, real customer pilot, live billing/messaging, financial settlement, final commercial price, marketing/launch, or Company Stage change without explicit appropriate owner authorization. A feature-development approval is **not** release authority.

### Working branches, work-in-progress and integration checkpoints

- **Track A — existing billing integration:** [draft PR #67](https://github.com/MPG-Technoologies/MPG-Reputation/pull/67). Full 17-migration/security/financial diff and owner review; defer provider TEST and financial finality until accounts/decisions exist. No more billing micro-PRs without a distinct functional blocker.
- **Track B — operational application:** after remote comparison and within owner-approved scope, address complete synthetic client journeys and MPG admin/support flows (onboarding, link confirmation, completion, neutral review request, delivery guard, Usage & Trial and read-only support). Work on one coherent journey at a time. Reuse existing UI/auth/RLS.
- **Track C — trust/release dependencies:** MR-7 qualified legal/compliance review and review-dependent technical decisions are external/owner gated. Prepare evidence without claiming legal completion or activating MR-8/pilot/launch.
- **WIP limit:** target one active integration-review stream (A) plus one independently scoped product-delivery stream (B); C tracks external prerequisites without inserting speculative schema. Parallelize only truly independent streams; do not ask the owner to review routine commits.

## CI policy — fast where safe, exhaustive where needed

Existing workflow names, job names, credential checks and production kill switches stay in place.

| Change type | Local development checks | Pull-request CI | Integration / merge gate |
| --- | --- | --- | --- |
| **Markdown-only:** `README.md` or `docs/**/*.md` | Markdown/link/content review | Fast classifier preserves required check runs, skips pnpm/build and disposable Supabase | Owner/document review as needed |
| **Code, test, SQL, RLS, config, lockfile, scripts, workflow, auth or unknown** | Relevant targeted tests; typecheck/lint for changed TS/Next surfaces; DB-backed tests for SQL/security | **Full existing application CI and isolated database workflow, unchanged** | Complete regression, required security/tenant review and full diff |
| **UI/customer journey** | Targeted component/route tests plus realistic synthetic screens | Full code CI | Authenticated desktop/mobile browser journey, role and tenant boundary acceptance |
| **Provider/financial finalizer** | **BLOCKED pending specific approval and TEST credentials** | Synthetic checks only until provider enabled | Separate authorized provider TEST, immutable financial evidence, commercial/legal controls; no LIVE shortcuts |

### Implemented conservative change classifier

`.github/scripts/classify-ci-changes.sh` reads **all file changes** in a pull request against its GitHub base ref. It uses NUL-delimited names, includes file deletions, checks the remote base ref exists, and emits `docs_only=true` only when the nonempty entire diff contains **exclusively `README.md` or Markdown under `docs/`**.

- **Pull requests only.** A push to `main`, manual `workflow_dispatch`, an empty diff, a failed diff, unknown file/path or missing base **never** skips heavyweight verification. Classifier failures fail CI.
- A changed `AGENTS.md`, `.github/`, configuration, SQL migration, test, code, shell script or any other file triggers both workflows' full original checks.
- Both workflows retain their original job names and safety settings. They perform the classifier and necessary environment/safety gate even when Markdown-only, then skip dependency install, app tests/build and local Docker startup only in the safe case.
- This fast path does **not** speed up executable pull requests by removing tests. Code development accelerates primarily by batching related commits and avoiding needless new PRs. Existing cancel-in-progress CI concurrency also prevents paying for superseded full PR runs.
- The classifier and CI changes themselves are **executable changes**, so the first PR receives full checks. A zero-network synthetic Git fixture suite (`.github/scripts/test-ci-change-scope.sh`) executes on every Internal CI run and checks Markdown-only PRs, push/dispatch, code changes, mixed changes, code deletion, workflow changes, empty diffs and unknown base refs. A real docs-only PR smoke remains a separate deployment-of-policy check before relying on the skip path for branch protection.
- Do not apply a broad `paths-ignore` workflow trigger that would strand a **required** check in a pending state; keeping required job names is intentional.

## Product-level definition of done and stop conditions

**ENGINEERING COMPLETE** for a functional user journey means: same-org role/action visibility, tenant isolation, permission/failure handling, no duplicate charges/requests/events, signed redirect safety, suppression/unsubscribe, genuine UI states, automated regression, full scoped diff and no secrets are verified. A backend contract with no wired UI must instead be reported as *foundation complete*, not full feature complete.

If a slice introduces RLS/auth/authorization weakening, a destructive change, new provider/credentials, production impact, conflicting accepted governance, legally uncertain consent, new financial authority or a material scope expansion: **stop that specific change, present the owner decision**, and proceed with other independent authorized work.

## Immediate execution after adopting this playbook

1. Review and accept this independent **process/CI PR**; do not merge it automatically. Confirm GitHub workflow tests.
2. On existing [PR #67](https://github.com/MPG-Technoologies/MPG-Reputation/pull/67), finish the comprehensive SQL/financial/tenant security review as **one integration gate**, rather than opening repeated billing slices. Summarize concrete blockers and request explicit owner permission if/when safe to merge provider-OFF engineering. No live billing.
3. Prepare **one integrated synthetic operational acceptance branch** from the latest product baseline after verifying prior features. First user journey: founder/client signs up, onboards location/destination, executes Quick Complete, sees review-request/usage states; ensure neutral solicitation and console-only delivery. Evidence needs authenticated desktop/mobile browser checks where runnable; do not claim those were executed from Vitest alone.
4. Retain MR-7 legal review and MR-1B-H domain verification as named external gates. MR-8 and commercial activation remain blocked until deliberate owner decisions.

**Priority rule:** every subsequent update should reduce remaining product-user acceptance gaps, not merely increase the count of branches, tests, documents, or milestones.
