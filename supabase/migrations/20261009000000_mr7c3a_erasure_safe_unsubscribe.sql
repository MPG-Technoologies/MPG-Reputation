-- Migration: MR-7C.3A Erasure-Safe Unsubscribe Decoupling
-- Description: Adds server-only system-owned review_request_recipient_evidence table,
--              indexed by (organization_id, suppression_contact_hash), with database-enforced
--              immutability, append-only service_role privileges, and strict tenant non-visibility.
--
-- LAUNCH & PRE-PILOT INVARIANT (OWNER-APPROVED):
-- C3A must be hosted and production-verified BEFORE live customer messaging or any real-customer
-- pilot can be enabled.
-- Pre-C3A unresolved recipient rows are treated as synthetic/pre-production legacy state and remain
-- blocked from erasure. Unresolved legacy unsubscribe links are NOT claimed to be erasure-safe.
--
-- HISTORICAL RECIPIENT EVIDENCE & BACKFILL POLICY (OWNER-APPROVED CONSERVATIVE RULE):
-- Prior to MR-7C.3A, review requests did not record an immutable recipient hash at send time.
-- Completion events (customer_completion_events.contact) represent intake snapshots, while
-- send-time authority checks re-read mutable customers.email immediately before dispatch.
-- Therefore, neither completion contact nor current customer email provides cryptographic proof
-- of which address was actually delivered for historical communications.
-- To prevent fabricating recipient identities, legacy review requests created before C3A
-- have no row in review_request_recipient_evidence (or suppression_contact_hash IS NULL).
--
-- C3B PRECONDITION:
-- Customer erasure (MR-7C.3B) must fail closed and refuse erasure for any customer that has
-- unresolved historical review requests where recipient evidence is missing,
-- as those requests cannot be provably verified without customer identity.

-- 1. Ensure review_requests does NOT expose pseudonymous compliance data to tenant queries
ALTER TABLE public.review_requests
DROP COLUMN IF EXISTS suppression_contact_hash;

-- 2. Create server-owned recipient evidence table
CREATE TABLE IF NOT EXISTS public.review_request_recipient_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    review_request_id UUID NOT NULL,
    channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
    suppression_contact_hash TEXT CHECK (suppression_contact_hash IS NULL OR suppression_contact_hash ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_rrre_review_request FOREIGN KEY (review_request_id, organization_id)
        REFERENCES public.review_requests(id, organization_id) ON DELETE CASCADE,
    CONSTRAINT uq_rrre_request_channel UNIQUE (organization_id, review_request_id, channel)
);

-- 3. Indexes for fast suppression matching and request lookup
CREATE INDEX IF NOT EXISTS idx_rrre_lookup
ON public.review_request_recipient_evidence(organization_id, suppression_contact_hash);

CREATE INDEX IF NOT EXISTS idx_rrre_request_id
ON public.review_request_recipient_evidence(review_request_id);

-- 4. Enable Row Level Security & strictly lock down access to append-only (SELECT + INSERT) for service_role
ALTER TABLE public.review_request_recipient_evidence ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke all privileges from PUBLIC, anon, authenticated, and service_role
REVOKE ALL ON public.review_request_recipient_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.review_request_recipient_evidence FROM service_role;

-- Explicitly ensure service_role does NOT have UPDATE, DELETE, or TRUNCATE
REVOKE UPDATE, DELETE, TRUNCATE ON public.review_request_recipient_evidence FROM service_role;

-- Grant strictly SELECT and INSERT to service_role (append-only)
GRANT SELECT, INSERT ON public.review_request_recipient_evidence TO service_role;

-- 5. Database-level immutability enforcement:
-- Once bound to a non-null hash, suppression_contact_hash can NEVER change to a different hash.
-- NULL -> hash(A) is allowed when binding.
-- hash(A) -> hash(A) is allowed (idempotent).
-- hash(A) -> hash(B) raises an exception.
CREATE OR REPLACE FUNCTION public.protect_recipient_evidence_immutability()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF OLD.suppression_contact_hash IS NOT NULL AND NEW.suppression_contact_hash IS DISTINCT FROM OLD.suppression_contact_hash THEN
        RAISE EXCEPTION 'Recipient suppression contact hash is immutable once bound';
    END IF;
    IF NEW.review_request_id IS DISTINCT FROM OLD.review_request_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.channel IS DISTINCT FROM OLD.channel THEN
        RAISE EXCEPTION 'Recipient evidence linkage is immutable';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_recipient_evidence_immutability ON public.review_request_recipient_evidence;
CREATE TRIGGER trg_protect_recipient_evidence_immutability
BEFORE UPDATE ON public.review_request_recipient_evidence
FOR EACH ROW EXECUTE FUNCTION public.protect_recipient_evidence_immutability();
