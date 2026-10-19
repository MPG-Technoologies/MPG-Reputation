-- MR-5D3D1 — read-only, service-only, tenant-authorized recovery diagnosis.
-- No session reset, Customer relink, Stripe call, entitlement or new checkout.
-- Classifications are advisory snapshots; reconciliation MUST recheck state.
CREATE FUNCTION public.inspect_stripe_test_billing_recovery(
  p_user_id UUID,
  p_organization_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_customer public.stripe_test_customer_provisioning%ROWTYPE;
  v_checkout public.stripe_test_checkout_reservations%ROWTYPE;
  v_has_account BOOLEAN;
  v_has_subscription BOOLEAN;
  v_customer_state TEXT := 'NOT_STARTED';
  v_checkout_state TEXT := 'NOT_STARTED';
BEGIN
  IF p_user_id IS NULL OR p_organization_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome','INVALID_INPUT');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations o
      WHERE o.id = p_organization_id AND o.status = 'ACTIVE'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.organization_users m
      WHERE m.organization_id = p_organization_id
        AND m.user_id = p_user_id
        AND m.role IN ('OWNER','ADMIN')
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_AUTHORIZED');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.organization_billing_accounts a
    WHERE a.organization_id = p_organization_id
      AND a.provider = 'stripe' AND a.environment = 'TEST'
  ) INTO v_has_account;
  SELECT EXISTS (
    SELECT 1 FROM public.organization_subscriptions s
    WHERE s.organization_id = p_organization_id
      AND s.provider = 'stripe' AND s.environment = 'TEST'
      AND s.normalized_status <> 'ENDED'
  ) INTO v_has_subscription;

  SELECT * INTO v_customer
    FROM public.stripe_test_customer_provisioning
    WHERE organization_id = p_organization_id;
  SELECT * INTO v_checkout
    FROM public.stripe_test_checkout_reservations
    WHERE organization_id = p_organization_id;

  IF v_has_account THEN
    v_customer_state := 'ACCOUNT_LINKED';
  ELSIF v_customer.id IS NOT NULL THEN
    IF v_customer.state = 'READY'
       OR v_customer.created_at <= v_now - INTERVAL '10 minutes' THEN
      v_customer_state := 'RECONCILE_PROVIDER';
    ELSIF v_customer.lease_expires_at > v_now THEN
      v_customer_state := 'IN_FLIGHT';
    ELSE
      v_customer_state := 'RETRY_SAME_RESERVATION';
    END IF;
  END IF;

  IF v_has_subscription THEN
    -- A local subscription record is NOT proof of a settled payment.
    v_checkout_state := 'SUBSCRIPTION_RECORDED';
  ELSIF v_checkout.id IS NOT NULL THEN
    IF v_checkout.reservation_expires_at <= v_now THEN
      v_checkout_state := 'RECONCILE_PROVIDER';
    ELSIF v_checkout.status = 'READY' THEN
      IF v_checkout.session_expires_at > v_now THEN
        v_checkout_state := 'ACTIVE_SESSION';
      ELSE
        v_checkout_state := 'RECONCILE_PROVIDER';
      END IF;
    ELSIF v_checkout.created_at <= v_now - INTERVAL '10 minutes' THEN
      v_checkout_state := 'RECONCILE_PROVIDER';
    ELSIF v_checkout.lease_expires_at > v_now THEN
      v_checkout_state := 'IN_FLIGHT';
    ELSE
      v_checkout_state := 'RETRY_SAME_RESERVATION';
    END IF;
  END IF;

  -- Intentionally no Customer ID, account ID, session URL/ID, lease token,
  -- Stripe data, user PII, amounts or raw provider status in this response.
  RETURN pg_catalog.jsonb_build_object(
    'outcome','READY',
    'customer',v_customer_state,
    'checkout',v_checkout_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inspect_stripe_test_billing_recovery(UUID,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_stripe_test_billing_recovery(UUID,UUID)
  TO service_role;
