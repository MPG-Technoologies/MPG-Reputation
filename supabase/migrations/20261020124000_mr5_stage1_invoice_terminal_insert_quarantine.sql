-- MR-5 Stage 1: reject already-terminal UNLINKED TEST invoice ingestion.
-- Incoming signed webhook receipts start without an organization assignment.
-- The existing UPDATE quarantine applies even after tenant attribution.
-- Historical org-attributed, processed synthetic proposal fixtures remain
-- explicitly possible and nonauthorizing; this is NOT comprehensive INSERT
-- success admission, and never proof of funds or access.
-- No provider access, financial settlement or new DB privileges.
CREATE FUNCTION public.guard_mr5_test_invoice_terminal_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $mr5_stage1_insert$
BEGIN
  IF NEW.provider = 'stripe'
     AND NEW.environment = 'TEST'
     AND NEW.event_type IN ('invoice.paid', 'invoice.payment_failed')
     AND NEW.organization_id IS NULL
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
  'Fail closed on unlinked TEST invoice ingress inserted as PROCESSED/IGNORED; separately attributed synthetic fixtures remain nonauthorizing and need later owner-approved success admission.';
