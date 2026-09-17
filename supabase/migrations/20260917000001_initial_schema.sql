-- MPG Reputation v0.1 Initial Schema Migration
-- Authoritative definition matching PRD section 14 and docs/DATA-MODEL.md

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_id
  FROM public.organization_users
  WHERE user_id = auth.uid();
$$;

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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_locations_org_id ON public.locations(organization_id);

-- 4. customers
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    permission_email TEXT NOT NULL DEFAULT 'allowed' CHECK (permission_email IN ('allowed', 'unknown', 'denied')),
    permission_sms TEXT NOT NULL DEFAULT 'unknown' CHECK (permission_sms IN ('allowed', 'unknown', 'denied')),
    permission_source TEXT NOT NULL DEFAULT 'quick_complete',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_org_id ON public.customers(organization_id);
CREATE INDEX IF NOT EXISTS idx_customers_loc_id ON public.customers(location_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers(organization_id, email);

-- 5. customer_completion_events
CREATE TABLE IF NOT EXISTS public.customer_completion_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    source_customer_id TEXT,
    source_transaction_id TEXT,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    country VARCHAR(2) NOT NULL DEFAULT 'CA',
    contact JSONB NOT NULL DEFAULT '{}'::jsonb,
    permission JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, source, source_event_id)
);
CREATE INDEX IF NOT EXISTS idx_cce_org_id ON public.customer_completion_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_cce_customer_id ON public.customer_completion_events(customer_id);

-- 6. review_destinations
CREATE TABLE IF NOT EXISTS public.review_destinations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
    url TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'INACTIVE')),
    confirmed_by UUID,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (location_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_dest_org_id ON public.review_destinations(organization_id);
CREATE INDEX IF NOT EXISTS idx_dest_loc_id ON public.review_destinations(location_id);

-- 7. review_requests
CREATE TABLE IF NOT EXISTS public.review_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    completion_event_id UUID NOT NULL REFERENCES public.customer_completion_events(id) ON DELETE CASCADE,
    destination_id UUID REFERENCES public.review_destinations(id) ON DELETE SET NULL,
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
    UNIQUE (completion_event_id, channel)
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

-- 12. audit_events
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
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- POLICIES: organization_users
CREATE POLICY org_users_select ON public.organization_users
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY org_users_insert ON public.organization_users
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() OR organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY org_users_update ON public.organization_users
    FOR UPDATE TO authenticated
    USING (organization_id IN (SELECT public.user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY org_users_delete ON public.organization_users
    FOR DELETE TO authenticated
    USING (organization_id IN (SELECT public.user_org_ids()));

-- POLICIES: organizations
CREATE POLICY orgs_select ON public.organizations
    FOR SELECT TO authenticated
    USING (id IN (SELECT public.user_org_ids()));

CREATE POLICY orgs_insert ON public.organizations
    FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY orgs_update ON public.organizations
    FOR UPDATE TO authenticated
    USING (id IN (SELECT public.user_org_ids()))
    WITH CHECK (id IN (SELECT public.user_org_ids()));

-- MACRO POLICIES FOR TENANT DATA TABLES
-- locations
CREATE POLICY locations_select ON public.locations FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY locations_insert ON public.locations FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY locations_update ON public.locations FOR UPDATE TO authenticated USING (organization_id IN (SELECT public.user_org_ids())) WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY locations_delete ON public.locations FOR DELETE TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));

-- customers
CREATE POLICY customers_select ON public.customers FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY customers_insert ON public.customers FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY customers_update ON public.customers FOR UPDATE TO authenticated USING (organization_id IN (SELECT public.user_org_ids())) WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY customers_delete ON public.customers FOR DELETE TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));

-- customer_completion_events
CREATE POLICY cce_select ON public.customer_completion_events FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY cce_insert ON public.customer_completion_events FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY cce_update ON public.customer_completion_events FOR UPDATE TO authenticated USING (organization_id IN (SELECT public.user_org_ids())) WITH CHECK (organization_id IN (SELECT public.user_org_ids()));

-- review_destinations
CREATE POLICY dest_select ON public.review_destinations FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY dest_insert ON public.review_destinations FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY dest_update ON public.review_destinations FOR UPDATE TO authenticated USING (organization_id IN (SELECT public.user_org_ids())) WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY dest_delete ON public.review_destinations FOR DELETE TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));

-- review_requests
CREATE POLICY rr_select ON public.review_requests FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY rr_insert ON public.review_requests FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY rr_update ON public.review_requests FOR UPDATE TO authenticated USING (organization_id IN (SELECT public.user_org_ids())) WITH CHECK (organization_id IN (SELECT public.user_org_ids()));

-- review_request_events
CREATE POLICY rre_select ON public.review_request_events FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY rre_insert ON public.review_request_events FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.user_org_ids()));

-- message_events
CREATE POLICY me_select ON public.message_events FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY me_insert ON public.message_events FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.user_org_ids()));

-- suppressions
CREATE POLICY sup_select ON public.suppressions FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY sup_insert ON public.suppressions FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY sup_delete ON public.suppressions FOR DELETE TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));

-- organization_usage
CREATE POLICY usage_select ON public.organization_usage FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY usage_insert ON public.organization_usage FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY usage_update ON public.organization_usage FOR UPDATE TO authenticated USING (organization_id IN (SELECT public.user_org_ids())) WITH CHECK (organization_id IN (SELECT public.user_org_ids()));

-- audit_events
CREATE POLICY audit_select ON public.audit_events FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY audit_insert ON public.audit_events FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
