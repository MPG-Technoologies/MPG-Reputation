-- MR-5 Stage 1 — additive financial-success guard for TEST invoice updates.
--
-- Reviewed latest chronological migration MR-5C3C1
-- (20261018225000_mr5c3c1_test_recovery_queue.sql). It ALREADY
-- excludes all invoice.* events from generic lease and completion RPCs,
-- and preserves retry cooldown, exponential scheduling and aged-out guards.
-- DO NOT replace those functions with older MR-5C3A definitions.
--
-- Add defense-in-depth SQL UPDATE protection for invoice terminal-status
-- transitions only. No financial finality, paid entitlement, payment provider,
-- privileges, hosted schema mutation or approval to mark an invoice paid.
-- Historical synthetic seed inserts with terminal state stay as test fixtures.
--
-- Defense in depth: block any newly finalized TEST invoice via generic,
-- manually issued, or future accidental service-role UPDATE. This trigger
-- protects state TRANSITIONS rather than retroactively reclassifying old
-- seed fixtures (some accepted proposal tests seed historical PROCESSED
-- events). New INSERT paths need their own future provider-authentication
-- admission policy; this is not a settlement or financial-ledger invariant.
CREATE FUNCTION public.guard_mr5_test_invoice_terminal_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $mr5stage1$
BEGIN
  IF NEW.provider = 'stripe'
     AND NEW.environment = 'TEST'
     AND NEW.event_type IN ('invoice.paid', 'invoice.payment_failed')
     AND NEW.processing_status IN ('PROCESSED','IGNORED')
     AND (
       NEW.processing_status IS DISTINCT FROM OLD.processing_status OR
       NEW.event_type IS DISTINCT FROM OLD.event_type OR
       NEW.provider IS DISTINCT FROM OLD.provider OR
       NEW.environment IS DISTINCT FROM OLD.environment
     ) THEN
    RAISE EXCEPTION 'MR5_STAGE1_INVOICE_SUCCESS_NOT_AUTHORIZED'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$mr5stage1$;

REVOKE ALL ON FUNCTION public.guard_mr5_test_invoice_terminal_transition()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_mr5_test_invoice_terminal_transition()
  TO service_role;

CREATE TRIGGER guard_mr5_test_invoice_terminal_transition_update
  BEFORE UPDATE ON public.billing_webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_mr5_test_invoice_terminal_transition();

COMMENT ON FUNCTION public.guard_mr5_test_invoice_terminal_transition() IS
  'Stage 1 nonauthorizing TEST invoice quarantine: no invoice PROCESSED or IGNORED transition before an approved provider-attested atomic finalizer.';
