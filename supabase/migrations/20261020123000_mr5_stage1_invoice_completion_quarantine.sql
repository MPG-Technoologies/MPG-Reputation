-- MR-5 Stage 1: TEST invoice financial-finality quarantine.
--
-- The pre-existing general webhook lease/completion functions could set
-- invoice.paid (or invoice.payment_failed) to PROCESSED without independent
-- provider settlement evidence. That status is NOT proof of funds, but is an
-- unsafe success marker for downstream proposal consumers.
--
-- Repair the existing functions in-place WITHOUT changing generic
-- subscription-event behavior, their grants, RLS or historical fixtures.
-- Invoice processing remains exclusively available through the pre-existing
-- service-only invoice CLAIM + FAIL RPCs; NO invoice success path is added.
--
-- Repository migration only: candidate PR, disposable Supabase tests.
-- Do not apply to hosted or production without separate owner authorization.
CREATE OR REPLACE FUNCTION public.lease_stripe_webhook_processing(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_row public.billing_webhook_events%ROWTYPE;
BEGIN
    IF p_event_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NO_WORK');
    END IF;

    UPDATE public.billing_webhook_events AS events
       SET processing_status = 'PROCESSING',
           processing_lease_token = pg_catalog.gen_random_uuid(),
           processing_lease_expires_at = pg_catalog.now() + INTERVAL '180 seconds',
           processing_attempts = processing_attempts + 1,
           processed_at = NULL,
           error_code = NULL
     WHERE events.id = p_event_id
       AND events.provider = 'stripe'
       AND events.environment = 'TEST'
       AND events.event_type NOT IN ('invoice.paid', 'invoice.payment_failed')
       AND events.processing_attempts < 5
       AND (
            events.processing_status IN ('RECEIVED', 'FAILED')
            OR (events.processing_status = 'PROCESSING'
                AND (events.processing_lease_expires_at IS NULL
                     OR events.processing_lease_expires_at <= pg_catalog.now()))
       )
    RETURNING events.* INTO v_row;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NO_WORK');
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'outcome','LEASED',
        'event_id',v_row.id,
        'lease_token',v_row.processing_lease_token,
        'provider_event_id',v_row.provider_event_id,
        'event_type',v_row.event_type,
        'environment',v_row.environment,
        'attempt',v_row.processing_attempts
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_stripe_webhook_processing(
    p_event_id UUID,
    p_lease_token UUID,
    p_status TEXT,
    p_organization_id UUID DEFAULT NULL,
    p_error_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_event_id IS NULL OR p_lease_token IS NULL OR
       p_status IS NULL OR p_status NOT IN ('PROCESSED', 'IGNORED', 'FAILED') THEN
        RETURN pg_catalog.jsonb_build_object('outcome','INVALID_RESULT');
    END IF;

    IF (p_status = 'FAILED' AND (
            p_organization_id IS NOT NULL OR
            p_error_code IS NULL OR
            p_error_code NOT IN (
                'PROVIDER_UNAVAILABLE',
                'UNRESOLVED_CUSTOMER',
                'INVALID_PROVIDER_DATA',
                'CORRELATION_FAILED',
                'PROCESSING_FAILED'
            ))) OR
       (p_status IN ('PROCESSED', 'IGNORED') AND p_error_code IS NOT NULL) OR
       (p_status = 'PROCESSED' AND p_organization_id IS NULL) OR
       (p_status = 'IGNORED' AND p_organization_id IS NOT NULL) THEN
        RETURN pg_catalog.jsonb_build_object('outcome','INVALID_RESULT');
    END IF;

    UPDATE public.billing_webhook_events AS events
       SET processing_status = p_status,
           organization_id = CASE WHEN p_status = 'PROCESSED' THEN p_organization_id ELSE NULL END,
           processed_at = CASE WHEN p_status IN ('PROCESSED', 'IGNORED')
                               THEN pg_catalog.now() ELSE NULL END,
           error_code = CASE WHEN p_status = 'FAILED' THEN p_error_code ELSE NULL END,
           processing_lease_token = NULL,
           processing_lease_expires_at = NULL
     WHERE events.id = p_event_id
       AND events.provider = 'stripe'
       AND events.environment = 'TEST'
       AND events.event_type NOT IN ('invoice.paid', 'invoice.payment_failed')
       AND events.processing_status = 'PROCESSING'
       AND events.processing_lease_token = p_lease_token
       AND events.processing_lease_expires_at > pg_catalog.now()
    RETURNING events.id INTO v_id;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NOT_LEASE_HOLDER');
    END IF;

    RETURN pg_catalog.jsonb_build_object('outcome','FINALIZED','status',p_status);
END;
$$;

-- Defense in depth: block any newly finalized TEST invoice via generic,
-- manually issued, or future accidental service-role UPDATE. This trigger
-- protects state TRANSITIONS rather than retroactively reclassifying old
-- seed fixtures (some accepted proposal tests seed historical PROCESSED
-- events). New INSERT paths need their own future provider-authentication
-- admission policy; this is not a settlement or financial-ledger invariant.
CREATE FUNCTION public.guard_mr5_test_invoice_terminal_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $mr5stage1$
BEGIN
  IF NEW.provider = 'stripe'
     AND NEW.environment = 'TEST'
     AND NEW.event_type IN ('invoice.paid', 'invoice.payment_failed')
     AND NEW.processing_status IN ('PROCESSED','IGNORED')
     AND (
       NEW.processing_status IS DISTINCT FROM OLD.processing_status OR
       NEW.event_type IS DISTINCT FROM OLD.event_type OR
       NEW.provider IS DISTINCT FROM OLD.provider OR
       NEW.environment IS DISTINCT FROM OLD.environment
     ) THEN
    RAISE EXCEPTION 'MR5_STAGE1_INVOICE_SUCCESS_NOT_AUTHORIZED'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$mr5stage1$;

REVOKE ALL ON FUNCTION public.guard_mr5_test_invoice_terminal_transition()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_mr5_test_invoice_terminal_transition()
  TO service_role;

CREATE TRIGGER guard_mr5_test_invoice_terminal_transition_update
  BEFORE UPDATE ON public.billing_webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_mr5_test_invoice_terminal_transition();

COMMENT ON FUNCTION public.guard_mr5_test_invoice_terminal_transition() IS
  'Stage 1 nonauthorizing TEST invoice quarantine: no invoice PROCESSED or IGNORED transition before an approved provider-attested atomic finalizer.';
