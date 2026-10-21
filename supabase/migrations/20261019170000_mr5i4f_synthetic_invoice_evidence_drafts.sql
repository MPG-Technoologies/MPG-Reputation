-- MR-5I4F: immutable-by-privilege, synthetic TEST-only invoice evidence drafts.
--
-- This is NOT a financial ledger, settlement, a provider attestation, a
-- verified frozen checkout contract, or an entitlement source.
-- No invoice PROCESSED success transition / finalization RPC exists here.
-- Deploy only in an authorized synthetic engineering database. PR CI uses
-- its disposable local Supabase; do not apply to hosted or production.
--
-- A unique provider TEST invoice reference rejects a *second staged draft*
-- even when it comes from a different signed Event ID. Future real settlement
-- needs separate independently authenticated provider evidence, accepted
-- immutable terms, a transactionally fenced ledger, reversal handling and
-- owner approval. Never promote these rows into financial truth.
CREATE TABLE public.billing_synthetic_invoice_evidence_drafts (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    organization_id UUID NOT NULL
        REFERENCES public.organizations(id) ON DELETE CASCADE,
    billing_account_id UUID NOT NULL,
    subscription_record_id UUID NOT NULL,
    webhook_event_record_id UUID NOT NULL
        REFERENCES public.billing_webhook_events(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
    environment TEXT NOT NULL DEFAULT 'TEST' CHECK (environment = 'TEST'),
    provider_invoice_id TEXT NOT NULL
        CHECK (provider_invoice_id ~ '^in_[A-Za-z0-9]+$'),
    provider_event_id TEXT NOT NULL
        CHECK (provider_event_id ~ '^evt_[A-Za-z0-9]+$'),
    source_payload_hash TEXT NOT NULL
        CHECK (source_payload_hash ~ '^[a-f0-9]{64}$'),
    candidate_price_id TEXT NOT NULL
        CHECK (candidate_price_id ~ '^price_[A-Za-z0-9]+$'),
    candidate_currency TEXT NOT NULL DEFAULT 'PHP'
        CHECK (candidate_currency = 'PHP'),
    candidate_amount_minor BIGINT NOT NULL CHECK (
        candidate_amount_minor > 0 AND
        candidate_amount_minor <= 9007199254740991
    ),
    candidate_interval TEXT NOT NULL
        CHECK (candidate_interval IN ('month', 'year')),
    candidate_period_start TIMESTAMPTZ NOT NULL,
    candidate_period_end TIMESTAMPTZ NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'SYNTHETIC'
        CHECK (source_kind = 'SYNTHETIC'),
    verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
        CHECK (verification_status = 'UNVERIFIED'),
    financial_finality BOOLEAN NOT NULL DEFAULT false
        CHECK (financial_finality = false),
    access_authorized BOOLEAN NOT NULL DEFAULT false
        CHECK (access_authorized = false),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT mr5i4f_candidate_period_order_check
        CHECK (candidate_period_end > candidate_period_start),
    CONSTRAINT mr5i4f_account_identity_fkey
        FOREIGN KEY (billing_account_id, organization_id, provider, environment)
        REFERENCES public.organization_billing_accounts
            (id, organization_id, provider, environment)
        ON DELETE CASCADE,
    CONSTRAINT mr5i4f_subscription_identity_fkey
        FOREIGN KEY (subscription_record_id, organization_id, provider, environment)
        REFERENCES public.organization_subscriptions
            (id, organization_id, provider, environment)
        ON DELETE CASCADE,
    CONSTRAINT mr5i4f_provider_invoice_once_key
        UNIQUE (provider, environment, provider_invoice_id),
    CONSTRAINT mr5i4f_event_record_once_key
        UNIQUE (webhook_event_record_id)
);

-- The FK locks source existence; this insert-only check separately matches
-- the exact signed event receipt's TEST source ID, hash, invoice and org.
-- Event org NULL is an unassigned receipt and is NOT ownership proof.
-- The private service caller must have sourced the org from the approved
-- tenant/account; this table cannot authenticate provider payment.
CREATE FUNCTION public.validate_mr5i4f_invoice_evidence_draft()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $mr5i4f$
DECLARE
    v_event public.billing_webhook_events%ROWTYPE;
    v_account public.organization_billing_accounts%ROWTYPE;
    v_subscription public.organization_subscriptions%ROWTYPE;
BEGIN
    SELECT * INTO v_event
    FROM public.billing_webhook_events
    WHERE id = NEW.webhook_event_record_id;
    IF NOT FOUND OR
       v_event.provider IS DISTINCT FROM NEW.provider OR
       v_event.environment IS DISTINCT FROM NEW.environment OR
       v_event.event_type <> 'invoice.paid' OR
       v_event.provider_invoice_id IS DISTINCT FROM NEW.provider_invoice_id OR
       v_event.provider_event_id IS DISTINCT FROM NEW.provider_event_id OR
       v_event.payload_hash IS DISTINCT FROM NEW.source_payload_hash OR
       v_event.processing_status NOT IN ('RECEIVED', 'PROCESSING') OR
       v_event.processed_at IS NOT NULL OR
       (v_event.organization_id IS NOT NULL AND
        v_event.organization_id IS DISTINCT FROM NEW.organization_id) THEN
        RAISE EXCEPTION 'MR5I4F_SOURCE_RECEIPT_MISMATCH';
    END IF;

    SELECT * INTO v_account
    FROM public.organization_billing_accounts
    WHERE id = NEW.billing_account_id
      AND organization_id = NEW.organization_id
      AND provider = NEW.provider
      AND environment = NEW.environment;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MR5I4F_ACCOUNT_IDENTITY_MISMATCH';
    END IF;

    SELECT * INTO v_subscription
    FROM public.organization_subscriptions
    WHERE id = NEW.subscription_record_id
      AND organization_id = NEW.organization_id
      AND billing_account_id = NEW.billing_account_id
      AND provider = NEW.provider
      AND environment = NEW.environment;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MR5I4F_SUBSCRIPTION_IDENTITY_MISMATCH';
    END IF;

    IF v_subscription.provider_price_id IS DISTINCT FROM NEW.candidate_price_id THEN
        RAISE EXCEPTION 'MR5I4F_PRICE_PROJECTION_MISMATCH';
    END IF;

    -- Matching current projection is only a *synthetic candidate*. A stored
    -- Price is NOT frozen checkout terms or proof the provider was paid.
    RETURN NEW;
END;
$mr5i4f$;

REVOKE ALL ON FUNCTION public.validate_mr5i4f_invoice_evidence_draft()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_mr5i4f_invoice_evidence_draft()
    TO service_role;

CREATE TRIGGER validate_mr5i4f_invoice_evidence_draft_insert
    BEFORE INSERT ON public.billing_synthetic_invoice_evidence_drafts
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_mr5i4f_invoice_evidence_draft();

CREATE INDEX mr5i4f_org_evidence_recorded_idx
    ON public.billing_synthetic_invoice_evidence_drafts
        (organization_id, recorded_at DESC);

-- The APPEND-ONLY boundary is enforced for ordinary service-role DML by
-- PostgreSQL grants. No UPDATE or DELETE (including service_role), no public,
-- anon or authenticated SELECT/INSERT and no RLS user policy are granted.
-- FK ON DELETE CASCADE remains available for authorized tenant erasure;
-- webhook org ON DELETE SET NULL policy is preserved.
ALTER TABLE public.billing_synthetic_invoice_evidence_drafts
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_synthetic_invoice_evidence_drafts
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.billing_synthetic_invoice_evidence_drafts
    TO service_role;

COMMENT ON TABLE public.billing_synthetic_invoice_evidence_drafts IS
    'MR-5I4F synthetic-only UNVERIFIED candidate evidence; not a financial ledger or source of paid access.';
COMMENT ON COLUMN public.billing_synthetic_invoice_evidence_drafts.financial_finality IS
    'Hard false; neither this record nor any synthetic provider mock proves payment.';
COMMENT ON COLUMN public.billing_synthetic_invoice_evidence_drafts.candidate_amount_minor IS
    'Synthetic amount only; no authenticated frozen checkout terms are available.';
