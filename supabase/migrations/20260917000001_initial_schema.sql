-- MPG Reputation v0.1 Initial Schema Migration
-- Authoritative definition matching PRD section 14 and docs/DATA-MODEL.md
-- Hardened for role-aware RLS, cross-tenant composite integrity, atomic onboarding & outbox

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. organizations
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    country VARCHAR(2) NOT NULL DEFAULT 'CA',
    timezone TEXT NOT NULL DEFAULT 'America/Toronto',
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. organization_users
CREATE TABLE IF NOT EXISTS public.organization_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'OPERATOR' CHECK (role IN ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_users_user_id ON public.organization_users(user_id);
CREATE INDEX IF NOT EXISTS idx_org_users_org_id ON public.organization_users(organization_id);

-- Helper functions for RLS (placed after organization_users table definition)
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT organization_id
  FROM public.organization_users
  WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.user_has_role(org_id UUID, allowed_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_users
    WHERE user_id = auth.uid()
      AND organization_id = org_id
      AND role = ANY(allowed_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.user_role(org_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM public.organization_users
  WHERE user_id = auth.uid()
    AND organization_id = org_id;
$$;

-- 3. locations
CREATE TABLE IF NOT EXISTS public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT,
    country VARCHAR(2) NOT NULL DEFAULT 'CA',
    timezone TEXT NOT NULL DEFAULT 'America/Toronto',
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_locations_org_id ON public.locations(organization_id);

-- 4. customers
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    permission_email TEXT NOT NULL DEFAULT 'unknown' CHECK (permission_email IN ('allowed', 'unknown', 'denied')),
    permission_sms TEXT NOT NULL DEFAULT 'unknown' CHECK (permission_sms IN ('allowed', 'unknown', 'denied')),
    permission_source TEXT NOT NULL DEFAULT 'quick_complete',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id),
    CONSTRAINT fk_customer_location FOREIGN KEY (location_id, organization_id)
        REFERENCES public.locations(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_customers_org_id ON public.customers(organization_id);
CREATE INDEX IF NOT EXISTS idx_customers_loc_id ON public.customers(location_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers(organization_id, email);

-- 5. customer_completion_events
CREATE TABLE IF NOT EXISTS public.customer_completion_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    source TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    source_customer_id TEXT,
    source_transaction_id TEXT,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    country VARCHAR(2) NOT NULL DEFAULT 'CA',
    contact JSONB NOT NULL DEFAULT '{}'::jsonb,
    permission JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id),
    UNIQUE (organization_id, source, source_event_id),
    CONSTRAINT fk_cce_location FOREIGN KEY (location_id, organization_id)
        REFERENCES public.locations(id, organization_id) ON DELETE CASCADE,
    CONSTRAINT fk_cce_customer FOREIGN KEY (customer_id, organization_id)
        REFERENCES public.customers(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cce_org_id ON public.customer_completion_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_cce_customer_id ON public.customer_completion_events(customer_id);

-- 6. review_destinations
CREATE TABLE IF NOT EXISTS public.review_destinations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL,
    provider TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
    url TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'INACTIVE')),
    confirmed_by UUID,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id),
    UNIQUE (location_id, provider),
    CONSTRAINT fk_dest_location FOREIGN KEY (location_id, organization_id)
        REFERENCES public.locations(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dest_org_id ON public.review_destinations(organization_id);
CREATE INDEX IF NOT EXISTS idx_dest_loc_id ON public.review_destinations(location_id);

-- 7. review_requests
CREATE TABLE IF NOT EXISTS public.review_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    completion_event_id UUID NOT NULL,
    destination_id UUID,
    channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
    status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'SENDING', 'SENT', 'DELIVERED', 'CLICKED', 'FAILED', 'CANCELLED', 'SUPPRESSED')),
    token TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id),
    UNIQUE (completion_event_id, channel),
    CONSTRAINT fk_rr_location FOREIGN KEY (location_id, organization_id)
        REFERENCES public.locations(id, organization_id) ON DELETE CASCADE,
    CONSTRAINT fk_rr_customer FOREIGN KEY (customer_id, organization_id)
        REFERENCES public.customers(id, organization_id) ON DELETE CASCADE,
    CONSTRAINT fk_rr_completion_event FOREIGN KEY (completion_event_id, organization_id)
        REFERENCES public.customer_completion_events(id, organization_id) ON DELETE CASCADE,
    CONSTRAINT fk_rr_destination FOREIGN KEY (destination_id, organization_id)
        REFERENCES public.review_destinations(id, organization_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_rr_org_id ON public.review_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_rr_token ON public.review_requests(token);
CREATE INDEX IF NOT EXISTS idx_rr_token_hash ON public.review_requests(token_hash);
CREATE INDEX IF NOT EXISTS idx_rr_status ON public.review_requests(organization_id, status);

-- 8. review_request_events
CREATE TABLE IF NOT EXISTS public.review_request_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    review_request_id UUID NOT NULL REFERENCES public.review_requests(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    idempotency_key TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rre_org_id ON public.review_request_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_rre_req_id ON public.review_request_events(review_request_id);

-- 9. message_events
CREATE TABLE IF NOT EXISTS public.message_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    review_request_id UUID NOT NULL REFERENCES public.review_requests(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_message_id TEXT,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    sanitized_error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_me_org_id ON public.message_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_me_req_id ON public.message_events(review_request_id);

-- 10. suppressions
CREATE TABLE IF NOT EXISTS public.suppressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    channel TEXT NOT NULL DEFAULT 'email',
    contact_hash TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'UNSUBSCRIBE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, channel, contact_hash)
);
CREATE INDEX IF NOT EXISTS idx_sup_lookup ON public.suppressions(organization_id, channel, contact_hash);

-- 11. organization_usage
CREATE TABLE IF NOT EXISTS public.organization_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    metric TEXT NOT NULL,
    value BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, period, metric)
);
CREATE INDEX IF NOT EXISTS idx_usage_org_id ON public.organization_usage(organization_id);

-- 12. domain_event_outbox (Prompt Correction 9: Transactional Outbox)
CREATE TABLE IF NOT EXISTS public.domain_event_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'FAILED')),
    attempt_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    dispatched_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_org_status ON public.domain_event_outbox(organization_id, status);

-- 13. audit_events
CREATE TABLE IF NOT EXISTS public.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL,
    actor_id UUID,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_org_id ON public.audit_events(organization_id);

-- ATOMIC STORED PROCEDURES (Prompt Corrections 4 & 19)

-- Atomic Organization Onboarding Procedure
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

    RETURN jsonb_build_object(
        'organization_id', v_org_id,
        'location_id', v_loc_id,
        'user_id', v_user_id,
        'role', 'OWNER'
    );
END;
$$;

-- Atomic Organization Usage Increment Procedure
CREATE OR REPLACE FUNCTION public.increment_organization_usage(
    p_org_id UUID,
    p_period TEXT,
    p_metric TEXT,
    p_amount INT DEFAULT 1
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_val BIGINT;
BEGIN
    INSERT INTO public.organization_usage (organization_id, period, metric, value, updated_at)
    VALUES (p_org_id, p_period, p_metric, p_amount, now())
    ON CONFLICT (organization_id, period, metric)
    DO UPDATE SET
        value = public.organization_usage.value + EXCLUDED.value,
        updated_at = now()
    RETURNING value INTO v_new_val;

    RETURN v_new_val;
END;
$$;

-- ENABLE ROW LEVEL SECURITY
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_completion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- POLICIES: organizations
CREATE POLICY orgs_select ON public.organizations
    FOR SELECT TO authenticated
    USING (id IN (SELECT public.user_org_ids()));

CREATE POLICY orgs_insert ON public.organizations
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY orgs_update ON public.organizations
    FOR UPDATE TO authenticated
    USING (public.user_has_role(id, ARRAY['OWNER', 'ADMIN']))
    WITH CHECK (public.user_has_role(id, ARRAY['OWNER', 'ADMIN']));

CREATE POLICY orgs_delete ON public.organizations
    FOR DELETE TO authenticated
    USING (public.user_has_role(id, ARRAY['OWNER']));

-- POLICIES: organization_users (Prompt Corrections 2 & 3)
CREATE POLICY org_users_select ON public.organization_users
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']));

CREATE POLICY org_users_insert ON public.organization_users
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN']));

CREATE POLICY org_users_update ON public.organization_users
    FOR UPDATE TO authenticated
    USING (
      public.user_has_role(organization_id, ARRAY['OWNER']) OR
      (public.user_has_role(organization_id, ARRAY['ADMIN']) AND role IN ('OPERATOR', 'VIEWER'))
    )
    WITH CHECK (
      public.user_has_role(organization_id, ARRAY['OWNER']) OR
      (public.user_has_role(organization_id, ARRAY['ADMIN']) AND role IN ('OPERATOR', 'VIEWER'))
    );

CREATE POLICY org_users_delete ON public.organization_users
    FOR DELETE TO authenticated
    USING (
      public.user_has_role(organization_id, ARRAY['OWNER']) OR
      (public.user_has_role(organization_id, ARRAY['ADMIN']) AND role IN ('OPERATOR', 'VIEWER'))
    );

-- POLICIES: locations
CREATE POLICY locations_select ON public.locations
    FOR SELECT TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']));

CREATE POLICY locations_insert ON public.locations
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN']));

CREATE POLICY locations_update ON public.locations
    FOR UPDATE TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN']))
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN']));

CREATE POLICY locations_delete ON public.locations
    FOR DELETE TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER']));

-- POLICIES: customers
CREATE POLICY customers_select ON public.customers
    FOR SELECT TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']));

CREATE POLICY customers_insert ON public.customers
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY customers_update ON public.customers
    FOR UPDATE TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']))
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY customers_delete ON public.customers
    FOR DELETE TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN']));

-- POLICIES: customer_completion_events
CREATE POLICY cce_select ON public.customer_completion_events
    FOR SELECT TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']));

CREATE POLICY cce_insert ON public.customer_completion_events
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

-- POLICIES: review_destinations
CREATE POLICY dest_select ON public.review_destinations
    FOR SELECT TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']));

CREATE POLICY dest_insert ON public.review_destinations
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN']));

CREATE POLICY dest_update ON public.review_destinations
    FOR UPDATE TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN']))
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN']));

CREATE POLICY dest_delete ON public.review_destinations
    FOR DELETE TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER']));

-- POLICIES: review_requests
CREATE POLICY rr_select ON public.review_requests
    FOR SELECT TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']));

CREATE POLICY rr_insert ON public.review_requests
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY rr_update ON public.review_requests
    FOR UPDATE TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']))
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

-- POLICIES: review_request_events
CREATE POLICY rre_select ON public.review_request_events
    FOR SELECT TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']));

CREATE POLICY rre_insert ON public.review_request_events
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

-- POLICIES: message_events
CREATE POLICY me_select ON public.message_events
    FOR SELECT TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']));

CREATE POLICY me_insert ON public.message_events
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

-- POLICIES: suppressions
CREATE POLICY sup_select ON public.suppressions
    FOR SELECT TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']));

CREATE POLICY sup_insert ON public.suppressions
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY sup_delete ON public.suppressions
    FOR DELETE TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN']));

-- POLICIES: organization_usage
CREATE POLICY usage_select ON public.organization_usage
    FOR SELECT TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']));

CREATE POLICY usage_insert ON public.organization_usage
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY usage_update ON public.organization_usage
    FOR UPDATE TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']))
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

-- POLICIES: domain_event_outbox
CREATE POLICY outbox_select ON public.domain_event_outbox
    FOR SELECT TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY outbox_insert ON public.domain_event_outbox
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY outbox_update ON public.domain_event_outbox
    FOR UPDATE TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']))
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

-- POLICIES: audit_events
CREATE POLICY audit_select ON public.audit_events
    FOR SELECT TO authenticated
    USING (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']));

CREATE POLICY audit_insert ON public.audit_events
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));
