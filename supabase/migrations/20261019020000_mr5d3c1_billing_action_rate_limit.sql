-- MR-5D3C1: TEST-only, service-role-only request-throttle contract.
-- This does NOT expose a billing API, create a charge, or activate Stripe.
CREATE TABLE public.stripe_test_billing_action_limits (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    period_started_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 5),
    last_action TEXT NOT NULL CHECK (last_action IN ('CUSTOMER_SETUP','CHECKOUT','PORTAL')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    PRIMARY KEY (organization_id,user_id)
);
ALTER TABLE public.stripe_test_billing_action_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_test_billing_action_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_test_billing_action_limits TO service_role;

-- Atomic fixed-window admission with a global per-user/org budget shared
-- across all three billing actions. Concurrency uses the unique PK lock.
CREATE FUNCTION public.claim_stripe_test_billing_action(
    p_user_id UUID,
    p_organization_id UUID,
    p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_attempts INTEGER;
BEGIN
    IF p_user_id IS NULL OR p_organization_id IS NULL OR p_action IS NULL
       OR p_action NOT IN ('CUSTOMER_SETUP','CHECKOUT','PORTAL') THEN
        RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_users
         WHERE organization_id = p_organization_id
           AND user_id = p_user_id
           AND role IN ('OWNER','ADMIN')
    ) THEN
        RETURN pg_catalog.jsonb_build_object('outcome','NOT_AUTHORIZED');
    END IF;

    INSERT INTO public.stripe_test_billing_action_limits AS bucket (
        organization_id, user_id, period_started_at, attempts, last_action, updated_at
    )
    VALUES (p_organization_id,p_user_id,v_now,1,p_action,v_now)
    ON CONFLICT (organization_id,user_id) DO UPDATE
       SET attempts = CASE
           WHEN bucket.period_started_at <= v_now - INTERVAL '60 seconds' THEN 1
           ELSE bucket.attempts + 1
       END,
           period_started_at = CASE
           WHEN bucket.period_started_at <= v_now - INTERVAL '60 seconds' THEN v_now
           ELSE bucket.period_started_at
       END,
           last_action = p_action,
           updated_at = v_now
    WHERE bucket.period_started_at <= v_now - INTERVAL '60 seconds'
       OR bucket.attempts < 5
    RETURNING attempts INTO v_attempts;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('outcome','RATE_LIMITED');
    END IF;
    RETURN pg_catalog.jsonb_build_object('outcome','ALLOWED','remaining',5-v_attempts);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_test_billing_action(UUID,UUID,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_test_billing_action(UUID,UUID,TEXT)
  TO service_role;
