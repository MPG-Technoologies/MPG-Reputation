-- Migration: 20260919030000_mr1_email_provider_events.sql
-- Description: Add provider event deduplication and delivery tracking columns for MR-1A Production Messaging Core

-- 1. Add provider_event_id and event_occurred_at to message_events
ALTER TABLE public.message_events
    ADD COLUMN IF NOT EXISTS provider_event_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS event_occurred_at TIMESTAMPTZ NULL;

-- 2. Create unique partial index on (provider, provider_event_id) for idempotent provider webhook processing
CREATE UNIQUE INDEX IF NOT EXISTS idx_me_provider_event_unique
    ON public.message_events(provider, provider_event_id)
    WHERE provider_event_id IS NOT NULL;

-- 3. Create index on provider_message_id for efficient webhook-to-request correlation
CREATE INDEX IF NOT EXISTS idx_me_provider_msg_id
    ON public.message_events(provider_message_id)
    WHERE provider_message_id IS NOT NULL;

-- 4. Add delivered_at lifecycle column to review_requests for truthful delivery tracking
ALTER TABLE public.review_requests
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_rr_delivered_at
    ON public.review_requests(delivered_at)
    WHERE delivered_at IS NOT NULL;
