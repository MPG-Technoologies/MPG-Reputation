-- MR-5C2: isolated atomic TEST subscription projection.
-- Billing persistence only. No provider calls, event consumption, payment
-- receipts, grants of paid entitlement, customer charging, or LIVE activation.
--
-- Caller contract: only the future privileged server-side processor may call
-- this function, after obtaining fresh provider truth, resolving Stripe
-- Customer ID through the stored billing account, and preparing a validated
-- MR-5C1 candidate. Event snapshots alone are NEVER trusted state.
--
-- Important: serializing writes does NOT prove provider-state freshness.
-- The eventual MR-5C3 worker must serialize fetch/reconciliation per
-- subscription, retry recovery, and fetch fresh provider truth. No Stripe
-- event.created timestamp is used as a subscription version.

CREATE OR REPLACE FUNCTION public.reconcile_stripe_subscription_projection(
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
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_expected_status TEXT;
    v_account_id UUID;
    v_existing public.organization_subscriptions%ROWTYPE;
    v_inserted_id UUID;
BEGIN
    -- The only privileged entry point is service_role with an intentionally
    -- narrow EXECUTE grant. This implementation refuses LIVE altogether
    -- even if the calling server accidentally enables a live environment.
    IF p_environment IS DISTINCT FROM 'TEST' THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'BLOCKED', 'reason', 'ENVIRONMENT_DISABLED');
    END IF;

    IF p_org_id IS NULL OR p_billing_account_id IS NULL OR
       p_provider_customer_id IS NULL OR
       p_provider_customer_id !~ '^cus_[A-Za-z0-9]+$' OR
       p_provider_subscription_id IS NULL OR
       p_provider_subscription_id !~ '^sub_[A-Za-z0-9]+$' OR
       p_provider_price_id IS NULL OR
       p_provider_price_id !~ '^price_[A-Za-z0-9]+$' OR
       p_cancel_at_period_end IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'BLOCKED', 'reason', 'INVALID_INPUT');
    END IF;

    v_expected_status := CASE p_provider_status
        WHEN 'incomplete' THEN 'PENDING'
        WHEN 'trialing' THEN 'PENDING'
        WHEN 'active' THEN 'ACTIVE'
        WHEN 'past_due' THEN 'SUSPENDED'
        WHEN 'unpaid' THEN 'SUSPENDED'
        WHEN 'paused' THEN 'SUSPENDED'
        WHEN 'incomplete_expired' THEN 'ENDED'
        WHEN 'canceled' THEN 'ENDED'
        ELSE NULL
    END;

    IF v_expected_status IS NULL OR
       p_normalized_status IS DISTINCT FROM v_expected_status THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'BLOCKED', 'reason', 'STATUS_MISMATCH');
    END IF;

    IF ((p_current_period_start IS NULL) <> (p_current_period_end IS NULL)) OR
       (p_current_period_start IS NOT NULL AND
        p_current_period_start >= p_current_period_end) OR
       (p_provider_status = 'active' AND p_current_period_start IS NULL) THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'BLOCKED', 'reason', 'PERIOD_INVALID');
    END IF;

    -- Serializes same-subscription calls, including attempts to reassign the
    -- subscription to a different account or tenant.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'mr5c2:stripe:TEST:' || p_provider_subscription_id, 0
        )
    );

    -- Re-confirm the account ID, provider customer, tenant and environment
    -- inside the same database transaction. No Stripe metadata is authority.
    SELECT account.id INTO v_account_id
      FROM public.organization_billing_accounts AS account
     WHERE account.id = p_billing_account_id
       AND account.organization_id = p_org_id
       AND account.provider_customer_id = p_provider_customer_id
       AND account.provider = 'stripe'
       AND account.environment = 'TEST'
     FOR UPDATE;

    IF v_account_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'BLOCKED', 'reason', 'ACCOUNT_MISMATCH');
    END IF;

    SELECT subscription.* INTO v_existing
      FROM public.organization_subscriptions AS subscription
     WHERE subscription.provider = 'stripe'
       AND subscription.environment = 'TEST'
       AND subscription.provider_subscription_id = p_provider_subscription_id
     FOR UPDATE;

    IF FOUND THEN
        IF v_existing.organization_id IS DISTINCT FROM p_org_id OR
           v_existing.billing_account_id IS DISTINCT FROM p_billing_account_id THEN
            RETURN pg_catalog.jsonb_build_object('outcome', 'CONFLICT');
        END IF;

        IF v_existing.provider_price_id IS NOT DISTINCT FROM p_provider_price_id AND
           v_existing.provider_status IS NOT DISTINCT FROM p_provider_status AND
           v_existing.normalized_status IS NOT DISTINCT FROM p_normalized_status AND
           v_existing.current_period_start IS NOT DISTINCT FROM p_current_period_start AND
           v_existing.current_period_end IS NOT DISTINCT FROM p_current_period_end AND
           v_existing.cancel_at_period_end IS NOT DISTINCT FROM p_cancel_at_period_end AND
           v_existing.canceled_at IS NOT DISTINCT FROM p_canceled_at THEN
            RETURN pg_catalog.jsonb_build_object('outcome', 'UNCHANGED', 'subscription_id', v_existing.id);
        END IF;

        UPDATE public.organization_subscriptions
           SET provider_price_id = p_provider_price_id,
               provider_status = p_provider_status,
               normalized_status = p_normalized_status,
               current_period_start = p_current_period_start,
               current_period_end = p_current_period_end,
               cancel_at_period_end = p_cancel_at_period_end,
               canceled_at = p_canceled_at,
               -- There is no trustworthy Stripe subscription version field.
               provider_state_updated_at = NULL,
               updated_at = pg_catalog.now()
         WHERE id = v_existing.id;

        RETURN pg_catalog.jsonb_build_object('outcome', 'UPDATED', 'subscription_id', v_existing.id);
    END IF;

    INSERT INTO public.organization_subscriptions (
        organization_id,
        billing_account_id,
        provider,
        environment,
        provider_subscription_id,
        provider_price_id,
        provider_status,
        normalized_status,
        current_period_start,
        current_period_end,
        cancel_at_period_end,
        canceled_at,
        provider_state_updated_at
    ) VALUES (
        p_org_id,
        p_billing_account_id,
        'stripe',
        'TEST',
        p_provider_subscription_id,
        p_provider_price_id,
        p_provider_status,
        p_normalized_status,
        p_current_period_start,
        p_current_period_end,
        p_cancel_at_period_end,
        p_canceled_at,
        NULL
    )
    RETURNING id INTO v_inserted_id;

    RETURN pg_catalog.jsonb_build_object('outcome', 'CREATED', 'subscription_id', v_inserted_id);
END;
$$;

-- public is an exposed schema, but invocation is not public. Explicitly
-- revoke the default PUBLIC function privilege and all client roles.
REVOKE ALL ON FUNCTION public.reconcile_stripe_subscription_projection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
    TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stripe_subscription_projection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
    TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ
) TO service_role;
