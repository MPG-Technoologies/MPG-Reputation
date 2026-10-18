-- MR-5C3B2: TEST-only subscription-level serialized provider-truth reconciliation.
--
-- No live billing, no checkout, paid entitlement, invoice settlement, or webhook
-- route wiring. An approved server worker must acquire this lock BEFORE fetching
-- the current Stripe Subscription, then commit with both current fencing tokens.
-- Event lease (MR-5C3A) and subscription lease both must be current at commit.
CREATE TABLE public.stripe_subscription_reconciliation_leases (
    provider_subscription_id TEXT PRIMARY KEY
        CHECK (provider_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
    event_id UUID NOT NULL REFERENCES public.billing_webhook_events(id) ON DELETE CASCADE,
    event_lease_token UUID NOT NULL,
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_subscription_reconciliation_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_subscription_reconciliation_leases FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_subscription_reconciliation_leases TO service_role;

-- Acquisition checks the event row under a transaction lock, then attempts
-- to claim the subscription's durable mutex by unique key. This spans requests
-- without holding an open Postgres transaction across a Stripe API call.
CREATE FUNCTION public.lease_stripe_subscription_reconciliation(
    p_event_id UUID,
    p_event_lease_token UUID,
    p_subscription_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_event public.billing_webhook_events%ROWTYPE;
    v_lease public.stripe_subscription_reconciliation_leases%ROWTYPE;
BEGIN
    IF p_event_id IS NULL OR p_event_lease_token IS NULL OR
       p_subscription_id IS NULL OR
       p_subscription_id !~ '^sub_[A-Za-z0-9]+$' THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'INVALID_INPUT');
    END IF;

    SELECT * INTO v_event
      FROM public.billing_webhook_events
     WHERE id = p_event_id
     FOR UPDATE;

    IF NOT FOUND OR
       v_event.provider IS DISTINCT FROM 'stripe' OR
       v_event.environment IS DISTINCT FROM 'TEST' OR
       v_event.event_type NOT IN (
           'customer.subscription.created',
           'customer.subscription.updated',
           'customer.subscription.deleted'
       ) OR
       v_event.processing_status IS DISTINCT FROM 'PROCESSING' OR
       v_event.processing_lease_token IS DISTINCT FROM p_event_lease_token OR
       v_event.processing_lease_expires_at <= pg_catalog.clock_timestamp() THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_LEASE_HOLDER');
    END IF;

    INSERT INTO public.stripe_subscription_reconciliation_leases AS lease (
        provider_subscription_id, event_id, event_lease_token,
        lease_token, lease_expires_at
    )
    VALUES (
        p_subscription_id, p_event_id, p_event_lease_token,
        pg_catalog.gen_random_uuid(),
        LEAST(
            pg_catalog.clock_timestamp() + INTERVAL '120 seconds',
            v_event.processing_lease_expires_at
        )
    )
    ON CONFLICT (provider_subscription_id) DO UPDATE
        SET event_id = EXCLUDED.event_id,
            event_lease_token = EXCLUDED.event_lease_token,
            lease_token = EXCLUDED.lease_token,
            lease_expires_at = EXCLUDED.lease_expires_at,
            updated_at = pg_catalog.clock_timestamp()
        WHERE lease.lease_expires_at <= pg_catalog.clock_timestamp()
    RETURNING * INTO v_lease;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'BUSY');
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'LEASED',
        'subscription_id', v_lease.provider_subscription_id,
        'lease_token', v_lease.lease_token,
        'expires_at', v_lease.lease_expires_at
    );
END;
$$;

-- Cleanly release a owned subscription slot on failed provider reads.
-- Superseded tokens cannot release or interrupt another worker's slot.
CREATE FUNCTION public.release_stripe_subscription_reconciliation(
    p_subscription_id TEXT,
    p_lease_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_id TEXT;
BEGIN
    IF p_lease_token IS NULL OR p_subscription_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NOT_LEASE_HOLDER');
    END IF;

    UPDATE public.stripe_subscription_reconciliation_leases
       SET lease_token = NULL,
           lease_expires_at = pg_catalog.clock_timestamp(),
           updated_at = pg_catalog.clock_timestamp()
     WHERE provider_subscription_id = p_subscription_id
       AND lease_token = p_lease_token
    RETURNING provider_subscription_id INTO v_id;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NOT_LEASE_HOLDER');
    END IF;
    RETURN pg_catalog.jsonb_build_object('outcome','RELEASED');
END;
$$;

-- The subscription projection and durable event finalization share exactly
-- one database transaction. A stale event token OR a stale subscription token
-- blocks the entire operation without changing billing state.
CREATE FUNCTION public.commit_stripe_subscription_reconciliation(
    p_event_id UUID,
    p_event_lease_token UUID,
    p_subscription_lease_token UUID,
    p_org_id UUID,
    p_billing_account_id UUID,
    p_provider_customer_id TEXT,
    p_environment TEXT,
    p_provider_subscription_id TEXT,
    p_provider_price_id TEXT,
    p_provider_status TEXT,
    p_normalized_status TEXT,
    p_current_period_start TIMESTAMPTZ,
    p_current_period_end TIMESTAMPTZ,
    p_cancel_at_period_end BOOLEAN,
    p_canceled_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_event public.billing_webhook_events%ROWTYPE;
    v_lease public.stripe_subscription_reconciliation_leases%ROWTYPE;
    v_projection JSONB;
BEGIN
    IF p_event_id IS NULL OR
       p_event_lease_token IS NULL OR
       p_subscription_lease_token IS NULL OR
       p_environment IS DISTINCT FROM 'TEST' OR
       p_provider_subscription_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NOT_LEASE_HOLDER');
    END IF;

    SELECT * INTO v_event
      FROM public.billing_webhook_events
     WHERE id = p_event_id
     FOR UPDATE;

    IF NOT FOUND OR
       v_event.provider IS DISTINCT FROM 'stripe' OR
       v_event.environment IS DISTINCT FROM 'TEST' OR
       v_event.event_type NOT IN (
           'customer.subscription.created',
           'customer.subscription.updated',
           'customer.subscription.deleted'
       ) OR
       v_event.processing_status IS DISTINCT FROM 'PROCESSING' OR
       v_event.processing_lease_token IS DISTINCT FROM p_event_lease_token OR
       v_event.processing_lease_expires_at <= pg_catalog.clock_timestamp() THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NOT_LEASE_HOLDER');
    END IF;

    SELECT * INTO v_lease
      FROM public.stripe_subscription_reconciliation_leases
     WHERE provider_subscription_id = p_provider_subscription_id
     FOR UPDATE;

    IF NOT FOUND OR
       v_lease.event_id IS DISTINCT FROM p_event_id OR
       v_lease.event_lease_token IS DISTINCT FROM p_event_lease_token OR
       v_lease.lease_token IS DISTINCT FROM p_subscription_lease_token OR
       v_lease.lease_expires_at <= pg_catalog.clock_timestamp() THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NOT_LEASE_HOLDER');
    END IF;

    -- Under the subscription mutex, invoke MR-5C2's tenant/account/customer
    -- checks and atomic insert-or-update. No provider-event snapshot is passed.
    v_projection := public.reconcile_stripe_subscription_projection(
        p_org_id,
        p_billing_account_id,
        p_provider_customer_id,
        p_environment,
        p_provider_subscription_id,
        p_provider_price_id,
        p_provider_status,
        p_normalized_status,
        p_current_period_start,
        p_current_period_end,
        p_cancel_at_period_end,
        p_canceled_at
    );

    IF v_projection->>'outcome' NOT IN ('CREATED','UPDATED','UNCHANGED') THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome','REJECTED',
            'reason',pg_catalog.coalesce(v_projection->>'outcome','UNKNOWN')
        );
    END IF;

    UPDATE public.billing_webhook_events
       SET processing_status = 'PROCESSED',
           organization_id = p_org_id,
           processed_at = pg_catalog.clock_timestamp(),
           error_code = NULL,
           processing_lease_token = NULL,
           processing_lease_expires_at = NULL
     WHERE id = p_event_id;

    UPDATE public.stripe_subscription_reconciliation_leases
       SET lease_token = NULL,
           lease_expires_at = pg_catalog.clock_timestamp(),
           updated_at = pg_catalog.clock_timestamp()
     WHERE provider_subscription_id = p_provider_subscription_id;

    RETURN pg_catalog.jsonb_build_object(
        'outcome','COMMITTED',
        'projection_outcome',v_projection->>'outcome',
        'subscription_id',v_projection->>'subscription_id'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.lease_stripe_subscription_reconciliation(UUID,UUID,TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lease_stripe_subscription_reconciliation(UUID,UUID,TEXT)
    TO service_role;

REVOKE ALL ON FUNCTION public.release_stripe_subscription_reconciliation(TEXT,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_stripe_subscription_reconciliation(TEXT,UUID)
    TO service_role;

REVOKE ALL ON FUNCTION public.commit_stripe_subscription_reconciliation(
    UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BOOLEAN,TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_stripe_subscription_reconciliation(
    UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BOOLEAN,TIMESTAMPTZ
) TO service_role;
