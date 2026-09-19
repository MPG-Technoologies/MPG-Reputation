-- Migration: MR-1B.1 Unsubscribe Token Index Hardening
-- Enforces that unsubscribe_token_hash is strictly unique when non-null

DROP INDEX IF EXISTS idx_review_requests_unsub_token_hash;

CREATE UNIQUE INDEX idx_review_requests_unsub_token_hash
ON public.review_requests(unsubscribe_token_hash)
WHERE unsubscribe_token_hash IS NOT NULL;
