-- Migration: 20260919020000_dashboard_live_activity.sql
-- Description: Realtime broadcast trigger for review_request.checking and completionEventId correlation additions

-- 1. TRIGGER FUNCTION ON public.audit_events FOR review_request.checking
CREATE OR REPLACE FUNCTION public.broadcast_audit_checking()
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
  IF NEW.event_type <> 'review_request.checking' THEN
    RETURN NEW;
  END IF;

  v_topic := 'organization:' || NEW.organization_id::text || ':dashboard';
  v_completion_event_id := COALESCE(
    NEW.metadata->>'completionEventId',
    NEW.metadata->>'eventId',
    CASE WHEN NEW.entity_type = 'customer_completion_event' THEN NEW.entity_id::text ELSE NULL END
  );

  v_payload := jsonb_build_object(
    'id', NEW.id,
    'eventId', NEW.id,
    'type', 'review_request.checking',
    'organizationId', NEW.organization_id,
    'completionEventId', v_completion_event_id,
    'createdAt', to_jsonb(NEW.created_at)
  );

  BEGIN
    PERFORM realtime.send(
      v_payload,
      'review_request.checking',
      v_topic,
      true -- private channel
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Dashboard realtime review_request.checking broadcast failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_audit_checking ON public.audit_events;

CREATE TRIGGER trg_broadcast_audit_checking
AFTER INSERT ON public.audit_events
FOR EACH ROW
WHEN (NEW.event_type = 'review_request.checking')
EXECUTE FUNCTION public.broadcast_audit_checking();

-- 2. UPDATE broadcast_review_request_change() TO INCLUDE completionEventId
CREATE OR REPLACE FUNCTION public.broadcast_review_request_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_topic text;
  v_event_id uuid;
  v_event_type text;
  v_payload jsonb;
BEGIN
  v_topic := 'organization:' || NEW.organization_id::text || ':dashboard';
  v_event_id := gen_random_uuid();

  IF TG_OP = 'INSERT' THEN
    v_event_type := 'review_request.created';
    v_payload := jsonb_build_object(
      'id', v_event_id,
      'eventId', v_event_id,
      'type', 'review_request.created',
      'organizationId', NEW.organization_id,
      'completionEventId', NEW.completion_event_id,
      'requestId', NEW.id,
      'customerId', NEW.customer_id,
      'channel', NEW.channel,
      'status', NEW.status,
      'createdAt', to_jsonb(NEW.created_at),
      'scheduledFor', to_jsonb(NEW.scheduled_for)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only broadcast if status changed meaningfully
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;

    v_event_type := 'review_request.updated';
    v_payload := jsonb_build_object(
      'id', v_event_id,
      'eventId', v_event_id,
      'type', 'review_request.updated',
      'organizationId', NEW.organization_id,
      'completionEventId', NEW.completion_event_id,
      'requestId', NEW.id,
      'customerId', NEW.customer_id,
      'channel', NEW.channel,
      'previousStatus', OLD.status,
      'status', NEW.status,
      'sentAt', to_jsonb(NEW.sent_at),
      'clickedAt', to_jsonb(NEW.clicked_at),
      'failedAt', to_jsonb(NEW.failed_at),
      'updatedAt', to_jsonb(NEW.updated_at)
    );
  ELSE
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM realtime.send(
      v_payload,
      v_event_type,
      v_topic,
      true -- private channel
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Dashboard realtime review_request broadcast failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- 3. UPDATE broadcast_audit_ineligible() TO INCLUDE completionEventId
CREATE OR REPLACE FUNCTION public.broadcast_audit_ineligible()
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
  IF NEW.event_type <> 'review_request.ineligible' THEN
    RETURN NEW;
  END IF;

  v_topic := 'organization:' || NEW.organization_id::text || ':dashboard';
  v_completion_event_id := COALESCE(
    NEW.metadata->>'completionEventId',
    NEW.metadata->>'eventId',
    CASE WHEN NEW.entity_type = 'customer_completion_event' THEN NEW.entity_id::text ELSE NULL END
  );

  v_payload := jsonb_build_object(
    'id', NEW.id,
    'eventId', NEW.id,
    'type', 'review_request.ineligible',
    'organizationId', NEW.organization_id,
    'completionEventId', v_completion_event_id,
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
