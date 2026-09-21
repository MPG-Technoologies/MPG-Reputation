-- Dashboard realtime lifecycle for entitlement-blocked review requests

CREATE OR REPLACE FUNCTION public.broadcast_audit_entitlement_blocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_topic text;
  v_completion_event_id text;
  v_payload jsonb;
BEGIN
  IF NEW.event_type <> 'review_request.blocked_by_entitlement' THEN
    RETURN NEW;
  END IF;

  v_topic := 'organization:' || NEW.organization_id::text || ':dashboard';

  v_completion_event_id := COALESCE(
    NEW.metadata->>'completionEventId',
    NEW.metadata->>'eventId',
    CASE
      WHEN NEW.entity_type = 'customer_completion_event'
      THEN NEW.entity_id::text
      ELSE NULL
    END
  );

  IF v_completion_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'id', NEW.id,
    'eventId', NEW.id,
    'type', 'review_request.blocked_by_entitlement',
    'organizationId', NEW.organization_id,
    'completionEventId', v_completion_event_id,
    'auditEventId', NEW.id,
    'reason', NEW.metadata->>'reason',
    'createdAt', to_jsonb(NEW.created_at)
  );

  BEGIN
    PERFORM realtime.send(
      v_payload,
      'review_request.blocked_by_entitlement',
      v_topic,
      true
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      'Dashboard realtime entitlement-blocked broadcast failed: %',
      SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_audit_entitlement_blocked
ON public.audit_events;

CREATE TRIGGER trg_broadcast_audit_entitlement_blocked
AFTER INSERT ON public.audit_events
FOR EACH ROW
WHEN (NEW.event_type = 'review_request.blocked_by_entitlement')
EXECUTE FUNCTION public.broadcast_audit_entitlement_blocked();
