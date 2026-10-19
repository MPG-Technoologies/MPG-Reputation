-- MR-5E3C3B — one immutable private OPEN review case per synthetic
-- subscription exception webhook. Repository-only migration; NOT hosted.
-- Follows existing MR-5D3D3A service-only recovery case privacy/grant pattern,
-- without overloading its CUSTOMER_SETUP/CHECKOUT kinds or per-org unique key.
-- Neither this table nor OPEN means provider truth, financial approval,
-- operational paid entitlement, or authorization for an MPG support decision.
CREATE TABLE public.billing_synthetic_subscription_exception_reviews (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    organization_id UUID NOT NULL
      REFERENCES public.organizations(id) ON DELETE CASCADE,
    subscription_record_id UUID NOT NULL,
    webhook_event_record_id UUID NOT NULL
      REFERENCES public.billing_webhook_events(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
    environment TEXT NOT NULL DEFAULT 'TEST' CHECK (environment = 'TEST'),
    review_reason TEXT NOT NULL CHECK (review_reason IN (
        'HISTORY_INVALID_OR_AMBIGUOUS',
        'EVENT_FINGERPRINT_CONFLICT',
        'OLDER_OR_EQUAL_TIME',
        'INITIAL_SUBSCRIPTION_REQUIRES_REVIEW',
        'UNSUPPORTED_TRANSITION',
        'PAID_PERIOD_NOT_ADVANCED',
        'PAID_PERIOD_INVALID',
        'FAILED_PAYMENT_PERIOD_MISMATCH',
        'REPEATED_PAYMENT_FAILURE',
        'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW',
        'DISPUTE_OR_REFUND_HOLD',
        'CANCELLATION_HOLD',
        'TERMINAL_SUBSCRIPTION_HOLD',
        'END_BEFORE_PAID_PERIOD',
        'REFUND_OR_DISPUTE_REQUIRES_REVIEW'
    )),
    review_state TEXT NOT NULL DEFAULT 'OPEN' CHECK (review_state = 'OPEN'),
    source_kind TEXT NOT NULL DEFAULT 'SYNTHETIC'
      CHECK (source_kind = 'SYNTHETIC'),
    verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
      CHECK (verification_status = 'UNVERIFIED'),
    access_authorized BOOLEAN NOT NULL DEFAULT false
      CHECK (access_authorized = false),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT billing_synthetic_exception_subscription_tenant_fk
      FOREIGN KEY (subscription_record_id, organization_id, provider, environment)
      REFERENCES public.organization_subscriptions
        (id, organization_id, provider, environment) ON DELETE CASCADE,
    CONSTRAINT billing_synthetic_exception_one_case_per_event
      UNIQUE (webhook_event_record_id)
);

CREATE INDEX billing_synthetic_exception_reviews_by_org
  ON public.billing_synthetic_subscription_exception_reviews
  (organization_id, opened_at DESC);

-- The webhook's organization_id becomes NULL on organization erasure.
-- Keep its original independent FK to retain that behavior. Instead validate
-- source tenant at append time; no raw payload, PII, provider ID or event hash
-- is copied into this case table.
CREATE FUNCTION public.validate_billing_synthetic_exception_review_source()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $synthetic_exception$
DECLARE
  v_source public.billing_webhook_events%ROWTYPE;
BEGIN
  SELECT * INTO v_source FROM public.billing_webhook_events
    WHERE id = NEW.webhook_event_record_id
    FOR SHARE;

  IF NOT FOUND OR
     v_source.organization_id IS DISTINCT FROM NEW.organization_id OR
     v_source.provider <> 'stripe' OR
     v_source.environment <> 'TEST' OR
     v_source.provider_event_id !~ '^evt_[A-Za-z0-9]+$' OR
     v_source.payload_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'BILLING_SYNTHETIC_EXCEPTION_SOURCE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$synthetic_exception$;

REVOKE ALL ON FUNCTION public.validate_billing_synthetic_exception_review_source()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_billing_synthetic_exception_review_source()
  TO service_role;

CREATE TRIGGER validate_billing_synthetic_exception_review_insert
  BEFORE INSERT ON public.billing_synthetic_subscription_exception_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_billing_synthetic_exception_review_source();

-- No API user, including the business OWNER, can directly see this data.
-- Reuse the MR-5D3 billing support permission pattern; no public routes.
ALTER TABLE public.billing_synthetic_subscription_exception_reviews
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_synthetic_subscription_exception_reviews
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.billing_synthetic_subscription_exception_reviews
  TO service_role;

COMMENT ON TABLE public.billing_synthetic_subscription_exception_reviews IS
  'MR-5E3C3B TEST-only UNVERIFIED synthetic support-intake evidence, NOT approved recovery, verified payment or paid-access authorization.';
