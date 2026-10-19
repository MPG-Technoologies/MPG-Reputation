# MR-5E2 — Synthetic Durable Invoice Correlation Contract

Status: IN PROGRESS — CI pending. Stacked on MR-5E1, not merged to main. Company OS still records MR-5 PAUSED/INCOMPLETE, with bounded engineering directed by owner.

This slice adds one pure domain function and tests to correlate a fresh MR-5E1 payment-evidence snapshot with a matching, processed, signature-verified invoice.paid event. Identical replayed event IDs are deduplicated, contradictory duplicate IDs fail closed; processed payment-failed events, stale evidence, cross-tenant or mismatched invoice/subscription and unsigned events fail closed.

**Critical trust limitation:** `signatureVerified: true` is only a field in a synthetic input contract. It does NOT prove authenticity. No untrusted caller may set this flag and treat correlation as payment authority. Future code must obtain authenticated Stripe event data from the existing signature-verified ingress, verify durable inbox processing against private database evidence and independently fetch live provider invoice/payment/subscription truth. Event order and post-payment refunds/disputes remain unresolved. No provider SDK calls, API route, schema change, billing access grant or webhook handler is introduced.

The only positive outcome is `CORRELATED_EVIDENCE_ONLY`, not paid entitlement or proof of financial settlement. MR-5E3 cannot use this value alone to grant product access. Existing 30 Free Review Requests, suppression, trial/usage boundaries and all RLS policies remain untouched.

Next: verify CI, inspect signed webhook inbox/resolver schemas, then implement a narrowly authorized server-side durable evidence assembler with replay/order safeguards. Separate MR-5C hosted acceptance and MR-5F Stripe TEST acceptance remain deferred. No live billing, production, main merge or financial mutation.
