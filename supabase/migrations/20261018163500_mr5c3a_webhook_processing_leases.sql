-- MR-5C3A: safe leasing and failure recovery for already verified Stripe webhook identities.
-- TEST ONLY. No provider call, subscription projection, paid entitlement or charging.
-- No raw Stripe body or customer PII stored. This is queue custody, not settlement.
ALTER TABLE public.billing_webhook_events
    ADD COLUMN processing_lease_token UUID,
    ADD COLUMN processing_lease_expires_at TIMESTAMPTZ,
    ADD COLUMN processing_attempts INTEGER NOT NULL DEFAULT 0
      CONSTRAINT billing_webhook_events_attempts_check CHECK (processing_attempts BETWEEN 0 AND 5);

CREATE INDEX billing_webhook_events_test_recovery_idx
    ON public.billing_webhook_events (processing_status, processing_lease_expires_at, received_at)
    WHERE provider = 'stripe' AND environment = 'TEST';

-- Atomically claim a particular durable verified-event row, or reclaim
-- a failed/expired one. The lease is a *fencing token*: a superseded worker
-- cannot finalize the row after another worker has reclaimed it.
CREATE FUNCTION public.lease_stripe_webhook_processing(p_event_id UUID)
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

-- Only the holder of a still-current lease may finalize the same event.
-- Allow fixed sanitized codes only: no raw provider errors or customer data.
CREATE FUNCTION public.complete_stripe_webhook_processing(
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

-- Postgres grants EXECUTE on functions to PUBLIC by default. No browser user,
-- tenant OWNER, anonymous caller or client-access token may invoke these.
REVOKE ALL ON FUNCTION public.lease_stripe_webhook_processing(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lease_stripe_webhook_processing(UUID)
    TO service_role;

REVOKE ALL ON FUNCTION public.complete_stripe_webhook_processing(
    UUID, UUID, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_stripe_webhook_processing(
    UUID, UUID, TEXT, UUID, TEXT
) TO service_role;
