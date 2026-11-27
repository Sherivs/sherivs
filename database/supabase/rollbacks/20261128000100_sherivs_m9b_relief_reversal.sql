-- Rollback of M9B relief reversal. Refuses if any relief reversal has been posted: ledger postings are append-only and are never deleted here.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.cg_fee_ledger_posting WHERE event_type = 'relief_reversal') THEN
    RAISE EXCEPTION 'relief reversals exist in the ledger; the posting type cannot be removed' USING ERRCODE = '55000';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.cg_fee_reverse_relief(uuid, uuid, text);
DROP INDEX IF EXISTS public.cg_fee_relief_reversal_once;
ALTER TABLE public.cg_fee_ledger_posting DROP CONSTRAINT IF EXISTS cg_fee_ledger_posting_event_type_check;
ALTER TABLE public.cg_fee_ledger_posting ADD CONSTRAINT cg_fee_ledger_posting_event_type_check
  CHECK (event_type IN ('invoice', 'payment', 'reversal', 'invoice_reversal', 'relief'));
ALTER TABLE public.cg_fee_ledger_posting DROP CONSTRAINT IF EXISTS cg_fee_ledger_posting_check;
ALTER TABLE public.cg_fee_ledger_posting ADD CONSTRAINT cg_fee_ledger_posting_check CHECK (
  (event_type = 'invoice' AND payment_id IS NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NULL AND reversal_reason IS NULL AND adjustment_id IS NULL)
  OR (event_type = 'payment' AND payment_id IS NOT NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NULL AND reversal_reason IS NULL AND adjustment_id IS NULL)
  OR (event_type = 'reversal' AND payment_id IS NOT NULL AND refund_decision_id IS NOT NULL AND reverses_posting_id IS NOT NULL AND reversal_reason IS NULL AND adjustment_id IS NULL)
  OR (event_type = 'invoice_reversal' AND payment_id IS NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NOT NULL AND reversal_reason IS NOT NULL AND adjustment_id IS NULL)
  OR (event_type = 'relief' AND payment_id IS NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NULL AND reversal_reason IS NULL AND adjustment_id IS NOT NULL)
);
CREATE OR REPLACE FUNCTION public.cg_fee_posting_balanced()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_debits bigint;
  v_credits bigint;
  v_amount bigint;
  v_type text;
  v_valid boolean;
BEGIN
  SELECT p.amount_kobo, p.event_type INTO v_amount, v_type
    FROM public.cg_fee_ledger_posting p WHERE p.id = NEW.id;
  SELECT count(*)::integer, coalesce(sum(l.debit_kobo), 0)::bigint,
         coalesce(sum(l.credit_kobo), 0)::bigint
    INTO v_count, v_debits, v_credits
    FROM public.cg_fee_ledger_line l WHERE l.posting_id = NEW.id;
  IF v_count <> 2 OR v_debits <> v_credits OR v_debits <> v_amount THEN
    RAISE EXCEPTION 'fee ledger posting must contain exactly two balanced integer-kobo lines'
      USING ERRCODE = '23514';
  END IF;
  SELECT CASE v_type
    WHEN 'invoice' THEN
      EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'accounts_receivable' AND debit_kobo = v_amount AND credit_kobo = 0)
      AND EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'fee_revenue' AND debit_kobo = 0 AND credit_kobo = v_amount)
    WHEN 'payment' THEN
      EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'cash' AND debit_kobo = v_amount AND credit_kobo = 0)
      AND EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'accounts_receivable' AND debit_kobo = 0 AND credit_kobo = v_amount)
    WHEN 'reversal' THEN
      EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'accounts_receivable' AND debit_kobo = v_amount AND credit_kobo = 0)
      AND EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'cash' AND debit_kobo = 0 AND credit_kobo = v_amount)
    WHEN 'invoice_reversal' THEN
      EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'fee_revenue' AND debit_kobo = v_amount AND credit_kobo = 0)
      AND EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'accounts_receivable' AND debit_kobo = 0 AND credit_kobo = v_amount)
    WHEN 'relief' THEN
      EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'fee_relief' AND debit_kobo = v_amount AND credit_kobo = 0)
      AND EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'accounts_receivable' AND debit_kobo = 0 AND credit_kobo = v_amount)
    ELSE false
  END INTO v_valid;
  IF NOT coalesce(v_valid, false) THEN
    RAISE EXCEPTION 'fee ledger posting lines do not match the transaction type'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.cg_fee_posting_balanced() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.cg_fee_invoice_reversal_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.event_type = 'invoice_reversal' AND EXISTS (
    SELECT 1 FROM public.cg_fee_ledger_posting p WHERE p.invoice_id = NEW.invoice_id AND p.event_type = 'relief'
  ) THEN
    RAISE EXCEPTION 'invoice with posted relief cannot be reversed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cg_fee_invoice_reversal_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.fee_relief_revoke(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.fee_adjustments;
BEGIN
  SELECT * INTO a FROM public.fee_adjustments WHERE id = p_id;
  IF a.id IS NULL OR a.school_id IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(a.school_id, 'fees.manage_plans') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF a.status NOT IN ('approved','pending') THEN RAISE EXCEPTION 'already %', a.status; END IF;
  UPDATE public.fee_adjustments SET status = 'revoked', decided_by = auth.uid(), decided_at = now() WHERE id = a.id;
END $$;
COMMIT;
