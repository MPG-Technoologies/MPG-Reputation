-- MR-5D3B1: synthetic-safe TEST Stripe Customer creation reservation.
-- No hosted deployment, Stripe key, public API or charge is authorized.
CREATE TABLE public.stripe_test_customer_provisioning (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  environment TEXT NOT NULL DEFAULT 'TEST' CHECK (environment = 'TEST'),
  organization_name TEXT NOT NULL CHECK (pg_catalog.length(organization_name) BETWEEN 1 AND 150),
  state TEXT NOT NULL CHECK (state IN ('PREPARING', 'READY')),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  provider_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT customer_provisioning_state_check CHECK (
    (state = 'PREPARING' AND provider_customer_id IS NULL)
    OR (state = 'READY' AND provider_customer_id IS NOT NULL
      AND provider_customer_id ~ '^cus_[A-Za-z0-9]+
  )
);
ALTER TABLE public.stripe_test_customer_provisioning ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_test_customer_provisioning FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_test_customer_provisioning TO service_role;

-- Both provisioning RPCs lock the organization row first. Consequently even
-- two workers racing on an absent provisioning row serialize on the same key.
CREATE FUNCTION public.reserve_stripe_test_customer(
  p_user_id UUID,
  p_organization_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_account public.organization_billing_accounts%ROWTYPE;
  v_reservation public.stripe_test_customer_provisioning%ROWTYPE;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_name TEXT;
BEGIN
  IF p_user_id IS NULL OR p_organization_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_users
     WHERE organization_id = p_organization_id AND user_id = p_user_id
       AND role IN ('OWNER','ADMIN')
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_AUTHORIZED');
  END IF;

  SELECT * INTO v_org FROM public.organizations
   WHERE id = p_organization_id AND status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome','ORG_UNAVAILABLE');
  END IF;

  SELECT * INTO v_account FROM public.organization_billing_accounts
   WHERE organization_id = p_organization_id AND provider = 'stripe'
     AND environment = 'TEST';
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome','EXISTING');
  END IF;

  SELECT * INTO v_reservation FROM public.stripe_test_customer_provisioning
   WHERE organization_id = p_organization_id FOR UPDATE;

  IF FOUND THEN
    IF v_reservation.state = 'READY' OR
       v_reservation.created_at <= v_now - INTERVAL '10 minutes' THEN
      RETURN pg_catalog.jsonb_build_object('outcome','MANUAL_REVIEW_REQUIRED');
    END IF;
    IF v_reservation.lease_expires_at > v_now THEN
      RETURN pg_catalog.jsonb_build_object('outcome','BUSY');
    END IF;

    UPDATE public.stripe_test_customer_provisioning
       SET lease_token = pg_catalog.gen_random_uuid(),
           lease_expires_at = v_now + INTERVAL '120 seconds',
           updated_at = v_now
     WHERE id = v_reservation.id
     RETURNING * INTO v_reservation;
  ELSE
    -- Freeze trusted organization name for Stripe idempotency retries.
    v_name := pg_catalog.left(pg_catalog.btrim(v_org.name), 150);
    IF pg_catalog.length(v_name) < 1 THEN
      RETURN pg_catalog.jsonb_build_object('outcome','INVALID_ORGANIZATION_NAME');
    END IF;

    INSERT INTO public.stripe_test_customer_provisioning (
      organization_id, organization_name, state, lease_token, lease_expires_at
    ) VALUES (
      p_organization_id, v_name, 'PREPARING',
      pg_catalog.gen_random_uuid(), v_now + INTERVAL '120 seconds'
    ) RETURNING * INTO v_reservation;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'outcome','RESERVED',
    'reservation_id',v_reservation.id,
    'lease_token',v_reservation.lease_token,
    'organization_name',v_reservation.organization_name
  );
END;
$$;

CREATE FUNCTION public.finalize_stripe_test_customer(
  p_user_id UUID,
  p_organization_id UUID,
  p_reservation_id UUID,
  p_lease_token UUID,
  p_provider_customer_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.stripe_test_customer_provisioning%ROWTYPE;
  v_account public.organization_billing_accounts%ROWTYPE;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF p_user_id IS NULL OR p_organization_id IS NULL OR
     p_reservation_id IS NULL OR p_lease_token IS NULL OR
     p_provider_customer_id IS NULL OR
     p_provider_customer_id !~ '^cus_[A-Za-z0-9]+$' THEN
    RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_users
     WHERE organization_id = p_organization_id AND user_id = p_user_id
       AND role IN ('OWNER','ADMIN')
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_AUTHORIZED');
  END IF;

  -- Same lock sequence as reserve; prevents finalize/reserve races.
  PERFORM 1 FROM public.organizations
   WHERE id = p_organization_id AND status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome','ORG_UNAVAILABLE');
  END IF;
  SELECT * INTO v_reservation FROM public.stripe_test_customer_provisioning
   WHERE id = p_reservation_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.state <> 'PREPARING' OR
     v_reservation.lease_token IS DISTINCT FROM p_lease_token OR
     v_reservation.lease_expires_at <= v_now OR
     v_reservation.created_at <= v_now - INTERVAL '10 minutes' THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_LEASE_HOLDER');
  END IF;

  SELECT * INTO v_account FROM public.organization_billing_accounts
   WHERE organization_id = p_organization_id AND provider = 'stripe'
     AND environment = 'TEST';
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome','ACCOUNT_ALREADY_LINKED');
  END IF;

  -- Never replace an existing provider/tenant customer mapping.
  INSERT INTO public.organization_billing_accounts (
    organization_id, provider, environment, provider_customer_id
  ) VALUES (
    p_organization_id, 'stripe', 'TEST', p_provider_customer_id
  );
  UPDATE public.stripe_test_customer_provisioning
    SET state = 'READY',
        provider_customer_id = p_provider_customer_id,
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_reservation_id;
  RETURN pg_catalog.jsonb_build_object('outcome','LINKED');
EXCEPTION
  WHEN unique_violation THEN
    -- A different tenant or worker already linked the provider customer.
    -- The transaction rolls back; do not overwrite or trust metadata.
    RETURN pg_catalog.jsonb_build_object('outcome','CUSTOMER_CONFLICT');
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_stripe_test_customer(UUID,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_stripe_test_customer(UUID,UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.finalize_stripe_test_customer(UUID,UUID,UUID,UUID,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_stripe_test_customer(UUID,UUID,UUID,UUID,TEXT)
  TO service_role;
)
  )
);
ALTER TABLE public.stripe_test_customer_provisioning ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_test_customer_provisioning FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_test_customer_provisioning TO service_role;

-- Both provisioning RPCs lock the organization row first. Consequently even
-- two workers racing on an absent provisioning row serialize on the same key.
CREATE FUNCTION public.reserve_stripe_test_customer(
  p_user_id UUID,
  p_organization_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_account public.organization_billing_accounts%ROWTYPE;
  v_reservation public.stripe_test_customer_provisioning%ROWTYPE;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_name TEXT;
BEGIN
  IF p_user_id IS NULL OR p_organization_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_users
     WHERE organization_id = p_organization_id AND user_id = p_user_id
       AND role IN ('OWNER','ADMIN')
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_AUTHORIZED');
  END IF;

  SELECT * INTO v_org FROM public.organizations
   WHERE id = p_organization_id AND status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome','ORG_UNAVAILABLE');
  END IF;

  SELECT * INTO v_account FROM public.organization_billing_accounts
   WHERE organization_id = p_organization_id AND provider = 'stripe'
     AND environment = 'TEST';
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome','EXISTING');
  END IF;

  SELECT * INTO v_reservation FROM public.stripe_test_customer_provisioning
   WHERE organization_id = p_organization_id FOR UPDATE;

  IF FOUND THEN
    IF v_reservation.state = 'READY' OR
       v_reservation.created_at <= v_now - INTERVAL '10 minutes' THEN
      RETURN pg_catalog.jsonb_build_object('outcome','MANUAL_REVIEW_REQUIRED');
    END IF;
    IF v_reservation.lease_expires_at > v_now THEN
      RETURN pg_catalog.jsonb_build_object('outcome','BUSY');
    END IF;

    UPDATE public.stripe_test_customer_provisioning
       SET lease_token = pg_catalog.gen_random_uuid(),
           lease_expires_at = v_now + INTERVAL '120 seconds',
           updated_at = v_now
     WHERE id = v_reservation.id
     RETURNING * INTO v_reservation;
  ELSE
    -- Freeze trusted organization name for Stripe idempotency retries.
    v_name := pg_catalog.left(pg_catalog.btrim(v_org.name), 150);
    IF pg_catalog.length(v_name) < 1 THEN
      RETURN pg_catalog.jsonb_build_object('outcome','INVALID_ORGANIZATION_NAME');
    END IF;

    INSERT INTO public.stripe_test_customer_provisioning (
      organization_id, organization_name, state, lease_token, lease_expires_at
    ) VALUES (
      p_organization_id, v_name, 'PREPARING',
      pg_catalog.gen_random_uuid(), v_now + INTERVAL '120 seconds'
    ) RETURNING * INTO v_reservation;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'outcome','RESERVED',
    'reservation_id',v_reservation.id,
    'lease_token',v_reservation.lease_token,
    'organization_name',v_reservation.organization_name
  );
END;
$$;

CREATE FUNCTION public.finalize_stripe_test_customer(
  p_user_id UUID,
  p_organization_id UUID,
  p_reservation_id UUID,
  p_lease_token UUID,
  p_provider_customer_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.stripe_test_customer_provisioning%ROWTYPE;
  v_account public.organization_billing_accounts%ROWTYPE;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF p_user_id IS NULL OR p_organization_id IS NULL OR
     p_reservation_id IS NULL OR p_lease_token IS NULL OR
     p_provider_customer_id IS NULL OR
     p_provider_customer_id !~ '^cus_[A-Za-z0-9]+$' THEN
    RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_users
     WHERE organization_id = p_organization_id AND user_id = p_user_id
       AND role IN ('OWNER','ADMIN')
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_AUTHORIZED');
  END IF;

  -- Same lock sequence as reserve; prevents finalize/reserve races.
  PERFORM 1 FROM public.organizations
   WHERE id = p_organization_id AND status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome','ORG_UNAVAILABLE');
  END IF;
  SELECT * INTO v_reservation FROM public.stripe_test_customer_provisioning
   WHERE id = p_reservation_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.state <> 'PREPARING' OR
     v_reservation.lease_token IS DISTINCT FROM p_lease_token OR
     v_reservation.lease_expires_at <= v_now OR
     v_reservation.created_at <= v_now - INTERVAL '10 minutes' THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_LEASE_HOLDER');
  END IF;

  SELECT * INTO v_account FROM public.organization_billing_accounts
   WHERE organization_id = p_organization_id AND provider = 'stripe'
     AND environment = 'TEST';
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome','ACCOUNT_ALREADY_LINKED');
  END IF;

  -- Never replace an existing provider/tenant customer mapping.
  INSERT INTO public.organization_billing_accounts (
    organization_id, provider, environment, provider_customer_id
  ) VALUES (
    p_organization_id, 'stripe', 'TEST', p_provider_customer_id
  );
  UPDATE public.stripe_test_customer_provisioning
    SET state = 'READY',
        provider_customer_id = p_provider_customer_id,
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_reservation_id;
  RETURN pg_catalog.jsonb_build_object('outcome','LINKED');
EXCEPTION
  WHEN unique_violation THEN
    -- A different tenant or worker already linked the provider customer.
    -- The transaction rolls back; do not overwrite or trust metadata.
    RETURN pg_catalog.jsonb_build_object('outcome','CUSTOMER_CONFLICT');
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_stripe_test_customer(UUID,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_stripe_test_customer(UUID,UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.finalize_stripe_test_customer(UUID,UUID,UUID,UUID,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_stripe_test_customer(UUID,UUID,UUID,UUID,TEXT)
  TO service_role;
