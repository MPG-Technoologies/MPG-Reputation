-- MR-5E2C — Retain minimal invoice reference from a signature-verified Stripe
-- event at durable intake. Historical rows stay NULL and unverified.
-- No raw event body, invoice paid flag, entitlement, new table, policy or grant.
ALTER TABLE public.billing_webhook_events
    ADD COLUMN provider_invoice_id TEXT;

ALTER TABLE public.billing_webhook_events
    ADD CONSTRAINT billing_webhook_events_invoice_reference_check
    CHECK (
        provider_invoice_id IS NULL OR (
            event_type IN ('invoice.paid', 'invoice.payment_failed')
            AND provider_invoice_id ~ '^in_[A-Za-z0-9]+$'
        )
    );

COMMENT ON COLUMN public.billing_webhook_events.provider_invoice_id IS
    'Invoice ID from signed Stripe invoice webhook intake only; not settlement or entitlement evidence. Legacy NULL is unverified.';
