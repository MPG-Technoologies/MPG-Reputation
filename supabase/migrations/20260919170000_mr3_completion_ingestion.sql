-- MR-3A.1 — Secure Completion Ingestion Foundation
-- Public API credentials, replay/rate-limit claims, ingestion audit,
-- and service-role-only atomic completion persistence.
--
-- This migration does NOT enable a public API endpoint by itself.

-- ============================================================
-- 1. API credentials
-- ============================================================

CREATE TABLE IF NOT EXISTS public.completion_api_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL
        REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Completion API',
    secret_hash TEXT NOT NULL
        CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'REVOKED')),
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 60
        CHECK (
            rate_limit_per_minute >= 1
            AND rate_limit_per_minute <= 10000
        ),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_completion_api_credentials_org
    ON public.completion_api_credentials(organization_id);

CREATE INDEX IF NOT EXISTS idx_completion_api_credentials_active
    ON public.completion_api_credentials(organization_id, status);


-- ============================================================
-- 2. Ingestion request audit / replay claims
--
-- Do not store the raw customer payload here. The body hash gives
-- us correlation/debugging evidence without duplicating PII.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.completion_ingestion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL
        REFERENCES public.organizations(id) ON DELETE CASCADE,
    credential_id UUID NOT NULL
        REFERENCES public.completion_api_credentials(id) ON DELETE RESTRICT,
    nonce TEXT NOT NULL,
    request_timestamp TIMESTAMPTZ NOT NULL,
    request_body_hash TEXT NOT NULL
        CHECK (request_body_hash ~ '^[0-9a-f]{64}$'),
    source_event_id TEXT,
    location_id UUID,
    completion_event_id UUID,
    status TEXT NOT NULL DEFAULT 'CLAIMED'
        CHECK (
            status IN (
                'CLAIMED',
                'ACCEPTED',
                'DUPLICATE',
                'REJECTED',
                'FAILED'
            )
        ),
    http_status INTEGER,
    error_code TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (credential_id, nonce),

    CONSTRAINT fk_completion_ingestion_location
        FOREIGN KEY (location_id, organization_id)
        REFERENCES public.locations(id, organization_id)
        ON DELETE SET NULL (location_id),

    CONSTRAINT fk_completion_ingestion_event
        FOREIGN KEY (completion_event_id, organization_id)
        REFERENCES public.customer_completion_events(id, organization_id)
        ON DELETE SET NULL (completion_event_id)
);

CREATE INDEX IF NOT EXISTS idx_completion_ingestion_org_created
    ON public.completion_ingestion_requests(
        organization_id,
        created_at DESC
    );

CREATE INDEX IF NOT EXISTS idx_completion_ingestion_source_event
    ON public.completion_ingestion_requests(
        organization_id,
        source_event_id
    )
    WHERE source_event_id IS NOT NULL;


-- ============================================================
-- 3. Protect both system-owned tables
-- ============================================================

ALTER TABLE public.completion_api_credentials
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.completion_ingestion_requests
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL
    ON public.completion_api_credentials
    FROM PUBLIC, anon, authenticated;

REVOKE ALL
    ON public.completion_ingestion_requests
    FROM PUBLIC, anon, authenticated;

GRANT ALL
    ON public.completion_api_credentials
    TO service_role;

GRANT ALL
    ON public.completion_ingestion_requests
    TO service_role;


-- ============================================================
-- 4. Atomic replay + per-tenant rate-limit claim
--
-- Advisory locking serializes claims for one organization so
-- concurrent requests cannot bypass the per-minute limit.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_completion_ingestion(
    p_org_id UUID,
    p_credential_id UUID,
    p_nonce TEXT,
    p_request_timestamp TIMESTAMPTZ,
    p_request_body_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_credential_org UUID;
    v_credential_status TEXT;
    v_rate_limit INTEGER;
    v_existing_id UUID;
    v_request_count INTEGER;
    v_ingestion_id UUID;
BEGIN
    IF p_org_id IS NULL
        OR p_credential_id IS NULL
        OR NULLIF(TRIM(p_nonce), '') IS NULL
        OR p_request_timestamp IS NULL
        OR p_request_body_hash !~ '^[0-9a-f]{64}$'
    THEN
        RAISE EXCEPTION 'Invalid ingestion claim input';
    END IF;

    SELECT organization_id, status, rate_limit_per_minute
    INTO v_credential_org, v_credential_status, v_rate_limit
    FROM public.completion_api_credentials
    WHERE id = p_credential_id;

    IF v_credential_org IS NULL
        OR v_credential_org <> p_org_id
        OR v_credential_status <> 'ACTIVE'
    THEN
        RAISE EXCEPTION 'Invalid completion API credential';
    END IF;

    IF v_rate_limit IS NULL
        OR v_rate_limit < 1
        OR v_rate_limit > 10000
    THEN
        RAISE EXCEPTION 'Invalid stored ingestion rate limit';
    END IF;

    -- Defense in depth. HTTP handler will enforce the same window.
    IF p_request_timestamp < now() - INTERVAL '5 minutes'
        OR p_request_timestamp > now() + INTERVAL '5 minutes'
    THEN
        RETURN jsonb_build_object(
            'accepted', false,
            'replay', false,
            'rate_limited', false,
            'stale', true,
            'ingestion_id', NULL
        );
    END IF;

    -- Serialize all claims for one organization.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'completion-ingestion:' || p_org_id::text,
            0
        )
    );

    -- Exact nonce replay protection.
    SELECT id
    INTO v_existing_id
    FROM public.completion_ingestion_requests
    WHERE credential_id = p_credential_id
      AND nonce = p_nonce
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'accepted', false,
            'replay', true,
            'rate_limited', false,
            'stale', false,
            'ingestion_id', v_existing_id
        );
    END IF;

    -- Strict organization-wide sliding one-minute claim count.
    SELECT COUNT(*)
    INTO v_request_count
    FROM public.completion_ingestion_requests
    WHERE organization_id = p_org_id
      AND created_at >= now() - INTERVAL '1 minute';

    IF v_request_count >= v_rate_limit THEN
        RETURN jsonb_build_object(
            'accepted', false,
            'replay', false,
            'rate_limited', true,
            'stale', false,
            'ingestion_id', NULL
        );
    END IF;

    INSERT INTO public.completion_ingestion_requests (
        organization_id,
        credential_id,
        nonce,
        request_timestamp,
        request_body_hash,
        status
    )
    VALUES (
        p_org_id,
        p_credential_id,
        p_nonce,
        p_request_timestamp,
        p_request_body_hash,
        'CLAIMED'
    )
    RETURNING id INTO v_ingestion_id;

    UPDATE public.completion_api_credentials
    SET last_used_at = now(),
        updated_at = now()
    WHERE id = p_credential_id;

    RETURN jsonb_build_object(
        'accepted', true,
        'replay', false,
        'rate_limited', false,
        'stale', false,
        'ingestion_id', v_ingestion_id
    );
END;
$$;

REVOKE ALL
    ON FUNCTION public.claim_completion_ingestion(
        UUID,
        UUID,
        TEXT,
        TIMESTAMPTZ,
        TEXT
    )
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
    ON FUNCTION public.claim_completion_ingestion(
        UUID,
        UUID,
        TEXT,
        TIMESTAMPTZ,
        TEXT
    )
    TO service_role;


-- ============================================================
-- 5. Service-role completion persistence
--
-- Uses the exact existing customer_completion_events +
-- domain_event_outbox path.
--
-- This is separate from submit_quick_complete_atomic because the
-- latter intentionally requires auth.uid() and operational user
-- membership.
-- ============================================================

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
            'completedAt', v_completed_at,
            'country', UPPER(TRIM(p_country)),
            'contact', jsonb_build_object(
                'email', v_clean_email,
                'phone', NULLIF(TRIM(p_phone), ''),
                'firstName', TRIM(p_first_name),
                'lastName', NULLIF(TRIM(p_last_name), '')
            ),
            'permission', jsonb_build_object(
                'email', p_permission_email,
                'sms', p_permission_sms,
                'source', p_permission_source
            ),
            'source', p_source,
            'sourceEventId', v_source_event_id,
            'sourceCustomerId', NULLIF(
                TRIM(p_source_customer_id),
                ''
            ),
            'sourceTransactionId', NULLIF(
                TRIM(p_source_transaction_id),
                ''
            )
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

REVOKE ALL
    ON FUNCTION public.submit_completion_system_atomic(
        UUID,
        UUID,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TIMESTAMPTZ,
        VARCHAR
    )
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
    ON FUNCTION public.submit_completion_system_atomic(
        UUID,
        UUID,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TEXT,
        TIMESTAMPTZ,
        VARCHAR
    )
    TO service_role;
