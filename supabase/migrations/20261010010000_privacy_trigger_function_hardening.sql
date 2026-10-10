-- Hosted security verification correction.
-- Harden privacy lifecycle trigger-only SECURITY DEFINER functions.
-- These functions must execute through their table triggers only and must not
-- be callable directly by PUBLIC, anon, or authenticated roles.

ALTER FUNCTION public.protect_recipient_evidence_immutability()
SET search_path = public, pg_temp;

REVOKE ALL
ON FUNCTION public.protect_recipient_evidence_immutability()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.protect_erased_customer_immutability()
FROM PUBLIC, anon, authenticated;
