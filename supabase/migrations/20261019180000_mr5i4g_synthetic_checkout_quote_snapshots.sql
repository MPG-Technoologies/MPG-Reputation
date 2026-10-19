-- MR-5I4G — synthetic TEST-only historical checkout quote snapshot.
-- This is NOT a provider-verified checkout contract, financial ledger,
-- invoice settlement, price acceptance, charge, entitlement or live billing.
-- Repository-only migration; apply in disposable synthetic CI, never hosted.
--
-- Quotes are captured once per existing fenced checkout reservation, not
-- re-derived from mutable MPG_BILLING_* variables when viewed later.
CREATE TABLE public.billing_synthetic_checkout_quote_snapshots (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    billing_account_id UUID NOT NULL,
    checkout_reservation_id UUID NOT NULL,
    provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
    environment TEXT NOT NULL DEFAULT 'TEST' CHECK (environment = 'TEST'),
    plan_id TEXT NOT NULL CHECK (plan_id IN ('monthly','annual')),
    provider_price_id TEXT NOT NULL CHECK (provider_price_id ~ '^price_[A-Za-z0-9]+$'),
    candidate_currency TEXT NOT NULL DEFAULT 'PHP' CHECK (candidate_currency = 'PHP'),
    candidate_amount_minor BIGINT NOT NULL
        CHECK (candidate_amount_minor > 0 AND candidate_amount_minor <= 9007199254740991),
    candidate_interval TEXT NOT NULL CHECK (candidate_interval IN ('month','year')),
    interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count = 1),
    source_kind TEXT NOT NULL DEFAULT 'SYNTHETIC' CHECK (source_kind = 'SYNTHETIC'),
    approval_status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (approval_status = 'PROPOSED'),
    verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
        CHECK (verification_status = 'UNVERIFIED'),
    payment_authorized BOOLEAN NOT NULL DEFAULT false CHECK (payment_authorized = false),
    access_authorized BOOLEAN NOT NULL DEFAULT false CHECK (access_authorized = false),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT mr5i4g_quote_once_per_reservation UNIQUE (checkout_reservation_id),
    CONSTRAINT mr5i4g_quote_account_tenant_fk
        FOREIGN KEY (billing_account_id,organization_id,provider,environment)
        REFERENCES public.organization_billing_accounts(id,organization_id,provider,environment)
        ON DELETE CASCADE,
    CONSTRAINT mr5i4g_quote_reservation_fk
        FOREIGN KEY (checkout_reservation_id)
        REFERENCES public.stripe_test_checkout_reservations(id)
        ON DELETE CASCADE,
    CONSTRAINT mr5i4g_quote_plan_interval_check CHECK (
        (plan_id = 'monthly' AND candidate_interval = 'month') OR
        (plan_id = 'annual' AND candidate_interval = 'year')
    )
);

-- Source admission checks the ACTUAL stored TEST reservation. This cannot
-- authenticate provider Price amounts or grant billing/entitlement authority.
-- The candidate amount is explicitly a synthetic quote proposal.
CREATE FUNCTION public.validate_mr5i4g_checkout_quote_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $mr5i4g$
DECLARE
    v_reservation public.stripe_test_checkout_reservations%ROWTYPE;
BEGIN
    SELECT * INTO v_reservation
    FROM public.stripe_test_checkout_reservations
    WHERE id = NEW.checkout_reservation_id;
    IF NOT FOUND OR
       v_reservation.organization_id IS DISTINCT FROM NEW.organization_id OR
       v_reservation.billing_account_id IS DISTINCT FROM NEW.billing_account_id OR
       v_reservation.provider IS DISTINCT FROM NEW.provider OR
       v_reservation.environment IS DISTINCT FROM NEW.environment OR
       v_reservation.plan_id IS DISTINCT FROM NEW.plan_id OR
       v_reservation.provider_price_id IS DISTINCT FROM NEW.provider_price_id OR
       v_reservation.status NOT IN ('PREPARING','READY') OR
       v_reservation.reservation_expires_at <= pg_catalog.clock_timestamp() THEN
        RAISE EXCEPTION 'MR5I4G_CHECKOUT_RESERVATION_MISMATCH';
    END IF;
    RETURN NEW;
END;
$mr5i4g$;

REVOKE ALL ON FUNCTION public.validate_mr5i4g_checkout_quote_snapshot()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_mr5i4g_checkout_quote_snapshot()
    TO service_role;

CREATE TRIGGER validate_mr5i4g_checkout_quote_snapshot_insert
    BEFORE INSERT ON public.billing_synthetic_checkout_quote_snapshots
    FOR EACH ROW EXECUTE FUNCTION public.validate_mr5i4g_checkout_quote_snapshot();

CREATE INDEX mr5i4g_quote_org_captured_idx
    ON public.billing_synthetic_checkout_quote_snapshots
        (organization_id,captured_at DESC);

ALTER TABLE public.billing_synthetic_checkout_quote_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_synthetic_checkout_quote_snapshots
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.billing_synthetic_checkout_quote_snapshots
    TO service_role;

COMMENT ON TABLE public.billing_synthetic_checkout_quote_snapshots IS
    'MR-5I4G TEST-only proposed immutable historic checkout quote; not an accepted contract or permission to charge.';
COMMENT ON COLUMN public.billing_synthetic_checkout_quote_snapshots.payment_authorized IS
    'Hard false, no payment provider connection or financial authorization.';
