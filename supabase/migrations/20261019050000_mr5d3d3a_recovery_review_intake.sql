-- MR-5D3D3A — append-only TEST recovery review REQUEST intake.
-- This is not approval, recovery execution, billing access or provider evidence.
CREATE TABLE public.stripe_test_billing_recovery_reviews (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('CUSTOMER_SETUP','CHECKOUT')),
  reason TEXT NOT NULL CHECK (reason IN (
    'AGED_CUSTOMER_ATTEMPT','UNLINKED_CUSTOMER','CUSTOMER_MAPPING_CONFLICT',
    'AGED_CHECKOUT_ATTEMPT','EXPIRED_CHECKOUT_SESSION','EXPIRED_CHECKOUT_RESERVATION'
  )),
  state TEXT NOT NULL DEFAULT 'OPEN' CHECK (state = 'OPEN'),
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (organization_id,kind)
);
ALTER TABLE public.stripe_test_billing_recovery_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_test_billing_recovery_reviews FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.stripe_test_billing_recovery_reviews TO service_role;
-- No UPDATE/DELETE grant. Future support review/closure requires separate
-- owner-approved authority, auditable events and stale-state fencing.

CREATE FUNCTION public.request_stripe_test_billing_recovery_review(
  p_user_id UUID,
  p_organization_id UUID,
  p_kind TEXT
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_customer public.stripe_test_customer_provisioning%ROWTYPE;
  v_account public.organization_billing_accounts%ROWTYPE;
  v_checkout public.stripe_test_checkout_reservations%ROWTYPE;
  v_reason TEXT;
  v_inserted UUID;
BEGIN
  IF p_user_id IS NULL OR p_organization_id IS NULL OR
     p_kind IS NULL OR p_kind NOT IN ('CUSTOMER_SETUP','CHECKOUT') THEN
    RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
  END IF;

  -- Serialize intake for this organization. A client-supplied owner UUID is
  -- NEVER trusted unless authenticated server code has resolved auth.getUser().
  PERFORM 1 FROM public.organizations
   WHERE id = p_organization_id AND status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.organization_users
     WHERE organization_id = p_organization_id AND user_id = p_user_id
       AND role IN ('OWNER','ADMIN')
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_AUTHORIZED');
  END IF;

  IF p_kind = 'CUSTOMER_SETUP' THEN
    SELECT * INTO v_customer FROM public.stripe_test_customer_provisioning
      WHERE organization_id = p_organization_id;
    SELECT * INTO v_account FROM public.organization_billing_accounts
      WHERE organization_id = p_organization_id
        AND provider = 'stripe' AND environment = 'TEST';
    IF v_customer.id IS NULL THEN
      RETURN pg_catalog.jsonb_build_object('outcome','NOT_NEEDED');
    END IF;

    IF v_account.id IS NOT NULL AND v_customer.provider_customer_id IS NOT NULL
       AND v_account.provider_customer_id IS DISTINCT FROM v_customer.provider_customer_id THEN
      v_reason := 'CUSTOMER_MAPPING_CONFLICT';
    ELSIF v_account.id IS NULL AND v_customer.state = 'READY' THEN
      v_reason := 'UNLINKED_CUSTOMER';
    ELSIF v_account.id IS NULL AND
          v_customer.created_at <= v_now - INTERVAL '10 minutes' THEN
      v_reason := 'AGED_CUSTOMER_ATTEMPT';
    ELSE
      RETURN pg_catalog.jsonb_build_object('outcome','NOT_NEEDED');
    END IF;
  ELSE
    SELECT * INTO v_checkout FROM public.stripe_test_checkout_reservations
      WHERE organization_id = p_organization_id;
    IF v_checkout.id IS NULL OR EXISTS (
      SELECT 1 FROM public.organization_subscriptions
       WHERE organization_id = p_organization_id
         AND provider = 'stripe' AND environment = 'TEST'
         AND normalized_status <> 'ENDED'
    ) THEN
      RETURN pg_catalog.jsonb_build_object('outcome','NOT_NEEDED');
    END IF;

    IF v_checkout.status = 'READY' AND v_checkout.session_expires_at <= v_now THEN
      v_reason := 'EXPIRED_CHECKOUT_SESSION';
    ELSIF v_checkout.reservation_expires_at <= v_now THEN
      v_reason := 'EXPIRED_CHECKOUT_RESERVATION';
    ELSIF v_checkout.status = 'PREPARING' AND
          v_checkout.created_at <= v_now - INTERVAL '10 minutes' THEN
      v_reason := 'AGED_CHECKOUT_ATTEMPT';
    ELSE
      RETURN pg_catalog.jsonb_build_object('outcome','NOT_NEEDED');
    END IF;
  END IF;

  -- One OPEN case per tenant/kind; repeated requests have no new write.
  -- Never accept reason, case status or raw Stripe IDs from the caller.
  INSERT INTO public.stripe_test_billing_recovery_reviews (
    organization_id,kind,reason,requested_by
  ) VALUES (p_organization_id,p_kind,v_reason,p_user_id)
  ON CONFLICT (organization_id,kind) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome','ALREADY_REQUESTED');
  END IF;
  RETURN pg_catalog.jsonb_build_object('outcome','REQUESTED');
END;
$$;

REVOKE ALL ON FUNCTION public.request_stripe_test_billing_recovery_review(UUID,UUID,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_stripe_test_billing_recovery_review(UUID,UUID,TEXT)
  TO service_role;
