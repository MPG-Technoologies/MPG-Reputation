-- Migration: 20260919003000_dashboard_realtime_hardening.sql
-- Description: Realtime hardening pass: explicit eventId in payloads, extension = 'broadcast' RLS hardening

-- 1. HARDEN RLS POLICY ON realtime.messages
-- Explicitly restrict SELECT to extension = 'broadcast' while preserving organization membership check
DROP POLICY IF EXISTS "Members can listen to their organization dashboard" ON realtime.messages;

CREATE POLICY "Members can listen to their organization dashboard"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'broadcast'
  AND realtime.topic() LIKE 'organization:%:dashboard'
  AND EXISTS (
    SELECT 1 FROM public.organization_users ou
    WHERE ou.user_id = auth.uid()
      AND ou.organization_id::text = split_part(realtime.topic(), ':', 2)
  )
);

-- 2. HARDEN TRIGGER ON customer_completion_events
-- Explicitly generates and includes id and eventId in broadcast payload for client deduplication
CREATE OR REPLACE FUNCTION public.broadcast_customer_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_topic text;
  v_event_id uuid;
  v_payload jsonb;
BEGIN
  v_topic := 'organization:' || NEW.organization_id::text || ':dashboard';
  v_event_id := gen_random_uuid();
  v_payload := jsonb_build_object(
    'id', v_event_id,
    'eventId', v_event_id,
    'type', 'customer.completed',
    'organizationId', NEW.organization_id,
    'completionEventId', NEW.id,
    'completedAt', to_jsonb(NEW.completed_at),
    'createdAt', to_jsonb(NEW.created_at)
  );

  BEGIN
    PERFORM realtime.send(
      v_payload,
      'customer.completed',
      v_topic,
      true -- private channel
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Dashboard realtime customer.completed broadcast failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- 3. HARDEN TRIGGER ON review_requests
-- Explicitly generates and includes id and eventId in broadcast payloads
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
