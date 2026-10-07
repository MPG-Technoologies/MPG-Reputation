# MR-7 — Trust / Security / Compliance: Execution Handoff

| Metadata | Value |
|---|---|
| Date | 2026-10-07 |
| Authority | Owner direction (Company OS source of truth: techwithmpg/mpg-company-os @ 7df63fb75cc184197b11fcbdeca1b1d333a8e81a; reconciliation outstanding; MPG-DEC-050 uncommitted) |
| Milestone | MR-7 (Trust / Security / Compliance) — ACTIVE |
| Milestone Slices | **MR-7B.1 — OWNER ACCEPTED**<br>**MR-7B.2 — READY FOR OWNER REVIEW** (NOT `MR-7 — COMPLETE`) |
| Current Bounded Slice | MR-7B.2 — Sender Identity + Compliance Footer |
| Inspected Product Baseline | `07e83fd368e2f262a116f1f09dd105b71fc0043f` (on `main`) |
| Feature Branch | `chatgpt/mr7b2-sender-identity-footer` |
| Public Safe | Yes; synthetic fixtures only; zero customer PII / postal address in audit metadata |

---

## 1. Slice History & Authority Tracking

- **MR-7B.1 — OWNER ACCEPTED**:
  - Authority evidence foundation table (`public.messaging_authority_evidence`) and trigger on `customer_completion_events`.
  - Suppression table delete hardening (direct tenant DELETE revoked).
  - Final send-time permission and suppression invariant in `checkFinalEmailDispatchAuthority`.
  - Merged into `main` at commit `07e83fd368e2f262a116f1f09dd105b71fc0043f`.
- **MR-7B.2 — READY FOR OWNER REVIEW**:
  - Sender identity enforcement: real email provider dispatch (`provider.name === 'resend'`) requires usable business postal address from the tenant location (`public.locations.address`).
  - Fail-closed invariant on missing address (marks review request `FAILED`, records zero-PII audit event `review_request.dispatch_blocked` with `decision: 'SENDER_IDENTITY_INCOMPLETE'`, zero send attempts, zero cost).
  - Retry-compatible: when location address is subsequently configured, retry claims the `FAILED` request and dispatches cleanly.
  - Reminder parity: freshly validates sender identity before reminder invocation; missing address blocks reminder without regressing historical status (`SENT`/`DELIVERED`/`CLICKED`).
  - Synthetic path compatibility: `ConsoleEmailProvider` continues operating for local dev/testing without hard blocking, rendering the address when present.
  - Reused existing `public.locations.address` schema; zero database migrations required.

---

## 2. MR-7B.2 Architecture & Design Decisions

### 2.1 Postal Address Domain Utility
- File: `src/domain/email/postal-address.ts`
- Utility: `sanitizePostalAddress(address?: string | null): string | null`
- Properties:
  - Strips NUL bytes and ASCII control characters (`\x00-\x08`, `\x0B-\x0C`, `\x0E-\x1F`, `\x7F`).
  - Normalizes CR, LF, and tab sequences into single spaces.
  - Collapses multiple whitespace characters into a single space and trims.
  - Enforces a bounded maximum length of 300 characters.
  - Returns `null` for empty, whitespace-only, or non-string inputs.
  - International-address compatible without statutory or country-specific assumptions.
  - Does NOT fabricate missing address elements.
  - HTML escaping is deferred to rendering time.
  - Exported through `src/domain/email/index.ts`.

### 2.2 Email Input Contract & Template Footers
- `ReviewRequestEmailInput` extended with optional `businessPostalAddress?: string | null` in `src/domain/email/types.ts`.
- `ReviewReminderEmailInput` automatically shares the same contract.
- Pure email composer (`composeReviewRequestEmail`, `composeReviewReminderEmail`) remains transport-agnostic and free of database dependencies.
- Templates updated:
  - `src/domain/email/template-html.ts`
  - `src/domain/email/template-text.ts`
  - `src/domain/email/template-reminder-html.ts`
  - `src/domain/email/template-reminder-text.ts`
- Semantic footer structure when address is present:
  - Identified business name (`escapeHtml(safeBusinessName)`)
  - Full postal address (`escapeHtml(safePostalAddress)`)
  - Delivery attribution (`Delivered using MPG Reputation.`)
  - Unsubscribe link (`opt out of future review-request emails`)
- Neutrality preserved: no guarantees, no ratings, no incentives, no tracking pixels.
- Fallback footer preserved when address is absent (for synthetic dev/test runs).

### 2.3 Send-Time Sender Identity Check (`checkFinalEmailSenderIdentity`)
- Location: `src/inngest/functions/review-request.ts`
- Scopes queries strictly by `organizationId` and `locationId`:
  - `organizations`: `id, name, status`
  - `locations`: `id, organization_id, name, status, address, review_reply_to_email`
- Cross-tenant/cross-location leakage strictly prevented (returns `LOCATION_NOT_FOUND` if location does not belong to organization).
- Returns sanitized `businessName`, `businessPostalAddress`, `reviewReplyToEmail`, and operational `decision`:
  - `ELIGIBLE`
  - `ORGANIZATION_NOT_FOUND` / `ORGANIZATION_INACTIVE`
  - `LOCATION_NOT_FOUND` / `LOCATION_INACTIVE`
  - `SENDER_IDENTITY_INCOMPLETE` (when address is missing or empty)

### 2.4 Live Provider Fail-Closed Rule
- Evaluated immediately before provider dispatch in both initial send and reminder send.
- When `emailProvider.name === 'resend'` and `!senderIdentity.allowed`:
  - Initial send:
    - Provider is **NOT** called.
    - `provider_send_attempt` is **NOT** recorded in `usage_ledger`.
    - No provider cost is incurred.
    - Review request is marked `FAILED` with sanitized error message `Business postal address required before live email dispatch` (retry-compatible).
    - Zero-PII audit event `review_request.dispatch_blocked` is recorded (`decision: 'SENDER_IDENTITY_INCOMPLETE'`, NO postal address, NO customer email, NO tokens).
  - Reminder send:
    - Provider is **NOT** called.
    - Historical status (`SENT`, `DELIVERED`, `CLICKED`) is **preserved** and never regressed.
    - `reminded_at` remains `NULL`.
    - Zero-PII audit event `review_request.reminder_blocked` is recorded (`decision: 'SENDER_IDENTITY_INCOMPLETE'`).

### 2.5 Location Actions & Settings UX
- `src/actions/locations.ts`:
  - `createLocation` and `updateLocationSettings` sanitize address input using `sanitizePostalAddress`.
  - Existing strict RBAC (`OWNER`/`ADMIN` allowed, `OPERATOR`/`VIEWER` denied) and cross-tenant checks preserved.
  - Audit event metadata excludes postal address.
- `src/app/app/settings/location/page.tsx`:
  - Label refined to "Business Mailing Address".
  - Explanatory helper text added: "Used in review-request email footers. Enter the complete business mailing address for this location. Required before live review emails can be sent."
  - Input field constrained with `maxLength={300}`.
  - No claims of legal certification.

---

## 3. Files Modified in MR-7B.2

| File | Nature of Change |
|---|---|
| `src/domain/email/postal-address.ts` | **NEW**: Postal address normalization and sanitization utility |
| `src/domain/email/index.ts` | Exported `postal-address` from domain barrel |
| `src/domain/email/types.ts` | Added `businessPostalAddress?: string | null` to `ReviewRequestEmailInput` |
| `src/domain/email/template-html.ts` | Added `businessPostalAddress` support to HTML template footer with escaping |
| `src/domain/email/template-text.ts` | Added `businessPostalAddress` support to plain-text template footer |
| `src/domain/email/template-reminder-html.ts` | Reminder HTML parity with initial email footer |
| `src/domain/email/template-reminder-text.ts` | Reminder plain-text parity with initial email footer |
| `src/domain/email/compose.ts` | Passed sanitized `businessPostalAddress` to HTML and text templates |
| `src/inngest/functions/review-request.ts` | Added `checkFinalEmailSenderIdentity`, wired fail-closed live send and reminder checks |
| `src/actions/locations.ts` | Added `sanitizePostalAddress` on location creation and updates |
| `src/app/app/settings/location/page.tsx` | Refined UI label to "Business Mailing Address", added helper text and `maxLength={300}` |
| `test/domain/email-composition.test.ts` | Added 10 MR-7B.2 domain tests covering address sanitization, footer rendering, and escaping |
| `test/integration/location-reply-to-auth.test.ts` | Added 6 tests for postal address authorization, sanitization, and audit metadata |
| `test/integration/mr7b2-sender-identity.test.ts` | **NEW**: 9 integration tests proving live send fail-closed, retry, reminder, and multi-location isolation |
| `docs/MR-7-EXECUTION-HANDOFF.md` | Updated handoff documentation |

---

## 4. Verification & Test Results

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | **PASS** | TypeScript 5 cleanly passes with zero errors |
| `pnpm lint` | **PASS** | ESLint passes with zero warnings, zero errors |
| `pnpm test test/domain/email-composition.test.ts` | **PASS** | 29 tests passed (all 10 MR-7B.2 domain tests passed) |
| `pnpm test test/providers/email-headers.test.ts` | **PASS** | 6 tests passed |
| `pnpm test test/integration/location-reply-to-auth.test.ts` | **PASS** | 14 tests passed (including 6 postal address authorization tests) |
| `pnpm test test/integration/mr7b1-authority-send-invariant.test.ts` | **PASS** | 5 tests passed (B1 regression clean) |
| `pnpm test test/integration/real-rls.test.ts` | **PASS** | 15 tests passed (PostgreSQL RLS clean) |
| `pnpm test test/domain/` | **PASS** | 18 test files, 209 tests passed |
| `pnpm test test/integration/mr7b2-sender-identity.test.ts` | **PASS** | 9 integration tests passed (fail-closed, retry, reminder, multi-location) |
| `npx supabase db lint --local` | **PASS** | Local Supabase schema clean (0 errors) |
| `pnpm build` | **PASS** | Production build succeeded; all 18 routes compiled |

---

## 5. Remaining MR-7 Slices

1. **MR-7B.3**: Production suppression management & re-authorization workflow (audited re-consent path).
2. **MR-7C**: Privacy lifecycle:
   - Tenant-requested customer deletion / erasure orchestration.
   - Data export / portability endpoints.
   - Retention policy enforcement and purge scheduling.
   - Outbox and audit payload PII anonymization / redaction.
3. **MR-7D**: Compliance and legal review of terms, disclosures, and neutral solicitation language before pilot or live messaging.

---

## 6. Rollback Implications

If rollback of MR-7B.2 is required:
1. Revert application code changes in:
   - `src/domain/email/`
   - `src/inngest/functions/review-request.ts`
   - `src/actions/locations.ts`
   - `src/app/app/settings/location/page.tsx`
2. No database rollback SQL is required because no database migrations were created.
3. Existing locations and review requests remain completely unaffected.

---

## 7. Owner Gate

- **Milestone Status**: MR-7 is ACTIVE; MR-7B.1 is **OWNER ACCEPTED**; MR-7B.2 is **READY FOR OWNER REVIEW**.
- **Live messaging remains disabled** (`ENABLE_LIVE_EMAIL=false`).
- **Live billing remains paused** under `MPG-DEC-049`.
- **Controlled Pilot (MR-8) remains strictly GATED**.
- Feature branch `chatgpt/mr7b2-sender-identity-footer` is prepared for review.
- No merge to `main` has occurred. No production deployment has occurred.
