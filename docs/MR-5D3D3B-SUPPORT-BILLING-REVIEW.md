# MPG Reputation — MR-5D3D3B Scoped Support Billing Recovery Inspection

| Control | State |
|---|---|
| Slice | MR-5D3D3B — read-only internal TEST billing recovery case inspection |
| Base | MR-5D3D3A [PR #35](https://github.com/MPG-Technoologies/MPG-Reputation/pull/35) at `09f03136ac840d23e8177c875921cc642a710fd8` |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699` |
| Company OS main | `03a48a34481f1952a31cd5c4fb980bc381432d8d` |
| Governance | MR-5 PAUSED/INCOMPLETE in Company OS; bounded non-live engineering continued at owner's request |
| External Stripe TEST/hosted acceptance | DEFERRED until owner-approved deployed testing |
| Live billing / production action | NOT AUTHORIZED |
| Verification | PENDING CI on initial draft |

## Existing authority reused — not invented

MR-6A introduced `support_access_grants`, authorizing **MPG_ADMIN for a single organization only when the actor remains a current tenant member and has an unrevoked, unexpired, exact-org grant**. The server helper `authorizeSupportAccess(organizationId)` verifies both the authenticated Supabase user and the tenant-scoped grant. Merely being OWNER or ADMIN of a customer business does **not** confer MPG support rights. This slice reuses the accepted MR-6 authorization rather than introducing global billing-operator privileges.

MR-6 already records support inspection audits into `audit_events`. This slice reuses the same fixed, server-authored audit mechanism.

## Code changes

- `src/lib/support/billing-recovery.ts` is a server-only read model, default-disabled unless `ENABLE_STRIPE_TEST_RECOVERY_SUPPORT_VIEW=true`, `MPG_STRIPE_TEST_RECOVERY_SUPPORT_TARGET=LOCAL_SYNTHETIC`, exact local disposable Supabase URL, nonproduction process, no Vercel environment and live billing disabled. It calls `authorizeSupportAccess` before any privileged read. It queries only `stripe_test_billing_recovery_reviews` for that exact organization and only `OPEN` rows. Max 20 with a truncation indicator. It returns only case UUID, kind, DB-derived reason, OPEN status and timestamp; **no** business actor IDs, Stripe IDs, Customer data, raw provider errors, amounts, URLs, credentials or full row objects.
- `src/lib/support/audit.ts` adds event `support.billing_recovery_inspection` with an exact allowed outcome of AVAILABLE/UNAVAILABLE. Existing fixed audit infrastructure writes the actual MPG support actor UUID, organization UUID and minimal outcome via `audit_events`.
- Before returning an AVAILABLE snapshot, support authorization is rechecked with fresh JWT/grant reads after the private read; an actor or grant change causes DENIED. An audit write failure causes UNAVAILABLE, never returning private case data.
- `/admin/organizations/[organizationId]/billing-recovery` is a read-only server-rendered internal support page using existing `AdminWorkspace` and `OrganizationHeader` patterns. It suppresses reads/audits for Next.js speculative prefetch requests and displays only minimal cases and explicit "investigation only, never paid access" messaging. There are no mutation buttons or Stripe Customer/Checkout Session links.
- The existing admin organization navigation shows the Billing recovery tab only when the same local synthetic feature gate is true, and the route independently gates access.
- Synthetic domain tests and disposable PostgreSQL integration tests require denial of business OWNER without MPG_ADMIN grant, anonymous/foreign/revoked grants, private-table RLS, zero Stripe data leakage and the mandatory audit behavior.

## Critical boundary and next slice

This is **read-only support inspection** and does not approve a case, append a case *decision*, release a reservation or assign any new role. An existing MR-6 `MPG_ADMIN` grant is not a commercial or financial authorization. It is limited to inspecting one explicitly granted organization, not a global billing operator. Before any recovery resolution, the owner must approve an action policy (which actor, required provider evidence, idempotency and fencing, audit protocol, stale-evidence validity, rollback and conflict handling).

**MR-5D3D3C (gated):** define action-specific and financially safe case-decision/closure policy. No mutation without owner security review. **MR-5E:** payment and invoice evidence + paid-entitlement policy, preserving **30 Free Review Requests**, usage and suppression. **MR-5F:** hosted Stripe TEST acceptance and actual billing after separate owner authorization.

No secret, real provider call, deployed hosted migration, real Customer data, billing entitlement, Stripe write, RLS relaxation, production release, pilot, Company Stage change or main merge.

## Verification required

Run actual CI for lint, typecheck, synthetic tests, production build, disposable PostgreSQL support-grant and mandatory-audit tests (including intentionally failing audit and revoked-grant denial) and final scoped diff. Record verified HEAD evidence in PR.
