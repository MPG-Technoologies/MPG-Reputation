-- Migration: 20260919010000_dashboard_ineligible_realtime.sql
-- Description: Realtime broadcast trigger on audit_events for review_request.ineligible

CREATE OR REPLACE FUNCTION public.broadcast_audit_ineligible()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_topic text;
  v_payload jsonb;
BEGIN
  IF NEW.event_type <> 'review_request.ineligible' THEN
    RETURN NEW;
  END IF;

  v_topic := 'organization:' || NEW.organization_id::text || ':dashboard';
  v_payload := jsonb_build_object(
    'id', NEW.id,
    'eventId', NEW.id,
    'type', 'review_request.ineligible',
    'organizationId', NEW.organization_id,
    'auditEventId', NEW.id,
    'createdAt', to_jsonb(NEW.created_at)
  );

  BEGIN
    PERFORM realtime.send(
      v_payload,
      'review_request.ineligible',
      v_topic,
      true -- private channel
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Dashboard realtime review_request.ineligible broadcast failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_audit_ineligible ON public.audit_events;

CREATE TRIGGER trg_broadcast_audit_ineligible
AFTER INSERT ON public.audit_events
FOR EACH ROW
WHEN (NEW.event_type = 'review_request.ineligible')
EXECUTE FUNCTION public.broadcast_audit_ineligible();
