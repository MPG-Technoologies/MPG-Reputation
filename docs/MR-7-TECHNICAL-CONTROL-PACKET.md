# MR-7 — Technical-Control Packet for Qualified US/Canada Legal & Compliance Review

| Metadata | Value |
|---|---|
| Date | 2026-10-17 |
| Product | MPG Reputation (`PROD-REP-001`) |
| Milestone | MR-7 — Trust / Security / Compliance |
| Slice | MR-7 Closeout Technical-Control Packet |
| Slice Status | ENGINEERING COMPLETE / READY FOR OWNER REVIEW |
| Product Baseline | `29fe5527113e7d3a82c16899e2cc2f940846ea22` |
| Company OS Baseline | `b62a7fea72c30eb8e768511815816b4de1ed1a3e` |
| Feature Branch | `chatgpt/mr7-closeout-technical-control-packet` |
| Intended Reviewer | Qualified US/Canada legal / privacy / messaging-compliance counsel |
| Data Boundary | Engineering/test environment; seed/synthetic data only; zero real customer data |
| Legal Status | Engineering evidence only — not legal advice, certification, or compliance sign-off |

---

## 1. Purpose

This packet consolidates the technical controls already implemented in MPG Reputation so a qualified reviewer can evaluate whether the current engineering design adequately supports the legal, privacy, messaging, suppression, retention, and data-processing requirements applicable to the intended United States / Canada validation scope.

The packet deliberately separates:

1. **implemented technical controls**;
2. **owner-accepted engineering/product policy**;
3. **provider/account facts that still require account-level verification**;
4. **questions requiring qualified legal/compliance judgment**;
5. **later milestone or commercial gates that remain unauthorized**.

This packet does **not** claim that MPG Reputation complies with CAN-SPAM, CASL, TCPA, state/provincial privacy law, federal privacy law, contractual platform rules, or any other legal regime. Engineering controls are evidence for review, not a substitute for qualified professional judgment.

---

## 2. Governance and Authority

### 2.1 Current Product Authority

Company OS records:

- MR-6 — Admin / Support / Observability: **COMPLETE / ACCEPTED** under `MPG-DEC-050`;
- MR-7 — Trust / Security / Compliance: **ACTIVE / IN PROGRESS** under `MPG-DEC-050`;
- MR-5 Billing: **PAUSED / INCOMPLETE** under `MPG-DEC-049`;
- MR-8 Controlled Pilot: **GATED**;
- live customer messaging: **NOT AUTHORIZED**;
- live billing/charging: **NOT AUTHORIZED**;
- public/commercial launch: **NOT AUTHORIZED**;
- Company Stage 2 and later stages: **NOT ACTIVATED**.

### 2.2 Case B Reconciliation Note

The current Company OS product document still contains an older statement identifying Case B disaster-recovery architecture as the "next technical step."

A later explicit Owner decision supersedes that execution instruction:

> **Do not implement Case B.**

Under MPG's authority order, the later explicit Owner decision controls.

Therefore:

- Case B is recorded as an unresolved architecture gap;
- Case B is **excluded from current engineering work**;
- this packet does not design or select an offsite privacy ledger/storage provider;
- Case B is not used as justification for scope expansion.

### 2.3 Hosted Database Operating Boundary

The current hosted Supabase project is an **engineering/test database** populated with seed/test/synthetic state and zero real customer data.

Within an owner-approved engineering slice, bounded hosted database work is permitted, including version-controlled migrations, schema work required by the slice, synthetic fixture mutation, RLS/privilege verification, and cleanup.

This does not authorize:

- real customer data;
- live customer messaging;
- live billing/charging;
- a real-customer pilot;
- arbitrary destructive resets;
- weakening RLS/authentication/authorization/tenant isolation;
- unrelated schema changes.

---

## 3. Product Processing Scope Relevant to Review

The currently implemented reputation-request flow is:

```text
Legitimate completed customer transaction/service
        ↓
Completion ingestion / Quick Complete
        ↓
Customer + permission state
        ↓
Eligibility evaluation
        ↓
Review request scheduled
        ↓
Final messaging-authority / suppression / sender checks
        ↓
Neutral email request
        ↓
Tracked MPG review link
        ↓
Confirmed Google review destination
        ↓
Delivery/click operational evidence
        ↓
Optional single bounded reminder
        ↓
Suppression / unsubscribe / audit / usage controls
```

Important product limitation:

- MPG currently tracks request creation, send/delivery state, and clicks on MPG's tracked review link.
- A tracked click does **not** prove that a Google review was submitted.
- Google review ingestion/detection and outcome attribution are not part of the currently accepted MR-7 implementation.

---

## 4. Technical-Control Summary

| Control Area | Current Technical State | Engineering Classification |
|---|---|---|
| Tenant isolation | PostgreSQL RLS + active membership/role checks; cross-tenant negative tests | IMPLEMENTED / ACCEPTED |
| Authentication / authorization | Server-verified Supabase auth; no editable user metadata used as authority | IMPLEMENTED |
| Messaging permission evidence | Durable `messaging_authority_evidence`; final send-time recheck | IMPLEMENTED / ACCEPTED |
| Sender identity | Real-provider sends require usable tenant location postal address | IMPLEMENTED / ACCEPTED |
| Neutral solicitation | No sentiment/rating/complaint gating in eligibility; neutral request language | IMPLEMENTED PRODUCT RULE |
| Unsubscribe | RFC 8058 one-click headers + token route + durable suppression | IMPLEMENTED |
| Suppression | Permanent tenant-scoped hash registry; final send-time suppression check | IMPLEMENTED / ACCEPTED |
| Bounce/complaint handling | Provider events can create suppression and stop prohibited re-contact | IMPLEMENTED |
| Customer export | OWNER/ADMIN only; allowlisted structured export; fail closed | IMPLEMENTED / ACCEPTED |
| Customer erasure | OWNER only; atomic in-place anonymization/redaction; no hard delete | IMPLEMENTED / ACCEPTED |
| External identifier erasure | source_customer_id/source_transaction_id erased; source_event_id retained | IMPLEMENTED / FROZEN |
| Retention | Owner-frozen class-specific retention policy and guarded maintenance controls | IMPLEMENTED / ACCEPTED |
| Processor minimization | Inngest payload/step minimization; sanitized provider/log errors | IMPLEMENTED / ACCEPTED |
| Backup restore privacy — Case A | Delta collection + replay + verifier gate; hosted synthetic proof | IMPLEMENTED / HOSTED VERIFIED |
| Backup restore privacy — Case B | No independent authoritative delta source | OWNER-EXCLUDED / UNRESOLVED |
| Terms / Privacy acceptance | No final legal text or frozen acceptance/version contract | GATED |
| Live messaging | `ENABLE_LIVE_EMAIL=false` | DISABLED |
| Live billing | MR-5 paused | DISABLED / INCOMPLETE |
| Real-customer pilot | MR-8 | GATED |

---

## 5. Messaging Authority and Permission Controls

### 5.1 Durable Messaging Authority Evidence

MR-7B.1 introduced `public.messaging_authority_evidence` as server-owned durable evidence associated with legitimate customer completion events.

The current send path performs a final authority check before provider dispatch. The check is designed to fail closed if required authority/permission evidence is not present or current.

Relevant evidence:

- migration: `supabase/migrations/20261007000000_mr7b1_authority_evidence.sql`;
- domain/integration evidence:
  - `test/domain/mr7b1-authority-send-invariant.test.ts`;
  - `test/integration/mr7b1-authority-send-invariant.test.ts`;
- execution record: MR-7B.1 — **OWNER ACCEPTED**.

### 5.2 Permission State

Customer permission state is stored with the customer/completion workflow and re-evaluated before sending/reminding.

Engineering rule:

- permission/authority failure must stop delivery rather than permit a send by default;
- suppression state is evaluated independently and can block delivery even if other eligibility conditions pass.

### 5.3 Legal Questions for Review

Qualified review should determine:

1. how MPG's intended review-request messages are classified under applicable US and Canadian regimes;
2. which permission/consent basis is required for each supported customer/business relationship;
3. whether the current evidence captured in `messaging_authority_evidence` is sufficient, and what additional evidence fields—if any—are legally necessary;
4. whether different rules are required for first request versus reminder;
5. whether jurisdiction-specific rules require additional timing, frequency, relationship, or recordkeeping controls;
6. whether any additional state/provincial/federal messaging rules must be reflected in product configuration before real customer use.

Engineering must not infer these legal answers.

---

## 6. Sender Identity and Physical Address Controls

MR-7B.2 established a real-provider sender-identity guard.

For real email provider dispatch:

- the tenant location must have a usable business postal address;
- missing sender identity fails closed;
- failed send state can be retried only after configuration is corrected;
- reminder dispatch applies the same current sender-identity check;
- synthetic console-provider development remains separate.

Relevant evidence:

- `src/domain/email/sender.ts`;
- `test/integration/mr7b2-sender-identity.test.ts`;
- MR-7B.2 — **OWNER ACCEPTED**.

### Legal Questions for Review

Qualified review should determine:

- whether the stored/rendered business identity and postal-address format satisfy applicable identification requirements;
- whether any specific corporate/legal entity name, sender designation, physical-address type, or jurisdictional disclosure is required;
- whether MPG itself must appear in the sender identity, footer, Terms, Privacy notice, or other communication surface;
- whether Canadian and US recipients require materially different sender disclosures.

---

## 7. Neutral Review Solicitation / Review Integrity

MPG Reputation's technical policy prohibits:

- positive-only solicitation;
- review gating;
- sentiment-based eligibility;
- predicted-rating filters;
- fake reviews;
- paid reviewers;
- complaint-based suppression from ordinary review solicitation solely to manipulate ratings.

The accepted neutral message model asks customers for honest feedback without conditioning the request on expected sentiment.

Eligibility logic does not use customer happiness, complaint state, sentiment, or predicted star rating as a positive-review filter.

This is an engineering/product integrity rule and should also be reviewed against applicable Google/platform policies before public use.

### Reviewer Question

Confirm whether additional platform-policy controls or customer disclosures are required for the intended neutral request flow and tracked redirect architecture.

---

## 8. Unsubscribe and Suppression Controls

### 8.1 One-Click Unsubscribe

The email path includes unsubscribe support consistent with RFC 8058 architecture.

Relevant evidence includes:

- `src/app/unsubscribe/[token]/route.ts`;
- `src/domain/unsubscribe/index.ts`;
- `test/integration/unsubscribe.test.ts`;
- `test/providers/email-headers.test.ts`;
- migrations:
  - `20260919040000_mr1b_sender_identity_and_unsubscribe.sql`;
  - `20260919040100_mr1b_unsubscribe_token_index_hardening.sql`.

### 8.2 Durable Recipient Evidence

MR-7C.3A decoupled unsubscribe resolution from mutable customer PII using `review_request_recipient_evidence.suppression_contact_hash`.

That evidence is:

- server-owned;
- append-only;
- inaccessible to `anon` and `authenticated`;
- preserved through customer erasure;
- used so historical unsubscribe remains resolvable after direct customer PII has been removed.

Migration:

- `supabase/migrations/20261009000000_mr7c3a_erasure_safe_unsubscribe.sql`.

### 8.3 Suppression Registry

`public.suppressions` is a tenant-scoped, pseudonymous/hash-based exclusion registry.

Frozen current product policy:

- suppression registry retained permanently per organization;
- customer PII erasure must not remove suppression;
- unsubscribe capability/recipient evidence retained indefinitely;
- final send-time eligibility checks suppression before delivery.

### Legal Questions for Review

Qualified review should determine:

1. whether the unsubscribe workflow, timing, presentation, and processing meet the applicable requirements for intended message classes;
2. whether a 90-day review link plus indefinite unsubscribe capability is acceptable;
3. whether suppression should remain permanent or whether any legal deletion/expiry rule requires a different model;
4. whether channel-specific opt-out semantics will be required before SMS or other channels are activated;
5. whether additional preference-center or organization-wide versus channel-specific opt-out semantics are required.

---

## 9. Bounce / Complaint and Re-Contact Prevention

Provider webhook handling records delivery states and can convert permanent delivery/complaint outcomes into suppression state.

Relevant evidence includes:

- Resend webhook integration tests;
- reminder privacy tests;
- durable suppression model;
- final dispatch authority/suppression recheck.

Engineering intent:

- a suppressed customer must not be re-contacted through ordinary automation;
- customer erasure does not remove the pseudonymous suppression record;
- CRM/POS re-ingestion should still resolve against the suppression hash and prevent prohibited re-contact.

Qualified review should determine whether the current complaint/bounce rules are sufficient and whether additional legally mandated suppression categories or retention rules are required.

---

## 10. Customer Privacy Export

MR-7C.2 provides controlled per-customer export.

Authority:

- OWNER: allowed;
- ADMIN: allowed;
- OPERATOR: denied;
- VIEWER: denied;
- anonymous: denied.

Controls:

- target explicitly scoped to organization + customer;
- RLS and server authorization preserved;
- authorization rechecked before release;
- required read failure or audit failure withholds the entire export;
- allowlisted fields only;
- internal secrets, raw bearer tokens, provider credentials, outbox payloads, suppression hashes, and unnecessary internals excluded;
- successful export creates a minimized audit event;
- HTTP delivery uses no-store semantics and a non-PII filename.

Relevant evidence:

- `src/domain/privacy/customer-export.ts`;
- `src/domain/privacy/export-delivery.ts`;
- `test/integration/customer-privacy-export.test.ts`;
- `test/integration/customer-privacy-export-delivery.test.ts`.

### Legal Questions for Review

Qualified review should determine:

- whether the export scope is sufficient for applicable access/data-subject rights;
- whether additional identity verification is required before a business user can obtain a customer export;
- whether response deadlines, formats, notices, or recordkeeping obligations must be implemented;
- whether tenant OWNER/ADMIN authority is legally/operationally sufficient for handling requests on behalf of the business.

---

## 11. Customer Erasure / Anonymization

### 11.1 Authority

Customer erasure is restricted to tenant **OWNER only**.

ADMIN, OPERATOR, VIEWER, and anonymous users are denied.

The PostgreSQL transaction re-verifies OWNER authority inside the transaction to close TOCTOU gaps.

### 11.2 No Hard Customer Delete

Direct hard deletion of a customer is forbidden because cascades would destroy:

- completion evidence;
- review request history;
- recipient/unsubscribe evidence;
- messaging authority evidence;
- erasure certificates;
- other operational/audit records.

Instead, erasure is an in-place anonymization/redaction transaction.

### 11.3 Frozen Erasure Map

Upon accepted erasure:

- `customers.first_name` → `[Deleted Customer]`;
- `customers.last_name` → `NULL`;
- `customers.email` → `NULL`;
- `customers.phone` → `NULL`;
- completion `contact` → exact empty JSON object;
- `source_customer_id` → `NULL`;
- `source_transaction_id` → `NULL`;
- `source_event_id` → retained for deduplication/idempotency;
- review/provider error text associated with the customer → scrubbed;
- suppression hashes → retained;
- recipient evidence → retained;
- non-PII operational history → retained.

A durable `customer_erasure_records` certificate and database immutability guard prevent later restoration of erased direct PII.

Relevant evidence:

- `src/domain/privacy/customer-erasure.ts`;
- `src/domain/privacy/erasure-delivery.ts`;
- `src/actions/customer-erasure.ts`;
- migrations:
  - `20261009120000_mr7c3b_customer_erasure.sql`;
  - `20261009140000_mr7c3c_external_id_erasure.sql`;
- `test/integration/customer-erasure.test.ts`;
- `test/integration/customer-erasure-delivery.test.ts`.

### Legal Questions for Review

Qualified review should determine:

1. whether the retained fields/records after erasure are legally justified for the intended markets and business purposes;
2. whether the retained `source_event_id`, authority evidence, suppression hash, audit history, erasure certificate, and operational request history require specific notices or retention limits;
3. whether any customer deletion request requires external-processor escalation rather than natural expiry;
4. whether additional identity/authority verification is required before a tenant OWNER can perform erasure;
5. whether legal hold, fraud, accounting, dispute, or regulatory exceptions require a formal hold mechanism.

---

## 12. Frozen Retention Policy

MR-7C.4A established the currently owner-approved engineering retention policy:

| Data Class / Control | Frozen MPG Policy |
|---|---|
| Active customer PII | Retain until explicit OWNER erasure; no automatic customer PII aging |
| Completion contact payload | Redact after 30 days |
| `source_event_id` | Retain permanently for deduplication/idempotency |
| Review request routing link | Valid for 90 days; expired link fails closed with HTTP 410 |
| Unsubscribe capability | Retain indefinitely |
| Recipient evidence | Retain indefinitely |
| Messaging authority evidence | Retain indefinitely |
| Suppression registry | Retain permanently per organization |
| Erasure certificates | Retain permanently |
| Audit events | Retain indefinitely in initial product stage |
| Financial/usage ledgers | Retain indefinitely while MR-5 is paused |
| Inactive tenants | Soft-deactivate; no hard tenant delete |
| Outbox PENDING | Never purge |
| Outbox DISPATCHED | Eligible for purge after 30 days |

Implementation evidence:

- `docs/MR-7C4-RETENTION-DECISION-MATRIX.md`;
- `src/domain/privacy/retention-controls.ts`;
- `src/domain/privacy/retention-maintenance.ts`;
- `src/inngest/functions/retention-maintenance.ts`;
- `test/domain/retention-controls.test.ts`;
- `test/integration/retention-controls.test.ts`;
- `test/domain/retention-maintenance.test.ts`;
- `test/integration/retention-maintenance.test.ts`.

Operational safety:

- production retention maintenance remains gated by `ENABLE_RETENTION_MAINTENANCE=false`;
- disabled state omits the workflow from normal registration and also has a secondary runtime guard;
- protected permanent-retention classes are explicitly guarded from generic purge routines.

### Legal Questions for Review

The owner-approved durations above are **engineering/product policy**, not legal conclusions.

Qualified review should determine:

- whether each duration is lawful and sufficient for the intended US/Canada scope;
- whether any record must be retained for a minimum period or deleted sooner;
- whether indefinite/permanent retention of suppression, authority, audit, erasure, or deduplication evidence is proportionate and properly disclosed;
- whether different jurisdictional policies are required;
- whether inactive tenant data requires an eventual deletion schedule;
- whether review link/unsubscribe validity periods need adjustment;
- whether a formal legal-hold mechanism is required.

---

## 13. External Processor Map

Current processor inventory established by MR-7C.5A:

| Processor | Current Role | Customer/Data Scope | Current Operational Status |
|---|---|---|---|
| Resend | Email delivery + delivery/bounce/complaint webhooks | Direct recipient PII during delivery; minimized correlation metadata | Live customer sending disabled; synthetic validation only when explicitly configured |
| Inngest | Durable orchestration/delays/workflows | Minimized 5-ID trigger + hardened step outputs | Active orchestration boundary |
| Supabase | Primary PostgreSQL/Auth/RLS datastore | Full primary data store | Hosted engineering/test project |
| Vercel | Next.js application hosting/runtime logs | Request/runtime pseudonymous data and sanitized errors | Application host |
| Stripe | B2B billing infrastructure | Organization billing data only; no end-consumer review-recipient data | MR-5 paused; live billing disabled |

Non-processors in current implementation:

- Google: review-link destination only; no Google OAuth/API ingestion currently;
- Twilio: no active client/provider; SMS gated;
- outbound CRM/POS processor: none;
- APM/analytics SDK processor: none in accepted C5A inventory.

Authoritative technical evidence:

- `docs/MR-7C5-EXTERNAL-PROCESSOR-RETENTION-MAP.md`.

### 13.1 Provider Account Evidence Still Required

Before real-customer launch, account/configuration evidence should be verified for:

- Resend active plan and content-storage controls;
- Inngest active plan/run-history retention;
- Vercel plan/log retention/Observability configuration;
- Supabase backup/PITR state if plan changes or offsite backups are introduced;
- Stripe account eligibility/configuration if MR-5 resumes.

These are account/provider facts, not assumptions to be inferred from repository code.

### Legal / Contract Questions for Review

Qualified review should determine:

- required DPA/data-processing contract terms;
- controller/processor or business/service-provider roles as applicable;
- cross-border/data-residency implications;
- whether vendor natural-expiry periods are acceptable for data-subject requests;
- whether support-assisted deletion processes are sufficient;
- whether provider terms require customer-facing disclosures;
- whether subprocessor listings or contractual flow-down obligations are required.

---

## 14. Processor Data-Minimization Hardening

MR-7B.3 and MR-7C.5B reduce unnecessary processor exposure.

### Inngest

Trigger payload is constrained to five operational identifiers:

- `eventId`;
- `organizationId`;
- `locationId`;
- `customerId`;
- `sourceEventId`.

MR-7C.5B removed direct PII and rendered message content from durable step outputs.

### Provider / Runtime Error Handling

Arbitrary provider errors are collapsed into bounded safe operational categories before:

- console logging;
- audit metadata;
- message-event sanitized errors;
- workflow retry exceptions.

### Console Provider

Console email sending fails closed in production before email content can be rendered/logged.

Evidence:

- `test/integration/mr7c5b-provider-privacy-hardening.test.ts`;
- `test/providers/email.test.ts`;
- MR-7B.3 and MR-7C.5B acceptance evidence.

---

## 15. Backup / Restore Privacy — Case A

MR-7C.5C1 and C5C2 implement Case A, where the pre-restore source database remains readable.

Controls include:

- deterministic privacy-delta collection;
- strict `PrivacyRestoreDeltaV1` contract;
- customer-erasure certificate continuity;
- completion-contact and external-ID redaction verification;
- suppression continuity verification;
- fail-closed restored-state decision;
- atomic replay RPCs;
- idempotency and conflict rejection;
- tenant boundary enforcement.

C5C2-H subsequently applied and verified the replay boundary on the hosted engineering/test Supabase project.

Hosted state after C5C2-H:

- repository/hosted migration history aligned 26/26;
- replay RPCs denied to PUBLIC / anon / authenticated;
- replay RPCs executable only through the intended elevated server role;
- valid synthetic erasure/suppression replay verified;
- idempotency verified;
- contradictory certificate timestamp rejected;
- cross-tenant replay rejected;
- malformed suppression replay rejected;
- unreconciled restored state remains BLOCK;
- injected failure proved transactional rollback;
- synthetic fixtures/test-only failure objects cleaned up.

Evidence:

- `src/domain/privacy/restore-verification.ts`;
- `src/domain/privacy/restore-replay.ts`;
- `supabase/migrations/20261011120000_mr7c5c2_restore_delta_replay.sql`;
- `docs/MR-7C5C2-H-HOSTED-VERIFICATION.md`;
- `test/domain/restore-privacy-verification.test.ts`;
- `test/domain/restore-delta-replay.test.ts`;
- `test/integration/restore-delta-replay-postgres.test.ts`.

### Case B

Case B means catastrophic database loss where no readable pre-restore database remains to supply the privacy delta.

Current state:

**UNRESOLVED / OWNER-EXCLUDED / DO NOT IMPLEMENT.**

No offsite ledger, external privacy registry, or storage provider is selected.

Qualified review may identify legal requirements relevant to disaster recovery and erasure continuity, but implementation requires a separate future Owner decision.

---

## 16. PostgreSQL / Supabase Security Evidence

### 16.1 Tenant Isolation

Core security model:

- RLS enabled on exposed tables;
- active organization membership required;
- authorization derives from server-verified identity and tenant membership;
- editable user metadata is not an authorization source;
- direct browser access to service-role operations is prohibited.

Existing evidence includes:

- `test/integration/tenant-isolation.test.ts`;
- `test/integration/real-rls.test.ts`;
- support-access negative tests;
- privacy/export/erasure negative tests;
- completion-source tenant isolation tests.

### 16.2 Server-Owned Tables

Hosted security-advisor review identified seven RLS-enabled tables with no user-facing policies:

- `billing_webhook_events`;
- `completion_api_credentials`;
- `completion_ingestion_requests`;
- `cost_ledger`;
- `customer_erasure_records`;
- `messaging_authority_evidence`;
- `review_request_recipient_evidence`.

Direct privilege inspection established:

- `anon`: no SELECT/INSERT/UPDATE/DELETE;
- `authenticated`: no SELECT/INSERT/UPDATE/DELETE.

This advisor signal is therefore tracked as an expected server-owned-table configuration rather than evidence of tenant exposure.

### 16.3 Existing SECURITY DEFINER Advisories

Previously reviewed authenticated-executable functions:

- `create_org_with_owner_and_location`;
- `submit_quick_complete_atomic`;
- `user_has_role`;
- `user_org_ids`;
- `user_role`.

Accepted inspection found current-user / tenant-membership enforcement and fixed `public, pg_temp` search paths, with no demonstrated authorization bypass.

C5C2 replay functions are separately denied to authenticated users.

### 16.4 Leaked Password Protection

Supabase leaked-password protection is currently disabled on the current project plan.

Engineering classification:

**PLATFORM / PLAN HARDENING DEPENDENCY**, not a repository-code defect.

Owner/commercial/infrastructure approval is required before any paid plan change.

---

## 17. Terms of Service / Privacy Policy Technical Enforcement

Current state:

**NOT FINALIZED / GATED.**

There is currently no owner-frozen:

- final Terms of Service text;
- final Privacy Policy text;
- versioning scheme;
- acknowledgement/acceptance event schema;
- re-consent/re-acknowledgement rule;
- legal-basis mapping;
- final jurisdiction-specific disclosure model.

Public `/terms` and `/privacy` pages are MR-9 product-site surfaces.

Engineering must not invent a policy-acceptance contract before qualified legal review and owner approval.

### Reviewer Output Requested

Qualified review should identify:

1. what Terms/Privacy documents are required for the intended business/product model;
2. which users must acknowledge which document(s);
3. whether acceptance must be explicit or whether notice is sufficient for particular documents;
4. what evidence of acceptance/notice should be stored;
5. whether policy versions and timestamps must be retained;
6. when re-acceptance/re-notification is required after material changes;
7. what disclosures must exist before MPG processes real customer data;
8. what data-subject contact/process language is required;
9. what processor/subprocessor disclosures are required;
10. what jurisdiction-specific variants, if any, must exist.

---

## 18. Questions Requiring Qualified US/Canada Review

The following are intentionally unresolved by engineering.

### Messaging

- What legal classification applies to MPG Reputation review-request emails in each intended use case?
- What consent/permission basis is required?
- Is the current completion/permission evidence sufficient?
- What sender identity/address disclosures are required?
- Are timing, frequency, quiet-hour, reminder, or relationship-duration limits required?
- What exact unsubscribe processing and validity requirements apply?
- Must suppression be permanent, time-bounded, organization-wide, or channel-specific?

### Privacy / Data Subject Rights

- Which access/export rights apply?
- Which deletion/erasure rights and exceptions apply?
- Is the current anonymization/retention model legally sufficient?
- Are additional identity-verification procedures required?
- Are response deadlines or required response formats applicable?
- Are retained pseudonymous identifiers/evidence adequately justified and disclosed?

### Retention

- Are the frozen MPG retention durations acceptable?
- Do any records require minimum retention?
- Do any records require earlier deletion?
- Is indefinite/permanent evidence retention proportionate?
- Is a legal-hold mechanism required?
- What tenant/account decommission retention period should apply?

### Processors / Contracts

- Which vendor DPAs or equivalent terms are required?
- What controller/processor/service-provider characterization applies?
- What cross-border or data-residency disclosures/controls are required?
- Are natural-expiry-only provider deletion models acceptable?
- Are provider-support deletion processes adequate?
- Are subprocessor disclosures required?

### Terms / Privacy / Platform Rules

- What Terms of Service and Privacy Policy clauses are required?
- What technical acknowledgement/versioning controls are necessary?
- What Google/platform policy obligations apply to the neutral review request flow?
- Are any additional disclosures required for tracked links, provider processing, analytics-like operational measurement, or automated messaging?

---

## 19. Explicitly Out of Scope / Not Authorized

This packet does not authorize or implement:

- Case B architecture;
- live customer messaging;
- SMS activation;
- live billing or charging;
- completion of paused MR-5;
- real customer data;
- real-customer pilot operation;
- MR-8 activation;
- public marketing;
- final pricing;
- public product launch;
- lifecycle `ACTIVE`;
- Company Stage 2;
- legal/compliance certification;
- final Terms or Privacy copy.

---

## 20. Evidence Index

Primary engineering evidence:

- `docs/MR-7-EXECUTION-HANDOFF.md`
- `docs/MR-7C-PRIVACY-LIFECYCLE-CONTRACT.md`
- `docs/MR-7C4-RETENTION-DECISION-MATRIX.md`
- `docs/MR-7C5-EXTERNAL-PROCESSOR-RETENTION-MAP.md`
- `docs/MR-7C5C2-H-HOSTED-VERIFICATION.md`
- `docs/SECURITY.md`
- `docs/MARKET-READY-ROADMAP.md`

Relevant migrations:

- `20260919040000_mr1b_sender_identity_and_unsubscribe.sql`
- `20260919040100_mr1b_unsubscribe_token_index_hardening.sql`
- `20261007000000_mr7b1_authority_evidence.sql`
- `20261008000000_mr7b3_payload_minimization.sql`
- `20261008010000_mr7c1_customer_delete_guard.sql`
- `20261009000000_mr7c3a_erasure_safe_unsubscribe.sql`
- `20261009120000_mr7c3b_customer_erasure.sql`
- `20261009140000_mr7c3c_external_id_erasure.sql`
- `20261010000000_security_definer_trigger_hardening.sql`
- `20261010010000_privacy_trigger_function_hardening.sql`
- `20261011120000_mr7c5c2_restore_delta_replay.sql`

Representative verification suites:

- `test/integration/tenant-isolation.test.ts`
- `test/integration/real-rls.test.ts`
- `test/domain/mr7b1-authority-send-invariant.test.ts`
- `test/integration/mr7b1-authority-send-invariant.test.ts`
- `test/integration/mr7b2-sender-identity.test.ts`
- `test/providers/email-headers.test.ts`
- `test/integration/unsubscribe.test.ts`
- `test/integration/reminder-privacy-truth.test.ts`
- `test/integration/customer-privacy-export.test.ts`
- `test/integration/customer-privacy-export-delivery.test.ts`
- `test/integration/customer-erasure.test.ts`
- `test/integration/customer-erasure-delivery.test.ts`
- `test/domain/retention-controls.test.ts`
- `test/integration/retention-controls.test.ts`
- `test/domain/retention-maintenance.test.ts`
- `test/integration/retention-maintenance.test.ts`
- `test/integration/mr7c5b-provider-privacy-hardening.test.ts`
- `test/domain/restore-privacy-verification.test.ts`
- `test/domain/restore-delta-replay.test.ts`
- `test/integration/restore-delta-replay-postgres.test.ts`

---

## 21. Requested Qualified-Review Deliverable

For each major control area, the qualified reviewer should return one of:

- **ACCEPT AS TECHNICALLY SUFFICIENT FOR INTENDED SCOPE**;
- **REVISE — ENGINEERING CHANGE REQUIRED**;
- **POLICY / CONTRACT CHANGE REQUIRED**;
- **JURISDICTION-SPECIFIC CONDITION REQUIRED**;
- **INSUFFICIENT INFORMATION — ADDITIONAL FACTS REQUIRED**.

Where a change is required, the reviewer should identify:

1. the legal/policy requirement;
2. the affected jurisdiction/use case;
3. the exact technical behavior that must change;
4. whether the requirement is a blocker before real customer data, before live messaging, before pilot, or before public launch;
5. any required Terms/Privacy language or contractual/provider action;
6. any retention/recordkeeping minimum or maximum;
7. any unresolved risk that requires an explicit Owner decision.

---

## 22. Engineering Closeout Position

Based on accepted engineering evidence:

- the primary MR-7 technical-control foundations have been implemented;
- Case A restore privacy support is implemented and hosted-engineering verified;
- technical evidence is now consolidated for qualified review;
- legal/compliance sufficiency is **not** claimed;
- final Terms/Privacy technical enforcement remains dependent on qualified review;
- Case B remains owner-excluded;
- MR-8 remains gated.

### Slice Result

**MR-7 Closeout Technical-Control Packet — ENGINEERING COMPLETE / READY FOR OWNER REVIEW.**

The next consequential step is owner review of this packet and, when approved, delivery to a qualified US/Canada legal/compliance reviewer.

No later milestone or production/commercial authority follows automatically.
