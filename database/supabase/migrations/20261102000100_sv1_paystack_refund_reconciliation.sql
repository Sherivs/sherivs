-- CoreGrid V1 Paystack refund-event reconciliation.
-- Status: authored, NOT APPLIED. Depends on 20261101000060_cg_financial_scope.sql.
-- Do not apply to production without explicit owner approval.
-- Rollback: database/supabase/rollbacks/20261102000100_sv1_paystack_refund_reconciliation.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.cg_financial_record_refund(
  p_provider_ref text,
  p_reference text,
  p_amount_minor bigint,
  p_currency text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_reversal public.cg_financial_reversal%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_provider_ref IS NULL OR length(btrim(p_provider_ref)) NOT BETWEEN 1 AND 200
     OR p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 6 AND 200
     OR p_amount_minor IS NULL OR p_amount_minor <= 0
     OR p_currency IS NULL OR upper(btrim(p_currency)) !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('outcome', 'amount_or_currency_mismatch');
  END IF;

  SELECT * INTO v_reversal
    FROM public.cg_financial_reversal
   WHERE provider_ref = btrim(p_provider_ref)
   FOR UPDATE;
  IF v_reversal.id IS NULL OR v_reversal.reference IS DISTINCT FROM btrim(p_reference) THEN
    RETURN jsonb_build_object('outcome', 'unknown_reference');
  END IF;
  IF v_reversal.amount_minor IS DISTINCT FROM p_amount_minor
     OR v_reversal.currency IS DISTINCT FROM upper(btrim(p_currency)) THEN
    RETURN jsonb_build_object('outcome', 'amount_or_currency_mismatch');
  END IF;
  IF v_reversal.state = 'processed' THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;
  IF v_reversal.state <> 'processing' THEN
    RETURN jsonb_build_object('outcome', 'not_processing');
  END IF;

  UPDATE public.cg_financial_reversal
     SET state = 'processed', processed_at = now()
   WHERE id = v_reversal.id;
  RETURN jsonb_build_object('outcome', 'processed');
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_record_refund(text, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_record_refund(text, text, bigint, text) TO service_role;

COMMIT;
