-- MR-5 Stage 1: preserve idempotent reads of an already admitted synthetic
-- invoice review after its source webhook moves from PROCESSING to FAILED.
-- An existing immutable review is NOT provider payment evidence or paid access.
-- New admissions still require all checks in the existing INSERT trigger.
-- Disposable synthetic CI only. Never deploy to hosted or production here.
CREATE OR REPLACE FUNCTION public.record_mr5_synthetic_invoice_review(
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

    SELECT * INTO v_draft
    FROM public.billing_synthetic_invoice_evidence_drafts
    WHERE id=p_draft_id;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('outcome','SOURCE_NOT_FOUND');
    END IF;

    -- A committed, immutable review remains readable after the receipt
    -- enters FAILED/REVIEW. Do not run a fresh INSERT through an admission
    -- trigger that correctly refuses NEW evidence from a failed receipt.
    SELECT * INTO v_existing
    FROM public.billing_synthetic_invoice_reconciliation_reviews
    WHERE provider=v_draft.provider AND environment=v_draft.environment
      AND provider_invoice_id=v_draft.provider_invoice_id;
    IF FOUND THEN
        IF v_existing.checkout_quote_snapshot_id=p_quote_id AND
           v_existing.invoice_evidence_draft_id=p_draft_id THEN
            RETURN pg_catalog.jsonb_build_object(
                'outcome','ALREADY_RECORDED',
                'financial_finality',false,'access_authorized',false
            );
        END IF;
        RETURN pg_catalog.jsonb_build_object('outcome','REPLAY_CONFLICT');
    END IF;

    -- For a first admission, the original BEFORE INSERT trigger rechecks
    -- tenant, Price, checkout, event/hash and non-authorizing state.
    -- ON CONFLICT plus the post-conflict read handle concurrent writers.
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

-- Preserve service-only invocation; the replacement never broadens privileges.
REVOKE ALL ON FUNCTION public.record_mr5_synthetic_invoice_review(UUID,UUID)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_mr5_synthetic_invoice_review(UUID,UUID)
    TO service_role;

COMMENT ON FUNCTION public.record_mr5_synthetic_invoice_review(UUID,UUID) IS
    'Service-only idempotent synthetic review read/admission. Failed webhook replay remains non-authorizing. Never settlement.';
