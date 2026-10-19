-- MR-5E2D2: fenced processing claim ONLY for TEST Stripe invoice events.
-- Does not query Stripe, settle invoices, accept evidence, grant entitlements,
-- replay FAILED events, or permit any billing status to become PROCESSED.
-- Existing webhook inbox remains private with its original RLS and privileges.
ALTER TABLE public.billing_webhook_events
  ADD COLUMN processing_lease_token UUID,
  ADD COLUMN processing_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN processing_attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.billing_webhook_events
  ADD CONSTRAINT billing_webhook_invoice_processing_attempts_check
    CHECK (processing_attempt_count BETWEEN 0 AND 3),
  ADD CONSTRAINT billing_webhook_invoice_processing_lease_pair_check
    CHECK (
      (processing_lease_token IS NULL AND processing_lease_expires_at IS NULL)
      OR
      (processing_lease_token IS NOT NULL AND
       processing_lease_expires_at IS NOT NULL AND
       processing_status = 'PROCESSING')
    );

-- Service-only SECURITY INVOKER. Each claim locks the exact inbox row and
-- advances a fencing token. An expired worker's token cannot finish it.
CREATE FUNCTION public.claim_stripe_test_invoice_processing(
  p_provider_event_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_event public.billing_webhook_events%ROWTYPE;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_token UUID;
BEGIN
  IF p_provider_event_id IS NULL
     OR p_provider_event_id !~ '^evt_[A-Za-z0-9]+$' THEN
    RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
  END IF;

  SELECT * INTO v_event
  FROM public.billing_webhook_events
  WHERE provider = 'stripe'
    AND environment = 'TEST'
    AND provider_event_id = p_provider_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_FOUND');
  END IF;

  IF v_event.event_type NOT IN ('invoice.paid','invoice.payment_failed')
     OR v_event.provider_invoice_id IS NULL
     OR v_event.provider_invoice_id !~ '^in_[A-Za-z0-9]+$'
     OR v_event.payload_hash !~ '^[0-9a-f]{64}$'
     OR v_event.processed_at IS NOT NULL
     OR v_event.organization_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_ELIGIBLE');
  END IF;

  IF v_event.processing_status = 'FAILED' THEN
    -- Explicit failures need a separate, owner-reviewed recovery action.
    RETURN pg_catalog.jsonb_build_object('outcome','MANUAL_REVIEW');
  END IF;

  IF v_event.processing_status = 'PROCESSING' THEN
    -- Fail closed for legacy/foreign in-flight rows with unknown lease.
    IF v_event.processing_lease_token IS NULL
       OR v_event.processing_lease_expires_at IS NULL
       OR v_event.processing_lease_expires_at > v_now THEN
      RETURN pg_catalog.jsonb_build_object('outcome','IN_FLIGHT');
    END IF;
  ELSIF v_event.processing_status <> 'RECEIVED' THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_ELIGIBLE');
  END IF;

  IF v_event.processing_attempt_count >= 3 THEN
    RETURN pg_catalog.jsonb_build_object('outcome','MANUAL_REVIEW');
  END IF;

  v_token := pg_catalog.gen_random_uuid();

  UPDATE public.billing_webhook_events
  SET processing_status = 'PROCESSING',
      processing_lease_token = v_token,
      processing_lease_expires_at = v_now + INTERVAL '2 minutes',
      processing_attempt_count = v_event.processing_attempt_count + 1
  WHERE id = v_event.id;

  -- Token is internal to the trusted worker, never an API/browser response.
  RETURN pg_catalog.jsonb_build_object(
    'outcome','CLAIMED',
    'lease_token',v_token,
    'attempts',v_event.processing_attempt_count + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_test_invoice_processing(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_test_invoice_processing(TEXT)
  TO service_role;

-- The ONLY terminal action in this slice is a fenced FAILED transition.
-- There is intentionally no PROCESSED/PAID path or automatic FAILED retry.
CREATE FUNCTION public.fail_stripe_test_invoice_processing(
  p_provider_event_id TEXT,
  p_lease_token UUID,
  p_error_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_affected UUID;
BEGIN
  IF p_provider_event_id IS NULL
     OR p_provider_event_id !~ '^evt_[A-Za-z0-9]+$'
     OR p_lease_token IS NULL
     OR p_error_code IS NULL
     OR p_error_code NOT IN (
       'PROVIDER_UNAVAILABLE','PROVIDER_MISMATCH',
       'TENANT_UNRESOLVED','EVIDENCE_CONFLICT','WORKER_ERROR'
     ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
  END IF;

  UPDATE public.billing_webhook_events
  SET processing_status = 'FAILED',
      error_code = p_error_code,
      processing_lease_token = NULL,
      processing_lease_expires_at = NULL,
      processed_at = NULL
  WHERE provider = 'stripe'
    AND environment = 'TEST'
    AND provider_event_id = p_provider_event_id
    AND event_type IN ('invoice.paid','invoice.payment_failed')
    AND processing_status = 'PROCESSING'
    AND processing_lease_token = p_lease_token
    AND processing_lease_expires_at > v_now
    AND processed_at IS NULL
  RETURNING id INTO v_affected;

  IF v_affected IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome','STALE_OR_NOT_CLAIMED');
  END IF;
  RETURN pg_catalog.jsonb_build_object('outcome','FAILED_REQUIRES_REVIEW');
END;
$$;

REVOKE ALL ON FUNCTION public.fail_stripe_test_invoice_processing(TEXT,UUID,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_stripe_test_invoice_processing(TEXT,UUID,TEXT)
  TO service_role;
