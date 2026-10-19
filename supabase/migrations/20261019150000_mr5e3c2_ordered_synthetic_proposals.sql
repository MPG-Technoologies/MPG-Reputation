-- MR-5E3C2: STRICT SOURCE-TIME ORDERING of private SYNTHETIC proposals ONLY.
-- Repository migration for disposable tests, NOT hosted Supabase.
-- Does not modify product entitlements, usage quotas, or payment projections.
--
-- Never use arrival/received_at as a replacement for provider creation time:
-- out-of-order webhooks could otherwise turn an old payment into a new decision.
-- Null remains allowed for legacy staged records, but new inserts with unknown
-- provider order fail closed and any legacy null blocks subsequent proposals.
ALTER TABLE public.billing_paid_entitlement_proposals
  ADD COLUMN source_provider_created_at TIMESTAMPTZ;

CREATE INDEX billing_paid_proposals_subscription_order_idx
  ON public.billing_paid_entitlement_proposals
  (subscription_record_id, source_provider_created_at DESC);

CREATE FUNCTION public.enforce_synthetic_paid_proposal_event_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $ordered_proposals$
DECLARE
  v_subscription_id UUID;
  v_event public.billing_webhook_events%ROWTYPE;
  v_prior public.billing_paid_entitlement_proposals%ROWTYPE;
BEGIN
  -- Lock the ONE tenant's subscription row before checking prior proposals.
  -- Every concurrent insertion for this subscription serializes through it.
  -- Never lock a foreign tenant or use SECURITY DEFINER.
  SELECT s.id INTO v_subscription_id
    FROM public.organization_subscriptions AS s
    WHERE s.id = NEW.subscription_record_id
      AND s.organization_id = NEW.organization_id
      AND s.provider = 'stripe'
      AND s.environment = 'TEST'
    FOR UPDATE;

  IF v_subscription_id IS NULL THEN
    RAISE EXCEPTION 'BILLING_PROPOSAL_SUBSCRIPTION_IDENTITY_MISMATCH';
  END IF;

  SELECT * INTO v_event
    FROM public.billing_webhook_events
    WHERE id = NEW.webhook_event_record_id
    FOR SHARE;

  IF NOT FOUND OR
     v_event.organization_id IS DISTINCT FROM NEW.organization_id OR
     v_event.environment <> 'TEST' OR
     v_event.provider <> 'stripe' OR
     v_event.provider_created_at IS NULL THEN
    RAISE EXCEPTION 'BILLING_PROPOSAL_SOURCE_ORDER_UNKNOWN';
  END IF;

  -- Source-derived immutable value: client-supplied ordering values ignored.
  NEW.source_provider_created_at := v_event.provider_created_at;

  -- Check exact-event deduplication across the whole ledger, not just the
  -- latest proposal, so old replays remain idempotent after later events.
  IF EXISTS (
      SELECT 1 FROM public.billing_paid_entitlement_proposals
      WHERE webhook_event_record_id = NEW.webhook_event_record_id
  ) THEN
    RAISE EXCEPTION 'BILLING_PROPOSAL_EVENT_ALREADY_RECORDED'
      USING ERRCODE = '23505';
  END IF;

  -- NULLS FIRST is intentional: a preexisting unorderable ledger record must
  -- hold processing for review rather than be silently bypassed.
  SELECT * INTO v_prior
    FROM public.billing_paid_entitlement_proposals
    WHERE subscription_record_id = NEW.subscription_record_id
    ORDER BY source_provider_created_at DESC NULLS FIRST, recorded_at DESC, id DESC
    LIMIT 1;

  IF FOUND THEN
    IF v_prior.webhook_event_record_id = NEW.webhook_event_record_id THEN
      -- Preserve existing exact-event idempotency path (including racing
      -- inserts that waited on the subscription lock).
      RAISE EXCEPTION 'BILLING_PROPOSAL_EVENT_ALREADY_RECORDED'
        USING ERRCODE = '23505';
    END IF;

    IF v_prior.source_provider_created_at IS NULL OR
       v_event.provider_created_at <= v_prior.source_provider_created_at THEN
      -- Equal-second events may be valid but ordering is ambiguous;
      -- fail closed rather than guess and overwrite a later decision.
      RAISE EXCEPTION 'BILLING_PROPOSAL_STALE_OR_AMBIGUOUS_EVENT';
    END IF;

    -- An ACTIVE proposal cannot supersede an unresolved dispute, a pending
    -- cancellation, or a terminal subscription simply because it arrived later.
    -- This is *not* the full authoritative lifecycle transition policy.
    IF NEW.candidate_status = 'ACTIVE' AND
       v_prior.candidate_status IN ('REVIEW_REQUIRED', 'CANCEL_AT_PERIOD_END', 'ENDED') THEN
      RAISE EXCEPTION 'BILLING_PROPOSAL_REVIEW_HOLD';
    END IF;
  END IF;

  RETURN NEW;
END;
$ordered_proposals$;

REVOKE ALL ON FUNCTION public.enforce_synthetic_paid_proposal_event_order()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_synthetic_paid_proposal_event_order()
  TO service_role;

-- Existing validation trigger is named validate_*; PostgreSQL fires same-kind
-- triggers in name order, so this source-order check runs second.
CREATE TRIGGER zz_enforce_synthetic_paid_proposal_event_order
  BEFORE INSERT ON public.billing_paid_entitlement_proposals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_synthetic_paid_proposal_event_order();

COMMENT ON COLUMN public.billing_paid_entitlement_proposals.source_provider_created_at IS
  'Strict synthetic staging order from the saved Stripe event provider_created_at. NOT verified financial settlement, payment finality or entitlement authority.';
