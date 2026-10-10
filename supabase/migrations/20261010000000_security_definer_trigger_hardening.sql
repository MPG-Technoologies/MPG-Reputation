-- Migration 24: Security Definer Trigger Function Direct Execute Hardening
-- Revoke direct EXECUTE privileges on realtime broadcast trigger functions from untrusted roles.
-- These functions are designed strictly for table trigger execution and must not be callable directly by external roles.

REVOKE ALL ON FUNCTION public.broadcast_audit_checking() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_audit_entitlement_blocked() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_audit_ineligible() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_customer_completion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_review_request_change() FROM PUBLIC, anon, authenticated;
