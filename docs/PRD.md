# MPG Reputation — Product Requirements Document v0.1

| Metadata | Value |
|---|---|
| Product / WIP subject | MPG Reputation / Review & Reputation Automation — `PROD-REP-001` |
| Version | 0.1 |
| Status | OWNER-AUTHORIZED IMPLEMENTATION BASELINE |
| Company stage | Stage 1 active; Stage 2 and all later company stages not activated |
| Owner | MPG Founder |
| Last Updated | 2026-09-17 |
| Public Safe | Yes — synthetic examples only |
| Authority | `MPG-DEC-038` through `MPG-DEC-044` |

This PRD is the owner-authorized implementation baseline for the first bounded MPG Reputation product slice. It translates the [authoritative product direction](README.md) into testable requirements. It is not `FROZEN`, a market-approved offer, evidence of delivery readiness, a final commercial model, a legal-compliance claim, or authority to launch or message real customers.

## 1. Product outcome

V0.1 must prove one reliable, neutral review-request loop:

```text
business user authenticates
→ creates organization and location
→ confirms a valid Google review destination
→ records a legitimate completed customer through Quick Complete
→ persists customer.completed once
→ evaluates eligibility without sentiment or rating prediction
→ runs a durable workflow
→ generates one development email with an opaque tracked link
→ records a click
→ redirects with HTTP 302 to the trusted stored Google destination
→ updates truthful dashboard activity
```

The success condition is a secure, repeatable vertical slice, not breadth. The system optimizes genuine participation; it never optimizes positive-rating manipulation.

## 2. Authority and boundaries

### Authorized in this baseline

- implementation-ready architecture and data model;
- separate local product repository and, where safely possible, private remote repository;
- application development, automated tests, prototypes and synthetic internal testing;
- the first complete vertical slice defined in this PRD;
- provider evaluation through abstractions and development-safe adapters.

### Not authorized by this baseline

- public commercial launch, unrestricted solicitation or claims that the product is available;
- delivery-readiness, lifecycle `ACTIVE` or `marketingApproved = true`;
- final pricing, paid plan purchases or production infrastructure commitments;
- production sending to real customers, a live pilot or import of real customer/patient data;
- blanket legal, privacy, security, Google-policy or messaging-compliance claims;
- the MPG umbrella website or any Stage 2/Stage 7 activation.

Professional Business Websites remains the primary commercial productization track. MPG Reputation remains the single authorized secondary build track.

## 3. Product principles

1. **Seamless for the business:** configure a location and destination once, then use a small completion action or adapter.
2. **Seamless for the customer:** no MPG account or installation; one recognizable neutral request and one direct link.
3. **Seamless for MPG:** automate routine execution, retain domain audit evidence and surface exceptions.
4. **Truth before hype:** distinguish completed customers, eligible customers, scheduled requests, sends and clicks; do not invent reviews, ratings or causal outcomes.
5. **Minimal data:** accept only the customer reference, contact channel, location, completion event and permission state needed for the workflow.
6. **No review gating:** eligibility must never depend on satisfaction, complaint status, predicted rating or expected positive sentiment.
7. **Defense in depth:** database tenant isolation, server-only secrets, safe redirects, idempotency and auditability are baseline requirements.

## 4. Actors and access

| Actor | V0.1 responsibility |
|---|---|
| `MPG_ADMIN` | Future operational oversight through secure developer/admin tooling; no complex admin UI in V0.1. |
| `BUSINESS_OWNER` | Creates and controls an organization; manages locations, users and review destinations. |
| `BUSINESS_ADMIN` | Manages organization configuration, locations, destinations and operational users. |
| `BUSINESS_OPERATOR` | Uses Quick Complete and views operational activity allowed by policy. |
| `BUSINESS_VIEWER` | Read-only access to authorized organization activity. |
| `CUSTOMER` | Receives and may click a neutral request; never creates an MPG account. |
| `SYSTEM` | Executes validated workflows, provider calls, usage entries and audits. |

Application roles map to stored organization memberships: `OWNER`, `ADMIN`, `OPERATOR`, `VIEWER`. Authorization comes from trusted database/application state, never editable user metadata.

## 5. Organization and tenant model

```text
MPG
└── Organization
    ├── Organization Users
    └── Locations
        ├── Review Destination
        ├── Customers
        └── Review Automation
```

Multi-location support is mandatory in the domain model from the first migration. A user may belong to more than one organization. Every tenant-owned record must carry an organization identifier directly or through an immutable, validated parent relationship. A user may access only rows for organizations where an active authorized membership exists.

## 6. V0.1 functional surfaces

| Route | Requirement |
|---|---|
| `/login` | Supabase Auth email/password sign-in; development account creation may be available without implying public signup. |
| `/onboarding` | Create an organization and initial owner membership, then create the first location. |
| `/app` | Authenticated product entry that resolves to the dashboard. |
| `/app/dashboard` | Truthful activity and attention summary for the active organization. |
| `/app/quick-complete` | Small completion form and clear success/failure state. |
| `/app/settings/location` | Create/update location basics and active state within authorized roles. |
| `/app/settings/review-destination` | Validate, test and explicitly confirm a supported Google review URL. |
| `/r/[token]` | Resolve a strong opaque token, record the click if possible and issue a safe 302 redirect. |

The UI is a coherent temporary product system, not final MPG visual identity. No full marketing site, complex pricing page, giant dashboard or decorative AI surface belongs in V0.1.

## 7. Quick Complete

Quick Complete is the first customer-source interface, not a CRM.

Required fields: Customer First Name; Customer Last Name (optional); Email; Phone (optional and future-compatible only); Completion Date/Time; and Location. Primary action: **Complete Customer**.

On submission the server validates membership and location ownership, normalizes contact/country/time values, atomically creates or updates the minimal customer record, persists a canonical completion event, and emits `customer.completed` exactly once for a stable source event. The response distinguishes success, validation error, duplicate acceptance and server failure without allowing a double-click to duplicate downstream requests.

## 8. Canonical completion event

Domain name: `CUSTOMER_COMPLETED`  
Event name: `customer.completed`

```json
{
  "event_id": "uuid",
  "organization_id": "uuid",
  "location_id": "uuid",
  "customer_id": "uuid",
  "source": "quick_complete",
  "source_event_id": "stable-string",
  "source_customer_id": null,
  "source_transaction_id": null,
  "completed_at": "ISO-8601",
  "country": "CA",
  "contact": { "email": "customer@example.test", "phone": null },
  "permission": { "email": "allowed", "sms": "unknown", "source": "quick_complete" }
}
```

Country values use normalized ISO 3166-1 alpha-2 codes. Timestamps use UTC-aware ISO-8601 values. The database enforces uniqueness for the organization/source/source-event tuple. Repeated receipt is an idempotent success and must not create another request.

## 9. Eligibility engine

`evaluateReviewEligibility()` is a pure domain function where practical. It accepts normalized organization, location, customer, destination, suppression, prior-request and usage facts and returns exactly one primary decision:

- `ELIGIBLE`;
- `NO_CONTACT`;
- `EMAIL_PERMISSION_UNKNOWN`;
- `EMAIL_PERMISSION_DENIED`;
- `SUPPRESSED`;
- `DUPLICATE_EVENT`;
- `RECENT_REQUEST`;
- `NO_REVIEW_DESTINATION`;
- `LOCATION_INACTIVE`;
- `ORGANIZATION_INACTIVE`;
- `TRIAL_LIMIT_REACHED`.

The engine must not receive or inspect customer happiness, star rating, complaint status, expected sentiment or any proxy for a positive review. V0.1 treats email permission conservatively: only `allowed` is eligible for sending; `unknown` and `denied` produce their named outcomes. Final legal treatment remains subject to qualified review before real messaging.

## 10. Review destination

Each location may have one active Google review destination in V0.1. Configuration must require HTTPS; accept only supported Google host/path patterns; canonicalize and store the validated URL; let an owner/admin open and test it; record explicit owner/admin confirmation; reject arbitrary hosts and redirect-time destinations; and block automation when the destination is missing, invalid, unconfirmed or inactive.

The tracked route resolves the destination from trusted stored state only. This prevents open redirects.

## 11. Review requests and tracked links

A review request includes organization, location, customer, completion event, channel, status, token, schedule/sent/delivery/click/cancel timestamps, expiry and timestamps. Supported statuses are `SCHEDULED`, `SENDING`, `SENT`, `DELIVERED`, `CLICKED`, `FAILED`, `CANCELLED`, and `SUPPRESSED`.

Tracking tokens use a cryptographically secure random source, contain no customer identifier or email and have enough entropy to resist guessing. Tokens are unique; a digest may be stored where the lookup design permits.

`/r/[token]` must resolve the request; reject invalid/expired tokens safely; resolve the active organization, location and confirmed stored destination; record an idempotent `review_request.clicked` event and usage increment where possible; then issue HTTP 302 to the stored destination. An analytics write failure must not unnecessarily trap a legitimate customer after token and destination verification. Disabled locations, inactive organizations and missing destinations never redirect to an untrusted target.

## 12. Workflow

Inngest is the V0.1 durable workflow provider. Postgres remains the domain-system record.

```text
customer.completed
→ record workflow execution/audit
→ evaluate eligibility
→ sleep for configurable delay
→ re-check current eligibility
→ create-or-resolve the unique review request
→ send through EmailProvider
→ persist provider result, message event, usage and audit
→ optionally sleep for configured reminder interval
→ if not clicked and still eligible, send at most one reminder
```

The development delay is configurable in seconds/minutes. No final production delay is hard-coded. The workflow defines bounded retries, cancellation events, provider failure handling and idempotent steps. Duplicate events, function retries, user double-clicks and provider retries must not produce duplicate customer messages.

## 13. Provider boundaries

Vendor-specific calls remain behind narrow interfaces:

- `EmailProvider` — `ConsoleEmailProvider` is the safe default; `ResendEmailProvider` is enabled only through explicit server configuration;
- `SmsProvider` — interface only in V0.1; no Twilio implementation or live SMS;
- `WorkflowProvider` — Inngest implementation;
- `CustomerSourceAdapter` — Quick Complete implementation and future universal/native adapters;
- `ReviewProvider` — manual Google destination now; Google OAuth/API later;
- `AnalyticsProvider` — optional future external analytics; V0.1 activity stays in Postgres.

Domain logic must not contain scattered `resend.*`, `twilio.*`, `nango.*` or `google.*` calls.

## 14. Data model

| Table | Purpose and essential constraints |
|---|---|
| `organizations` | Name, slug, country, timezone, status and timestamps; unique normalized slug. |
| `organization_users` | Organization/user/role membership; unique organization/user pair; indexed by user for RLS. |
| `locations` | Tenant-owned name/address/country/timezone/status; multi-location from day one. |
| `customers` | Minimal contact and permission data scoped to organization/location; no clinical records. |
| `customer_completion_events` | Canonical normalized event; unique organization/source/source-event identifier. |
| `review_destinations` | Location/provider URL, validation state and authorized confirmation; one provider record per location as constrained. |
| `review_requests` | Unique completion/channel request, state machine, strong token and timestamps. |
| `review_request_events` | Append-only request lifecycle facts with idempotency key where applicable. |
| `message_events` | Provider-neutral attempts/results, provider reference, event type and sanitized error information. |
| `suppressions` | Tenant/channel/contact suppression digest or normalized value, reason and timestamps. |
| `organization_usage` | Period-and-metric counters with unique organization/period/metric key. |
| `audit_events` | Append-only domain audits with minimal metadata and actor/entity references. |

Foreign keys require supporting indexes. Columns used by tenant policies and operational filters require intentional indexes. Use timezone-aware timestamps and lower-case snake-case identifiers. Database constraints and unique indexes are the primary concurrency/idempotency controls.

Later architecture may add `integration_connections`, `google_reviews`, `review_attributions`, `reputation_baselines`, `reputation_snapshots`, `private_feedback`, and `subscriptions`. V0.1 must not create unused future tables merely to appear complete.

## 15. Security and trust boundaries

- Supabase Auth establishes identity; server protection uses current verified-claims guidance rather than trusting cookie session data alone.
- Every Data API-exposed table has RLS enabled and explicit grants.
- Tenant policies include organization-membership predicates; `TO authenticated` alone is insufficient.
- `UPDATE` policies use both `USING` and `WITH CHECK`, and have corresponding `SELECT` policies.
- Authorization never uses editable user metadata.
- Publishable browser configuration is limited to the Supabase project URL and publishable key. Service-role/secret keys, database credentials and provider secrets remain server-only.
- Anonymous customers cannot query tenant tables. Tracking resolution uses a narrow server route and privileged server client.
- Privileged database functions are avoided by default. If required for an atomic cross-RLS operation, the function lives in a non-exposed schema, validates `auth.uid()` and membership internally, sets an empty search path, has explicit grants and receives dedicated tests/review.
- All identifiers, dates, email addresses, phone values and URLs are validated server-side.
- No destination query parameter controls redirects.
- Logs, audits and errors avoid unnecessary personal information.

## 16. Audit and usage

Required audit events include `organization.created`, `location.created`, `review_destination.updated`, `customer.completed`, `review_request.created`, `review_request.sent`, `review_request.clicked`, `review_request.failed`, and `suppression.created`. Audit fields are ID, organization, actor type, optional actor ID, event type, entity type/ID, minimal JSON metadata and timestamp.

Initial usage metrics are `review_requests_created`, `review_requests_sent`, `emails_sent`, `email_provider_attempts`, `link_clicks`, and `workflow_executions`. SMS segments, inbound SMS, phone-number months and Google API calls are future-compatible only. V0.1 does not implement billing.

## 17. Dashboard

The authenticated dashboard shows only stored, scoped facts. This period: Completed customers, Eligible customers, Requests scheduled, Requests sent and Review links clicked. Needs Attention: missing/unconfirmed Google review destination, failed requests and configuration issues. Automation status reflects current configuration and organization/location state. Empty states say no activity has been recorded. V0.1 shows no fake reviews, ratings, testimonials, outcome attribution or invented trends.

## 18. Review integrity and message content

The system prohibits fake reviews, purchased reviewers, paid positive reviews, review gating, positive-only solicitation, rating-prediction filters, incentives conditional on positive sentiment and employee-generated customer reviews.

Development email copy remains neutral:

```text
Hi {{first_name}},

Thanks for choosing {{business_name}}.

If you'd like to share your experience, we'd appreciate your honest feedback.

Leave a review:
{{tracking_url}}

Thank you,
{{business_name}}
```

It never asks for five stars, a positive review or protection of a rating.

## 19. Sensitive-business data rule

Potential healthcare use does not authorize healthcare-data ingestion. External systems send a minimal `CUSTOMER_COMPLETED` event. Do not ingest diagnosis, clinical notes, imaging, medical history, insurance, treatment records or medication data. Repository fixtures use synthetic organizations such as `Northstar Dental`, `Acme Plumbing` or `Demo Orthodontics`; no identifiable pilot, patient, commercial arrangement or private contact information may enter either repository.

## 20. Failure behaviour

| Condition | Required behaviour |
|---|---|
| Database failure | Return a safe failure, record what can be recorded, and do not emit an unpersisted event. |
| Duplicate event | Return idempotent accepted result; do not create/send another request. |
| Provider failure | Persist sanitized failed message/request state; bounded retry remains idempotent. |
| Workflow failure | Surface an operational exception and audit; no uncontrolled resend loop. |
| Invalid Google URL | Reject configuration and retain no active arbitrary destination. |
| Invalid/expired token | Safe failure page; no redirect and no tenant/customer disclosure. |
| Inactive organization/location | Ineligible/cancelled; no message and no redirect. |
| Missing email | `NO_CONTACT`; no workflow send. |
| Permission unknown/denied | Named ineligible result; no send. |
| Suppression | `SUPPRESSED`; no send or reminder. |
| Trial limit | `TRIAL_LIMIT_REACHED`; no send; final trial/commercial rules remain unresolved. |

## 21. Technical baseline

- Current stable Next.js App Router with TypeScript, React Server Components/Actions and Node.js runtime by default;
- Supabase Postgres, Auth, `@supabase/ssr`, Data API grants and RLS;
- Inngest durable orchestration through the App Router serve route;
- provider-neutral email with Console default and Resend opt-in;
- Vercel deployment target without paid provisioning in this task;
- committed lockfile and dependency/version verification against current official guidance.

Implementation references current official documentation, including [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Supabase SSR client setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Inngest Next.js quick start](https://www.inngest.com/docs/getting-started/nextjs-quick-start), and [Resend for Next.js](https://resend.com/nextjs), retrieved 2026-09-17. These references do not convert providers into permanently adopted commercial commitments.

## 22. Automated acceptance coverage

Domain tests cover every eligibility outcome and precedence, duplicate prevention, suppression, supported destination validation, and tracking token resolution/expiry. Database tests prove RLS on every exposed table; Org A cannot select/insert/update/delete Org B data; roles observe their boundaries; anonymous access and cross-tenant relationship attempts are denied. Workflow tests cover eligible scheduling/sending, ineligible paths, retry/idempotency, suppression/cancellation and at most one reminder. Route/form tests prove Quick Complete persists and emits once, valid tracking records and redirects, invalid tracking fails safely, and dashboard metrics reflect stored synthetic events.

## 23. V0.1 quality gate

V0.1 is technically complete only when the repository proves authentication, organization/location/destination configuration, canonical completion persistence, duplicate protection, server-side eligibility, an eligible Inngest workflow using Console email, opt-in Resend adapter, safe tracked redirect, persisted dashboard activity, passing tenant-isolation tests, no committed secrets or real client/patient data, and passing lint, typecheck, tests and production build.

If an external account or local service is unavailable, the handoff states the exact unverified item. Code existence alone is not evidence that a blocked integration passed.

## 24. Deferred V0.1 scope

Do not implement Twilio/SMS, A2P 10DLC, Nango, native Jobber/Housecall Pro connectors, Google OAuth, Google review sync, Pub/Sub, AI replies, advanced attribution, billing, Stripe, multi-plan pricing, white-label/reseller features, native mobile apps, a full CRM, workflow builder, advanced AI, a complex marketing site or the MPG umbrella website.

## 25. Open decisions and later gates

Still `TBD`, `UNKNOWN`, `PROPOSED` or evidence-gated: final vertical, final name/trademark clearance, production providers and infrastructure, legal/compliance implementation, retention periods, production delay/quiet-hour rules, trial count/expiry rules, pricing and allowances, attribution method, support/SLA, pilot eligibility, marketing approval and launch date.

The Company OS remains the governance source of truth. The separate `mpg-reputation` repository becomes the implementation source of truth for code, migrations, tests and technical documentation, subordinate to this baseline and later accepted owner decisions.
