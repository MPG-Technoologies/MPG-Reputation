-- MR-4 — Trial / Usage / Economics
-- Server-authoritative organization entitlement model, append-only usage ledger,
-- internal economics cost ledger, and concurrency-safe limit enforcement.

-- ============================================================
-- 1. Organization Entitlements
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_entitlements (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (
        status IN ('NOT_STARTED', 'ACTIVE', 'EXHAUSTED', 'EXPIRED', 'ENDED', 'SUSPENDED')
    ) DEFAULT 'NOT_STARTED',
    allocated_requests INT NOT NULL DEFAULT 30 CHECK (allocated_requests >= 0),
    consumed_requests INT NOT NULL DEFAULT 0 CHECK (consumed_requests >= 0),
    duration_days INT NOT NULL DEFAULT 30 CHECK (duration_days > 0),
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    status_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organization_entitlements_status
    ON public.organization_entitlements(status);

-- ============================================================
-- 2. Usage Ledger (Append-only factual usage accounting)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.usage_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'initial_request_created',
            'reminder_created',
            'provider_send_attempt',
            'provider_send_success',
            'provider_send_failure',
            'tracked_click',
            'completion_received'
        )
    ),
    channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
    units INT NOT NULL DEFAULT 1 CHECK (units > 0),
    entity_type TEXT NOT NULL CHECK (
        entity_type IN (
            'review_request',
            'message_event',
            'customer_completion_event',
            'tracked_link'
        )
    ),
    entity_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    source_event_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_org_created
    ON public.usage_ledger(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_org_event
    ON public.usage_ledger(organization_id, event_type);

-- ============================================================
-- 3. Internal Cost Ledger (COGS & Economic Attribution)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cost_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    usage_ledger_id UUID REFERENCES public.usage_ledger(id) ON DELETE SET NULL,
    cost_category TEXT NOT NULL CHECK (
        cost_category IN (
            'email_provider',
            'workflow_execution',
            'database_storage',
            'hosting_allocation',
            'support_allocation',
            'other'
        )
    ),
    cost_status TEXT NOT NULL CHECK (
        cost_status IN ('MEASURED', 'CONFIGURED_ESTIMATE', 'UNKNOWN')
    ),
    currency TEXT NOT NULL DEFAULT 'USD',
    amount_micro_usd BIGINT NOT NULL DEFAULT 0,
    description TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_ledger_org_recorded
    ON public.cost_ledger(organization_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_cost_ledger_category
    ON public.cost_ledger(organization_id, cost_category);

-- ============================================================
-- 4. RLS and Grants (Strict Trust Boundary)
-- ============================================================

ALTER TABLE public.organization_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organization_entitlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.usage_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cost_ledger FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.organization_entitlements TO service_role;
GRANT ALL ON public.usage_ledger TO service_role;
GRANT ALL ON public.cost_ledger TO service_role;

-- Authenticated tenant read access for entitlements:
GRANT SELECT ON public.organization_entitlements TO authenticated;

CREATE POLICY organization_entitlements_select ON public.organization_entitlements
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.organization_users ou
            WHERE ou.organization_id = public.organization_entitlements.organization_id
              AND ou.user_id = auth.uid()
        )
    );

-- Authenticated tenant read access for usage_ledger:
GRANT SELECT ON public.usage_ledger TO authenticated;

CREATE POLICY usage_ledger_select ON public.usage_ledger
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.organization_users ou
            WHERE ou.organization_id = public.usage_ledger.organization_id
              AND ou.user_id = auth.uid()
        )
    );

-- cost_ledger remains restricted to service_role only (no direct browser client read/write)

-- ============================================================
-- 5. Stored Procedures: Provisioning, Consumption, and Recording
-- ============================================================

CREATE OR REPLACE FUNCTION public.provision_organization_trial(
    p_org_id UUID,
    p_allocated_requests INT DEFAULT 30,
    p_duration_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'Organization ID is required';
    END IF;

    IF p_allocated_requests < 0 THEN
        RAISE EXCEPTION 'Allocated requests must be non-negative';
    END IF;

    IF p_duration_days <= 0 THEN
        RAISE EXCEPTION 'Duration days must be positive';
    END IF;

    INSERT INTO public.organization_entitlements (
        organization_id,
        status,
        allocated_requests,
        consumed_requests,
        duration_days,
        started_at,
        expires_at,
        status_reason,
        updated_at
    )
    VALUES (
        p_org_id,
        'NOT_STARTED',
        p_allocated_requests,
        0,
        p_duration_days,
        NULL,
        NULL,
        'Trial provisioned in NOT_STARTED state (awaiting explicit activation)',
        now()
    )
    ON CONFLICT (organization_id) DO UPDATE
    SET allocated_requests = EXCLUDED.allocated_requests,
        duration_days = EXCLUDED.duration_days,
        status_reason = CASE
            WHEN organization_entitlements.status = 'NOT_STARTED' THEN 'Trial re-provisioned in NOT_STARTED state'
            ELSE organization_entitlements.status_reason
        END,
        updated_at = now();

    INSERT INTO public.audit_events (
        organization_id,
        actor_type,
        event_type,
        entity_type,
        entity_id,
        metadata
    )
    VALUES (
        p_org_id,
        'system',
        'trial.provisioned',
        'organization_entitlement',
        p_org_id,
        jsonb_build_object(
            'allocatedRequests', p_allocated_requests,
            'durationDays', p_duration_days,
            'status', 'NOT_STARTED'
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'status', 'NOT_STARTED',
        'allocated_requests', p_allocated_requests,
        'consumed_requests', 0,
        'duration_days', p_duration_days,
        'started_at', NULL,
        'expires_at', NULL
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_organization_trial(
    p_org_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_started_at TIMESTAMPTZ;
    v_expires_at TIMESTAMPTZ;
    v_duration_days INT;
    v_allocated INT;
    v_consumed INT;
BEGIN
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'Organization ID is required';
    END IF;

    -- Concurrency lock per organization
    PERFORM pg_advisory_xact_lock(
        hashtextextended('trial_entitlement:' || p_org_id::text, 0)
    );

    -- Fetch current entitlement
    SELECT status, started_at, expires_at, duration_days, allocated_requests, consumed_requests
    INTO v_status, v_started_at, v_expires_at, v_duration_days, v_allocated, v_consumed
    FROM public.organization_entitlements
    WHERE organization_id = p_org_id;

    -- If not provisioned at all, provision in NOT_STARTED state first
    IF v_status IS NULL THEN
        PERFORM public.provision_organization_trial(p_org_id, 30, 30);

        SELECT status, started_at, expires_at, duration_days, allocated_requests, consumed_requests
        INTO v_status, v_started_at, v_expires_at, v_duration_days, v_allocated, v_consumed
        FROM public.organization_entitlements
        WHERE organization_id = p_org_id;
    END IF;

    -- Idempotent check: if already ACTIVE, do not modify or extend timestamps!
    IF v_status = 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'success', true,
            'status', 'ACTIVE',
            'already_active', true,
            'started_at', v_started_at,
            'expires_at', v_expires_at,
            'allocated_requests', v_allocated,
            'consumed_requests', v_consumed
        );
    END IF;

    -- If trial has already concluded (EXHAUSTED, EXPIRED, ENDED) or is SUSPENDED, repeated start cannot reset/extend trial!
    IF v_status IN ('EXPIRED', 'EXHAUSTED', 'ENDED', 'SUSPENDED') THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'CANNOT_REACTIVATE',
            'status', v_status,
            'started_at', v_started_at,
            'expires_at', v_expires_at
        );
    END IF;

    -- Status must be 'NOT_STARTED' to activate
    v_started_at := now();
    v_expires_at := v_started_at + (COALESCE(v_duration_days, 30) || ' days')::INTERVAL;

    UPDATE public.organization_entitlements
    SET status = 'ACTIVE',
        started_at = v_started_at,
        expires_at = v_expires_at,
        status_reason = 'Trial explicitly activated by user action',
        updated_at = now()
    WHERE organization_id = p_org_id;

    INSERT INTO public.audit_events (
        organization_id,
        actor_type,
        event_type,
        entity_type,
        entity_id,
        metadata
    )
    VALUES (
        p_org_id,
        'user',
        'trial.activated',
        'organization_entitlement',
        p_org_id,
        jsonb_build_object(
            'startedAt', v_started_at,
            'expiresAt', v_expires_at,
            'allocatedRequests', v_allocated,
            'durationDays', COALESCE(v_duration_days, 30)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'status', 'ACTIVE',
        'already_active', false,
        'started_at', v_started_at,
        'expires_at', v_expires_at,
        'allocated_requests', v_allocated,
        'consumed_requests', v_consumed
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_trial_entitlement(
    p_org_id UUID,
    p_review_request_id UUID,
    p_idempotency_key TEXT,
    p_source_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_allocated INT;
    v_consumed INT;
    v_expires_at TIMESTAMPTZ;
    v_existing_ledger_id UUID;
    v_new_consumed INT;
    v_new_status TEXT;
    v_status_reason TEXT;
BEGIN
    IF p_org_id IS NULL OR p_review_request_id IS NULL OR NULLIF(TRIM(p_idempotency_key), '') IS NULL THEN
        RAISE EXCEPTION 'Invalid input to consume_trial_entitlement';
    END IF;

    -- Concurrency lock per organization
    PERFORM pg_advisory_xact_lock(
        hashtextextended('trial_entitlement:' || p_org_id::text, 0)
    );

    -- 1. Check idempotency: if this exact key was already processed, do not double-consume
    SELECT id
    INTO v_existing_ledger_id
    FROM public.usage_ledger
    WHERE idempotency_key = p_idempotency_key;

    IF v_existing_ledger_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'allowed', true,
            'reason', 'ENTITLEMENT_ALREADY_CONSUMED',
            'already_consumed', true
        );
    END IF;

    -- 2. Fetch current entitlement state
    SELECT status, allocated_requests, consumed_requests, expires_at
    INTO v_status, v_allocated, v_consumed, v_expires_at
    FROM public.organization_entitlements
    WHERE organization_id = p_org_id;

    -- Entitlement must be provisioned and explicitly started; completion cannot auto-start trial
    IF v_status IS NULL OR v_status = 'NOT_STARTED' THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'TRIAL_NOT_ACTIVE',
            'remaining', 0
        );
    END IF;

    -- 3. Check time expiration
    IF v_expires_at IS NOT NULL AND v_expires_at <= now() THEN
        IF v_status <> 'EXPIRED' THEN
            UPDATE public.organization_entitlements
            SET status = 'EXPIRED',
                status_reason = 'Trial duration expired',
                updated_at = now()
            WHERE organization_id = p_org_id;
        END IF;

        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'TRIAL_EXPIRED',
            'remaining', GREATEST(0, v_allocated - v_consumed)
        );
    END IF;

    -- 4. Check request limit / exhaustion
    IF v_status = 'EXHAUSTED' OR v_consumed >= v_allocated THEN
        IF v_status <> 'EXHAUSTED' THEN
            UPDATE public.organization_entitlements
            SET status = 'EXHAUSTED',
                status_reason = 'Request allowance reached',
                updated_at = now()
            WHERE organization_id = p_org_id;
        END IF;

        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'REQUEST_LIMIT_REACHED',
            'remaining', 0
        );
    END IF;

    -- 5. Check active status
    IF v_status <> 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'TRIAL_NOT_ACTIVE',
            'remaining', GREATEST(0, v_allocated - v_consumed)
        );
    END IF;

    -- 6. Grant & Consume exactly one unit
    v_new_consumed := v_consumed + 1;
    IF v_new_consumed >= v_allocated THEN
        v_new_status := 'EXHAUSTED';
        v_status_reason := 'Request allowance reached';
    ELSE
        v_new_status := 'ACTIVE';
        v_status_reason := NULL;
    END IF;

    UPDATE public.organization_entitlements
    SET consumed_requests = v_new_consumed,
        status = v_new_status,
        status_reason = v_status_reason,
        updated_at = now()
    WHERE organization_id = p_org_id;

    -- 7. Record in usage_ledger
    INSERT INTO public.usage_ledger (
        organization_id,
        event_type,
        channel,
        units,
        entity_type,
        entity_id,
        idempotency_key,
        source_event_id,
        metadata
    )
    VALUES (
        p_org_id,
        'initial_request_created',
        'email',
        1,
        'review_request',
        p_review_request_id,
        p_idempotency_key,
        p_source_event_id,
        jsonb_build_object('consumedUnit', 1)
    );

    -- 8. Record estimated workflow cost (100 micro-USD = $0.0001)
    INSERT INTO public.cost_ledger (
        organization_id,
        cost_category,
        cost_status,
        currency,
        amount_micro_usd,
        description
    )
    VALUES (
        p_org_id,
        'workflow_execution',
        'CONFIGURED_ESTIMATE',
        'USD',
        100,
        'Workflow execution estimate for initial review request'
    );

    RETURN jsonb_build_object(
        'allowed', true,
        'reason', 'ENTITLEMENT_GRANTED',
        'already_consumed', false,
        'consumed', v_new_consumed,
        'remaining', v_allocated - v_new_consumed
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_usage_event(
    p_org_id UUID,
    p_event_type TEXT,
    p_channel TEXT,
    p_units INT,
    p_entity_type TEXT,
    p_entity_id UUID,
    p_idempotency_key TEXT,
    p_source_event_id TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ledger_id UUID;
    v_cost_micro_usd BIGINT;
    v_cost_category TEXT;
    v_cost_status TEXT;
BEGIN
    IF p_org_id IS NULL OR p_event_type IS NULL OR p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters to record_usage_event';
    END IF;

    -- Idempotent insert into usage_ledger
    INSERT INTO public.usage_ledger (
        organization_id,
        event_type,
        channel,
        units,
        entity_type,
        entity_id,
        idempotency_key,
        source_event_id,
        metadata
    )
    VALUES (
        p_org_id,
        p_event_type,
        COALESCE(p_channel, 'email'),
        COALESCE(p_units, 1),
        p_entity_type,
        p_entity_id,
        p_idempotency_key,
        p_source_event_id,
        COALESCE(p_metadata, '{}'::jsonb)
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NULL THEN
        RETURN jsonb_build_object('recorded', false, 'reason', 'DUPLICATE_IDEMPOTENCY_KEY');
    END IF;

    -- Attach economic estimate/cost if applicable
    IF p_event_type IN ('provider_send_attempt', 'provider_send_success') THEN
        v_cost_category := 'email_provider';
        v_cost_status := 'CONFIGURED_ESTIMATE';
        v_cost_micro_usd := 1000; -- 1,000 micro-USD = $0.001 per email attempt

        INSERT INTO public.cost_ledger (
            organization_id,
            usage_ledger_id,
            cost_category,
            cost_status,
            currency,
            amount_micro_usd,
            description
        )
        VALUES (
            p_org_id,
            v_ledger_id,
            v_cost_category,
            v_cost_status,
            'USD',
            v_cost_micro_usd,
            'Configured estimate for email provider send operation'
        );
    END IF;

    RETURN jsonb_build_object('recorded', true, 'id', v_ledger_id);
END;
$$;

REVOKE ALL ON FUNCTION public.provision_organization_trial(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_organization_trial(UUID, INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.activate_organization_trial(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_organization_trial(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.consume_trial_entitlement(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_trial_entitlement(UUID, UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.record_usage_event(UUID, TEXT, TEXT, INT, TEXT, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_usage_event(UUID, TEXT, TEXT, INT, TEXT, UUID, TEXT, TEXT, JSONB) TO service_role;

-- Update create_org_with_owner_and_location to provision trial entitlement atomically on onboarding
CREATE OR REPLACE FUNCTION public.create_org_with_owner_and_location(
    p_org_name TEXT,
    p_slug TEXT,
    p_loc_name TEXT,
    p_address TEXT DEFAULT NULL,
    p_country VARCHAR(2) DEFAULT 'CA',
    p_timezone TEXT DEFAULT 'America/Toronto'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_org_id UUID;
    v_loc_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Create organization
    INSERT INTO public.organizations (name, slug, country, timezone, status)
    VALUES (p_org_name, p_slug, p_country, p_timezone, 'ACTIVE')
    RETURNING id INTO v_org_id;

    -- Create OWNER membership
    INSERT INTO public.organization_users (organization_id, user_id, role)
    VALUES (v_org_id, v_user_id, 'OWNER');

    -- Create primary location
    INSERT INTO public.locations (organization_id, name, address, country, timezone, status)
    VALUES (v_org_id, p_loc_name, p_address, p_country, p_timezone, 'ACTIVE')
    RETURNING id INTO v_loc_id;

    -- Provision trial entitlement (MR-4 working hypothesis: 30 requests / 30 days)
    PERFORM public.provision_organization_trial(v_org_id, 30, 30);

    RETURN jsonb_build_object(
        'organization_id', v_org_id,
        'location_id', v_loc_id,
        'user_id', v_user_id,
        'role', 'OWNER'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_org_with_owner_and_location FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_org_with_owner_and_location TO authenticated, service_role;
