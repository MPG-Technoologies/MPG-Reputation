# MR-5E2D3 — Provider-Ready, Credential-Free Invoice Evidence Port

| Control | Status |
|---|---|
| Scope | Synthetic-only connector contract and fail-closed invoice evidence inspection |
| Base | MR-5E2D2 verified HEAD `665c3a1f5688041596afe71219d21224c4b47cc6` |
| Owner directive | **No Stripe account/API keys or any live payment API yet. Build the full system for easy future connection only.** |
| Company OS | `03a48a34481f1952a31cd5c4fb980bc381432d8d`: MR-5 PAUSED/INCOMPLETE; bounded non-live engineering authorized by subsequent owner instruction |
| Product main | `6b7ac073432921789314315ec5fc624a81d8f699`, unchanged |
| State | IN PROGRESS until GitHub CI completes |

## Existing reusable infrastructure

The codebase already has configurable PROPOSED monthly/yearly PHP plans; frozen pricing/Stripe Price checks; server-only Stripe Checkout/Customer Portal boundaries; MR-5C signed webhook intake; MR-5E1 payment evidence prerequisites; MR-5E2 synthetic invoice correlation; MR-5E2B invoice-to-tenant resolution; MR-5E2C signed durable invoice reference; MR-5E2D1 private inbox preflight; and MR-5E2D2 fenced TEST event claims. **None collectively proves live payment settlement or authorizes entitlements.** Do not restart or duplicate this infrastructure.

## This bounded slice

- Add `src/domain/billing/provider-evidence-port.ts` as a **provider connector port**, currently typed for the existing Stripe-first architecture, with one read-only method `readInvoice`. A future separately approved provider integration implements this interface using actual provider credentials on the server; no change to the MPG invoice evaluation logic should be required for a compatible adapter.
- `inspectProviderInvoiceEvidence` returns `NOT_CONFIGURED` with no adapter — the correct state today. With a synthetic injected adapter it independently checks exact saved invoice/customer/subscription/Price/environment, configured PHP amount and interval, current invoice paid and payment succeeded indicators, nonexpired period, currency, freshness, and refund/dispute signals. Any unknown or inconsistent result fails closed.
- Positive `EVIDENCE_ONLY` is deliberately **not** a subscription activation, settled-funds guarantee, verified provider provenance, signed webhook success, paid entitlement, billing account grant, refund authorization or charge permission.
- The input `ExpectedInvoiceBinding` MUST later be built by authenticated server code from persisted tenant billing account and frozen plan/Price details, NEVER from browser input. An injected test adapter can imitate provider data; such synthetic evidence is not financial proof.
- LIVE mode is unconditionally blocked in this slice, even when a test connector is supplied. Missing connector, network failure, invoice absence, mismatches or unknown refunds/disputes never grant access.
- Narrow synthetic unit tests are included in the credential-free Internal CI allowlist. **No provider SDK call, credentials, database query/migration, job/worker, webhook status mutation, entitlement write, environment switch or production operation is introduced.**

## Future connection checklist (separate owner-gated slices)

1. Obtain a provider account and TEST-mode API credentials; register secrets only in server-side environment/secret management. None are needed now.
2. Implement the `BillingEvidenceReadPort` read-only adapter with independently authenticated provider Invoice/Payment/Subscription reads, exact amount/currency/interval/Price, provider environment and up-to-date refund/dispute state. If Stripe object API shapes have changed, validate the current provider SDK before adapting; never trust cached client payloads.
3. Derive expected tenant bindings from authenticated, private, RLS-preserving application lookups and source-verified signed inbox records. Wire these into the existing MR-5E2D2 fenced worker after separately reviewed state/lease/finality design.
4. Add durable event processing and audit: replay, delayed/out-of-order webhook, lease expiry, unknown payment finality, corrections/refunds and dispute handling. A successful provider inspection cannot itself mark an invoice PROCESSED.
5. Separately implement and verify MR-5E3 paid entitlement decisions and renewal/failure/cancellation policy. Preserve the **30 Free Review Requests** trial quota and suppression/unsubscribe controls.
6. Only with owner approval conduct hosted Stripe TEST acceptance (MR-5F); LIVE billing, real charges, production deployment, commercial launch and any final pricing remain gated.

**Compatibility policy:** PHP pricing remains an internal configurable proposal (currently ₱1,500 monthly and ₱1,000 yearly). The port demands exact Price and amount agreement; tax, coupon, discount, credit/zero-amount invoices and multi-line invoice cases are intentionally **blocked** until explicit commercial and accounting policy exists. To support a second provider later, expand the provider ID and implement the same contract through a reviewed adapter, not a parallel MPG subscription engine.

## Verification

Require `pnpm lint`, `pnpm typecheck`, credential-free unit tests and `pnpm build` from Internal CI, plus final scoped diff review. Do not mark ENGINEERING COMPLETE before they pass. Prior MR-5E2D2 disposable database suite was green; no new database code in this slice.
