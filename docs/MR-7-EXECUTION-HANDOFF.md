# MR-7 — Trust / Security / Compliance: Execution Handoff

| Metadata | Value |
|---|---|
| Date | 2026-10-08 |
| Authority | Owner direction (Company OS source of truth: techwithmpg/mpg-company-os; reconciliation outstanding) |
| Milestone | MR-7 (Trust / Security / Compliance) — ACTIVE |
| Milestone Slices | **MR-7B.1 — OWNER ACCEPTED**<br>**MR-7B.2 — OWNER ACCEPTED**<br>**MR-7B.3 — READY FOR OWNER REVIEW** (NOT `MR-7 — COMPLETE`) |
| Current Bounded Slice | MR-7B.3 — Messaging Payload Minimization |
| Inspected Product Baseline | `02c85f9a410a08608f1204fd8bac03ac05c4c130` (on `main`) |
| Feature Branch | `chatgpt/mr7b3-payload-minimization` |
| Public Safe | Yes; synthetic fixtures only; zero customer PII in outbox or Inngest transport payloads |

---

## 1. Slice History & Authority Tracking

- **MR-7B.1 — OWNER ACCEPTED**:
  - Authority evidence foundation table (`public.messaging_authority_evidence`) and trigger on `customer_completion_events`.
  - Suppression table delete hardening (direct tenant DELETE revoked).
  - Final send-time permission and suppression invariant in `checkFinalEmailDispatchAuthority`.
  - Merged into `main` at commit `07e83fd368e2f262a116f1f09dd105b71fc0043f`.
- **MR-7B.2 — OWNER ACCEPTED**:
  - Sender identity enforcement: real email provider dispatch (`provider.name === 'resend'`) requires usable business postal address from the tenant location (`public.locations.address`).
  - Fail-closed invariant on missing address (marks review request `FAILED`, records zero-PII audit event `review_request.dispatch_blocked` with `decision: 'SENDER_IDENTITY_INCOMPLETE'`, zero send attempts, zero cost).
  - Retry-compatible: when location address is subsequently configured, retry claims the `FAILED` request and dispatches cleanly.
  - Reminder parity: freshly validates sender identity before reminder invocation; missing address blocks reminder without regressing historical status (`SENT`/`DELIVERED`/`CLICKED`).
  - Synthetic path compatibility: `ConsoleEmailProvider` continues operating for local dev/testing without hard blocking, rendering the address when present.
  - Merged into `main` at commit `02c85f9a410a08608f1204fd8bac03ac05c4c130`.
- **MR-7B.3 — READY FOR OWNER REVIEW**:
  - **Core Minimization Invariant**: `customer.completed` event data carries only the 5 operational identifiers necessary to locate authoritative state:
    ```json
    {
      "eventId": "...",
      "organizationId": "...",
      "locationId": "...",
      "customerId": "...",
      "sourceEventId": "..."
    }
    ```
  - **Transient/Transport PII Stripped**: Outbox and Inngest events completely exclude `contact`, `permission`, `country`, `completedAt`, `source`, `sourceCustomerId`, `sourceTransactionId`, `email`, `phone`, `firstName`, and `lastName`.
  - **Authoritative Evidence Records Preserved**: Full customer data (`customers`) and completion records (`customer_completion_events`) remain the immutable source of truth in the database. Customer retention and deletion policies belong strictly to MR-7C.
  - **Database Migration**: `20261008000000_mr7b3_payload_minimization.sql` updates both `submit_quick_complete_atomic` and `submit_completion_system_atomic` to construct the canonical 5-field outbox payload.
  - **Fail-Closed Historical Scrub**: Validates all existing `customer.completed` outbox rows have all 5 operational keys before scrubbing; aborts if any key is missing.
  - **RPC Privilege Preservation**: Explicitly enforces execution boundaries (`authenticated` + `service_role` for Quick Complete; `service_role`-only for System Completion; `PUBLIC`/`anon` revoked).

---

## 2. MR-7B.3 Architecture & Design Decisions

### 2.1 Transport vs. Authoritative Source of Truth
- Inngest events and `domain_event_outbox` payloads serve solely as transient/durable workflow transports.
- Storing full customer contact details and consent data in outbox rows or Inngest event stores created unnecessary duplication of PII across workflow infrastructure.
- Downstream processing (`executeReviewRequestHandler` in `src/inngest/functions/review-request.ts`) already re-fetches authoritative records from Supabase (`customers`, `locations`, `organizations`, `suppressions`).
- Therefore, workflow transports only require the operational foreign keys to locate those authoritative rows.

### 2.2 Event Contract Minimization
- **Inngest Client** (`src/inngest/client.ts`):
  `CustomerCompletedEvent.data` type constrained to exactly:
  ```ts
  eventId: string
  organizationId: string
  locationId: string
  customerId: string
  sourceEventId: string
  ```
- **Review Request Function** (`src/inngest/functions/review-request.ts`):
  `ReviewRequestEventData` updated to require only the canonical 5 fields. Deprecated optional fields (`completedAt`, `country`, `contact`, `permission`) removed from the TypeScript type. Handler runtime remains tolerant of legacy retries containing extra keys (unrecognized keys are ignored).
- **Quick Complete Immediate Dispatch** (`src/actions/quick-complete.ts`):
  `eventPayload` trimmed to the canonical 5 fields while preserving the stable outbox ID as the Inngest event deduplication ID.
- **API Completion Ingestion** (`src/domain/completion/store.ts`):
  `eventPayload` trimmed to the canonical 5 fields while preserving the stable outbox ID as the Inngest event deduplication ID.

### 2.3 Database Migration & Privileges
- Migration file: `supabase/migrations/20261008000000_mr7b3_payload_minimization.sql`.
- Functions modified:
  1. `public.submit_quick_complete_atomic`: writes `jsonb_build_object('eventId', v_completion_event_id, 'organizationId', p_org_id, 'locationId', p_loc_id, 'customerId', v_customer_id, 'sourceEventId', v_source_event_id)` to `domain_event_outbox.payload`.
  2. `public.submit_completion_system_atomic`: writes the identical 5-field JSON to `domain_event_outbox.payload`.
- Privileges preserved:
  - `submit_quick_complete_atomic`: REVOKE from `PUBLIC`, `anon`; GRANT to `authenticated`, `service_role`.
  - `submit_completion_system_atomic`: REVOKE from `PUBLIC`, `anon`, `authenticated`; GRANT to `service_role`.
- Neither function removes rich contact/permission data from `public.customer_completion_events`.

### 2.4 Fail-Closed Historical Outbox Scrub
- Checks all existing rows in `domain_event_outbox` where `event_type = 'customer.completed'`:
  ```sql
  payload ?& ARRAY['eventId', 'organizationId', 'locationId', 'customerId', 'sourceEventId']
  AND payload->>'eventId' IS NOT NULL AND TRIM(payload->>'eventId') <> ''
  ...
  ```
- If any row is missing an operational key, the migration immediately raises an exception and aborts.
- If all rows are valid, updates payload to only the canonical 5 keys while leaving `id`, `organization_id`, `aggregate_id`, `event_type`, `status`, `attempt_count`, `dispatched_at`, and `created_at` unchanged.

---

## 3. Scope Boundaries & Non-Goals

- **Source Record Retention/Deletion**: Retaining or deleting customer PII from `customers` or `customer_completion_events` is strictly within **MR-7C** scope. MR-7B.3 only minimizes transient/durable workflow transports.
- **No Production Deployment**: Hosted Supabase migration application and production deployment remain strictly prohibited until owner authorization.
- **Live Messaging**: Remains completely OFF (`ENABLE_LIVE_EMAIL=false`).
- **Billing**: Unchanged and paused under `MPG-DEC-049`.
- **MR-6**: Admin/support/observability remains undeployed.

---

## 4. Verification Matrix

| Command | Result | Notes |
|---|---|---|
| `pnpm lint` | **PASS** | ESLint passes with zero warnings, zero errors |
| `pnpm typecheck` | **PASS** | TypeScript 5 cleanly passes with zero errors |
| `pnpm test test/domain/mr7b3-payload-minimization.test.ts` | **PASS** | 6 tests passed (Quick Complete & API Inngest dispatch contracts, static migration guard) |
| `pnpm test test/integration/mr7b3-payload-minimization.test.ts` | **PASS** | 3 tests passed (submit_quick_complete_atomic outbox 5-key payload, submit_completion_system_atomic outbox 5-key payload, customer_completion_events rich evidence preservation, historical scrub & fail-closed validation) |
| `pnpm test test/integration/outbox-recovery.test.ts` | **PASS** | 2 tests passed (minimized outbox recovery + legacy payload backwards-compatibility) |
| `pnpm test test/domain/completion-ingestion-schema.test.ts` | **PASS** | 6 tests passed (MR-3 ingestion schema) |
| `pnpm test test/integration/mr7b1-authority-send-invariant.test.ts` | **PASS** | 5 tests passed (B1 regression clean) |
| `pnpm test test/domain/email-composition.test.ts` | **PASS** | 29 tests passed (B2 regression clean) |
| `pnpm test test/integration/mr7b2-sender-identity.test.ts` | **PASS** | 9 tests passed (B2 sender identity regression clean) |
| `pnpm test test/integration/location-reply-to-auth.test.ts` | **PASS** | 17 tests passed (B2 location reply-to regression clean) |
| `pnpm test test/integration/real-rls.test.ts` | **PASS** | 15 tests passed (PostgreSQL RLS clean) |
| `pnpm test test/domain/` | **PASS** | 19 test files, 215 tests passed |
| `npx supabase db lint --local` | **PASS** | Local Supabase schema clean (0 errors) |
| `pnpm build` | **PASS** | Production build succeeded; all 18 routes compiled |

---

## 5. Remaining MR-7 Slices

1. **MR-7C**: Privacy lifecycle:
   - Tenant-requested customer deletion / erasure orchestration.
   - Data export / portability endpoints.
   - Retention policy enforcement and purge scheduling.
   - Historical audit payload PII anonymization / redaction.
2. **MR-7D**: Compliance and legal review of terms, disclosures, and neutral solicitation language before pilot or live messaging.

---

## 6. Rollback Implications

If rollback of MR-7B.3 is required:
1. Revert application code changes in:
   - `src/inngest/client.ts`
   - `src/inngest/functions/review-request.ts`
   - `src/actions/quick-complete.ts`
   - `src/domain/completion/store.ts`
2. Apply down-migration or revert RPCs to earlier versions if database migration was applied.
3. Downstream handlers can continue reading either format safely because handler logic resolves all state from authoritative DB tables.

---

## 7. Owner Gate

- **Milestone Status**: MR-7 is ACTIVE; MR-7B.1 & MR-7B.2 are **OWNER ACCEPTED**; MR-7B.3 is **READY FOR OWNER REVIEW**.
- **Live messaging remains disabled** (`ENABLE_LIVE_EMAIL=false`).
- **Live billing remains paused** under `MPG-DEC-049`.
- **Controlled Pilot (MR-8) remains strictly GATED**.
- Feature branch `chatgpt/mr7b3-payload-minimization` is prepared for review.
- No merge to `main` has occurred. No production deployment has occurred. No hosted database mutation has occurred.
