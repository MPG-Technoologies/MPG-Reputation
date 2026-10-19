-- MR-5E3B — private proposed paid-entitlement ledger; NO paid access.
-- Repository-only migration for disposable PostgreSQL tests. NOT applied to hosted.
-- The MR-4 organization_entitlements / consume_trial_entitlement policy remains
-- the sole existing request allowance authority (30 Free Review Requests).
--
-- Composite FK keys lock every proposal to its exact organization, provider,
-- environment and pre-existing subscription and webhook records.
ALTER TABLE public.organization_subscriptions
    ADD CONSTRAINT organization_subscriptions_paid_proposal_identity_key
    UNIQUE (id, organization_id, provider, environment);

ALTER TABLE public.billing_webhook_events
    ADD CONSTRAINT billing_webhook_events_paid_proposal_identity_key
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
    CONSTRAINT billing_paid_entitlement_proposals_webhook_identity_fk
        FOREIGN KEY (webhook_event_record_id, organization_id, provider, environment)
        REFERENCES public.billing_webhook_events (id, organization_id, provider, environment)
        ON DELETE CASCADE,
    CONSTRAINT billing_paid_entitlement_proposals_event_once_key
        UNIQUE (webhook_event_record_id)
);

CREATE INDEX billing_paid_entitlement_proposals_org_recorded_idx
    ON public.billing_paid_entitlement_proposals (organization_id, recorded_at DESC);

-- No API user may see or manipulate this sensitive proposal store.
-- Service role can append and inspect, but not edit or remove proposals.
-- Referential cascade from a deleted organization remains managed by the DB.
ALTER TABLE public.billing_paid_entitlement_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_paid_entitlement_proposals
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.billing_paid_entitlement_proposals TO service_role;

COMMENT ON TABLE public.billing_paid_entitlement_proposals IS
    'MR-5E3B simulation-only records, not paid entitlement or billing settlement. Requires future owner-approved verification and activation design. Never used by request authorization.';
COMMENT ON COLUMN public.billing_paid_entitlement_proposals.access_authorized IS
    'Hard-false safety invariant. Proposed ACTIVE is not product access.';
