# MR-7 — Qualified US/Canada Legal & Compliance Review: Submission Handoff

| Metadata | Value |
|---|---|
| Product | MPG Reputation (`PROD-REP-001`) |
| Prepared | 2026-10-17 |
| Scope | MR-7 qualified-review submission / documentation-only preparation |
| Engineering source | Product `main` at `3c3fea462056eedcd57e658a48af06d9d5bba29f` |
| Company governance source | Company OS `main` at `03a48a34481f1952a31cd5c4fb980bc381432d8d` (`MPG-DEC-051`) |
| Submission status | ENGINEERING COMPLETE / READY FOR OWNER REVIEW; **not yet submitted to qualified counsel** |
| Legal findings | **NOT RECEIVED** |
| Customer data | None. Hosted Supabase is an engineering/test environment using seed/synthetic fixtures |
| Release boundary | MR-7 IN PROGRESS; MR-8 GATED; no live messaging, real customer pilot, live billing, public launch, or Company Stage change |

## 1. Reviewer instruction and requested outcome

This handoff accompanies the already owner-accepted **MR-7 Technical-Control Packet**. It is an **intake and response contract**, not a second engineering audit or a legal opinion.

The Owner intends to validate MPG Reputation for initial **United States and Canada** use cases. The product requests neutral, honest customer reviews after legitimate completed business transactions/services. Currently accepted engineering covers source ingestion, permission/authority evidence, suppression, unsubscribe, single bounded reminder behavior, privacy export/erasure, class-specific retention, processor minimization, and Case A backup-restore privacy reconciliation.

**Request to qualified reviewer:** Assess the intended use cases against the law and platform/processor rules applicable to the jurisdictions and recipient scenarios **actually identified and approved for review**. For every deficiency, specify the affected workflow, requirement, jurisdiction, severity/gate, and exact engineering, policy, operational, or contractual action.

Do not interpret this packet as a claim of compliance or a request to certify an unreleased product. If facts are missing, mark them as missing instead of assuming.

**Not requested:** final policy/legal drafting based on unverified assumptions, legal conclusions from AI-generated material, advertising claims, SMS activation, billing activation, or real-customer testing.

## 2. Source hierarchy and submission manifest

Use these accepted, versioned repositories and documents; review the exact code paths where the technical packet supplies them.

| Evidence ID | Item | Source |
|---|---|---|
| E-01 | Technical-Control Packet — complete engineering-control map and reviewer questions | `docs/MR-7-TECHNICAL-CONTROL-PACKET.md` |
| E-02 | MR-7 execution handoff, accepted slices, and non-authorizations | `docs/MR-7-EXECUTION-HANDOFF.md` |
| E-03 | Privacy lifecycle, export, erasure, no hard customer deletes | `docs/MR-7C-PRIVACY-LIFECYCLE-CONTRACT.md` |
| E-04 | Frozen class-specific retention matrix | `docs/MR-7C4-RETENTION-DECISION-MATRIX.md` |
| E-05 | Processor inventory, retention, deletion, provider-hardening constraints | `docs/MR-7C5-EXTERNAL-PROCESSOR-RETENTION-MAP.md` |
| E-06 | Hosted engineering/test Case A migration, privileges and replay proof | `docs/MR-7C5C2-H-HOSTED-VERIFICATION.md` |
| E-07 | Product security assumptions, access protections and audit references | `docs/SECURITY.md` |
| E-08 | Company OS accepted MR-7 authority / current external gate | `techwithmpg/mpg-company-os`: `docs/02-decision-register.md` (`MPG-DEC-050`, `MPG-DEC-051`) |
| E-09 | Company OS current product scope and roadmap gates | `techwithmpg/mpg-company-os`: `products/mpg-reputation/README.md` |
| E-10 | Application and SQL evidence index | Technical-Control Packet §20 |

Direct source links:

- [Product Technical-Control Packet](https://github.com/MPG-Technoologies/MPG-Reputation/blob/3c3fea462056eedcd57e658a48af06d9d5bba29f/docs/MR-7-TECHNICAL-CONTROL-PACKET.md)
- [Product MR-7 Execution Handoff](https://github.com/MPG-Technoologies/MPG-Reputation/blob/3c3fea462056eedcd57e658a48af06d9d5bba29f/docs/MR-7-EXECUTION-HANDOFF.md)
- [Product Processor Map](https://github.com/MPG-Technoologies/MPG-Reputation/blob/3c3fea462056eedcd57e658a48af06d9d5bba29f/docs/MR-7C5-EXTERNAL-PROCESSOR-RETENTION-MAP.md)
- [Company OS Decision Register](https://github.com/techwithmpg/mpg-company-os/blob/03a48a34481f1952a31cd5c4fb980bc381432d8d/docs/02-decision-register.md)

**Boundary of repository evidence:** acceptance and hosted technical proofs show specific engineering behavior, not legal sufficiency; no claim of a successful external legal review is implied. Provider/account configuration is not fully established by source code.

## 3. Scope confirmation required from Owner before external submission

The reviewer cannot reach defensible jurisdiction-specific conclusions without a factual description of the intended operations.

| Intake fact | Current known position | Needed before legal conclusion |
|---|---|---|
| Markets | **Owner-confirmed requested review coverage (2026-10-17): all 50 US states and Washington, DC, plus all 10 Canadian provinces and 3 territories.** Australia remains outside the initial scope. | Full jurisdiction-by-jurisdiction assessment and written coverage exceptions; rollout order is not approved or assumed. US territories require a separate explicit scoping decision. |
| Business verticals | **Owner-confirmed intake scope (2026-10-17): general service businesses, industry-agnostic.** This is a legal-review scoping choice, not a frozen go-to-market vertical or permission to serve every regulated industry. | Identify illustrative completed-service scenarios and sector-specific exceptions or obligations requiring separate fact gathering/review. |
| Recipients | End consumers of MPG business tenants | Consumer/business distinction, collection source, any minors/sensitive segments |
| Message channel | Email in current implemented provider; SMS gated | Real intended send/reminder practices and any future channels that require separate review |
| Customer email origin and proposed permission pathway | **Owner-proposed intake model (2026-10-17): email collected by the participating business during existing booking, checkout, POS or CRM processes.** MPG records completion/permission evidence; address possession, a completed service or CRM inclusion does **not** by itself establish permission to send. | Verify the exact capture/notice or opt-in mechanism used at each source, customer action and wording, lawful basis per jurisdiction and message classification, evidence provenance/timestamps, transfer/disclosure to MPG, opt-out status and revocation. **No legal sufficiency determination yet.** |
| Sender | Tenant business/location identity and postal address | Actual sender domain, registered business entity, physical/postal address, MPG's disclosed role |
| Provider plans | Supabase engineering/test plan documented; others have account-confirmation gaps | Resend, Inngest, Vercel and any external backup/provider configurations |
| Organizational/legal parties | MPG master brand and MPG Reputation working product identity | Actual contracting entity, country of establishment, data-processing roles, contact channels |
| International processing | Supabase project/processor map contains infrastructure details | Actual intended customer location, processor/subprocessor and cross-border transfer facts |
| Commercial terms | MR-5 paused; pricing unapproved | No invented plan/refund/renewal terms; identify future commercial terms only when owner adopts them |

**Recorded owner intake response — 2026-10-17:** Use **general service businesses (industry-agnostic)** for the initial US/Canada qualified legal-review scope. Product positioning remains broadly service-business-oriented; this does **not** approve a first commercial vertical, authorize handling regulated or sensitive-sector records, or activate real-customer processing. Where industry-specific privacy, health, finance, child-related, or other special obligations are potentially relevant, the qualified reviewer must identify whether a separately scoped assessment is required.

**Recorded owner jurisdiction-scope response — 2026-10-17:** Request **broad legal-review coverage across all 50 US states plus Washington, DC, and all 10 Canadian provinces and 3 territories**. This is a **request for comprehensive counsel assessment**, not evidence any requirement has been evaluated, a commitment to launch simultaneously in every jurisdiction, or an authorization to sell or process real customer data. US territories are **not included by implication** and require separate Owner confirmation if desired; Australia remains deferred. Counsel must explicitly report any incomplete jurisdictions or topics and any specialist/local counsel dependency. Actual recipient/consent notice language, the business's evidence-capture practice and intended rollout order remain unconfirmed.

**Recorded owner source/permission intake response — 2026-10-17:** The **proposed** operating model is to obtain customer email addresses through a participating business's **existing booking, checkout, POS, or CRM workflow**, connected to a genuine completed service/transaction. It is **not** a separate owner-approved consent standard: an email address, a historical customer record, an accepted booking, or a completion event alone must not be treated as lawful permission. The existing application uses permission state and durable messaging-authority evidence with a fail-closed send-time gate, but this technical control is not proof that the source business collected legally sufficient permission. The qualified reviewer must distinguish acquisition of contact data, grounds to use it for each message class in each jurisdiction, what disclosure/choice is required at collection, and what admissible evidence needs to be retained. Existing opt-outs/suppressions remain binding regardless of source-system re-ingestion. Owner has **not** confirmed actual consent notice text, selection/check box/action, collection timestamp source, system-to-MPG transfer disclosure, or opt-out history. No messaging activation or customer-data ingestion is authorized by this intake selection.

**Owner task:** Confirm factual intake answers and authorized scope. Do not use real customer records, contact details, credentials, or private contracts in this public repository. Convey confidential facts via an owner-approved private channel with qualified counsel.

### Broad jurisdiction coverage and reviewer deliverable

The Owner requests broad rather than prioritized local coverage. Request a **traceable jurisdiction matrix** with one entry for each of the 50 US states, Washington, DC, and Canada's 10 provinces and 3 territories. The matrix should distinguish:

- **national/federal baseline** from additional state/provincial/territorial requirements;
- **applicability to the actual approved service-business/recipient/message scenarios** versus inapplicable or undetermined obligations;
- consent and message classification; sender identification; unsubscribe/suppression; timing/frequency; privacy notice and subject rights; retention; data transfers/processors; recordkeeping; and any legally relevant restrictions on review solicitation;
- substantive differences requiring a **technical control, policy/Terms/Privacy change, business operation, provider setting, or gate**;
- written legal authority and an explicit **review status** for each jurisdiction, including *REVIEWED*, *NEEDS SPECIALIST / LOCAL COUNSEL*, *INSUFFICIENT FACTS*, or *NOT YET REVIEWED*.

A national-level summary alone does **not** satisfy the requested broad-coverage deliverable. Counsel should identify engagement limits and any need to coordinate specialists instead of implying blanket nationwide or Canada-wide legal sign-off. The Owner has **not approved review fees, retained counsel, finalized rollout jurisdictions, or authorized production launch** merely by requesting broad scope.

## 4. Required review questions / engineering traceability

Use the Technical-Control Packet for implementation detail. This matrix identifies the decision each review topic must produce.

| Ref | Review topic | Ask qualified reviewer | Engineering / owner output if change required |
|---|---|---|---|
| L-01 | Message classification | Classify the proposed neutral post-transaction email and reminders per scoped jurisdiction/use case | Written classification and affected workflows |
| L-02 | Consent and relationship evidence | For emails originating in existing booking, checkout, POS or CRM workflows, determine whether and under what conditions a business relationship, affirmative opt-in, or other lawful basis supports each proposed review-request/reminder message in each jurisdiction; identify source notice/choice, records, provenance, expiry and revocation requirements. Do not equate possession of email or completion with consent. | Source-specific eligibility rules, exact evidence fields, required notice/opt-in behavior (if any), suppression reconciliation and fail-closed tests |
| L-03 | Sender identity | Determine sender name, business address, MPG role and footer disclosures for the intended sender model | Required fields/text placement and sender-identity gates |
| L-04 | Unsubscribe and suppression | Assess processing, one-click workflow, validity, scope, complaints/bounces and cross-channel treatment | Opt-out handling, recordkeeping, expiry or permanent-retention changes |
| L-05 | Timing and frequency | Determine jurisdictional or platform constraints for initial send, reminder, quiet hours and relationship lookback | Defined timing/frequency policy and tests |
| L-06 | Review integrity/platform rules | Review neutral solicitation and redirect tracking against applicable platform/Google requirements | Documented platform obligations, neutral language constraints, prohibited behaviors |
| L-07 | Data access/export | Assess request authority, identity verification, scope, format, response timing, and exceptions | Customer-rights handling procedure and technical modifications |
| L-08 | Erasure and retained evidence | Assess tombstoning, source-event dedup key, hashes/certificates, authority/audit records, and erasure exceptions | Lawful retained-field rationale, redaction changes or legal holds |
| L-09 | Retention matrix | Evaluate owner-frozen 30-day contact redaction, 90-day review link, indefinite/permanent evidence, and tenant deactivation rules | Jurisdiction-specific minimums/maximums and disclosed schedule |
| L-10 | External processors | Evaluate account-specific retention, natural expiry, DPA/subprocessors, cross-border roles and early erasure escalation | Contract, process, configuration or provider-evidence requirements |
| L-11 | Backup restore/privacy | Evaluate what Case A protection covers and limitations, including the unresolved owner-excluded Case B scenario | Risk assessment and an explicit decision request, **not Case B implementation authority** |
| L-12 | Terms/Privacy | Define required documents, disclosure sections, acceptance/notice model, versioning, evidence and update/re-acceptance rules | Specific owner policy decisions and bounded engineering contract |
| L-13 | Launch/pilot dependencies | Identify legal blockers for test-only operations, first real customer data, email enablement, real-customer pilot, and public launch separately | A milestone/gate-specific blocker list |

A reviewer should **not** label an item legally sufficient merely because the engineering test suite passed.

## 5. Provider/account confirmations — factual evidence, not legal decisions

Before concluding L-10, obtain owner/provider confirmations for:

- **Resend:** subscribed plan, content retention/storage controls, ability and procedure for early message-content deletion, exact sender domain and applicable contractual terms.
- **Inngest:** active plan, run/step trace retention window, configured controls, data-processing terms.
- **Vercel:** active plan, runtime and observability log retention, request-path token exposure, subprocessor terms.
- **Supabase:** current engineering/test plan and region, backup/PITR/manual/offsite practices, changes before processing real customer data.
- **Stripe:** MR-5 remains paused; do not ask counsel to approve live billing from this handoff. Review any B2B billing processor obligations as a separate dependency if MR-5 resumes.
- **Google:** link destination in the accepted system; no Google Business Profile API review-detection integration may be assumed.
- **Twilio/SMS:** not active; separate scoped review is required before any future provider/channel activation.

Classify missing evidence **ACCOUNT OR PROVIDER CONFIRMATION REQUIRED**, not verified.

## 6. Findings response matrix — reviewer to complete

The qualified reviewer should return a row for each issue, including “no change required” decisions with reasoning. Keep this section blank until actual qualified findings are received.

| Ref | Jurisdiction/use case | Reviewer determination / supporting authority | Required action | Gate affected | Severity | Accountable party | Status |
|---|---|---|---|---|---|---|---|
| L-01 through L-13 | **REVIEW PENDING** | **NOT PROVIDED** | **TBD BY REVIEWER** | **TBD** | **TBD** | **TBD** | NOT STARTED |

**Allowed determination categories:**

- ACCEPT AS TECHNICALLY SUFFICIENT FOR SCOPED REQUIREMENT (with legal basis documented);
- REVISE — ENGINEERING CHANGE REQUIRED;
- POLICY / CONTRACT CHANGE REQUIRED;
- JURISDICTION-SPECIFIC CONDITION REQUIRED;
- INSUFFICIENT INFORMATION — ADDITIONAL FACTS REQUIRED.

**Gate labels:** before real customer data; before live messaging; before real-customer pilot; before public launch; post-launch operational obligation. More than one label may apply. Only the owner or qualified reviewer can determine actual legal or business obligations.

For each change request, identify the **specific behavior** required; the corresponding owner decision; any needed migration/data transition; negative-test expectations; audit/logging implications; processor account or commercial dependencies; and proof needed for acceptance.

## 7. Return and reconciliation protocol

1. Owner selects a qualified US/Canada legal/compliance professional, defines engagement scope, and confirms factual intake data privately.
2. Owner submits the versioned technical packet and this handoff through an approved channel. Sending/external engagement is **not** performed by this documentation slice.
3. Reviewer returns signed/attributed written findings, citing applicable authority and the jurisdiction/use case.
4. MPG logs each finding as a separate tracked decision or bounded engineering task. Engineering performs no substantive legal-policy choices by inference.
5. Owner accepts each policy or technical conclusion before implementing consequential changes.
6. Engineering implements permitted smallest-safe slices on feature branches, runs the necessary targeted tests and hosted synthetic verification, reviews diffs, and presents PRs for owner approval.
7. MR-7 closeout decision occurs only after review conclusions, unresolved exceptions and implementation evidence have been reconciled. MR-8 needs its own later explicit gate decision.

**Handling limitation:** Do not commit private attorney-client advice, non-public counsel correspondence, real customer data, processor contracts, or sensitive commercial material into the public Product or Company OS repositories. Store confidential artifacts only in an owner-approved private location and reference them with non-sensitive status/identifier.

## 8. Current explicit non-authorizations

- Case B is **UNRESOLVED / OWNER-EXCLUDED / DO NOT IMPLEMENT**.
- MR-7 remains **IN PROGRESS**, not complete or legally certified.
- MR-8 remains **GATED**, not authorized.
- MR-5 billing remains **PAUSED / INCOMPLETE**; Stripe/live charging disabled.
- MR-1B-H hosted email-domain validation remains **DEFERRED**.
- Live customer messaging and SMS are **NOT AUTHORIZED**.
- Real customer data, real-customer pilots, public solicitations, final pricing, public launch and Company Stage 2 are **NOT AUTHORIZED**.
- Terms/Privacy content, acceptance/versioning contracts and public site publication are **NOT FINALLY APPROVED**.

## 9. Closeout and owner checkpoint

**Current slice:** ENGINEERING COMPLETE / READY FOR OWNER REVIEW after branch/PR verification.

**Actual legal review:** NOT STARTED / AWAITING EXTERNAL REVIEWER AND FACTUAL INTAKE.

**Next owner action:** Review the proposed comprehensive jurisdiction scope and booking/checkout/POS/CRM email-origin model; identify qualified reviewer(s), and confirm what customer-facing messaging notice or consent choice (if any) is presented during these business workflows, along with provider/account facts, before requesting legal findings. No merger, deployment, pilot, live messaging, billing or legal sufficiency claim is implied by preparation of this handoff.
