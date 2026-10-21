-- MR-5D2 — TEST-only, service-role-invoked checkout reservation / fencing.
-- This migration DOES NOT create Stripe sessions or authorize external charges.
-- Pending Stripe sessions are never payment or entitlement evidence.
CREATE TABLE public.stripe_test_checkout_reservations (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    billing_account_id UUID NOT NULL,
    environment TEXT NOT NULL DEFAULT 'TEST' CHECK (environment = 'TEST'),
    provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
    provider_customer_id TEXT NOT NULL CHECK (provider_customer_id ~ '^cus_[A-Za-z0-9]+$'),
    provider_price_id TEXT NOT NULL CHECK (provider_price_id ~ '^price_[A-Za-z0-9]+$'),
    plan_id TEXT NOT NULL CHECK (plan_id IN ('monthly','annual')),
    return_origin TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PREPARING','READY')),
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    stripe_session_id TEXT CHECK (stripe_session_id IS NULL OR stripe_session_id ~ '^cs_test_[A-Za-z0-9]+$'),
    stripe_session_url TEXT,
    session_expires_at TIMESTAMPTZ NOT NULL,
    reservation_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT stripe_checkout_account_fkey
        FOREIGN KEY (billing_account_id, organization_id, provider, environment)
        REFERENCES public.organization_billing_accounts(id,organization_id,provider,environment),
    CONSTRAINT stripe_checkout_one_per_org UNIQUE (organization_id),
    CONSTRAINT stripe_checkout_status_consistency CHECK (
        (status = 'PREPARING' AND stripe_session_id IS NULL AND stripe_session_url IS NULL) OR
        (status = 'READY' AND stripe_session_id IS NOT NULL AND stripe_session_url IS NOT NULL)
    )
);

ALTER TABLE public.stripe_test_checkout_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_test_checkout_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_test_checkout_reservations TO service_role;

-- This RPC's p_user_id is only valid when passed from a trusted server using
-- auth.getUser() on the actual caller. Never expose the service-role client or
-- RPC to browsers; the DB also checks active OWNER/ADMIN membership itself.
CREATE FUNCTION public.reserve_stripe_test_checkout(
    p_user_id UUID,
    p_organization_id UUID,
    p_billing_account_id UUID,
    p_provider_customer_id TEXT,
    p_provider_price_id TEXT,
    p_plan_id TEXT,
    p_return_origin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_account public.organization_billing_accounts%ROWTYPE;
    v_current public.stripe_test_checkout_reservations%ROWTYPE;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_subscription_exists BOOLEAN;
BEGIN
    IF p_user_id IS NULL OR p_organization_id IS NULL OR p_billing_account_id IS NULL OR
       p_provider_customer_id IS NULL OR p_provider_customer_id !~ '^cus_[A-Za-z0-9]+$' OR
       p_provider_price_id IS NULL OR p_provider_price_id !~ '^price_[A-Za-z0-9]+$' OR
       p_plan_id NOT IN ('monthly','annual') OR
       p_return_origin IS NULL OR pg_catalog.length(p_return_origin) > 250 OR
       p_return_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?$' AND
       p_return_origin !~ '^http://(localhost|127[.]0[.]0[.]1):[0-9]{2,5}$' THEN
        RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
    END IF;

    -- Cross-org checkout is rejected even if the server mistakenly supplied a
    -- trusted but unrelated billing account, and before any Stripe side effect.
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_users AS membership
         WHERE membership.organization_id = p_organization_id
           AND membership.user_id = p_user_id
           AND membership.role IN ('OWNER','ADMIN')
    ) THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NOT_AUTHORIZED');
    END IF;

    -- Checkout and webhook projection both lock the billing account row.
    SELECT * INTO v_account
      FROM public.organization_billing_accounts
     WHERE id = p_billing_account_id
       AND organization_id = p_organization_id
       AND environment = 'TEST'
       AND provider = 'stripe'
       AND provider_customer_id = p_provider_customer_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('outcome','ACCOUNT_MISMATCH');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.organization_subscriptions
         WHERE organization_id = p_organization_id
           AND provider = 'stripe'
           AND environment = 'TEST'
           AND normalized_status <> 'ENDED'
    ) INTO v_subscription_exists;
    IF v_subscription_exists THEN
        RETURN pg_catalog.jsonb_build_object('outcome','SUBSCRIPTION_EXISTS');
    END IF;

    SELECT * INTO v_current
      FROM public.stripe_test_checkout_reservations
     WHERE organization_id = p_organization_id
     FOR UPDATE;

    IF FOUND THEN
        -- Never automatically overwrite or reopen a historical session:
        -- a delayed webhook may not yet have updated local subscriptions.
        IF v_current.reservation_expires_at <= v_now THEN
            RETURN pg_catalog.jsonb_build_object('outcome','MANUAL_REVIEW_REQUIRED');
        END IF;
        IF v_current.billing_account_id IS DISTINCT FROM p_billing_account_id OR
           v_current.provider_customer_id IS DISTINCT FROM p_provider_customer_id OR
           v_current.provider_price_id IS DISTINCT FROM p_provider_price_id OR
           v_current.plan_id IS DISTINCT FROM p_plan_id OR
           v_current.return_origin IS DISTINCT FROM p_return_origin THEN
            RETURN pg_catalog.jsonb_build_object('outcome','DIFFERENT_INTENT');
        END IF;
        IF v_current.status = 'READY' THEN
            IF v_current.session_expires_at <= v_now THEN
                RETURN pg_catalog.jsonb_build_object('outcome','MANUAL_REVIEW_REQUIRED');
            END IF;
            RETURN pg_catalog.jsonb_build_object(
                'outcome','EXISTING_READY',
                'session_id',v_current.stripe_session_id,
                'session_url',v_current.stripe_session_url
            );
        END IF;
        IF v_current.lease_expires_at > v_now THEN
            RETURN pg_catalog.jsonb_build_object('outcome','BUSY');
        END IF;
        -- Stripe persists idempotency keys for at least 24 hours. Only
        -- retry this immutable reservation during its first 10 minutes,
        -- far inside Stripe's idempotency retention and session expiry.
        IF v_current.created_at <= v_now - INTERVAL '10 minutes' THEN
            RETURN pg_catalog.jsonb_build_object('outcome','MANUAL_REVIEW_REQUIRED');
        END IF;

        UPDATE public.stripe_test_checkout_reservations
           SET lease_token = pg_catalog.gen_random_uuid(),
               lease_expires_at = v_now + INTERVAL '120 seconds',
               updated_at = v_now
         WHERE id = v_current.id
         RETURNING * INTO v_current;
    ELSE
        INSERT INTO public.stripe_test_checkout_reservations (
            organization_id,billing_account_id,provider_customer_id,
            provider_price_id,plan_id,return_origin,status,lease_token,
            lease_expires_at,session_expires_at,reservation_expires_at
        ) VALUES (
            p_organization_id,p_billing_account_id,p_provider_customer_id,
            p_provider_price_id,p_plan_id,p_return_origin,'PREPARING',
            pg_catalog.gen_random_uuid(),v_now + INTERVAL '120 seconds',
            v_now + INTERVAL '1 hour',v_now + INTERVAL '65 minutes'
        ) RETURNING * INTO v_current;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'outcome','RESERVED',
        'reservation_id',v_current.id,
        'lease_token',v_current.lease_token,
        'session_expires_at',v_current.session_expires_at
    );
END;
$$;

CREATE FUNCTION public.finalize_stripe_test_checkout(
    p_user_id UUID,
    p_reservation_id UUID,
    p_lease_token UUID,
    p_session_id TEXT,
    p_session_url TEXT,
    p_session_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_current public.stripe_test_checkout_reservations%ROWTYPE;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
    IF p_user_id IS NULL OR p_reservation_id IS NULL OR
       p_lease_token IS NULL OR p_session_id IS NULL OR
       p_session_id !~ '^cs_test_[A-Za-z0-9]+$' OR
       p_session_url IS NULL OR
       p_session_url !~ '^https://checkout[.]stripe[.]com/' OR
       pg_catalog.length(p_session_url) > 2048 THEN
        RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
    END IF;

    SELECT * INTO v_current
      FROM public.stripe_test_checkout_reservations
     WHERE id = p_reservation_id
     FOR UPDATE;

    IF NOT FOUND OR v_current.status IS DISTINCT FROM 'PREPARING' OR
       v_current.lease_token IS DISTINCT FROM p_lease_token OR
       v_current.lease_expires_at <= v_now OR
       v_current.session_expires_at IS DISTINCT FROM p_session_expires_at THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NOT_LEASE_HOLDER');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_users
         WHERE organization_id = v_current.organization_id
           AND user_id = p_user_id
           AND role IN ('OWNER','ADMIN')
    ) OR EXISTS (
        SELECT 1 FROM public.organization_subscriptions
         WHERE organization_id = v_current.organization_id
           AND provider = 'stripe' AND environment = 'TEST'
           AND normalized_status <> 'ENDED'
    ) THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NOT_AUTHORIZED');
    END IF;

    UPDATE public.stripe_test_checkout_reservations
       SET status = 'READY',
           stripe_session_id = p_session_id,
           stripe_session_url = p_session_url,
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = v_now
     WHERE id = p_reservation_id;
    RETURN pg_catalog.jsonb_build_object('outcome','FINALIZED');
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_stripe_test_checkout(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_stripe_test_checkout(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.finalize_stripe_test_checkout(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_stripe_test_checkout(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ)
  TO service_role;
