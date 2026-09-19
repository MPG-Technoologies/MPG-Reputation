-- Migration: 20260919031000_mr1_provider_event_processing.sql
-- Description: Add durable processing completion tracking to message_events for MR-1A.2 resumability

-- 1. Add processed_at to message_events
-- Meaning:
-- provider_event_id exists + processed_at IS NULL = event received/claimed but side effects incomplete
-- provider_event_id exists + processed_at IS NOT NULL = all required side effects completed successfully
ALTER TABLE public.message_events
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_me_processed_at
    ON public.message_events(processed_at)
    WHERE processed_at IS NOT NULL;
