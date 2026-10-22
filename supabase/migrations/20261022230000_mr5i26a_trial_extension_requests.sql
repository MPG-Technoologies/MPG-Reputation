-- MR-5I26A: business users request, but cannot change, free-trial entitlements.
-- Repository-only migration. Do NOT apply to hosted engineering/production without approval.
-- Existing trial provisioning and activation RPCs remain service_role-only.
REVOKE ALL ON FUNCTION public.provision_organization_trial(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_organization_trial(uuid, integer, integer)
  TO service_role;

CREATE TABLE public.trial_extension_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    requested_by uuid NOT NULL,
    reason text NOT NULL
      CONSTRAINT trial_extension_requests_reason_check
      CHECK (char_length(btrim(reason)) BETWEEN 20 AND 500),
    status text NOT NULL DEFAULT 'OPEN'
      CONSTRAINT trial_extension_requests_status_check
      CHECK (status IN ('OPEN', 'APPROVED', 'DENIED')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_by uuid,
    decision_reason text,
    CONSTRAINT trial_extension_requests_resolution_check
      CHECK (
        (status = 'OPEN' AND resolved_at IS NULL AND resolved_by IS NULL AND decision_reason IS NULL)
        OR
        (status IN ('APPROVED', 'DENIED') AND resolved_at IS NOT NULL
          AND resolved_by IS NOT NULL AND decision_reason IS NOT NULL
          AND char_length(btrim(decision_reason)) BETWEEN 10 AND 500)
      )
);

-- Only one unresolved request per tenant; concurrent submissions cannot
-- create multiple pending decisions or repeated staff tasks.
CREATE UNIQUE INDEX trial_extension_requests_one_open_per_org
  ON public.trial_extension_requests (organization_id)
  WHERE status = 'OPEN';

CREATE INDEX trial_extension_requests_requester_list
  ON public.trial_extension_requests (requested_by, requested_at DESC);

ALTER TABLE public.trial_extension_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_extension_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.trial_extension_requests TO authenticated;
-- Review reads are available to privileged server tooling; no resolution
-- UPDATE/DELETE grants are introduced by this intake-only slice.
GRANT SELECT, INSERT ON public.trial_extension_requests TO service_role;

CREATE POLICY trial_extension_requests_select_own
  ON public.trial_extension_requests FOR SELECT TO authenticated
  USING (
    requested_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.organization_users AS member
      WHERE member.organization_id = trial_extension_requests.organization_id
        AND member.user_id = (SELECT auth.uid())
        AND member.role IN ('OWNER', 'ADMIN')
    )
  );

CREATE POLICY trial_extension_requests_insert_own
  ON public.trial_extension_requests FOR INSERT TO authenticated
  WITH CHECK (
    status = 'OPEN'
    AND resolved_at IS NULL AND resolved_by IS NULL AND decision_reason IS NULL
    AND requested_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.organization_users AS member
      WHERE member.organization_id = trial_extension_requests.organization_id
        AND member.user_id = (SELECT auth.uid())
        AND member.role IN ('OWNER', 'ADMIN')
    )
  );

-- Append-only actor attribution in the existing audit ledger. Raw requester
-- notes intentionally stay out of the audit metadata and any logging.
CREATE FUNCTION public.audit_trial_extension_request_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.audit_events (
    organization_id, actor_type, actor_id, event_type,
    entity_type, entity_id, metadata
  ) VALUES (
    NEW.organization_id, 'user', NEW.requested_by, 'trial.extension_requested',
    'trial_extension_request', NEW.id,
    jsonb_build_object('status', 'OPEN')
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_trial_extension_request_insert()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_trial_extension_request_insert
AFTER INSERT ON public.trial_extension_requests
FOR EACH ROW EXECUTE FUNCTION public.audit_trial_extension_request_insert();

COMMENT ON TABLE public.trial_extension_requests IS
  'Tenant-authenticated request intake only. No entitlement mutation, automatic approval, extension, reset or paid activation.';
