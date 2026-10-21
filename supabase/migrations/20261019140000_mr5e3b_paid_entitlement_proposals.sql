-- MR-5E3B — private proposed paid-entitlement ledger; NO paid access.
-- Repository-only migration for disposable PostgreSQL tests. NOT applied to hosted.
-- The MR-4 organization_entitlements / consume_trial_entitlement policy remains
-- the sole existing request allowance authority (30 Free Review Requests).
--
-- Composite FK locks each proposal to its exact tenant-scoped subscription.
-- A narrowly scoped INSERT trigger validates the source event tenant/identity.
-- The webhook's org link can later be NULLed by its existing ON DELETE SET NULL
-- policy; do not add a composite webhook FK that would break org erasure.
ALTER TABLE public.organization_subscriptions
    ADD CONSTRAINT organization_subscriptions_paid_proposal_identity_key
    UNIQUE (id, organization_id, provider, environment);

CREATE TABLE public.billing_paid_entitlement_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    subscription_record_id UUID NOT NULL,
    webhook_event_record_id UUID NOT NULL,
    provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
    environment TEXT NOT NULL DEFAULT 'TEST' CHECK (environment = 'TEST'),
    proposed_action TEXT NOT NULL CHECK (proposed_action IN (
        'INITIAL_ACTIVATION', 'RENEWAL', 'PAYMENT_DUE',
        'SCHEDULE_CANCELLATION', 'END_AT_PERIOD', 'ESCALATE_FOR_REVIEW'
    )),
    candidate_status TEXT NOT NULL CHECK (candidate_status IN (
        'ACTIVE', 'PAST_DUE', 'CANCEL_AT_PERIOD_END', 'ENDED', 'REVIEW_REQUIRED'
    )),
    candidate_period_end TIMESTAMPTZ NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'SYNTHETIC' CHECK (source_kind = 'SYNTHETIC'),
    verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status = 'UNVERIFIED'),
    access_authorized BOOLEAN NOT NULL DEFAULT false CHECK (access_authorized = false),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT billing_paid_entitlement_proposals_action_status_check CHECK (
        (proposed_action IN ('INITIAL_ACTIVATION', 'RENEWAL') AND candidate_status = 'ACTIVE')
        OR (proposed_action = 'PAYMENT_DUE' AND candidate_status = 'PAST_DUE')
        OR (proposed_action = 'SCHEDULE_CANCELLATION' AND candidate_status = 'CANCEL_AT_PERIOD_END')
        OR (proposed_action = 'END_AT_PERIOD' AND candidate_status = 'ENDED')
        OR (proposed_action = 'ESCALATE_FOR_REVIEW' AND candidate_status = 'REVIEW_REQUIRED')
    ),
    CONSTRAINT billing_paid_entitlement_proposals_subscription_identity_fk
        FOREIGN KEY (subscription_record_id, organization_id, provider, environment)
        REFERENCES public.organization_subscriptions (id, organization_id, provider, environment)
        ON DELETE CASCADE,
    CONSTRAINT billing_paid_entitlement_proposals_webhook_record_fk
        FOREIGN KEY (webhook_event_record_id)
        REFERENCES public.billing_webhook_events (id)
        ON DELETE CASCADE,
    CONSTRAINT billing_paid_entitlement_proposals_event_once_key
        UNIQUE (webhook_event_record_id)
);

-- SOURCE CHECK ON INSERT ONLY. No entitlement activation or payment assertion.
-- A PROCESSED synthetic event is not independent proof of settlement.
CREATE FUNCTION public.validate_billing_paid_entitlement_proposal_source()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $paid_proposal$
DECLARE
    v_event public.billing_webhook_events%ROWTYPE;
BEGIN
    SELECT * INTO v_event
    FROM public.billing_webhook_events
    WHERE id = NEW.webhook_event_record_id;
    IF NOT FOUND OR
       v_event.organization_id IS DISTINCT FROM NEW.organization_id OR
       v_event.provider IS DISTINCT FROM NEW.provider OR
       v_event.environment IS DISTINCT FROM NEW.environment OR
       v_event.processing_status <> 'PROCESSED' OR
       v_event.processed_at IS NULL OR
       v_event.payload_hash !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'BILLING_PAID_PROPOSAL_SOURCE_NOT_VERIFIED';
    END IF;
    IF (NEW.proposed_action IN ('INITIAL_ACTIVATION', 'RENEWAL')
          AND (v_event.event_type <> 'invoice.paid' OR
               v_event.provider_invoice_id IS NULL OR
               v_event.provider_invoice_id !~ '^in_[A-Za-z0-9]+$'))
       OR (NEW.proposed_action = 'PAYMENT_DUE'
          AND v_event.event_type <> 'invoice.payment_failed')
       OR (NEW.proposed_action = 'SCHEDULE_CANCELLATION'
          AND v_event.event_type <> 'customer.subscription.updated')
       OR (NEW.proposed_action = 'END_AT_PERIOD'
          AND v_event.event_type <> 'customer.subscription.deleted')
       OR (NEW.proposed_action = 'ESCALATE_FOR_REVIEW'
          AND v_event.event_type NOT IN (
             'charge.refunded', 'charge.dispute.created', 'invoice.payment_failed'
          )) THEN
        RAISE EXCEPTION 'BILLING_PAID_PROPOSAL_EVENT_TYPE_MISMATCH';
    END IF;
    RETURN NEW;
END;
$paid_proposal$;

REVOKE ALL ON FUNCTION public.validate_billing_paid_entitlement_proposal_source()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_billing_paid_entitlement_proposal_source()
    TO service_role;

CREATE TRIGGER validate_billing_paid_entitlement_proposal_insert
    BEFORE INSERT ON public.billing_paid_entitlement_proposals
    FOR EACH ROW EXECUTE FUNCTION public.validate_billing_paid_entitlement_proposal_source();

CREATE INDEX billing_paid_entitlement_proposals_org_recorded_idx
    ON public.billing_paid_entitlement_proposals (organization_id, recorded_at DESC);

-- Private RLS; service_role can append/inspect only, no direct update/delete.
ALTER TABLE public.billing_paid_entitlement_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_paid_entitlement_proposals
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.billing_paid_entitlement_proposals TO service_role;

COMMENT ON TABLE public.billing_paid_entitlement_proposals IS
    'MR-5E3B synthetic-only staging, never paid access or billing settlement.';
COMMENT ON COLUMN public.billing_paid_entitlement_proposals.access_authorized IS
    'Hard-false safety invariant; even a proposed ACTIVE status is not product access.';
