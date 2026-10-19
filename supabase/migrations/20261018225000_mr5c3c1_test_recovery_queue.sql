-- MR-5C3C1: TEST-only webhook retry scheduling and operational queue inventory.
-- Extends the previous verified MR-5C3A SQL functions WITHOUT widening grants.
-- No cron, HTTP route, hosted DB operation, Stripe credentials, or entitlements.
ALTER TABLE public.billing_webhook_events
  ADD COLUMN next_processing_attempt_at TIMESTAMPTZ;

CREATE INDEX billing_webhook_test_retry_due_idx
  ON public.billing_webhook_events(next_processing_attempt_at, received_at)
  WHERE provider = 'stripe' AND environment = 'TEST'
    AND event_type NOT LIKE 'invoice.%'
    AND processing_status IN ('RECEIVED','FAILED','PROCESSING');

-- Invoice events have a separate MR-5E fenced evidence path.
-- Reserve ALL invoice.* events for that path at recovery inventory, claim
-- and completion boundaries; never treat payment events as ignorable noise.
-- All attempts, including direct privileged calls, must respect cooldown,
-- provider Event retrieval age, and the prior five-attempt maximum.
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
           error_code = NULL,
           next_processing_attempt_at = NULL
     WHERE events.id = p_event_id
       AND events.provider = 'stripe'
       AND events.environment = 'TEST'
       AND events.event_type NOT LIKE 'invoice.%'
       AND events.processing_attempts < 5
       -- Provider Event recovery is only guaranteed for 30 days. Stop
       -- automatic attempts before that boundary; manual inventory required.
       AND COALESCE(events.provider_created_at, events.received_at) >
           pg_catalog.clock_timestamp() - INTERVAL '29 days'
       AND (
            events.processing_status = 'RECEIVED'
            OR (events.processing_status = 'FAILED'
                AND (events.next_processing_attempt_at IS NULL OR
                     events.next_processing_attempt_at <= pg_catalog.clock_timestamp()))
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
           -- Fixed, exponential-ish TEST retry policy, enforced at claim.
           -- 1st failure: 30s; 2nd: 2m; 3rd: 5m; 4th: 15m.
           -- The 5th failure is exhausted and never automatically retried.
           next_processing_attempt_at = CASE
               WHEN p_status = 'FAILED' AND events.processing_attempts < 5
               THEN pg_catalog.clock_timestamp() + CASE events.processing_attempts
                   WHEN 1 THEN INTERVAL '30 seconds'
                   WHEN 2 THEN INTERVAL '2 minutes'
                   WHEN 3 THEN INTERVAL '5 minutes'
                   ELSE INTERVAL '15 minutes'
               END
               ELSE NULL
           END,
           processing_lease_token = NULL,
           processing_lease_expires_at = NULL
     WHERE events.id = p_event_id
       AND events.provider = 'stripe'
       AND events.environment = 'TEST'
       AND events.event_type NOT LIKE 'invoice.%'
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


-- A privileged read-only queue inventory; the event leasing RPC still makes
-- actual processing exclusive. Two dispatchers may receive the same candidate
-- ID but only ONE worker can claim it.
CREATE FUNCTION public.inspect_stripe_test_webhook_recovery(p_limit INTEGER DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_ready JSONB;
    v_summary JSONB;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10 THEN
        RETURN pg_catalog.jsonb_build_object('outcome','INVALID_LIMIT');
    END IF;

    SELECT COALESCE(pg_catalog.jsonb_agg(q.id), '[]'::jsonb)
      INTO v_ready
      FROM (
          SELECT events.id
            FROM public.billing_webhook_events AS events
           WHERE events.provider = 'stripe'
             AND events.environment = 'TEST'
             AND events.event_type NOT LIKE 'invoice.%'
             AND events.processing_attempts < 5
      AND COALESCE(events.provider_created_at, events.received_at) >
          v_now - INTERVAL '29 days'
      AND (
        events.processing_status = 'RECEIVED'
        OR (events.processing_status = 'FAILED'
          AND (events.next_processing_attempt_at IS NULL OR
               events.next_processing_attempt_at <= v_now))
        OR (events.processing_status = 'PROCESSING'
          AND (events.processing_lease_expires_at IS NULL OR
               events.processing_lease_expires_at <= v_now))
      )
           ORDER BY events.received_at, events.id
           LIMIT p_limit
      ) AS q;

    SELECT pg_catalog.jsonb_build_object(
      'ready', COUNT(*) FILTER (
          WHERE events.processing_attempts < 5
      AND COALESCE(events.provider_created_at, events.received_at) >
          v_now - INTERVAL '29 days'
      AND (
        events.processing_status = 'RECEIVED'
        OR (events.processing_status = 'FAILED'
          AND (events.next_processing_attempt_at IS NULL OR
               events.next_processing_attempt_at <= v_now))
        OR (events.processing_status = 'PROCESSING'
          AND (events.processing_lease_expires_at IS NULL OR
               events.processing_lease_expires_at <= v_now))
      )
      ),
      'cooldown', COUNT(*) FILTER (
          WHERE events.processing_status = 'FAILED'
            AND events.processing_attempts < 5
            AND events.next_processing_attempt_at > v_now
            AND COALESCE(events.provider_created_at,events.received_at) >
                v_now - INTERVAL '29 days'
      ),
      'in_flight', COUNT(*) FILTER (
          WHERE events.processing_status = 'PROCESSING'
            AND events.processing_lease_expires_at > v_now
      ),
      'exhausted', COUNT(*) FILTER (
          WHERE events.processing_attempts >= 5
            AND events.processing_status IN ('FAILED','PROCESSING','RECEIVED')
      ),
      'aged_out', COUNT(*) FILTER (
          WHERE events.processing_status IN ('RECEIVED','FAILED','PROCESSING')
            AND COALESCE(events.provider_created_at,events.received_at) <=
                v_now - INTERVAL '29 days'
      )
    )
      INTO v_summary
      FROM public.billing_webhook_events AS events
     WHERE events.provider = 'stripe'
       AND events.environment = 'TEST'
       AND events.event_type NOT LIKE 'invoice.%';

    RETURN pg_catalog.jsonb_build_object(
      'outcome','READY',
      'event_ids',v_ready,
      'summary',v_summary
    );
END;
$$;

-- Replacement functions retain explicit service_role-only EXECUTE.
REVOKE ALL ON FUNCTION public.lease_stripe_webhook_processing(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lease_stripe_webhook_processing(UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.complete_stripe_webhook_processing(UUID,UUID,TEXT,UUID,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_stripe_webhook_processing(UUID,UUID,TEXT,UUID,TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.inspect_stripe_test_webhook_recovery(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_stripe_test_webhook_recovery(INTEGER)
  TO service_role;
