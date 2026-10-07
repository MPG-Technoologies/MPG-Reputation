-- Migration: 20261007000000_mr7b1_authority_evidence.sql
-- Description: MR-7B.1 Authority Evidence Foundation + Send-Time Suppression Invariant
-- 1. Create public.messaging_authority_evidence for operational permission assertions observed by MPG Reputation
-- 2. Enforce strict system-only RLS on messaging_authority_evidence
-- 3. Hardening: drop sup_delete policy so authenticated users cannot directly delete suppressions
-- 4. Automatically record email & sms operational authority evidence on customer_completion_events insertion

-- 1. Table: messaging_authority_evidence
CREATE TABLE IF NOT EXISTS public.messaging_authority_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES public.organizations(id) ON DELETE CASCADE,

    customer_id UUID NOT NULL,

    completion_event_id UUID NOT NULL,

    channel TEXT NOT NULL
        CHECK (channel IN ('email', 'sms')),

    asserted_state TEXT NOT NULL
        CHECK (asserted_state IN ('allowed', 'unknown', 'denied')),

    assertion_kind TEXT NOT NULL
        DEFAULT 'OPERATIONAL_PERMISSION_STATE'
        CHECK (
            assertion_kind IN ('OPERATIONAL_PERMISSION_STATE')
        ),

    permission_source TEXT NOT NULL,

    completion_source TEXT NOT NULL,

    source_event_id TEXT NOT NULL,

    country VARCHAR(2),

    asserted_at TIMESTAMPTZ,

    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    basis_type TEXT,

    capture_method TEXT,

    evidence_reference TEXT,

    policy_version TEXT,

    actor_type TEXT NOT NULL DEFAULT 'system',

    actor_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (
        organization_id,
        completion_event_id,
        channel
    ),

    CONSTRAINT fk_mae_customer
        FOREIGN KEY (
            customer_id,
            organization_id
        )
        REFERENCES public.customers(
            id,
            organization_id
        )
        ON DELETE CASCADE,

    CONSTRAINT fk_mae_completion
        FOREIGN KEY (
            completion_event_id,
            organization_id
        )
        REFERENCES public.customer_completion_events(
            id,
            organization_id
        )
        ON DELETE CASCADE
);

-- Indexes for tenant/customer/channel query patterns
CREATE INDEX IF NOT EXISTS idx_mae_org_customer_channel_created
ON public.messaging_authority_evidence (
    organization_id,
    customer_id,
    channel,
    created_at DESC
);

CREATE INDEX IF NOT EXISTS idx_mae_org_completion_event
ON public.messaging_authority_evidence (
    organization_id,
    completion_event_id
);

-- 2. RLS & Privileges: messaging_authority_evidence
-- Strictly service-role / system-controlled.
-- Explicitly revoke all table permissions from PUBLIC, anon, and authenticated.
ALTER TABLE public.messaging_authority_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.messaging_authority_evidence FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.messaging_authority_evidence TO service_role;

-- 3. Hardening: Drop sup_delete policy and REVOKE DELETE on public.suppressions
-- Prevents OWNER and ADMIN from directly deleting suppression rows.
-- Suppression removal requires explicit, audited re-authorization workflows.
DROP POLICY IF EXISTS sup_delete ON public.suppressions;
REVOKE DELETE ON public.suppressions FROM authenticated;

-- 4. Authority Evidence Capture Trigger Function
CREATE OR REPLACE FUNCTION public.record_messaging_authority_evidence_from_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_email_state TEXT;
    v_sms_state TEXT;
    v_permission_source TEXT;
BEGIN
    -- Derive Email asserted state: accepted values 'allowed', 'denied', 'unknown'; fallback to 'unknown'
    v_email_state := LOWER(TRIM(COALESCE(NEW.permission->>'email', '')));
    IF v_email_state NOT IN ('allowed', 'denied', 'unknown') THEN
        v_email_state := 'unknown';
    END IF;

    -- Derive SMS asserted state: accepted values 'allowed', 'denied', 'unknown'; fallback to 'unknown'
    v_sms_state := LOWER(TRIM(COALESCE(NEW.permission->>'sms', '')));
    IF v_sms_state NOT IN ('allowed', 'denied', 'unknown') THEN
        v_sms_state := 'unknown';
    END IF;

    -- Derive permission source: prefer NEW.permission->>'source', fallback to NEW.source, then 'unspecified'
    v_permission_source := COALESCE(
        NULLIF(TRIM(NEW.permission->>'source'), ''),
        NULLIF(TRIM(NEW.source), ''),
        'unspecified'
    );

    -- Insert Email authority evidence (asserted_at is NULL because original capture timestamp is not certified)
    INSERT INTO public.messaging_authority_evidence (
        organization_id,
        customer_id,
        completion_event_id,
        channel,
        asserted_state,
        assertion_kind,
        permission_source,
        completion_source,
        source_event_id,
        country,
        asserted_at,
        observed_at,
        basis_type,
        capture_method,
        evidence_reference,
        policy_version,
        actor_type,
        actor_id,
        created_at
    ) VALUES (
        NEW.organization_id,
        NEW.customer_id,
        NEW.id,
        'email',
        v_email_state,
        'OPERATIONAL_PERMISSION_STATE',
        v_permission_source,
        NEW.source,
        NEW.source_event_id,
        NEW.country,
        NULL,
        now(),
        NULL,
        'completion_event_assertion',
        NEW.source_event_id,
        NULL,
        'system',
        NULL,
        now()
    )
    ON CONFLICT (organization_id, completion_event_id, channel) DO NOTHING;

    -- Insert SMS authority evidence (asserted_at is NULL because original capture timestamp is not certified)
    INSERT INTO public.messaging_authority_evidence (
        organization_id,
        customer_id,
        completion_event_id,
        channel,
        asserted_state,
        assertion_kind,
        permission_source,
        completion_source,
        source_event_id,
        country,
        asserted_at,
        observed_at,
        basis_type,
        capture_method,
        evidence_reference,
        policy_version,
        actor_type,
        actor_id,
        created_at
    ) VALUES (
        NEW.organization_id,
        NEW.customer_id,
        NEW.id,
        'sms',
        v_sms_state,
        'OPERATIONAL_PERMISSION_STATE',
        v_permission_source,
        NEW.source,
        NEW.source_event_id,
        NEW.country,
        NULL,
        now(),
        NULL,
        'completion_event_assertion',
        NEW.source_event_id,
        NULL,
        'system',
        NULL,
        now()
    )
    ON CONFLICT (organization_id, completion_event_id, channel) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
public.record_messaging_authority_evidence_from_completion()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.record_messaging_authority_evidence_from_completion()
TO service_role;

DROP TRIGGER IF EXISTS trg_record_messaging_authority_evidence ON public.customer_completion_events;

CREATE TRIGGER trg_record_messaging_authority_evidence
AFTER INSERT ON public.customer_completion_events
FOR EACH ROW
EXECUTE FUNCTION public.record_messaging_authority_evidence_from_completion();
