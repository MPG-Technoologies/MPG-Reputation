-- MR-5B — Billing Persistence & Domain Model
-- Persistence only: no Stripe SDK, checkout, portal, webhook HTTP route, live billing, or entitlement sync.

CREATE TABLE IF NOT EXISTS public.organization_billing_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('stripe')),
    provider_customer_id TEXT NOT NULL CHECK (char_length(trim(provider_customer_id)) > 0),
    environment TEXT NOT NULL DEFAULT 'TEST' CHECK (environment IN ('TEST', 'LIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT organization_billing_accounts_org_provider_env_key
        UNIQUE (organization_id, provider, environment),
    CONSTRAINT organization_billing_accounts_provider_customer_key
        UNIQUE (provider, environment, provider_customer_id),
    CONSTRAINT organization_billing_accounts_id_org_provider_key
        UNIQUE (id, organization_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_organization_billing_accounts_org
    ON public.organization_billing_accounts(organization_id);

CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    billing_account_id UUID NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('stripe')),
    provider_subscription_id TEXT NOT NULL CHECK (char_length(trim(provider_subscription_id)) > 0),
    provider_price_id TEXT CHECK (provider_price_id IS NULL OR char_length(trim(provider_price_id)) > 0),
    provider_status TEXT NOT NULL CHECK (char_length(trim(provider_status)) > 0),
    normalized_status TEXT NOT NULL CHECK (
        normalized_status IN ('PENDING', 'ACTIVE', 'GRACE', 'SUSPENDED', 'ENDED')
    ),
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    canceled_at TIMESTAMPTZ,
    provider_state_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT organization_subscriptions_provider_subscription_key
        UNIQUE (provider, provider_subscription_id),
    CONSTRAINT organization_subscriptions_account_org_provider_fkey
        FOREIGN KEY (billing_account_id, organization_id, provider)
        REFERENCES public.organization_billing_accounts(id, organization_id, provider)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_org
    ON public.organization_subscriptions(organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_status
    ON public.organization_subscriptions(organization_id, normalized_status);

CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL CHECK (provider IN ('stripe')),
    provider_event_id TEXT NOT NULL CHECK (char_length(trim(provider_event_id)) > 0),
    event_type TEXT NOT NULL CHECK (char_length(trim(event_type)) > 0),
    processing_status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (
        processing_status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED')
    ),
    payload_hash TEXT NOT NULL CHECK (char_length(trim(payload_hash)) > 0),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    provider_created_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT billing_webhook_events_provider_event_key
        UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_org_received
    ON public.billing_webhook_events(organization_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_processing
    ON public.billing_webhook_events(processing_status, received_at);

ALTER TABLE public.organization_billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organization_billing_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.organization_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.billing_webhook_events FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.organization_billing_accounts TO service_role;
GRANT ALL ON public.organization_subscriptions TO service_role;
GRANT ALL ON public.billing_webhook_events TO service_role;

GRANT SELECT ON public.organization_billing_accounts TO authenticated;
GRANT SELECT ON public.organization_subscriptions TO authenticated;

CREATE POLICY organization_billing_accounts_select
    ON public.organization_billing_accounts
    FOR SELECT
    TO authenticated
    USING (
        public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN'])
    );

CREATE POLICY organization_subscriptions_select
    ON public.organization_subscriptions
    FOR SELECT
    TO authenticated
    USING (
        public.user_has_role(organization_id, ARRAY['OWNER', 'ADMIN'])
    );

-- billing_webhook_events stays service_role-only.
-- GRACE is persisted as a candidate domain state only; it does not approve a grace-period policy.
