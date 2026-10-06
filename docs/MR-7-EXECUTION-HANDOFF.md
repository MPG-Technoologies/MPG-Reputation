# MR-7 — Trust / Security / Compliance: Execution Handoff

| Metadata | Value |
|---|---|
| Date | 2026-10-07 |
| Authority | Owner direction (Company OS source of truth: techwithmpg/mpg-company-os @ 7df63fb75cc184197b11fcbdeca1b1d333a8e81a; reconciliation outstanding; MPG-DEC-050 uncommitted) |
| Milestone | MR-7 (Trust / Security / Compliance) — ACTIVE |
| Slice Status | **MR-7B.1 — READY FOR OWNER REVIEW** (NOT `MR-7 — COMPLETE`) |
| Bounded Slice | MR-7B.1 — Authority Evidence Foundation + Send-Time Suppression Invariant |
| Inspected Product Baseline | `edf47ef61e6a46b53746d0ef70e60023cbe03b98` |
| Feature Branch | `chatgpt/mr7b1-authority-send-invariant` |
| Public Safe | Yes; synthetic fixtures only; zero PII in audit metadata |

---

## 1. MR-7B.1 Objective

Implement the smallest safe trust/compliance foundation needed for durable messaging authority evidence and last-moment suppression enforcement:

1. **Append-Oriented Messaging Authority Evidence**: Introduce `public.messaging_authority_evidence` capturing operational permission assertions observed by MPG Reputation upon customer completion ingestion.
2. **Strict Semantic Boundary (No Legal Certification Claim)**: The system observes and records operational permission states; it **does NOT** legally certify consent validity under CAN-SPAM, CASL, PIPEDA, TCPA or any other statute. Historical capture dates are never inferred (`asserted_at = NULL`).
3. **Suppression Hardening**: Remove direct `DELETE` capability for tenant users (including OWNER and ADMIN) on `public.suppressions`. Suppression removal must occur solely through an explicit, audited re-authorization workflow.
4. **Final Send-Time Authority & Suppression Invariant**: Freshly re-read current permission and suppression directly from the database source of truth immediately after claiming `SENDING` and before provider email dispatch (initial send, workflow retry, and reminder send).

Full customer deletion lifecycle, privacy export, and automatic retention orchestration belong to later MR-7 slices and remain out of scope for MR-7B.1.

---

## 2. Exact Database Migration

Migration file: `supabase/migrations/20261007000000_mr7b1_authority_evidence.sql`

### 2.1 Table: `public.messaging_authority_evidence`
```sql
CREATE TABLE IF NOT EXISTS public.messaging_authority_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES public.organizations(id) ON DELETE CASCADE,

    customer_id UUID NOT NULL,

    completion_event_id UUID NOT NULL,

    channel TEXT NOT NULL
        CHECK (channel IN ('email', 'sms')),

    asserted_state TEXT NOT NULL
        CHECK (asserted_state IN ('allowed', 'unknown', 'denied')),

    assertion_kind TEXT NOT NULL
        DEFAULT 'OPERATIONAL_PERMISSION_STATE'
        CHECK (
            assertion_kind IN ('OPERATIONAL_PERMISSION_STATE')
        ),

    permission_source TEXT NOT NULL,

    completion_source TEXT NOT NULL,

    source_event_id TEXT NOT NULL,

    country VARCHAR(2),

    asserted_at TIMESTAMPTZ,

    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    basis_type TEXT,

    capture_method TEXT,

    evidence_reference TEXT,

    policy_version TEXT,

    actor_type TEXT NOT NULL DEFAULT 'system',

    actor_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (
        organization_id,
        completion_event_id,
        channel
    ),

    CONSTRAINT fk_mae_customer
        FOREIGN KEY (
            customer_id,
            organization_id
        )
        REFERENCES public.customers(
            id,
            organization_id
        )
        ON DELETE CASCADE,

    CONSTRAINT fk_mae_completion
        FOREIGN KEY (
            completion_event_id,
            organization_id
        )
        REFERENCES public.customer_completion_events(
            id,
            organization_id
        )
        ON DELETE CASCADE
);
```

### 2.2 Indexes
- `idx_mae_org_customer_channel_created` on `(organization_id, customer_id, channel, created_at DESC)`
- `idx_mae_org_completion_event` on `(organization_id, completion_event_id)`

### 2.3 Row Level Security (RLS) & Privilege Boundaries
- `ALTER TABLE public.messaging_authority_evidence ENABLE ROW LEVEL SECURITY;`
- Strictly **SYSTEM / SERVICE-ROLE CONTROLLED**.
- Table permissions are explicitly revoked from `PUBLIC`, `anon`, and `authenticated`:
  ```sql
  REVOKE ALL ON public.messaging_authority_evidence FROM PUBLIC, anon, authenticated;
  GRANT ALL ON public.messaging_authority_evidence TO service_role;
  ```
- Authenticated tenant users and anonymous callers have zero access (`SELECT`, `INSERT`, `UPDATE`, `DELETE` are completely denied with error `42501`).
- Eliminates cross-tenant inspection, leakage, or tampering of messaging authority evidence.

### 2.4 Suppression Policy & Privilege Hardening
- `DROP POLICY IF EXISTS sup_delete ON public.suppressions;`
- Explicit privilege revoke:
  ```sql
  REVOKE DELETE ON public.suppressions FROM authenticated;
  ```
- Authenticated users (OWNER, ADMIN, OPERATOR, VIEWER) cannot delete suppression rows directly from client or API queries (denied with error `42501`).
- Public unsubscribe insertion and lookup remain fully operational.

### 2.5 Trigger on `customer_completion_events`
- `AFTER INSERT ON public.customer_completion_events` executes `record_messaging_authority_evidence_from_completion()`.
- Captures separate email and SMS operational permission states (`allowed`, `unknown`, or `denied`).
- Falls back to `unknown` for any invalid or missing permission value.
- Derives `permission_source` preferring `permission->>'source'`, falling back to `source`, then `'unspecified'`.
- Sets `asserted_at = NULL` (never derived from ingestion, completion, or customer creation timestamps).
- Sets `observed_at = now()`, `capture_method = 'completion_event_assertion'`, and `evidence_reference = NEW.source_event_id`.
- Idempotent via `ON CONFLICT (organization_id, completion_event_id, channel) DO NOTHING`.

---

## 3. Authority Evidence Semantics & Compliance Boundaries

1. **Operational Permission Assertion, NOT Certified Legal Consent**:
   - The record reflects only what the tenant completion event asserted at ingestion time.
   - It does not constitute legal certification that consent meets statutory standards under CAN-SPAM, CASL, PIPEDA, or TCPA.
   - No historical permission backfill was performed for existing customers with `permission_email = 'allowed'`.
2. **No Inferred Timestamps**:
   - Consent capture timestamps cannot be deduced from server ingestion time or transaction times.
   - `asserted_at` remains strictly `NULL` until a certified capture provenance mechanism is integrated.
3. **Strict Zero-PII Audit Invariant**:
   - Audit logs for blocked dispatches store only operational metadata (`reviewRequestId`, `stage`, `decision`).
   - Raw emails, phone numbers, unsubscribe tokens, tracking tokens, and customer names are excluded from audit metadata.

---

## 4. Final Send-Time Authority & Suppression Invariant

In `src/inngest/functions/review-request.ts`:

1. **Helper `checkFinalEmailDispatchAuthority`**:
   - Freshly queries the database for `customers` (`id, first_name, email, permission_email`) scoped by `(customerId, organizationId, locationId)`.
   - Normalizes email (`trim().toLowerCase()`).
   - Computes suppression hash via `hashSuppressionContact('email', email)` and checks `public.suppressions`.
   - Evaluates:
     - Missing customer or empty email $\rightarrow$ `NO_CONTACT` (`allowed: false`)
     - Active suppression present $\rightarrow$ `SUPPRESSED` (`allowed: false`)
     - Permission is `denied` $\rightarrow$ `EMAIL_PERMISSION_DENIED` (`allowed: false`)
     - Permission not `allowed` $\rightarrow$ `EMAIL_PERMISSION_UNKNOWN` (`allowed: false`)
     - Allowed & unsuppressed $\rightarrow$ `ELIGIBLE` (`allowed: true`)
2. **Initial Send Execution**:
   - Immediately after atomic claim of `SENDING` state and **BEFORE** provider usage accounting, message composition, and provider dispatch:
     - If `SUPPRESSED`: marks review request `SUPPRESSED`, records audit event `review_request.dispatch_blocked`, and aborts cleanly.
     - If `NO_CONTACT` / `EMAIL_PERMISSION_DENIED` / `EMAIL_PERMISSION_UNKNOWN`: marks review request `CANCELLED` (`cancelled_at = now()`), records audit event `review_request.dispatch_blocked`, and aborts cleanly.
     - If `ELIGIBLE`: dispatches to the **freshly retrieved** customer email.
3. **Workflow Retry Execution**:
   - Because the check executes on every atomic claim of `SENDING` (claimable from `FAILED` or stale `SENDING`), retried dispatches execute the exact same fresh check, preventing sends if suppression was added during failure cooldown.
4. **Reminder Execution**:
   - Executes `checkFinalEmailDispatchAuthority` immediately before reminder provider invocation.
   - If blocked by suppression or permission revocation:
     - **Preserves historical status**: `SENT`, `DELIVERED`, or `CLICKED` is **never regressed**.
     - `reminded_at` remains `NULL`.
     - Records audit event `review_request.reminder_blocked` (`reviewRequestId`, `decision`).
     - Skips reminder dispatch safely.

---

## 5. Files Modified

| File | Nature of Change |
|---|---|
| `supabase/migrations/20261007000000_mr7b1_authority_evidence.sql` | Migration adding `messaging_authority_evidence` table, indexes, trigger, and dropping `sup_delete` policy |
| `src/types/database.ts` | Added type-safe `messaging_authority_evidence` table definition (`Row`, `Insert`, `Update`, `Relationships`) with explicit union types |
| `src/inngest/functions/review-request.ts` | Added `checkFinalEmailDispatchAuthority` helper and integrated send-time and reminder-time suppression/permission checks |
| `test/domain/mr7b1-authority-send-invariant.test.ts` | 18 unit/domain test scenarios proving authority evidence derivation and send/retry/reminder invariants |
| `test/integration/mr7b1-authority-send-invariant.test.ts` | Database integration test suite for trigger and workflow invariants |
| `test/integration/real-rls.test.ts` | Added RLS tests for suppression delete hardening (Scenarios 25-29) and messaging authority evidence RLS (Scenarios 30-33) |
| `docs/MR-7-EXECUTION-HANDOFF.md` | Execution handoff documentation |

---

## 6. Verification & Test Results

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | **PASS** | TypeScript 5 cleanly passes with zero errors |
| `pnpm lint` | **PASS** | ESLint passes with zero warnings, zero errors |
| `pnpm test test/domain/mr7b1-authority-send-invariant.test.ts` | **PASS** | 18 tests passed (100% pass) |
| `pnpm test test/domain/suppression.test.ts test/domain/eligibility.test.ts` | **PASS** | 16 tests passed |
| `pnpm test test/integration/mr7b1-authority-send-invariant.test.ts` | **PASS** | 3 tests passed |
| `pnpm build` | **PASS** | Optimized Next.js production build succeeded in 8.1s; all 18 routes compiled |

---

## 7. Remaining MR-7 Gaps

The following capabilities remain deliberately out of scope for MR-7B.1 and form subsequent MR-7 slices:
1. **MR-7B.2 / MR-7C Privacy Lifecycle**:
   - Customer deletion orchestration (tenant-requested erasure).
   - Data export / portability endpoints.
   - Retention policy enforcement and purge scheduling.
   - Outbox and audit payload PII anonymization/redaction.
2. **Suppression Infrastructure Modernization**:
   - Keyed HMAC migration for suppression hashes.
   - Tracking token encryption at rest.
3. **Compliance Review**:
   - Formal legal review of customer agreements, terms, and neutral solicitation language before pilot or live messaging.

---

## 8. Rollback Implications

If rollback of MR-7B.1 is required prior to acceptance:
1. Revert application code changes in `src/inngest/functions/review-request.ts` and `src/types/database.ts`.
2. Database rollback SQL:
   ```sql
   DROP TRIGGER IF EXISTS trg_record_messaging_authority_evidence ON public.customer_completion_events;
   DROP FUNCTION IF EXISTS public.record_messaging_authority_evidence_from_completion();
   DROP TABLE IF EXISTS public.messaging_authority_evidence;
   -- Re-create previous sup_delete policy if tenant deletion was required:
   CREATE POLICY sup_delete ON public.suppressions
       FOR DELETE TO authenticated
       USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN']));
   ```
3. Existing customers and review requests remain completely unaffected by rollback since `customers.permission_*` fields were unmodified and operational compatibility was preserved.

---

## 9. Owner Gate

- **Milestone Status**: MR-7 is ACTIVE; MR-7B.1 is **READY FOR OWNER REVIEW**.
- **Live messaging remains disabled** (`ENABLE_LIVE_EMAIL=false`).
- **Live billing remains paused** under `MPG-DEC-049`.
- **Controlled Pilot (MR-8) remains strictly GATED**.
- Feature branch `chatgpt/mr7b1-authority-send-invariant` is preserved for review. No merge to `main` has occurred.
