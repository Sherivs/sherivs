-- Rollback for 20261103130000_sv1_m07_fees_ledger_receipts.sql (NOT APPLIED).
-- Preserves any fee or audit records; refuse rollback after data has been written.
BEGIN;

DO $guard$
DECLARE
  v_table text;
  v_has_data boolean;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'cg_fee_schedule','cg_fee_invoice','cg_fee_payment','cg_fee_refund_request',
    'cg_fee_refund_decision','cg_fee_ledger_posting','cg_fee_ledger_line',
    'cg_fee_receipt','cg_fee_receipt_counter','cg_fee_audit_event'
  ] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I LIMIT 1)', v_table)
      INTO v_has_data;
    IF v_has_data THEN
      RAISE EXCEPTION 'M07 rollback refused: public.% contains financial or audit data', v_table
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1
      FROM public.user_role_assignments a
      JOIN public.role_catalog r ON r.code = a.role_code
     WHERE r.template_code = 'bursar'
       AND a.status = 'active'
       AND a.started_at <= now()
       AND (a.valid_until IS NULL OR a.valid_until > now())
  ) THEN
    RAISE EXCEPTION 'M07 rollback refused while a bursar assignment depends on the cashier/refund separation'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

UPDATE public.role_template_permissions
   SET default_on = true
 WHERE template_code = 'bursar'
   AND permission_code = 'payments.record_cash'
   AND kind = 'optional'
   AND default_on IS DISTINCT FROM true;

DROP VIEW public.cg_fee_receipt_sequence_status;
DROP VIEW public.cg_fee_invoice_balances;

DROP TABLE public.cg_fee_ledger_line;
DROP TABLE public.cg_fee_ledger_posting;
DROP TABLE public.cg_fee_receipt;
DROP TABLE public.cg_fee_receipt_counter;
DROP TABLE public.cg_fee_audit_event;
DROP TABLE public.cg_fee_refund_decision;
DROP TABLE public.cg_fee_refund_request;
DROP TABLE public.cg_fee_payment;
DROP TABLE public.cg_fee_invoice;
DROP TABLE public.cg_fee_schedule;

DROP FUNCTION public.cg_fee_decide_refund(uuid, text, text);
DROP FUNCTION public.cg_fee_request_refund(uuid, bigint, text, text);
DROP FUNCTION public.cg_fee_record_payment(uuid, bigint, text, text, text);
DROP FUNCTION IF EXISTS public.cg_fee_reverse_invoice(uuid, text);
DROP FUNCTION public.cg_fee_issue_invoice(text, uuid, uuid, text, text, timestamptz);
DROP FUNCTION public.cg_fee_create_schedule(text, text, text, text, text, bigint, date, date);
DROP FUNCTION public.cg_fee_authorize(text, text, text, text, text);
DROP FUNCTION public.cg_fee_can_read(text, uuid, uuid, text);
DROP FUNCTION public.cg_fee_audit_insert();
DROP FUNCTION public.cg_fee_posting_balanced();
DROP FUNCTION public.cg_fee_append_only();

COMMIT;
