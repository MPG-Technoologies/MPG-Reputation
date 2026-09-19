-- Migration: MR-1B Sender Identity + Unsubscribe Foundation
-- Adds optional review_reply_to_email to locations
-- Adds unsubscribe_token and unsubscribe_token_hash to review_requests

ALTER TABLE public.locations
ADD COLUMN IF NOT EXISTS review_reply_to_email TEXT DEFAULT NULL;

ALTER TABLE public.review_requests
ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS unsubscribe_token_hash TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_review_requests_unsub_token_hash
ON public.review_requests(unsubscribe_token_hash);
