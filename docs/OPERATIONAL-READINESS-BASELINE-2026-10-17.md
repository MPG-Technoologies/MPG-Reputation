# MPG Reputation — Operational Readiness Baseline and Gap Register

| Field | Value |
|---|---|
| Audit date | 2026-10-17; corrected after active-layout re-review on 2026-10-18 |
| Status | INVESTIGATING — source-level audit; not an owner acceptance or pilot gate |
| Product inspected | `MPG-Technoologies/MPG-Reputation` `main` at `dc3a05fd59368fd496a5cc8c17599b558e0351da` |
| Governance inspected | `techwithmpg/mpg-company-os` `main` at `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Active milestone | MR-7 Trust / Security / Compliance — IN PROGRESS |
| External blockers | Qualified US/Canada legal review; MR-5 billing-provider dependency; deferred MR-1B-H hosted sender-domain validation |
| Hard stop | MR-8, live messaging, live billing, real data, customer pilot, commercial launch, Company Stage change NOT AUTHORIZED |

## 1. Why this baseline exists

Code, source-level domain tests, synthetic PostgreSQL tests, hosted migration history, manual UI testing, configured external provider accounts and operational acceptance are **different evidence classes**. Completing a technical milestone does **not** imply that a business can sign up, connect its tools, deliver customer messages and be served through the entire lifecycle without intervention.

This baseline follows **four actors** and the whole service loop, not another architectural restart:

1. **MPG operator:** discover, provision and troubleshoot subscribing organizations; manage support and provider incidents; reconcile usage and billing.
2. **Subscribing business owner:** create an account, activate an organization and location, configure a trustworthy Google destination, connect a completion source, understand readiness and usage.
3. **Business staff/operator:** record genuine completed services with trusted email permission; find customers and status without excessive privilege; handle failures.
4. **Business customer:** receive only a permitted neutral request, read it comfortably on mobile, follow a trusted link, choose freely whether to review, and unsubscribe.

The business customer is **not** MPG Reputation's paying client and does **not** need an MPG account.

## 2. Evidence vocabulary

- **SOURCE PRESENT:** feature path/code exists; not necessarily executable or usable.
- **SYNTHETIC TEST VERIFIED:** named CI/integration test actually passed against synthetic fixtures.
- **HOSTED CONFIG VERIFIED:** provider/account setting independently confirmed in the intended environment.
- **VISUALLY ACCEPTED:** a human used the actual UI and recorded a pass/fail.
- **NOT IMPLEMENTED:** no implementation found for the capability in the current product source/route inventory.
- **DEFERRED / GATED:** explicitly outside present authorization or blocked by dependency, not automatically a software defect.
- **UNKNOWN / UNVERIFIED:** no adequate evidence; do not convert uncertainty into a pass.

Existing automated evidence: Internal CI on combined main `39030374306` passed **426/426 allowlisted synthetic tests**, lint, typecheck and build; targeted isolated E2E `39025957738` passed **1/1** using disposable Supabase. The E2E test directly exercises Quick Complete persistence, outbox, orchestrator handler, console email and tracked HTTP redirect; it is **not** proof of a real delivered email, full browser session, Twilio, actual published review or customer pilot. Earlier accepted MR-7 evidence documents hosted engineering database migration/restore controls. No new visual test, real-provider dispatch or hosted data mutation was performed for this audit.

## 3. Operational flow — evidence matrix

| Stage | Current implementation evidence | Operational status | Missing or unverified evidence |
|---|---|---|---|
| Public discovery/acquisition | `src/app/page.tsx` is a basic login/onboarding landing page | SOURCE PRESENT, **MR-9 NOT STARTED** | Product website, Free Reputation Check, Opportunity Report, acquisition funnel, accessible marketing journey; public release remains gated |
| New business account | `src/actions/auth.ts`, `src/app/login/page.tsx`: Supabase signup/signin/signout | SOURCE PRESENT | Full browser registration, email confirmation, recovery and failed-signup behavior under actual account configuration **NOT VISUALLY ACCEPTED** |
| Business onboarding | `src/app/onboarding/page.tsx`, `src/actions/onboarding.ts`: atomic organization/owner/primary-location RPC | SOURCE PRESENT; synthetic RPC walkthrough exists | Real signup-to-ready browser journey, error recovery, self-service guidance, tenant switching **NOT VISUALLY ACCEPTED** |
| Location/Google destination | `src/app/app/settings/location`, `src/app/app/settings/review-destination`; destination readiness gates | SOURCE PRESENT; activation/domain tests | New user clarity, real destination test-and-confirm UX, failure recovery **NOT VISUALLY ACCEPTED** |
| Service completion — manual | `src/app/app/quick-complete`, `src/actions/quick-complete.ts` | SOURCE PRESENT; synthetic E2E passes | Operator permissions, validation feedback, duplicate behavior and disabled/unknown permission states in an actual browser **NOT VISUALLY ACCEPTED** |
| Service completion — integration | `src/app/api/v1/completions/route.ts`; integration credentials/log/guide UI | Generic signed API/source platform implemented | No ready-made native CRM/POS connector established in current repository; genuine third-party interoperability **UNVERIFIED** |
| Automation/delivery | `src/inngest/functions/review-request.ts`, outbox dispatcher, console/Resend email providers | Domain code and synthetic E2E verified; **LIVE GATED** | Active external sender/domain configuration and real provider acceptance/deliverability not verified; MR-1B-H deferred |
| SMS | No Twilio library, route, provider adapter or SMS worker in current source tree | **NOT IMPLEMENTED / CHANNEL GATED** | Owner-approved channel scope, legal consent/opt-out review, provider account, tests and architecture slice; do not turn on ad hoc |
| Customer message experience | `src/domain/email/*`, `src/app/r/[token]/route.ts`, `src/app/unsubscribe/[token]/route.ts` | Source present, synthetic link/opt-out tests | Inbox/device rendering, accessibility, expired/unsubscribe user journeys **NOT VISUALLY ACCEPTED**; click does not prove a Google review was published |
| Business dashboard/customers | `src/app/app/dashboard`, `src/app/app/customers/page.tsx`, usage and integration pages; `src/components/ui/app-shell.tsx` already includes Customers in active primary navigation | SOURCE PRESENT | Cross-screen browser verification, truthful loading/error/empty states, performance and staff permissions **NOT VISUALLY ACCEPTED** |
| Tenant staff/team operations | Roles OWNER, ADMIN, OPERATOR, VIEWER in membership model | Role enforcement in code/tests | No business-facing invite/role-administration route found in route inventory; staff provisioning journey **NOT IMPLEMENTED / UNVERIFIED** |
| MPG operator console | `src/app/admin/organizations/[organizationId]/{inspection,health,exceptions}`, support grants and audited bounded retries | Scoped support features implemented/accepted in MR-6 | No global tenant directory, search, aggregate owner overview, provider/account configuration or B2B lifecycle console found in current route tree; privilege boundaries must be preserved |
| Billing/subscriptions | `src/lib/billing` and signed Stripe webhook intake | **PARTIAL / MR-5 PAUSED** | Processor projection, recovery, checkout, customer portal, provider/account verification, authorized pricing; no live charging |
| Legal/privacy readiness | MR-7 technical-control packet, privacy lifecycle, sender authority, suppression, retention, Case A restore | Technical foundations accepted | Qualified US/Canada review and review-dependent Terms/Privacy decisions **OUTSTANDING**; Case B owner-excluded |
| Controlled real-customer pilot | MR-8 in accepted roadmap | **GATED / NOT STARTED** | Legal, billing and email-domain dependency reconciliation plus separate owner authorization; no real-customer tests allowed |

## 4. Gap register — source-confirmed versus decision-dependent

**Priorities describe the risk to a coherent operating experience, not permission to bypass accepted milestone gates.**

| ID | Priority | Actor / problem | Confidence | Smallest safe next action | Scope / authorization |
|---|---|---|---|---|---|
| OR-001 | CLOSED (audit correction) | Initial audit inspected unused `src/app/app/nav.tsx` and incorrectly classified Customers navigation as missing. Active `src/app/app/layout.tsx` uses `src/components/ui/app-shell.tsx`, which already links Customers in primary navigation. | **NOT A DEFECT** | Do not change navigation; verify the real AppShell in a future browser walkthrough. | Documentation corrected; previously proposed code/test changes reverted before merge. |
| OR-002 | P1 | Multiple business memberships are commonly resolved using first `organization_users` row; no explicit active-tenant picker found in UI | CONFIRMED code pattern; real multi-tenant usage unverified | Design scope/select/reset model; regression tests for tenant consistency and isolation | **OWNER UX/ARCHITECTURE DECISION BEFORE IMPLEMENTATION** |
| OR-003 | P1 | MPG internal support pages require a known organization ID and explicit access grant; no global owner directory / lifecycle controls | CONFIRMED route inventory | Specify limited operator tenant list/selection and account health navigation without weakening support grants | **NEW SCOPED INTERNAL OPERATIONS SLICE; APPROVAL REQUIRED IF AUTH MODEL CHANGES** |
| OR-004 | P1 | End-to-end signup/onboarding/Quick Complete/customer message flow is not browser-accepted | EVIDENCE GAP | Synthetic-only desktop/mobile visual script; verify success/error/permission/opt-out/expired states | Internal validation; no real customer data or external delivery |
| OR-005 | P1 | Sender domain and actual Resend/Inngest/provider accounts/configuration not proven by code-level tests | EVIDENCE GAP + DEFERRED DEPENDENCY | Read-only external-account inventory, then gated official test-recipient verification if authorized | **MR-1B-H EXTERNAL GATE** |
| OR-006 | P1 | Native client CRM/POS onboarding and mapping not shown beyond signed completion API and guide | CONFIRMED product breadth gap | Validate one common integration scenario using synthetic test payloads; propose adapter only after evidence | Bounded MR-3 refinement, no credential sharing |
| OR-007 | P1 | Tenant staff onboarding/invites and roles lack a demonstrated self-service operational journey | ROUTE GAP | Inspect approved membership provisioning and decide minimal invitation/role UX and enforcement tests | Security/tenant-impact decision required |
| OR-008 | P1 | Paid-client commercial operations incomplete | ACCEPTED MR-5 PAUSE | Resolve account/provider eligibility and resume separate approved MR-5 slices | **PAUSED / NOT ACTIVATED** |
| OR-009 | P1 | No Twilio SMS provider or SMS end-to-end workflow | CONFIRMED / EXPLICIT CHANNEL GATE | Decide whether email-only controlled proof is sufficient; separately scope SMS compliance/provider project | **DO NOT IMPLEMENT OR ACTIVATE UNDER MR-7** |
| OR-010 | P1 | Public product site and acquisition funnel absent beyond placeholder | CONFIRMED / MR-9 GATED | Retain existing design inputs; roadmap staging only until MR-9 dependencies and publication decision | **NO PUBLIC MARKETING / LAUNCH** |
| OR-011 | P0 gate | Real-customer legal permission/Terms/Privacy not approved | ACCEPTED EXTERNAL GATE | Qualified US/Canada counsel assesses actual original business notices, contracts and review-request emails | **MR-7 LEGAL GATE** |
| OR-012 | P1 | Measurement must distinguish sent/delivered/clicked from **review actually published** | CONFIRMED measurement boundary | Review every UI claim and analytic label for this distinction; do not invent Google review attribution | Safe factual copy audit, later slice |
| OR-013 | P2 | Product `README.md`/`AGENTS.md` still have stale MR-6 status at audited main | CONFIRMED docs drift | Review separate PR #9; preserve Company OS as authority | Existing PR #9, not part of this fix |

## 5. Four acceptance journeys (future proof required)

All journeys use fake business, fake staff and `example.test` recipients only. Business customers never need MPG accounts. An actual browser/email inbox experience is **not** inferred from mocked steps.

| Persona | Required synthetic acceptance proof | Current confidence |
|---|---|---|
| MPG operator | Log in with explicitly granted, authorized support access; navigate organization inspection → health → exceptions; record auditable bounded retry and denial on unauthorized tenant | Security/domain tests exist; cohesive owner UI and live browser journey **NOT ACCEPTED** |
| Business owner | Sign up/verify login → business/location → confirm Google link → activate trial via approved mechanism → API credential or Quick Complete → inspect requests, customers and usage | Major code present; synthetic chain tested; full browser interaction **NOT ACCEPTED** |
| Business staff | Operator logs in with appropriate tenant membership → access Customers / Quick Complete → record one legitimate completed service → permission unknown/denied does not dispatch → no cross-tenant access | Security code present; staff invite and realistic browser walkthrough **NOT ACCEPTED** |
| Business customer | See neutral email specimen in a safe test view → follow `/r/[token]` → verify trusted Google redirect, cancellation/expiry and unsubscribe → no real review or message sent | Route/transport tests exist; mobile UI/inbox experience **NOT ACCEPTED** |

For each acceptance item record: tested branch/SHA, fixture ID (not raw PII), user role, expected vs observed result, screenshot/video if actually captured, test/log reference and release impact. No real customer data or provider activation.

## 6. Near-term execution, not a roadmap reset

1. **This slice:** document the source-based operating-readiness matrix and correct the false-positive OR-001 navigation finding. No navigation or authorization code changes.
2. **Next internal readiness slice:** synthetic browser-based acceptance for login → onboarding → Quick Complete → customer link/unsubscribe, with screenshots and negative cases. Do not interpret synthetic test success as a customer pilot.
3. **Owner product decision:** choose how multi-tenant business membership and MPG's internal tenant-directory access should work (OR-002, OR-003), keeping distinct MPG staff grants.
4. **External dependency track:** qualified US/Canada legal review; sender-domain/provider evidence (MR-1B-H); billing-provider situation (MR-5). Do not run these as if approved engineering fixes.
5. **Roadmap-gated expansion:** Twilio/SMS only with approved channel scope and legal review; MR-9 site at the authorized stage; MR-8 pilot only after separate gate decision.

**Not ready to claim:** real-client onboarding validated, real email delivered, SMS operational, real published-review attribution, billing operational, full founder console, polished acquisition website, MR-7 legal compliance, MR-8 readiness or market launch.

## 7. Disposition / owner checkpoint

Audit status: **INVESTIGATING / SOURCE BASELINE DOCUMENTED**. OR-001 is CLOSED as a false positive after verifying the active AppShell navigation. All other gaps remain OPEN, GATED or UNVERIFIED as documented. This report is a source-level inventory, not visual acceptance, and does not change milestone states. Only the accepted Company OS and explicit Owner decisions govern activation and scope.
