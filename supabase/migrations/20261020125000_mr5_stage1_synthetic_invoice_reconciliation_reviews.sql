-- MR-5 Stage 1: append-only TEST invoice reconciliation review, NEVER settlement.
-- This stores a unique synthetic evidence correlation requiring future provider
-- attestation. It does not prove an actual Stripe invoice belongs to a checkout,
-- recognize revenue, mark a receipt PROCESSED, or grant paid entitlements.
-- Apply in disposable CI only; no hosted DB changes authorized.
CREATE TABLE public.billing_synthetic_invoice_reconciliation_reviews (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    billing_account_id UUID NOT NULL,
    checkout_quote_snapshot_id UUID NOT NULL
        REFERENCES public.billing_synthetic_checkout_quote_snapshots(id) ON DELETE CASCADE,
    invoice_evidence_draft_id UUID NOT NULL
        REFERENCES public.billing_synthetic_invoice_evidence_drafts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
    environment TEXT NOT NULL DEFAULT 'TEST' CHECK (environment = 'TEST'),
    provider_invoice_id TEXT NOT NULL CHECK (provider_invoice_id ~ '^in_[A-Za-z0-9]+$'),
    review_status TEXT NOT NULL DEFAULT 'REQUIRES_PROVIDER_ATTESTATION'
        CHECK (review_status = 'REQUIRES_PROVIDER_ATTESTATION'),
    financial_finality BOOLEAN NOT NULL DEFAULT false CHECK (financial_finality = false),
    access_authorized BOOLEAN NOT NULL DEFAULT false CHECK (access_authorized = false),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT mr5_review_invoice_unique UNIQUE (provider,environment,provider_invoice_id),
    CONSTRAINT mr5_review_draft_unique UNIQUE (invoice_evidence_draft_id),
    CONSTRAINT mr5_review_account_tenant_fk FOREIGN KEY
        (billing_account_id,organization_id,provider,environment)
        REFERENCES public.organization_billing_accounts
            (id,organization_id,provider,environment)
        ON DELETE CASCADE
);

-- The quote/draft source tables are append-only by grants (SELECT/INSERT),
-- so their reads intentionally do not request row locks that would require
-- granting UPDATE. Unique invoice indexes serialize concurrent review writes.
-- Protect even direct privileged INSERT, not only the RPC.
-- The event/quote/draft/checkout records are local synthetic sources and
-- remain intrinsically insufficient for provider-authenticated settlement.
CREATE FUNCTION public.validate_mr5_synthetic_invoice_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $mr5review$
DECLARE
    v_quote public.billing_synthetic_checkout_quote_snapshots%ROWTYPE;
    v_invoice public.billing_synthetic_invoice_evidence_drafts%ROWTYPE;
    v_reservation public.stripe_test_checkout_reservations%ROWTYPE;
    v_receipt public.billing_webhook_events%ROWTYPE;
    v_sub public.organization_subscriptions%ROWTYPE;
BEGIN
    SELECT * INTO v_quote FROM public.billing_synthetic_checkout_quote_snapshots
    WHERE id=NEW.checkout_quote_snapshot_id;
    SELECT * INTO v_invoice FROM public.billing_synthetic_invoice_evidence_drafts
    WHERE id=NEW.invoice_evidence_draft_id;

    IF v_quote.id IS NULL OR v_invoice.id IS NULL OR
       v_quote.organization_id IS DISTINCT FROM NEW.organization_id OR
       v_invoice.organization_id IS DISTINCT FROM NEW.organization_id OR
       v_quote.billing_account_id IS DISTINCT FROM NEW.billing_account_id OR
       v_invoice.billing_account_id IS DISTINCT FROM NEW.billing_account_id OR
       v_quote.provider IS DISTINCT FROM NEW.provider OR
       v_invoice.provider IS DISTINCT FROM NEW.provider OR
       v_quote.environment IS DISTINCT FROM NEW.environment OR
       v_invoice.environment IS DISTINCT FROM NEW.environment OR
       v_invoice.provider_invoice_id IS DISTINCT FROM NEW.provider_invoice_id OR
       v_quote.provider_price_id IS DISTINCT FROM v_invoice.candidate_price_id OR
       v_quote.candidate_currency IS DISTINCT FROM v_invoice.candidate_currency OR
       v_quote.candidate_amount_minor IS DISTINCT FROM v_invoice.candidate_amount_minor OR
       v_quote.candidate_interval IS DISTINCT FROM v_invoice.candidate_interval OR
       v_quote.source_kind <> 'SYNTHETIC' OR
       v_invoice.source_kind <> 'SYNTHETIC' OR
       v_quote.approval_status <> 'PROPOSED' OR
       v_quote.verification_status <> 'UNVERIFIED' OR
       v_invoice.verification_status <> 'UNVERIFIED' OR
       v_quote.payment_authorized IS DISTINCT FROM false OR
       v_quote.access_authorized IS DISTINCT FROM false OR
       v_invoice.financial_finality IS DISTINCT FROM false OR
       v_invoice.access_authorized IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'MR5_SYNTHETIC_REVIEW_SOURCE_MISMATCH' USING ERRCODE='23514';
    END IF;

    SELECT * INTO v_reservation FROM public.stripe_test_checkout_reservations
    WHERE id=v_quote.checkout_reservation_id FOR SHARE;
    SELECT * INTO v_receipt FROM public.billing_webhook_events
    WHERE id=v_invoice.webhook_event_record_id FOR SHARE;
    SELECT * INTO v_sub FROM public.organization_subscriptions
    WHERE id=v_invoice.subscription_record_id FOR SHARE;

    IF v_reservation.id IS NULL OR v_receipt.id IS NULL OR v_sub.id IS NULL OR
       v_reservation.status <> 'READY' OR
       v_reservation.stripe_session_id IS NULL OR
       v_reservation.organization_id IS DISTINCT FROM NEW.organization_id OR
       v_reservation.billing_account_id IS DISTINCT FROM NEW.billing_account_id OR
       v_reservation.provider IS DISTINCT FROM NEW.provider OR
       v_reservation.environment IS DISTINCT FROM NEW.environment OR
       v_reservation.provider_price_id IS DISTINCT FROM v_quote.provider_price_id OR
       v_reservation.plan_id IS DISTINCT FROM v_quote.plan_id OR
       (v_quote.plan_id='monthly' AND v_quote.candidate_interval<>'month') OR
       (v_quote.plan_id='annual' AND v_quote.candidate_interval<>'year') OR
       v_receipt.provider IS DISTINCT FROM NEW.provider OR
       v_receipt.environment IS DISTINCT FROM NEW.environment OR
       v_receipt.event_type <> 'invoice.paid' OR
       v_receipt.provider_invoice_id IS DISTINCT FROM NEW.provider_invoice_id OR
       v_receipt.provider_event_id IS DISTINCT FROM v_invoice.provider_event_id OR
       v_receipt.payload_hash IS DISTINCT FROM v_invoice.source_payload_hash OR
       v_receipt.processing_status NOT IN ('RECEIVED','PROCESSING') OR
       v_receipt.processed_at IS NOT NULL OR
       (v_receipt.organization_id IS NOT NULL AND
        v_receipt.organization_id IS DISTINCT FROM NEW.organization_id) OR
       v_sub.organization_id IS DISTINCT FROM NEW.organization_id OR
       v_sub.billing_account_id IS DISTINCT FROM NEW.billing_account_id OR
       v_sub.provider IS DISTINCT FROM NEW.provider OR
       v_sub.environment IS DISTINCT FROM NEW.environment OR
       v_sub.provider_price_id IS DISTINCT FROM v_quote.provider_price_id THEN
        RAISE EXCEPTION 'MR5_SYNTHETIC_REVIEW_CORRELATION_FAILED' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$mr5review$;

REVOKE ALL ON FUNCTION public.validate_mr5_synthetic_invoice_review()
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_mr5_synthetic_invoice_review()
    TO service_role;
CREATE TRIGGER validate_mr5_synthetic_invoice_review_insert
BEFORE INSERT ON public.billing_synthetic_invoice_reconciliation_reviews
FOR EACH ROW EXECUTE FUNCTION public.validate_mr5_synthetic_invoice_review();

-- One transaction / one unique invoice. Concurrent writers are serialized by
-- the unique index; a conflicting quote/draft replay cannot overwrite history.
CREATE FUNCTION public.record_mr5_synthetic_invoice_review(
    p_quote_id UUID, p_draft_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $mr5reviewrecord$
DECLARE
    v_draft public.billing_synthetic_invoice_evidence_drafts%ROWTYPE;
    v_existing public.billing_synthetic_invoice_reconciliation_reviews%ROWTYPE;
    v_inserted UUID;
BEGIN
    IF p_quote_id IS NULL OR p_draft_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
    END IF;
    SELECT * INTO v_draft FROM public.billing_synthetic_invoice_evidence_drafts
    WHERE id=p_draft_id;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('outcome','SOURCE_NOT_FOUND');
    END IF;

    -- Trigger validates all source identities in this same transaction.
    INSERT INTO public.billing_synthetic_invoice_reconciliation_reviews (
        organization_id,billing_account_id,checkout_quote_snapshot_id,
        invoice_evidence_draft_id,provider,environment,provider_invoice_id
    ) VALUES (
        v_draft.organization_id,v_draft.billing_account_id,p_quote_id,
        p_draft_id,v_draft.provider,v_draft.environment,v_draft.provider_invoice_id
    )
    ON CONFLICT DO NOTHING RETURNING id INTO v_inserted;

    IF v_inserted IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome','REQUIRES_PROVIDER_ATTESTATION',
            'financial_finality',false,'access_authorized',false
        );
    END IF;

    SELECT * INTO v_existing
    FROM public.billing_synthetic_invoice_reconciliation_reviews
    WHERE provider=v_draft.provider AND environment=v_draft.environment
      AND provider_invoice_id=v_draft.provider_invoice_id;
    IF FOUND AND v_existing.checkout_quote_snapshot_id=p_quote_id
       AND v_existing.invoice_evidence_draft_id=p_draft_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome','ALREADY_RECORDED',
            'financial_finality',false,'access_authorized',false
        );
    END IF;
    RETURN pg_catalog.jsonb_build_object('outcome','REPLAY_CONFLICT');
END;
$mr5reviewrecord$;

REVOKE ALL ON FUNCTION public.record_mr5_synthetic_invoice_review(UUID,UUID)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_mr5_synthetic_invoice_review(UUID,UUID)
    TO service_role;

CREATE INDEX mr5_synthetic_review_org_recorded_idx
ON public.billing_synthetic_invoice_reconciliation_reviews
    (organization_id,recorded_at DESC);
ALTER TABLE public.billing_synthetic_invoice_reconciliation_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_synthetic_invoice_reconciliation_reviews
    FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON TABLE public.billing_synthetic_invoice_reconciliation_reviews
    TO service_role;

COMMENT ON TABLE public.billing_synthetic_invoice_reconciliation_reviews IS
    'TEST-only append-only synthetic invoice reconciliation review. Never financial finality or paid entitlement.';
COMMENT ON FUNCTION public.record_mr5_synthetic_invoice_review(UUID,UUID) IS
    'Service-only atomic/idempotent synthetic review admission, not a settled-invoice finalizer.';
