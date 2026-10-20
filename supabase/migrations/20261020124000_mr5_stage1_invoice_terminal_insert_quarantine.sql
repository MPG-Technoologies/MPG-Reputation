-- MR-5 Stage 1: close direct privileged INSERT of already-terminal TEST
-- invoice webhook events. Existing UPDATE quarantine remains in place.
-- No settlement, verified provider evidence, paid access or new privileges.
-- DO NOT backdoor fixtures through a service-role exception or custom GUC.
CREATE FUNCTION public.guard_mr5_test_invoice_terminal_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $mr5_stage1_insert$
BEGIN
  IF NEW.provider = 'stripe'
     AND NEW.environment = 'TEST'
     AND NEW.event_type IN ('invoice.paid', 'invoice.payment_failed')
     AND NEW.processing_status IN ('PROCESSED','IGNORED') THEN
    RAISE EXCEPTION 'MR5_STAGE1_INVOICE_INSERT_FINALITY_NOT_AUTHORIZED'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$mr5_stage1_insert$;

REVOKE ALL ON FUNCTION public.guard_mr5_test_invoice_terminal_insert()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_mr5_test_invoice_terminal_insert()
  TO service_role;

CREATE TRIGGER guard_mr5_test_invoice_terminal_insert
  BEFORE INSERT ON public.billing_webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_mr5_test_invoice_terminal_insert();

COMMENT ON FUNCTION public.guard_mr5_test_invoice_terminal_insert() IS
  'Fail closed on privileged synthetic TEST invoice events inserted as paid/ignored before accepted provider-attested finalizer; not a payment verifier.';
