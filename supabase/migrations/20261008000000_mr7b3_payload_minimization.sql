-- ============================================================
-- MR-7B.3: Messaging Payload Minimization
-- 1. Historical domain_event_outbox scrub with fail-closed validation
-- 2. submit_quick_complete_atomic payload minimization
-- 3. submit_completion_system_atomic payload minimization
-- 4. Explicit privilege preservation
-- ============================================================

-- 1. Fail-closed historical validation & outbox payload scrub
DO $$
DECLARE
    v_invalid_count INT;
BEGIN
    -- Verify every existing customer.completed row has all 5 required operational keys
    SELECT count(*)
    INTO v_invalid_count
    FROM public.domain_event_outbox
    WHERE event_type = 'customer.completed'
      AND NOT (
        payload ?& ARRAY['eventId', 'organizationId', 'locationId', 'customerId', 'sourceEventId']
        AND payload->>'eventId' IS NOT NULL AND TRIM(payload->>'eventId') <> ''
        AND payload->>'organizationId' IS NOT NULL AND TRIM(payload->>'organizationId') <> ''
        AND payload->>'locationId' IS NOT NULL AND TRIM(payload->>'locationId') <> ''
        AND payload->>'customerId' IS NOT NULL AND TRIM(payload->>'customerId') <> ''
        AND payload->>'sourceEventId' IS NOT NULL AND TRIM(payload->>'sourceEventId') <> ''
      );

    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION 'Historical outbox scrub validation failed: % customer.completed row(s) missing required operational keys (eventId, organizationId, locationId, customerId, sourceEventId)', v_invalid_count;
    END IF;

    -- Update existing customer.completed rows to contain only the canonical five fields
    UPDATE public.domain_event_outbox
    SET payload = jsonb_build_object(
        'eventId', payload->'eventId',
        'organizationId', payload->'organizationId',
        'locationId', payload->'locationId',
        'customerId', payload->'customerId',
        'sourceEventId', payload->'sourceEventId'
    )
    WHERE event_type = 'customer.completed';
END;
$$;

-- 2. Atomic Quick Complete Procedure with minimized outbox payload
CREATE OR REPLACE FUNCTION public.submit_quick_complete_atomic(
    p_org_id UUID,
    p_loc_id UUID,
    p_first_name TEXT,
    p_last_name TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_permission_email TEXT DEFAULT 'unknown',
    p_permission_sms TEXT DEFAULT 'unknown',
    p_permission_source TEXT DEFAULT 'quick_complete',
    p_source TEXT DEFAULT 'quick_complete',
    p_source_event_id TEXT DEFAULT NULL,
    p_source_customer_id TEXT DEFAULT NULL,
    p_source_transaction_id TEXT DEFAULT NULL,
    p_country VARCHAR(2) DEFAULT 'CA'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_customer_id UUID;
    v_completion_event_id UUID;
    v_outbox_id UUID;
    v_source_event_id TEXT;
    v_completed_at TIMESTAMPTZ := now();
    v_loc_org_id UUID;
    v_clean_email TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Verify caller has operational role in this organization
    IF NOT public.user_has_role(p_org_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']) THEN
        RAISE EXCEPTION 'Access denied: caller does not have operational permissions';
    END IF;

    -- Verify location belongs to organization (cross-tenant check)
    SELECT organization_id INTO v_loc_org_id
    FROM public.locations
    WHERE id = p_loc_id AND organization_id = p_org_id;

    IF v_loc_org_id IS NULL THEN
        RAISE EXCEPTION 'Location does not belong to specified organization';
    END IF;

    -- Resolve source_event_id if not provided
    v_source_event_id := COALESCE(NULLIF(TRIM(p_source_event_id), ''), 'qc_' || gen_random_uuid()::text);
    v_clean_email := NULLIF(TRIM(LOWER(p_email)), '');

    -- Check if customer exists in this org
    IF v_clean_email IS NOT NULL THEN
        SELECT id INTO v_customer_id
        FROM public.customers
        WHERE organization_id = p_org_id AND email = v_clean_email
        LIMIT 1;
    END IF;

    IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (
            organization_id, location_id, first_name, last_name, email, phone,
            permission_email, permission_sms, permission_source
        ) VALUES (
            p_org_id, p_loc_id, TRIM(p_first_name), NULLIF(TRIM(p_last_name), ''),
            v_clean_email, NULLIF(TRIM(p_phone), ''),
            p_permission_email, p_permission_sms, p_permission_source
        )
        RETURNING id INTO v_customer_id;
    ELSE
        IF p_permission_email <> 'unknown' THEN
            UPDATE public.customers
            SET location_id = p_loc_id,
                first_name = COALESCE(NULLIF(TRIM(p_first_name), ''), first_name),
                last_name = COALESCE(NULLIF(TRIM(p_last_name), ''), last_name),
                permission_email = p_permission_email,
                permission_source = p_permission_source,
                updated_at = now()
            WHERE id = v_customer_id;
        END IF;
    END IF;

    -- Insert completion event (guarded by UNIQUE (organization_id, source, source_event_id))
    INSERT INTO public.customer_completion_events (
        organization_id, location_id, customer_id, source, source_event_id,
        source_customer_id, source_transaction_id, completed_at, country, contact, permission
    ) VALUES (
        p_org_id, p_loc_id, v_customer_id, p_source, v_source_event_id,
        p_source_customer_id, p_source_transaction_id, v_completed_at, p_country,
        jsonb_build_object('email', v_clean_email, 'phone', NULLIF(TRIM(p_phone), ''), 'firstName', TRIM(p_first_name), 'lastName', NULLIF(TRIM(p_last_name), '')),
        jsonb_build_object('email', p_permission_email, 'sms', p_permission_sms, 'source', p_permission_source)
    )
    RETURNING id INTO v_completion_event_id;

    -- Insert transactional outbox record (MR-7B.3: Minimized 5-field payload)
    INSERT INTO public.domain_event_outbox (
        organization_id, event_type, aggregate_type, aggregate_id, payload, status
    ) VALUES (
        p_org_id,
        'customer.completed',
        'customer_completion_event',
        v_completion_event_id,
        jsonb_build_object(
            'eventId', v_completion_event_id,
            'organizationId', p_org_id,
            'locationId', p_loc_id,
            'customerId', v_customer_id,
            'sourceEventId', v_source_event_id
        ),
        'PENDING'
    )
    RETURNING id INTO v_outbox_id;

    RETURN jsonb_build_object(
        'customer_id', v_customer_id,
        'completion_event_id', v_completion_event_id,
        'outbox_id', v_outbox_id,
        'source_event_id', v_source_event_id
    );
END;
$$;

-- 3. Atomic System Completion Procedure with minimized outbox payload
CREATE OR REPLACE FUNCTION public.submit_completion_system_atomic(
    p_org_id UUID,
    p_loc_id UUID,
    p_first_name TEXT,
    p_last_name TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_permission_email TEXT DEFAULT 'unknown',
    p_permission_sms TEXT DEFAULT 'unknown',
    p_permission_source TEXT DEFAULT 'api_v1',
    p_source TEXT DEFAULT 'api_v1',
    p_source_event_id TEXT DEFAULT NULL,
    p_source_customer_id TEXT DEFAULT NULL,
    p_source_transaction_id TEXT DEFAULT NULL,
    p_completed_at TIMESTAMPTZ DEFAULT now(),
    p_country VARCHAR(2) DEFAULT 'CA'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_customer_id UUID;
    v_completion_event_id UUID;
    v_outbox_id UUID;
    v_existing_customer_id UUID;
    v_loc_org_id UUID;
    v_clean_email TEXT;
    v_source_event_id TEXT;
    v_completed_at TIMESTAMPTZ;
BEGIN
    IF NULLIF(TRIM(p_source), '') IS NULL THEN
        RAISE EXCEPTION 'Completion source is required';
    END IF;

    v_source_event_id := NULLIF(TRIM(p_source_event_id), '');

    IF v_source_event_id IS NULL THEN
        RAISE EXCEPTION 'Source event ID is required';
    END IF;

    IF NULLIF(TRIM(p_first_name), '') IS NULL THEN
        RAISE EXCEPTION 'First name is required';
    END IF;

    v_clean_email := NULLIF(TRIM(LOWER(p_email)), '');

    IF v_clean_email IS NULL THEN
        RAISE EXCEPTION 'Email is required';
    END IF;

    IF p_permission_email NOT IN ('allowed', 'unknown', 'denied') THEN
        RAISE EXCEPTION 'Invalid email permission state';
    END IF;

    IF p_permission_sms NOT IN ('allowed', 'unknown', 'denied') THEN
        RAISE EXCEPTION 'Invalid SMS permission state';
    END IF;

    IF p_country IS NULL
        OR LENGTH(TRIM(p_country)) <> 2
    THEN
        RAISE EXCEPTION 'Two-character country code is required';
    END IF;

    SELECT organization_id
    INTO v_loc_org_id
    FROM public.locations
    WHERE id = p_loc_id
      AND organization_id = p_org_id;

    IF v_loc_org_id IS NULL THEN
        RAISE EXCEPTION 'Location does not belong to specified organization';
    END IF;

    -- Serialize a single canonical source event across concurrent retries.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            p_org_id::text
            || '|'
            || p_source
            || '|'
            || v_source_event_id,
            0
        )
    );

    -- Idempotent duplicate path before any customer mutation.
    SELECT id, customer_id
    INTO v_completion_event_id, v_existing_customer_id
    FROM public.customer_completion_events
    WHERE organization_id = p_org_id
      AND source = p_source
      AND source_event_id = v_source_event_id
    LIMIT 1;

    IF v_completion_event_id IS NOT NULL THEN
        SELECT id
        INTO v_outbox_id
        FROM public.domain_event_outbox
        WHERE organization_id = p_org_id
          AND aggregate_type = 'customer_completion_event'
          AND aggregate_id = v_completion_event_id
          AND event_type = 'customer.completed'
        ORDER BY created_at ASC
        LIMIT 1;

        RETURN jsonb_build_object(
            'duplicate', true,
            'customer_id', v_existing_customer_id,
            'completion_event_id', v_completion_event_id,
            'outbox_id', v_outbox_id,
            'source_event_id', v_source_event_id
        );
    END IF;

    v_completed_at := COALESCE(p_completed_at, now());

    SELECT id
    INTO v_customer_id
    FROM public.customers
    WHERE organization_id = p_org_id
      AND email = v_clean_email
    LIMIT 1;

    IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (
            organization_id,
            location_id,
            first_name,
            last_name,
            email,
            phone,
            permission_email,
            permission_sms,
            permission_source
        )
        VALUES (
            p_org_id,
            p_loc_id,
            TRIM(p_first_name),
            NULLIF(TRIM(p_last_name), ''),
            v_clean_email,
            NULLIF(TRIM(p_phone), ''),
            p_permission_email,
            p_permission_sms,
            p_permission_source
        )
        RETURNING id INTO v_customer_id;
    ELSE
        UPDATE public.customers
        SET location_id = p_loc_id,
            first_name = COALESCE(
                NULLIF(TRIM(p_first_name), ''),
                first_name
            ),
            last_name = COALESCE(
                NULLIF(TRIM(p_last_name), ''),
                last_name
            ),
            phone = COALESCE(
                NULLIF(TRIM(p_phone), ''),
                phone
            ),
            permission_email = CASE
                WHEN p_permission_email <> 'unknown'
                    THEN p_permission_email
                ELSE permission_email
            END,
            permission_sms = CASE
                WHEN p_permission_sms <> 'unknown'
                    THEN p_permission_sms
                ELSE permission_sms
            END,
            permission_source = CASE
                WHEN p_permission_email <> 'unknown'
                  OR p_permission_sms <> 'unknown'
                    THEN p_permission_source
                ELSE permission_source
            END,
            updated_at = now()
        WHERE id = v_customer_id;
    END IF;

    INSERT INTO public.customer_completion_events (
        organization_id,
        location_id,
        customer_id,
        source,
        source_event_id,
        source_customer_id,
        source_transaction_id,
        completed_at,
        country,
        contact,
        permission
    )
    VALUES (
        p_org_id,
        p_loc_id,
        v_customer_id,
        p_source,
        v_source_event_id,
        NULLIF(TRIM(p_source_customer_id), ''),
        NULLIF(TRIM(p_source_transaction_id), ''),
        v_completed_at,
        UPPER(TRIM(p_country)),
        jsonb_build_object(
            'email', v_clean_email,
            'phone', NULLIF(TRIM(p_phone), ''),
            'firstName', TRIM(p_first_name),
            'lastName', NULLIF(TRIM(p_last_name), '')
        ),
        jsonb_build_object(
            'email', p_permission_email,
            'sms', p_permission_sms,
            'source', p_permission_source
        )
    )
    RETURNING id INTO v_completion_event_id;

    -- Insert transactional outbox record (MR-7B.3: Minimized 5-field payload)
    INSERT INTO public.domain_event_outbox (
        organization_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload,
        status
    )
    VALUES (
        p_org_id,
        'customer.completed',
        'customer_completion_event',
        v_completion_event_id,
        jsonb_build_object(
            'eventId', v_completion_event_id,
            'organizationId', p_org_id,
            'locationId', p_loc_id,
            'customerId', v_customer_id,
            'sourceEventId', v_source_event_id
        ),
        'PENDING'
    )
    RETURNING id INTO v_outbox_id;

    RETURN jsonb_build_object(
        'duplicate', false,
        'customer_id', v_customer_id,
        'completion_event_id', v_completion_event_id,
        'outbox_id', v_outbox_id,
        'source_event_id', v_source_event_id
    );
END;
$$;

-- 4. Explicitly preserve RPC privileges
-- submit_quick_complete_atomic:
-- anon EXECUTE = false
-- authenticated EXECUTE = true
-- service_role EXECUTE = true
REVOKE ALL ON FUNCTION public.submit_quick_complete_atomic(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, VARCHAR
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_quick_complete_atomic(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, VARCHAR
) TO authenticated, service_role;

-- submit_completion_system_atomic:
-- anon EXECUTE = false
-- authenticated EXECUTE = false
-- service_role EXECUTE = true
REVOKE ALL ON FUNCTION public.submit_completion_system_atomic(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, VARCHAR
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_completion_system_atomic(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, VARCHAR
) TO service_role;
