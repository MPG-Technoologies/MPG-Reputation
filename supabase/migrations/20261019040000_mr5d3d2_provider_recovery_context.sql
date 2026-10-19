-- MR-5D3D2: trusted, read-only TEST billing provider reconciliation context.
-- This is strictly private server-to-server context, NEVER a client response.
CREATE FUNCTION public.read_stripe_test_provider_recovery_context(
  p_user_id UUID,
  p_organization_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_account public.organization_billing_accounts%ROWTYPE;
  v_customer public.stripe_test_customer_provisioning%ROWTYPE;
  v_checkout public.stripe_test_checkout_reservations%ROWTYPE;
  v_has_subscription BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR p_organization_id IS NULL OR
     NOT EXISTS (
       SELECT 1 FROM public.organizations o
       WHERE o.id = p_organization_id AND o.status = 'ACTIVE'
     ) OR NOT EXISTS (
       SELECT 1 FROM public.organization_users u
       WHERE u.organization_id = p_organization_id
         AND u.user_id = p_user_id AND u.role IN ('OWNER','ADMIN')
     ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome','NOT_AUTHORIZED');
  END IF;

  SELECT * INTO v_account FROM public.organization_billing_accounts
   WHERE organization_id = p_organization_id
     AND provider = 'stripe' AND environment = 'TEST';
  SELECT * INTO v_customer FROM public.stripe_test_customer_provisioning
   WHERE organization_id = p_organization_id;
  SELECT * INTO v_checkout FROM public.stripe_test_checkout_reservations
   WHERE organization_id = p_organization_id;
  SELECT EXISTS (
    SELECT 1 FROM public.organization_subscriptions
     WHERE organization_id = p_organization_id
       AND provider = 'stripe' AND environment = 'TEST'
       AND normalized_status <> 'ENDED'
  ) INTO v_has_subscription;

  RETURN pg_catalog.jsonb_build_object(
    'outcome','READY',
    'customer_id',pg_catalog.coalesce(
      v_account.provider_customer_id,v_customer.provider_customer_id
    ),
    'customer_linked',v_account.id IS NOT NULL,
    'customer_local_conflict',
      v_account.id IS NOT NULL AND v_customer.provider_customer_id IS NOT NULL
      AND v_account.provider_customer_id IS DISTINCT FROM v_customer.provider_customer_id,
    'customer_expected_name',v_customer.organization_name,
    'checkout_id',v_checkout.stripe_session_id,
    'checkout_reservation_id',v_checkout.id,
    'checkout_customer_id',v_checkout.provider_customer_id,
    'checkout_price_id',v_checkout.provider_price_id,
    'checkout_status',v_checkout.status,
    'checkout_expires_at',CASE WHEN v_checkout.id IS NOT NULL
      THEN pg_catalog.floor(pg_catalog.extract(epoch from v_checkout.session_expires_at))::BIGINT
      ELSE NULL END,
    'checkout_origin',v_checkout.return_origin,
    'has_subscription',v_has_subscription
  );
END;
$$;

REVOKE ALL ON FUNCTION public.read_stripe_test_provider_recovery_context(UUID,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_stripe_test_provider_recovery_context(UUID,UUID)
  TO service_role;
