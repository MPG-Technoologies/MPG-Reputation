# MPG Reputation — Market-Ready Roadmap (MR-0 through MR-11)

| Metadata | Value |
|---|---|
| Product | MPG Reputation (`PROD-REP-001`) |
| Document | Market-Ready Product Development Engineering Roadmap |
| Status | ACTIVE ENGINEERING EXECUTION PLAN |
| Authority | `MPG-DEC-046` (Owner Direction recorded 2026-09-19) |
| Governance Source of Truth | `E:\MPG` (Company OS) |
| Public Safe | Yes |

This document defines the sequential engineering and operational build program for MPG Reputation to progress from the proven V0.2 controlled staging baseline into a fully market-ready product. 

This is an **engineering execution specification**, not marketing copy. Inclusion in this roadmap authorizes architectural design, engineering development, and controlled synthetic/staging testing within bounded milestone limits. It **does not** imply that subsequent milestones are completed or that consequential launch/commercial gates have been passed.

---

## Roadmap Overview

```text
[MR-0: Governance Reconciliation] (CURRENT)
       │
       ▼
[MR-1: Production Messaging Core] (NEXT ENGINEERING MILESTONE)
       │
       ▼
[MR-2: Customer Activation]
       │
       ▼
[MR-3: Completion Source Platform]
       │
       ▼
[MR-4: Trial / Usage / Economics]
       │
       ▼
[MR-5: Billing]
       │
       ▼
[MR-6: Admin / Support / Observability]
       │
       ▼
[MR-7: Trust / Security / Compliance]
       │
       ▼
[MR-8: Controlled Pilot]
       │
       ▼
[MR-9: Product Website / Acquisition Funnel]
       │
       ▼
[MR-10: Marketing Engine]
       │
       ▼
[MR-11: Market Release]
```

Each transition is strictly evidence- and gate-controlled.

---

## Detailed Milestone Specifications

### MR-0 — Governance Reconciliation

| Dimension | Specification |
|---|---|
| **Status** | **CURRENT MILESTONE** |
| **Objective** | Synchronize governance, authority, decisions, project status, agent instructions, and roadmaps between Company OS (`E:\MPG`) and the product repository (`E:\MPG-Reputation`) under `MPG-DEC-046`. |
| **Dependencies** | Owner decision `MPG-DEC-046`. |
| **Implementation Scope** | 1. Record `MPG-DEC-046` in `docs/02-decision-register.md`.<br>2. Update `docs/01-project-status.md` to reflect temporary primary execution focus and paused Professional Business Websites work.<br>3. Update `products/mpg-reputation/README.md` and `docs/19-backlog.md` in Company OS.<br>4. Update `AGENTS.md` in `E:\MPG-Reputation` to govern the Market-Ready Build Program.<br>5. Establish `docs/MARKET-READY-ROADMAP.md` and project-specific `README.md`. |
| **Exit Evidence** | Clean pass on Company OS governance validator (`validate_company_os.py` and `test_company_os.py`); clean `git diff --check` across both repositories; atomic local commits recorded. |
| **Explicit Non-Assumptions** | Does not activate Stage 2 or later company stages; does not grant lifecycle `ACTIVE`, marketing approval, public launch, or live customer messaging; does not alter the accepted seven-family commercial productization sequence. |
| **Gate Required** | Owner acceptance of MR-0 reconciliation before MR-1 implementation begins. |

---

### MR-1 — Production Messaging Core

| Dimension | Specification |
|---|---|
| **Status** | **NEXT ENGINEERING MILESTONE** |
| **Objective** | Engineer production email messaging infrastructure using Resend with strict tenant routing, domain authentication, deliverability monitoring, and bounce/complaint handling, while keeping live sends disabled. |
| **Dependencies** | MR-0 complete; verified Resend sending domain and API configuration provided by owner. |
| **Implementation Scope** | 1. Implement production `ResendEmailProvider` with robust error classification (transient vs permanent).<br>2. Develop responsive, accessible, neutral email templates for initial review request and optional single reminder.<br>3. Implement inbound webhook handler (`/api/webhooks/resend`) with signature verification for delivery, bounce, and complaint events.<br>4. Automate contact suppression on hard bounces and spam complaints.<br>5. Harden workflow retry mechanisms with exponential backoff and dead-letter exception records.<br>6. Implement server-side safety flag ensuring live sends to real customers remain disabled until explicitly authorized. |
| **Exit Evidence** | Comprehensive test suite verifying email construction, template neutrality, webhook signature verification, bounce suppression updates, and retry behavior; synthetic end-to-end delivery verified to internal test addresses. |
| **Explicit Non-Assumptions** | LIVE customer messaging remains OFF (`ENABLE_LIVE_EMAIL=false` or server guard); SMS is explicitly outside MR-1 and remains gated; does not include marketing emails or broadcast campaigns. |
| **Gate Required** | Developer and founder verification of synthetic delivery, webhook ingestion, and safety guards before production traffic is permitted. |

---

### MR-2 — Customer Activation

| Dimension | Specification |
|---|---|
| **Status** | PLANNED |
| **Objective** | Provide a reliable, self-serve business onboarding and location activation workflow ensuring no review automation can become active without an explicitly confirmed, valid Google review destination. |
| **Dependencies** | MR-1 complete. |
| **Implementation Scope** | 1. Streamline authenticated onboarding wizard for organization and location creation.<br>2. Google review URL parser and validator with interactive test link.<br>3. Explicit business confirmation step persisting verified destination status.<br>4. Activation checklist widget in dashboard (organization created, location configured, destination verified, sample tested, automation enabled).<br>5. Clear error recovery flows for broken, changed, or invalid review URLs. |
| **Exit Evidence** | Walkthrough verification demonstrating that automation remains strictly disabled until a valid destination URL is confirmed; validation tests rejecting malformed, dangerous, or non-Google redirect URLs. |
| **Explicit Non-Assumptions** | Does not require Google Business Profile OAuth API (uses validated direct URL baseline); does not allow bypass of review gating restrictions. |
| **Gate Required** | Technical verification that automation engine enforces confirmed destination check prior to scheduling requests. |

---

### MR-3 — Completion Source Platform

| Dimension | Specification |
|---|---|
| **Status** | PLANNED |
| **Objective** | Create a scalable, secure, and extensible completion ingestion layer supporting universal webhooks and adapter architecture. |
| **Dependencies** | MR-2 complete. |
| **Implementation Scope** | 1. Universal completion API endpoint (`/api/v1/completions`) with API key and HMAC authentication.<br>2. Strict per-tenant rate limiting and replay attack protection.<br>3. Payload validation and normalization pipeline translating diverse completion formats into canonical `customer.completed` events.<br>4. Ingestion audit log and developer webhook debugging console in organization settings.<br>5. Extensible adapter interface for future demand-validated native CRM connectors. |
| **Exit Evidence** | Automated test suite verifying webhook authentication, tenant isolation, schema validation, replay rejection, and idempotent event creation; simulated external system completions processed cleanly. |
| **Explicit Non-Assumptions** | Does not build dozens of speculative native CRM connectors; native integrations are implemented only when supported by verified customer demand and API access. |
| **Gate Required** | Security and tenant isolation audit of public webhook endpoints. |

---

### MR-4 — Trial / Usage / Economics

| Dimension | Specification |
|---|---|
| **Status** | PLANNED |
| **Objective** | Enforce server-side trial limits, implement an immutable usage metering ledger, and validate per-organization cost models against actual provider pricing. |
| **Dependencies** | MR-1, MR-2, MR-3 complete. |
| **Implementation Scope** | 1. Server-side trial entitlement engine strictly enforcing 30 review requests or 30 calendar days (whichever comes first).<br>2. Automated trial expiration transitions that pause pending automations gracefully.<br>3. Immutable usage ledger recording billable events: `review_requests_initiated`, `emails_sent`, `webhooks_processed`.<br>4. Dashboard trial progress component displaying usage and remaining days/requests truthfully.<br>5. Cost allocation and contribution margin models tracking direct COGS (email, database, compute). |
| **Exit Evidence** | Automated tests demonstrating that automation halts immediately when request #30 is dispatched or day 30 is reached; verified ledger reconciliation against provider invoices. |
| **Explicit Non-Assumptions** | No unlimited requests during trial; no automated conversion to paid subscription without explicit customer payment method and consent. |
| **Gate Required** | Founder review and verification of unit economics and COGS model (`REP-ECON-001`). |

---

### MR-5 — Billing

| Dimension | Specification |
|---|---|
| **Status** | PLANNED |
| **Objective** | Integrate Stripe for recurring subscription billing, payment collection, entitlement management, and automated dunning/cancellation workflows. |
| **Dependencies** | MR-4 complete; owner-approved pricing, plan limits, and commercial terms (`REP-ECON-002`). |
| **Implementation Scope** | 1. Stripe Checkout integration for subscription checkout.<br>2. Stripe Customer Portal integration for card updates, invoice history, and cancellation.<br>3. Webhook handler (`/api/webhooks/stripe`) with cryptographic signature verification.<br>4. Subscription state synchronization (`trialing`, `active`, `past_due`, `canceled`, `unpaid`).<br>5. Automated grace period enforcement and automation suspension on payment failure. |
| **Exit Evidence** | Stripe test suite passing; end-to-end checkout, renewal, card update, failed payment, and cancellation flows validated in Stripe test mode; zero RLS or webhook race conditions. |
| **Explicit Non-Assumptions** | Pricing numbers remain hypotheses until formally authorized by the owner in Company OS; live Stripe mode disabled until pricing and terms are approved. |
| **Gate Required** | Formal owner decision approving commercial model, final prices, payment terms, and refund policies under the MPG Pricing Framework (`MPG-DEC-018`, `docs/07-pricing-commercial-model.md`). |

---

### MR-6 — Admin / Support / Observability

| Dimension | Specification |
|---|---|
| **Status** | PLANNED |
| **Objective** | Build secure administrative and operational tooling for MPG staff to monitor product health, troubleshoot customer issues, and handle exceptions without direct database access. |
| **Dependencies** | MR-1 through MR-5 complete. |
| **Implementation Scope** | 1. Internal administrative console restricted by `MPG_ADMIN` role.<br>2. Organization and location search, inspection, and status audit view.<br>3. Deliverability telemetry dashboard (bounce rates, spam complaints, delivery latency).<br>4. Exception management queue for failed webhooks, broken destination URLs, and stuck workflows.<br>5. Audit logging for all administrative actions and support interventions. |
| **Exit Evidence** | Operational walkthrough demonstrating resolution of common support scenarios (e.g. updating destination URL, investigating bounced email, reviewing usage) entirely via admin UI without SQL commands. |
| **Explicit Non-Assumptions** | Admin tooling is internal-only and never exposed to business users; admin capabilities must not bypass tenant security controls or leak customer PII across organizations. |
| **Gate Required** | Access-control and security audit of admin endpoints and role verification logic. |

---

### MR-7 — Trust / Security / Compliance

| Dimension | Specification |
|---|---|
| **Status** | PLANNED |
| **Objective** | Harden application security, enforce privacy standards, implement data lifecycle controls, and ensure compliance with US and Canadian messaging regulations. |
| **Dependencies** | MR-1 through MR-6 complete. |
| **Implementation Scope** | 1. Comprehensive PostgreSQL RLS audit with negative penetration tests verifying complete cross-tenant denial.<br>2. Customer data retention, export, and deletion pipelines honoring GDPR/CCPA-style data subject requests.<br>3. Cross-channel durable suppression registry ensuring unsubscribed contacts cannot be messaged by any trigger.<br>4. CAN-SPAM and CASL compliance verification (physical business address in footer, clear sender identification, functional one-click unsubscribe).<br>5. Product Terms of Service and Privacy Policy technical enforcement. |
| **Exit Evidence** | Automated penetration test report showing zero cross-tenant data leaks; verified end-to-end data deletion test; verified suppression check blocking sends to unsubscribed contacts. |
| **Explicit Non-Assumptions** | Technical compliance features do not substitute for qualified legal review (`REP-LEGAL-001`); no health information (PHI/HIPAA) is ever accepted or stored. |
| **Gate Required** | Qualified legal review and sign-off on messaging compliance, terms of service, and privacy policy before external customer data is processed. |

---

### MR-8 — Controlled Pilot

| Dimension | Specification |
|---|---|
| **Status** | PLANNED |
| **Objective** | Execute a bounded, supervised pilot with a small cohort of real businesses to validate real-world conversion, deliverability, and operational support feasibility. |
| **Dependencies** | MR-1 through MR-7 exit criteria verified; explicit owner pilot authorization (`REP-PILOT-001`). |
| **Implementation Scope** | 1. Pilot participant onboarding package and agreement.<br>2. Supervised activation of 3–5 candidate businesses.<br>3. High-frequency monitoring of delivery, click-through, and Google review generation.<br>4. Structured feedback capture interviews with business operators.<br>5. Operational metrics report measuring support burden and error rates. |
| **Exit Evidence** | Pilot summary report demonstrating reliable delivery, acceptable conversion rates, manageable support load, zero review-gating infractions, and positive founder/business validation. |
| **Explicit Non-Assumptions** | Pilot is invitation-only under controlled supervision; does NOT constitute open public availability or general market release. |
| **Gate Required** | Owner approval of `PILOT_READY` status and explicit pilot cohort authorization. |

---

### MR-9 — Product Website / Acquisition Funnel

| Dimension | Specification |
|---|---|
| **Status** | PLANNED |
| **Objective** | Develop the dedicated public product website for MPG Reputation, featuring the Free Reputation Check experience and seamless trial onboarding funnel. |
| **Dependencies** | MR-2, MR-4, MR-5, and MR-8 pilot learnings. |
| **Implementation Scope** | 1. Fast, responsive, accessible marketing site (`/`, `/how-it-works`, `/pricing`, `/faq`, `/terms`, `/privacy`).<br>2. Interactive Free Reputation Check questionnaire capturing current review metrics and process gaps.<br>3. Dynamic Reputation Opportunity Report generation presenting truthful, non-hyped optimization insights.<br>4. Seamless call-to-action transition from report to 30-day/30-request free trial registration.<br>5. Adherence to Company OS public claims policy (no fabricated testimonials, guarantees, or ranking promises). |
| **Exit Evidence** | Lighthouse performance, accessibility, and SEO audit scores > 90; end-to-end user testing of acquisition funnel from initial check to trial account creation; truthful claims audit pass. |
| **Explicit Non-Assumptions** | The product website is an independent product surface (`MPG-DEC-039`), not the MPG corporate/umbrella website; does not publish unapproved pricing. |
| **Gate Required** | Public claims review and owner marketing approval prior to public deployment. |

---

### MR-10 — Marketing Engine

| Dimension | Specification |
|---|---|
| **Status** | PLANNED |
| **Objective** | Build outbound and inbound marketing infrastructure, acquisition analytics, and organic content pipelines for MPG Reputation. |
| **Dependencies** | MR-9 complete. |
| **Implementation Scope** | 1. Privacy-respecting analytics and conversion funnel instrumentation.<br>2. Organic search landing page templates for local business review management.<br>3. Email nurture workflows for prospects completing the Free Reputation Check.<br>4. Acquisition attribution tracking measuring cost per lead and trial conversion velocity.<br>5. Marketing campaign performance reporting. |
| **Exit Evidence** | Verified funnel analytics tracking without privacy violations; tested lead nurture sequences; validated CAC and conversion reporting models. |
| **Explicit Non-Assumptions** | Does not authorize cold email spam or unsolicited messaging; all marketing claims must strictly reflect proven product capabilities. |
| **Gate Required** | Owner review and approval of marketing channels, copy, and acquisition budget. |

---

### MR-11 — Market Release

| Dimension | Specification |
|---|---|
| **Status** | PLANNED |
| **Objective** | Formal commercial release, open public customer acquisition, and operational handover. |
| **Dependencies** | MR-1 through MR-10 exit criteria verified; all company launch gates passed (`REP-LAUNCH-001`). |
| **Implementation Scope** | 1. Production infrastructure cutover and scaling verification.<br>2. Public self-serve registration enablement.<br>3. Real-time alerting, monitoring, and on-call runbooks active.<br>4. Authoritative service registry update in Company OS (`lifecycleStatus = ACTIVE`, `marketingApproved = true`). |
| **Exit Evidence** | Formal sign-off on G1–G13 service launch gates; signed readiness decision; passing Company OS validation with marketable service generated; operational stability under live conditions. |
| **Explicit Non-Assumptions** | Market release cannot occur without explicit owner authorization; commercial availability is never inferred or announced prematurely. |
| **Gate Required** | Explicit owner decision granting commercial market approval and advancing service lifecycle to `ACTIVE`. |

---

## Roadmap Governance Rules

1. **Sequential Progression**: Milestones must be executed in order unless explicit owner authorization permits parallel preparation.
2. **Evidence Over Assertion**: No milestone may be marked completed without documented exit evidence satisfying its stated criteria.
3. **Strict Gate Enforcement**: Reaching a milestone's development scope does not waive the required gate before consequential activation.
4. **No Premature Implementation**: Do not build billing in MR-1, do not build public funnels in MR-3, and do not enable live messaging until authorized.
