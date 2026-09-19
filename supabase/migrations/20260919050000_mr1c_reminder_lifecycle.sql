-- Migration: 20260919050000_mr1c_reminder_lifecycle.sql
-- Milestone: MR-1C Reminder Lifecycle & Messaging Operations
-- Description: Add reminded_at timestamp and index to review_requests for bounded reminder tracking

ALTER TABLE public.review_requests
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ NULL;

-- Create partial index on reminded_at for efficient query and filtering
CREATE INDEX IF NOT EXISTS idx_review_requests_reminded_at
  ON public.review_requests(reminded_at)
  WHERE reminded_at IS NOT NULL;
