-- Migration: 20260918235000_dashboard_realtime.sql
-- Description: Realtime Dashboard Synchronization backed by private-channel Broadcast triggers and RLS authorization

-- 1. REALTIME AUTHORIZATION ON realtime.messages
-- Enables authenticated organization members to subscribe to their organization's private dashboard channel topic:
-- organization:<organization_id>:dashboard

-- Drop policy if it already exists to ensure idempotency
DROP POLICY IF EXISTS "Members can listen to their organization dashboard" ON realtime.messages;

CREATE POLICY "Members can listen to their organization dashboard"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() LIKE 'organization:%:dashboard'
  AND EXISTS (
    SELECT 1 FROM public.organization_users ou
    WHERE ou.user_id = auth.uid()
      AND ou.organization_id::text = split_part(realtime.topic(), ':', 2)
  )
);

-- 2. TRIGGER ON public.customer_completion_events
-- Emits 'customer.completed' to organization:<org_id>:dashboard
-- Note: Does NOT include customer PII (no name, email, phone, or raw contact payload).

CREATE OR REPLACE FUNCTION public.broadcast_customer_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_topic text;
  v_payload jsonb;
BEGIN
  v_topic := 'organization:' || NEW.organization_id::text || ':dashboard';
  v_payload := jsonb_build_object(
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

DROP TRIGGER IF EXISTS trg_broadcast_customer_completion ON public.customer_completion_events;

CREATE TRIGGER trg_broadcast_customer_completion
AFTER INSERT ON public.customer_completion_events
FOR EACH ROW
EXECUTE FUNCTION public.broadcast_customer_completion();

-- 3. TRIGGER ON public.review_requests
-- Emits 'review_request.created' on INSERT
-- Emits 'review_request.updated' on UPDATE OF status (only when status changed)
-- Note: Strictly excludes token, token_hash, error_message, and recipient contact info.

CREATE OR REPLACE FUNCTION public.broadcast_review_request_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_topic text;
  v_event_type text;
  v_payload jsonb;
BEGIN
  v_topic := 'organization:' || NEW.organization_id::text || ':dashboard';

  IF TG_OP = 'INSERT' THEN
    v_event_type := 'review_request.created';
    v_payload := jsonb_build_object(
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

DROP TRIGGER IF EXISTS trg_broadcast_review_request_change ON public.review_requests;

CREATE TRIGGER trg_broadcast_review_request_change
AFTER INSERT OR UPDATE OF status ON public.review_requests
FOR EACH ROW
EXECUTE FUNCTION public.broadcast_review_request_change();
