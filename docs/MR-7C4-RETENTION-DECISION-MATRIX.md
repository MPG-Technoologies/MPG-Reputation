# MPG Reputation — MR-7C.4 Retention Requirements & Data-Class Decision Matrix

| Metadata | Value |
|---|---|
| Milestone Slice | MR-7C.4A — Retention Requirements + Data-Class Decision Matrix (**OWNER ACCEPTED / FROZEN** at `924a7f009d18bfeadd0944f5bca082548eac9e54`)<br>MR-7C.4B1 — Frozen Retention Controls Foundation (**ENGINEERING COMPLETE / READY FOR OWNER REVIEW**) |
| Document Type | Architecture Evidence & Frozen Retention Policy Foundation |
| Program | MPG Reputation Market-Ready Build (MR-0 through MR-11) |
| Authority | `MPG-DEC-050`; Owner Acceptance of MR-7C.4A (`924a7f009d18bfeadd0944f5bca082548eac9e54`) |
| Status | OWNER APPROVED / FROZEN RETENTION POLICY; MR-7C.4B1 IMPLEMENTED |
| Execution Policy | Strict Data Class Retention Operations; Zero Generic Purge; Zero Hard Customer Deletes; Zero Production Scheduling Activation |

---

## 1. Executive Summary & Authority

Under `MPG-DEC-050` and the Owner Acceptance of MR-7C.3B (`856d7b8`), MR-7C.3C external identifier erasure enforcement (`8796b5e`), and MR-7C.3C delivery correction (`50e1bcf`), MPG Reputation has established a cryptographically secure, tenant-isolated foundation for data subject export (MR-7C.2) and controlled customer erasure (MR-7C.3).

This document establishes **MR-7C.4A**: the authoritative retention requirements, foreign-key dependency audit, and data-class decision matrix for every persisted entity in MPG Reputation.

### Strict Governance Rules Applied

1. **NO INVENTED RETENTION PERIODS**:
   Neither 30 days, 90 days, 1 year, 7 years, nor any informal "industry standard" is assumed or hardcoded.
   Where no authoritative statute, accepted MPG document, or explicit Owner decision specifies a retention duration, the requirement is explicitly designated:
   `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED`.
2. **NO PREMATURE PURGE IMPLEMENTATION**:
   This slice introduces **zero** scheduled functions, cron jobs (`pg_cron`), retention configuration columns, purge RPCs, automatic deletion routines, or destructive migrations.
3. **INVARIANT PRESERVATION**:
   Retention policies must never compromise:
   - Post-erasure anti-spam suppression (`public.suppressions`).
   - Unsubscribe continuity (`public.review_request_recipient_evidence`).
   - Statutory messaging authority evidence (`public.messaging_authority_evidence`).
   - Audit trail integrity (`public.audit_events`).
   - Tenant isolation across all PostgreSQL queries.
   - Deduplication and idempotency (`source_event_id`, `provider_event_id`, `idempotency_key`).
   - Financial and billing accounting correctness (`public.usage_ledger`, `public.cost_ledger`).
   - Accepted customer erasure guarantees (`public.customer_erasure_records`).

---

## 2. Critical Architectural Findings & Hazards

### 2.1 The Catastrophic Cascade Deletion Hazard

A comprehensive audit of all 23 migrations in `supabase/migrations/` revealed a critical architectural hazard in database foreign-key definitions:

```
public.organizations
 ├── public.locations [ON DELETE CASCADE]
 │    ├── public.customers [ON DELETE CASCADE]
 │    │    ├── public.customer_completion_events [ON DELETE CASCADE]
 │    │    ├── public.review_requests [ON DELETE CASCADE]
 │    │    │    ├── public.review_request_events [ON DELETE CASCADE]
 │    │    │    ├── public.message_events [ON DELETE CASCADE]
 │    │    │    └── public.review_request_recipient_evidence [ON DELETE CASCADE]  <-- CRITICAL
 │    │    ├── public.customer_erasure_records [ON DELETE CASCADE]              <-- CRITICAL
 │    │    └── public.messaging_authority_evidence [ON DELETE CASCADE]          <-- CRITICAL
```

#### Hazard Consequences
If any retention or aging mechanism executes `DELETE FROM public.customers WHERE ...`:
1. **Destruction of Unsubscribe Recipient Evidence**: `public.review_request_recipient_evidence` is wiped via foreign key cascade (`fk_rrre_review_request`), permanently breaking unsubscribe resolution for any sent email.
2. **Destruction of Regulatory Authority Evidence**: `public.messaging_authority_evidence` is wiped via cascade (`fk_mae_customer`), destroying legal proof of compliance under CAN-SPAM, CASL, and TCPA.
3. **Destruction of Erasure Compliance Certificates**: `public.customer_erasure_records` is wiped via cascade, destroying proof that customer PII was erased.
4. **Destruction of Intake Deduplication**: `public.customer_completion_events` is wiped, removing `source_event_id`. If a business client re-imports historical transactions from their CRM or POS, identical completions will be treated as new, resulting in duplicate review solicitations to past customers.

#### Architectural Directive
**Hard delete (`DELETE FROM public.customers`) is strictly forbidden for individual customer data aging while operational history exists.**
Customer data aging must follow the in-place anonymization/redaction pattern established and accepted in MR-7C.3B/3C (`[Deleted Customer]`, `email = NULL`, `phone = NULL`, `contact = {"redacted": true}`).

### 2.2 Suppression Registry Independence

- `public.suppressions` stores pseudonymous SHA-256 hashes (`contact_hash`) and does **not** reference `customers`, `locations`, or `review_requests`.
- Its only foreign key is `organization_id REFERENCES public.organizations(id) ON DELETE CASCADE`.
- **Finding**: Customer aging or erasure does not degrade suppression records. Suppressions survive customer PII erasure and must be preserved to prevent prohibited re-contact upon CRM re-ingestion.

### 2.3 Unsubscribe Continuity Decoupling (MR-7C.3A)

- `public.review_request_recipient_evidence` stores `suppression_contact_hash` linked directly to `(review_request_id, organization_id)`.
- It is append-only for `service_role` (UPDATE, DELETE, TRUNCATE revoked; trigger prevents alteration).
- **Finding**: As long as the `review_requests` record remains present in the database, unsubscribe links remain functional regardless of customer PII erasure. Any eventual purge of historical `review_requests` must respect the statutory lifespan of active unsubscribe mechanisms.
- **Unsubscribe Mechanism Validity Standards**:
  - CAN-SPAM unsubscribe mechanism minimum validity: 30 days after send.
  - CASL unsubscribe mechanism minimum validity: 60 days after send.
  - MPG cross-US/Canada engineering floor: at least 60 days.
  - Longer or indefinite unsubscribe capability remains allowed (the 60-day engineering floor does not mean the link must expire at day 60).
  - Suppression registry retention remains completely independent from link validity.

### 2.4 Existing Documented Operational Windows vs. Statutory Retention

A search across the complete repository confirmed that **zero statutory retention durations exist in accepted documentation or code**:
- `support_access_grants.expires_at`: 1-hour active session window (MR-6 operational TTL).
- `completion_ingestion_requests`: 5-minute request freshness window (`request_timestamp` clock drift limit in MR-3).
- `organization_entitlements`: 30-day trial configuration (`duration_days = 30`).
- `review_requests.scheduled_for`: dispatch delay (e.g. 2 hours) and reminder interval (e.g. 3 to 7 days).
- **General customer data, completion events, review requests, message events, audit logs, and suppressions have NO authoritative retention durations.**

---

## 3. Data-Class Decision Matrix

The following matrix covers all 25 PostgreSQL tables in MPG Reputation, evaluating data classification, functional dependencies, safe technical actions, and policy status.

| Data Class / Table | Storage | Classification | Current Purpose | Dependencies | Safe Action | Existing Authoritative Duration | Decision Required |
|---|---|---|---|---|---|---|---|
| **1. Customers** (`customers`) | PostgreSQL `public.customers` | DIRECT PII (prior to erasure); PSEUDONYMOUS TOMBSTONE (post-erasure) | Stores customer profile (`first_name`, `last_name`, `email`, `phone`) and operational permission state for review request dispatch. | Cascaded from `locations`. Cascades to `customer_completion_events`, `review_requests`, `customer_erasure_records`, `messaging_authority_evidence`. Hard delete destroys all child evidence. | **ANONYMIZE / REDACT** (in-place tombstoning: `[Deleted Customer]`, `last_name/email/phone = NULL`). Hard delete forbidden while child records exist. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Retention duration for active customer PII; aging timeline for uncontacted vs. messaged customers). |
| **2. Customer Completion Events** (`customer_completion_events`) | PostgreSQL `public.customer_completion_events` | DIRECT PII (in `contact` JSON prior to erasure); INDIRECT IDENTIFIER / OPERATIONAL HISTORY (post-erasure) | Immutable log of business transaction completions. Provides source event deduplication (`source_event_id`). | FK to `customers`, `locations`. Referenced by `review_requests`, `messaging_authority_evidence`, `completion_ingestion_requests`. Deduplication key: `(organization_id, source, source_event_id)`. | **REDACT** (intake contact payload: `{"redacted": true}`; external IDs erased to NULL in C3C). Hard delete breaks re-import deduplication. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Duration of raw intake contact retention; deduplication key retention window). |
| **3. Review Requests** (`review_requests`) | PostgreSQL `public.review_requests` | OPERATIONAL HISTORY / PSEUDONYMOUS (tokens, timestamps, sanitized error text) | Tracks review request delivery lifecycle, token routing (`/r/[token]`), reminder delays, and dispatch status. | FK to `organizations`, `locations`, `customers`, `customer_completion_events`, `review_destinations`. Cascades to `review_request_events`, `message_events`, `review_request_recipient_evidence`. | **REDACT / AGE**. Scrub `error_message` on erasure. Hard delete safe ONLY after unsubscribe link token expiration. | NONE (Only operational dispatch/reminder intervals: `scheduled_for`) | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Review link token validity window; delivery history archive duration). |
| **4. Recipient Evidence** (`review_request_recipient_evidence`) | PostgreSQL `public.review_request_recipient_evidence` | PSEUDONYMOUS / HASHED CONTACT / COMPLIANCE EVIDENCE | Decouples unsubscribe processing from customer PII (MR-7C.3A). Resolves unsubscribe requests post-erasure. | FK to `organizations`, `review_requests` [ON DELETE CASCADE]. Append-only service_role access; trigger prevents modification. | **RETAIN** while parent review request exists. Safe to purge ONLY if parent `review_requests` row is purged after applicable unsubscribe validity period (CAN-SPAM min: 30 days; CASL min: 60 days; MPG engineering floor: at least 60 days; longer/indefinite allowed). | Minimum statutory validity: CAN-SPAM 30 days, CASL 60 days (MPG engineering floor: ≥60 days). Database retention duration: NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Retention beyond statutory 60-day engineering floor; indefinite capability allowed). |
| **5. Review Request Events** (`review_request_events`) | PostgreSQL `public.review_request_events` | OPERATIONAL HISTORY / SYSTEM DIAGNOSTIC DATA | Detailed interaction logs (`first_click`, state transitions). Privacy-minimized (zero raw IPs). | FK to `organizations`, `review_requests` [ON DELETE CASCADE]. | **AGE / PURGE** after operational reporting window closes. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Interaction log retention window). |
| **6. Message Events** (`message_events`) | PostgreSQL `public.message_events` | OPERATIONAL HISTORY / SYSTEM DIAGNOSTIC / INDIRECT IDENTIFIER | Outbound delivery attempts and inbound provider webhook events (sent, delivered, bounced, complained). Webhook deduplication. | FK to `organizations`, `review_requests` [ON DELETE CASCADE]. Resend webhook correlation depends on `provider_message_id`. Error scrubbed on erasure. | **AGE / PURGE** after webhook delivery attribution and bounce processing window closes. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Delivery log and webhook event retention duration). |
| **7. Messaging Authority Evidence** (`messaging_authority_evidence`) | PostgreSQL `public.messaging_authority_evidence` | SECURITY / AUTHORITY EVIDENCE / COMPLIANCE EVIDENCE | Cryptographic/transactional evidence of lawful permission to message (CAN-SPAM, CASL, TCPA). Auto-recorded on completion insert. | FK to `organizations`, `customers` [ON DELETE CASCADE], `customer_completion_events` [ON DELETE CASCADE]. Contains zero direct PII. | **RETAIN** (must outlive customer PII erasure to defend against regulatory enforcement actions). Hard delete of customer cascades here! | NONE (Legal limitation periods do not automatically establish database-deletion dates) | `MESSAGING AUTHORITY EVIDENCE RETENTION — OWNER/LEGAL DECISION REQUIRED` |
| **8. Suppressions** (`suppressions`) | PostgreSQL `public.suppressions` | PSEUDONYMOUS / HASHED CONTACT / COMPLIANCE EVIDENCE | Permanent cross-channel exclusion registry preventing messaging to opted-out, bounced, or complained contacts. | FK to `organizations` only. Independent of `customers`. Keyed by `(organization_id, channel, contact_hash)`. | **RETAIN INDEFINITELY** (or under explicit statutory policy). Purging suppressions risks illegal spam violations upon CRM re-ingestion. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Whether suppressions are permanent per tenant or have statutory expiry). |
| **9. Customer Erasure Records** (`customer_erasure_records`) | PostgreSQL `public.customer_erasure_records` | COMPLIANCE EVIDENCE / SECURITY / AUDIT EVIDENCE | Immutable certificate of customer erasure execution. Protects tombstone immutability via database trigger. | FK to `organizations`, `customers` [ON DELETE CASCADE]. Append-only service_role access. | **RETAIN**. Purging disables the database immutability trigger protecting the erased customer. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Privacy compliance certificate retention window). |
| **10. Audit Events** (`audit_events`) | PostgreSQL `public.audit_events` | SECURITY / AUDIT EVIDENCE / OPERATIONAL HISTORY | System and security audit trail (privacy export, privacy erasure, support session access, configuration changes). | FK to `organizations`. No FK to entity_id. Minimization enforced: zero raw PII in metadata. | **AGE / ARCHIVE THEN PURGE** or **RETAIN**. Essential for security forensics and regulatory auditability. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` |
| **11. Organization Usage** (`organization_usage`) | PostgreSQL `public.organization_usage` | FINANCIAL / ECONOMIC RECORD / OPERATIONAL HISTORY | Monthly aggregated metric rollups (`completed_customers`, `requests_sent`, `link_clicks`). | FK to `organizations`. No customer PII. Minimal storage footprint. | **RETAIN** (compact aggregate accounting records). | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Usage aggregate accounting retention). |
| **12. Usage Ledger** (`usage_ledger`) | PostgreSQL `public.usage_ledger` | FINANCIAL / ECONOMIC RECORD | Append-only atomic usage events for billing, allowances, and economic cost tracking. | FK to `organizations`. Referenced by `cost_ledger`. Unique `idempotency_key`. | **AGGREGATE THEN PURGE** or **RETAIN**. Must not be purged before billing dispute window closes. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Itemized financial ledger retention). |
| **13. Cost Ledger** (`cost_ledger`) | PostgreSQL `public.cost_ledger` | FINANCIAL / ECONOMIC RECORD | Internal accounting of COGS per tenant (email transport, hosting, compute allocations). | FK to `organizations`, `usage_ledger` [ON DELETE SET NULL]. | **RETAIN** (corporate tax and financial audit records). | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (COGS accounting retention duration). |
| **14. Organization Entitlements** (`organization_entitlements`) | PostgreSQL `public.organization_entitlements` | TENANT CONFIGURATION / FINANCIAL RECORD | Governs quota limits, trial status, and feature entitlements. | Primary key is FK to `organizations` [ON DELETE CASCADE]. | **RETAIN** while organization exists. | Configured trial window: `duration_days = 30`. Lifecycle: NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Expired trial tenant record retention). |
| **15. Billing Accounts** (`organization_billing_accounts`) | PostgreSQL `public.organization_billing_accounts` | FINANCIAL RECORD / INDIRECT IDENTIFIER | Maps tenant to external payment gateway customer ID (`provider_customer_id`). | FK to `organizations`. Referenced by `organization_subscriptions`. | **RETAIN** while tenant billing relationship is active. | NONE (MR-5 paused) | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Billing profile retention post-termination). |
| **16. Subscriptions** (`organization_subscriptions`) | PostgreSQL `public.organization_subscriptions` | FINANCIAL RECORD / TENANT CONFIGURATION | Tracks subscription tier, billing period dates, and cancellation status. | FK to `organizations`, `organization_billing_accounts`. | **RETAIN** (statutory financial/tax accounting). | NONE (MR-5 paused) | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Subscription history retention window). |
| **17. Billing Webhook Events** (`billing_webhook_events`) | PostgreSQL `public.billing_webhook_events` | FINANCIAL / OPERATIONAL AUDIT / DIAGNOSTIC | Webhook idempotency and delivery tracking for payment events. Stores SHA-256 `payload_hash`. | FK to `organizations` [ON DELETE SET NULL]. Unique `(provider, provider_event_id)`. Zero PII. | **AGE / PURGE** after billing dispute and accounting audit period. | NONE (MR-5 paused) | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Payment webhook event retention). |
| **18. Organizations** (`organizations`) | PostgreSQL `public.organizations` | TENANT CONFIGURATION | Tenant boundary root entity. | Cascade root for all 24 other tables. Deletion cascades to destroy all tenant data. | **RETAIN** while tenant is active or in grace period. Deletion is catastrophic and irreversible. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Inactive tenant decommissioning timeline and grace period). |
| **19. Locations** (`locations`) | PostgreSQL `public.locations` | TENANT CONFIGURATION | Represents physical practice/business location. | FK to `organizations`. Cascade parent to `customers`, `completions`, `destinations`, `requests`. | **RETAIN** (soft-deactivate via `status = 'INACTIVE'`). Hard delete cascades to destroy customer data. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Decommissioned location retention policy). |
| **20. Organization Users** (`organization_users`) | PostgreSQL `public.organization_users` | TENANT CONFIGURATION / SECURITY | RBAC role mapping for authenticated internal team members. | FK to `organizations`. Referenced by `support_access_grants`. References `auth.users`. | **RETAIN** or **PURGE** upon user membership revocation. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Deactivated team member record retention). |
| **21. Support Access Grants** (`support_access_grants`) | PostgreSQL `public.support_access_grants` | SECURITY / AUDIT EVIDENCE | Bounded, emergency support session authorizations (MR-6). | FK to `organization_users` [ON DELETE CASCADE]. RLS enforces active check (`expires_at > now()`). | **AGE / PURGE** after security audit window expires. | Session TTL: max 1 hour (`expires_at`). Record retention: NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Support access session audit log retention). |
| **22. Completion API Credentials** (`completion_api_credentials`) | PostgreSQL `public.completion_api_credentials` | SECURITY / CREDENTIAL (contains `secret_hash`) | Ingestion API key management and rate limit enforcement. | FK to `organizations`. Referenced by `completion_ingestion_requests` [ON DELETE RESTRICT]. | **RETAIN** (soft-revoke via `status = 'REVOKED'`). Cannot be deleted while ingestion requests exist. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Revoked API credential record retention). |
| **23. Completion Ingestion Requests** (`completion_ingestion_requests`) | PostgreSQL `public.completion_ingestion_requests` | SYSTEM / DIAGNOSTIC DATA / AUDIT EVIDENCE | API replay protection (`UNIQUE (credential_id, nonce)`) and ingestion troubleshooting log. Stores body hash. | FK to `organizations`, `credentials` [ON DELETE RESTRICT], `locations` [ON DELETE SET NULL], `completions` [ON DELETE SET NULL]. | **AGE / PURGE** after operational debugging window. (Nonces >5m rejected by clock-drift check regardless). | Operational replay window: 5 minutes (`INTERVAL '5 minutes'`). Record retention: NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Ingestion request audit log retention). |
| **24. Domain Event Outbox** (`domain_event_outbox`) | PostgreSQL `public.domain_event_outbox` | OPERATIONAL / SYSTEM DIAGNOSTIC / INDIRECT IDENTIFIER | Transactional outbox queue ensuring durable event dispatch to Inngest. Minimized payload (MR-7B.3). | FK to `organizations`. Scanned every 5 minutes by `outbox-recovery` Inngest cron for `status = 'PENDING'`. | `PENDING`: **NEVER PURGE**. `DISPATCHED`: **AGE / PURGE** once Inngest workflow receipt is confirmed. | Recovery scan cron: 5 minutes (`*/5 * * * *`). Record retention: NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Dispatched domain outbox retention window). |
| **25. Review Destinations** (`review_destinations`) | PostgreSQL `public.review_destinations` | TENANT CONFIGURATION | Validated destination URL for review requests (open redirect defense). | FK to `organizations`, `locations`. Referenced by `review_requests` [ON DELETE RESTRICT]. | **RETAIN** (soft-deactivate via `status = 'INACTIVE'`). Cannot delete if review requests reference it. | NONE | `RETENTION PERIOD — OWNER/LEGAL DECISION REQUIRED` (Inactive review destination retention). |

---

## 4. External Processors Retention & Reconciliation (MR-7C.5 Preview)

Data processed by MPG Reputation flows into external third-party infrastructure. MPG does **not** directly control third-party database retention, and PostgreSQL deletions do not automatically propagate to downstream processors.

### 4.1 Resend (Email Service Provider)
- **Data Transmitted by MPG**:
  - Recipient email address.
  - Recipient personalized greeting in email HTML body.
  - Sender display name and reply-to address (`reviewReplyToEmail`).
  - Subject line.
  - Email HTML body containing tracked review link (`/r/[token]`) and unsubscribe link (`/unsubscribe?token=[token]`).
  - Correlation metadata: `review_request_id`.
- **Identifiers / PII Retained by Resend**:
  - Recipient email address, full message HTML content, delivery logs, open/click telemetry, bounce records, and complaint events.
- **MPG Deletion Capabilities**:
  - `SENT EMAIL / DELIVERY LOG DELETION CAPABILITY — UNVERIFIED; MR-7C.5 PROVIDER RECONCILIATION REQUIRED`. (Do not claim absence of deletion capability unless fully proven).
- **Provider Retention Configuration**:
  - Resend platform retains message logs according to account tier policies (typically 30 days for message body content; event telemetry may persist longer).
- **Reconciliation Status**:
  - `EXTERNAL PROCESSOR RECONCILIATION REQUIRED` (Scheduled for MR-7C.5). MPG cannot claim local erasure purges Resend provider copies.

### 4.2 Inngest (Event Bus & Workflow Orchestrator)
- **Data Transmitted by MPG**:
  - Under MR-7B.3 (`20261008000000_mr7b3_payload_minimization.sql`), event payloads are strictly minimized to 5 operational keys: `eventId`, `organizationId`, `locationId`, `customerId`, `sourceEventId`.
  - Zero direct customer contact PII (names, emails, phone numbers) is transmitted.
- **Identifiers Retained by Inngest**:
  - Internal customer UUID (`customerId`), source event ID, workflow execution run history, step input/output JSON, and execution timestamps.
- **MPG Deletion Capabilities**:
  - Inngest SDK does not provide an API to purge individual completed workflow run histories.
- **Provider Retention Configuration**:
  - Documented plan-dependent trace/log history:
    - Free: 24 hours
    - Pro: 7 days
    - Business: 14 days
    - Enterprise: up to 365 days
  - `EXACT MPG ACCOUNT RETENTION — VERIFY IN MR-7C.5` (do not assume MPG's plan).
- **Reconciliation Status**:
  - `EXTERNAL PROCESSOR RECONCILIATION REQUIRED` (Scheduled for MR-7C.5).

### 4.3 Supabase Auth (`auth` Schema)
- **Data Stored**:
  - Internal team member email addresses, encrypted password hashes, last sign-in timestamps, MFA factors.
  - Internal audit log entries (`auth.audit_log_entries`): IP addresses, user agents, authentication timestamps.
- **MPG Deletion Capabilities**:
  - Programmatic deletion is technically supported via `supabase.auth.admin.deleteUser(userId)` upon team member offboarding.
- **Provider Retention Configuration**:
  - Managed via Supabase project settings.
- **Reconciliation Status**:
  - Controlled via admin client; requires Owner offboarding policy.

### 4.4 Vercel / Edge Runtime
- **Data Logged**:
  - HTTP request access logs, URLs, response codes, execution latency, runtime exceptions.
- **PII Controls**:
  - Codebase enforces strict error sanitization (`src/domain/review-request/sanitizer.ts`), stripping email addresses, phone numbers, and tokens before logging.
- **Provider Retention Configuration**:
  - Documented runtime-log retention:
    - Hobby: 1 hour
    - Pro: 1 day
    - Enterprise: 3 days
    - Observability Plus: up to 30 days
  - `EXACT MPG PROJECT RETENTION — VERIFY CURRENT PLAN / SETTINGS IN MR-7C.5`.
- **MPG Deletion Capabilities**:
  - Zero programmatic deletion via application code.

---

## 5. System Invariants Preservation Analysis

| Invariant | Retention Hazard | Architectural Requirement | Status |
|---|---|---|---|
| **1. Suppression Continuity** | Hard-deleting suppressions would allow re-imported CRM records to send prohibited spam. | `public.suppressions` stores pseudonymous `contact_hash` only. It must survive customer erasure and general customer data aging. | **PRESERVED** |
| **2. Unsubscribe Continuity** | Hard-deleting `review_requests` cascades to destroy `review_request_recipient_evidence`, breaking unsubscribe links for sent emails. | Historical `review_requests` and `review_request_recipient_evidence` must be retained for at least the statutory lifespan of active unsubscribe mechanisms (CAN-SPAM min: 30 days; CASL min: 60 days; MPG engineering floor: at least 60 days; longer or indefinite allowed). | **PRESERVED** |
| **3. Lawful Authority Evidence** | Hard-deleting `customers` cascades to destroy `messaging_authority_evidence`, eliminating legal defense against regulatory fines. | `messaging_authority_evidence` contains zero direct PII and must outlive customer PII erasure. Legal limitation periods do not automatically establish database-deletion dates. `customers` must not be hard deleted while authority evidence is required. | **PRESERVED** |
| **4. Non-PII Auditability** | Raw PII in audit logs would violate data minimization and privacy erasure requirements. | `audit_events` metadata enforces strict schema validation and strips PII, hashes, and raw errors. Retains non-PII compliance certificates. | **PRESERVED** |
| **5. Tenant Isolation** | Data aging queries lacking strict tenant scoping could cross organization boundaries. | All future aging routines must include `organization_id` in `WHERE` clauses and maintain strict RLS isolation. | **PRESERVED** |
| **6. Idempotency & Deduplication** | Purging completion records removes `source_event_id`, allowing duplicate transaction processing. | Ingestion completion tombstones (`source_event_id`) must be retained to prevent re-ingestion replay. | **PRESERVED** |
| **7. Billing / Economic Correctness** | Purging usage records corrupts billing reconciliation and tax accounting. | `usage_ledger`, `cost_ledger`, and `organization_usage` must be retained through financial accounting and dispute windows. | **PRESERVED** |
| **8. Security Forensics** | Premature deletion of audit trails obstructs incident response. | `audit_events` and `support_access_grants` must be preserved for enterprise security review. | **PRESERVED** |
| **9. Erasure Immutability** | Purging `customer_erasure_records` disables the database trigger protecting erased tombstones. | `customer_erasure_records` must remain permanently associated with the erased customer tombstone. | **PRESERVED** |

---

## 6. AUTHORITATIVE OWNER DECISIONS (FROZEN RETENTION POLICY)

Under `MPG-DEC-050` and the Authoritative Owner Review of MR-7C.4A (`924a7f009d18bfeadd0944f5bca082548eac9e54`), the following 12 policy decisions are **OWNER APPROVED / FROZEN**:

### Decision 1: Active Customer PII Retention Period — OWNER APPROVED / FROZEN
- **Policy**: Retain active customer PII until explicit OWNER-controlled erasure.
  - No automatic customer PII aging.
  - Do not automatically anonymize active customer rows.
  - Continue using the accepted C3B/C3C OWNER-only erasure workflow (`executeCustomerErasureInternal`).
- **Classification**: Permanent retention until explicit owner erasure.

### Decision 2: Completion Contact Payload Redaction — OWNER APPROVED / FROZEN
- **Policy**: Automatically redact `customer_completion_events.contact` after **30 days**.
  - The completion record must remain.
  - Preserve: `source_event_id`, timestamps, completion history, operational relationships.
  - Do not delete the completion event.
  - Expected representation: `contact = '{}'::jsonb`.
- **Classification**: Temporary launch-stage policy (Launch duration: 30 days).

### Decision 3: Ingestion Deduplication Retention — OWNER APPROVED / FROZEN
- **Policy**: Retain `customer_completion_events.source_event_id` **permanently**.
  - Never include `source_event_id` in automatic aging/purge jobs.
- **Classification**: Permanent retention class (strictly protected).

### Decision 4: Review Request Link Validity — OWNER APPROVED / FROZEN
- **Policy**: Review request routing links (`/r/[token]`) expire after **90 days**.
  - After expiration:
    - Do not route to the review destination.
    - Show a safe, user-friendly expired-link state (HTTP 410 Gone).
    - Do not reveal tenant/internal/customer information.
    - Expiration must NOT disable unsubscribe functionality.
    - Do not delete the `review_requests` row simply because the routing token expired.
- **Classification**: Temporary launch-stage policy (Launch duration: 90 days).

### Decision 5: Unsubscribe Capability & Recipient Evidence — OWNER APPROVED / FROZEN
- **Policy**: Retain unsubscribe capability and recipient evidence **indefinitely**.
  - Protect `public.review_request_recipient_evidence`.
  - Do not purge it automatically.
  - The statutory 60-day cross-US/Canada value is only a minimum floor; MPG's policy is indefinite functionality.
- **Classification**: Permanent retention class (strictly protected).

### Decision 6: Messaging Authority Evidence — OWNER APPROVED / FROZEN
- **Policy**: Retain `public.messaging_authority_evidence` **indefinitely**.
  - No automatic purge.
- **Classification**: Permanent retention class (strictly protected).

### Decision 7: Suppression Registry — OWNER APPROVED / FROZEN
- **Policy**: Retain `public.suppressions` **permanently per organization**.
  - No suppression expiry.
  - No automatic purge.
- **Classification**: Permanent retention class (strictly protected).

### Decision 8: Erasure Certificates — OWNER APPROVED / FROZEN
- **Policy**: Retain `public.customer_erasure_records` **permanently**.
  - They protect erasure evidence and tombstone immutability.
  - No automatic purge.
- **Classification**: Permanent retention class (strictly protected).

### Decision 9: Audit Events — OWNER APPROVED / FROZEN
- **Policy**: For the initial product stage, retain `public.audit_events` **indefinitely**.
  - No automatic audit purge in this slice.
  - This policy must be revisited before enterprise contractual retention requirements are introduced.
- **Classification**: Temporary launch-stage policy (Indefinite retention in initial slice).

### Decision 10: Financial / Usage Ledgers — OWNER APPROVED / FROZEN
- **Policy**: For the initial product stage retain:
  - `public.organization_usage`
  - `public.usage_ledger`
  - `public.cost_ledger`
  indefinitely.
  - No automatic purge while MR-5 billing remains paused and accounting policy is not finalized.
  - Revisit when billing/accounting policy becomes active.
- **Classification**: Temporary launch-stage policy (Indefinite retention while billing paused).

### Decision 11: Inactive Tenants — OWNER APPROVED / FROZEN
- **Policy**: Use soft deactivation only (`status = 'INACTIVE' | 'SUSPENDED'`).
  - Do NOT automatically hard-delete organizations.
  - No tenant-wide purge lifecycle in C4B1.
- **Classification**: Temporary launch-stage policy (Soft deactivation only).

### Decision 12: Domain Event Outbox — OWNER APPROVED / FROZEN
- **Policy**: For `public.domain_event_outbox`:
  - `PENDING` records: NEVER automatically purge.
  - Successfully `DISPATCHED` records: eligible for purge after **30 days**.
  - Do not purge failed or unresolved rows merely because they are old.
- **Classification**: Temporary launch-stage policy (Launch duration: 30 days for DISPATCHED).

---

## 7. Data Classification Taxonomy Summary

| Category | Data Classes / Tables | Policy Summary | Purge Eligibility |
|---|---|---|---|
| **Permanent-Retention Classes (Immune)** | `suppressions`<br>`review_request_recipient_evidence`<br>`messaging_authority_evidence`<br>`customer_erasure_records`<br>`customer_completion_events.source_event_id`<br>`customers` (active PII) | Retained indefinitely/permanently to protect anti-spam, legal authority, and idempotency invariants. Active customer PII retained until explicit Owner erasure. | **IMMUNE / NEVER PURGED** |
| **Temporary Launch-Stage Policies** | `customer_completion_events.contact`<br>`review_requests` routing link (`/r/[token]`)<br>`domain_event_outbox` (`DISPATCHED`)<br>`audit_events`<br>`organization_usage`, `usage_ledger`, `cost_ledger`<br>`organizations` | - Contact payload redacted after 30 days.<br>- Review link expires after 90 days (fails closed).<br>- Dispatched outbox purged after 30 days.<br>- Audit events and ledgers retained indefinitely in launch stage.<br>- Inactive tenants soft-deactivated only. | **EXECUTABLE CONTROLS IMPLEMENTED IN MR-7C.4B1** |
| **Deferred / Unresolved Retention Classes** | `message_events`<br>`review_request_events`<br>`completion_ingestion_requests`<br>`support_access_grants`<br>`billing_webhook_events`<br>`organization_users`<br>`review_destinations`<br>Billing/subscription records | Remain outside MR-7C.4B1 implementation. No automatic purge or aging authorized without explicit owner policy. | **EXCLUDED FROM PURGE JOBS** |

---

## 8. Implementation Verification (MR-7C.4B1)

The frozen launch retention controls foundation is implemented in:
- Module: `src/domain/privacy/retention-controls.ts`
- Routing: `src/app/r/[token]/route.ts` (90-day expiration check and user-friendly HTTP 410 response)
- Test Suite: `test/domain/retention-controls.test.ts` (25 tests covering all redaction, expiration, outbox purge, and permanent-retention immunity guards)
