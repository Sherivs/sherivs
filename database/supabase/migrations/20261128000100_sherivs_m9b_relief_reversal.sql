-- M9B relief revocation: a posted relief can be reversed in the fee ledger, by a second person, before the adjustment is revoked.
-- Creator: Claude Code agent, mission M9 part B (relief reversal) (provenance id W-021); AI-generated.
-- Before this, fee_relief_revoke only flipped the adjustment to 'revoked'. If the relief had been posted
-- (debit fee_relief, credit accounts_receivable) the ledger kept saying the student owed less.
-- Adds posting event 'relief_reversal' (debit accounts_receivable, credit fee_relief; never touches cash),
-- cg_fee_reverse_relief (bursar, not the requester and not the decider), and makes fee_relief_revoke refuse
-- while a posted relief is unreversed. Not applied anywhere. Rollback restores the previous bodies.
BEGIN;

ALTER TABLE public.cg_fee_ledger_posting DROP CONSTRAINT IF EXISTS cg_fee_ledger_posting_event_type_check;
ALTER TABLE public.cg_fee_ledger_posting ADD CONSTRAINT cg_fee_ledger_posting_event_type_check
  CHECK (event_type IN ('invoice', 'payment', 'reversal', 'invoice_reversal', 'relief', 'relief_reversal'));
ALTER TABLE public.cg_fee_ledger_posting DROP CONSTRAINT IF EXISTS cg_fee_ledger_posting_check;
ALTER TABLE public.cg_fee_ledger_posting ADD CONSTRAINT cg_fee_ledger_posting_check CHECK (
  (event_type = 'invoice' AND payment_id IS NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NULL AND reversal_reason IS NULL AND adjustment_id IS NULL)
  OR (event_type = 'payment' AND payment_id IS NOT NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NULL AND reversal_reason IS NULL AND adjustment_id IS NULL)
  OR (event_type = 'reversal' AND payment_id IS NOT NULL AND refund_decision_id IS NOT NULL AND reverses_posting_id IS NOT NULL AND reversal_reason IS NULL AND adjustment_id IS NULL)
  OR (event_type = 'invoice_reversal' AND payment_id IS NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NOT NULL AND reversal_reason IS NOT NULL AND adjustment_id IS NULL)
  OR (event_type = 'relief' AND payment_id IS NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NULL AND reversal_reason IS NULL AND adjustment_id IS NOT NULL)
  OR (event_type = 'relief_reversal' AND payment_id IS NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NOT NULL AND reversal_reason IS NOT NULL AND adjustment_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS cg_fee_relief_reversal_once
  ON public.cg_fee_ledger_posting (reverses_posting_id) WHERE event_type = 'relief_reversal';

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
    WHEN 'relief_reversal' THEN
      EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'accounts_receivable' AND debit_kobo = v_amount AND credit_kobo = 0)
      AND EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'fee_relief' AND debit_kobo = 0 AND credit_kobo = v_amount)
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

-- An invoice that carries UNREVERSED relief cannot be reversed in full (it would drive the receivable below zero).
CREATE OR REPLACE FUNCTION public.cg_fee_invoice_reversal_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.event_type = 'invoice_reversal' AND EXISTS (
    SELECT 1 FROM public.cg_fee_ledger_posting p
     WHERE p.invoice_id = NEW.invoice_id AND p.event_type = 'relief'
       AND NOT EXISTS (SELECT 1 FROM public.cg_fee_ledger_posting r WHERE r.event_type = 'relief_reversal' AND r.reverses_posting_id = p.id)
  ) THEN
    RAISE EXCEPTION 'invoice with posted relief cannot be reversed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cg_fee_invoice_reversal_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cg_fee_reverse_relief(p_invoice_id uuid, p_adjustment_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_invoice public.cg_fee_invoice%ROWTYPE;
  v_adj public.fee_adjustments%ROWTYPE;
  v_ctx record;
  v_relief public.cg_fee_ledger_posting%ROWTYPE;
  v_existing public.cg_fee_ledger_posting%ROWTYPE;
  v_posting uuid;
BEGIN
  SELECT * INTO v_invoice FROM public.cg_fee_invoice WHERE id = p_invoice_id;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'fee invoice is unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ctx FROM public.cg_fee_authorize(
    v_invoice.scope_ref, 'fees.manage_plans', 'bursar', 'campus', v_invoice.campus_id::text
  );
  SELECT * INTO v_invoice FROM public.cg_fee_invoice WHERE id = p_invoice_id FOR UPDATE;
  SELECT * INTO v_adj FROM public.fee_adjustments WHERE id = p_adjustment_id FOR SHARE;
  IF v_adj.id IS NULL OR v_adj.school_id IS DISTINCT FROM v_ctx.school_id THEN
    RAISE EXCEPTION 'relief does not apply to this invoice' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'a reason of 3 to 500 characters is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_relief FROM public.cg_fee_ledger_posting
   WHERE invoice_id = p_invoice_id AND adjustment_id = p_adjustment_id AND event_type = 'relief';
  IF v_relief.id IS NULL THEN
    RAISE EXCEPTION 'no posted relief to reverse' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.cg_fee_ledger_posting
   WHERE event_type = 'relief_reversal' AND reverses_posting_id = v_relief.id;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('posting_id', v_existing.id, 'amount_kobo', v_existing.amount_kobo, 'duplicate', true);
  END IF;
  IF v_adj.created_by IS NULL OR v_adj.decided_by IS NULL
     OR v_ctx.actor_id = v_adj.created_by OR v_ctx.actor_id = v_adj.decided_by THEN
    RAISE EXCEPTION 'separation of duties: a relief reversal must be posted by someone other than the requester and the decider'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.cg_fee_ledger_posting (
    scope_ref, tenant_id, org_ref, invoice_id, campus_id, subject_ref, principal_ref, event_type, amount_kobo,
    actor_id, adjustment_id, reverses_posting_id, reversal_reason
  ) VALUES (
    v_invoice.scope_ref, v_invoice.tenant_id, v_invoice.org_ref, v_invoice.id, v_invoice.campus_id,
    v_invoice.subject_ref, v_invoice.principal_ref, 'relief_reversal', v_relief.amount_kobo, v_ctx.actor_id,
    v_adj.id, v_relief.id, btrim(p_reason)
  ) RETURNING id INTO v_posting;
  INSERT INTO public.cg_fee_ledger_line (posting_id, tenant_id, campus_id, principal_ref, account_code, debit_kobo, credit_kobo)
  VALUES
    (v_posting, v_invoice.tenant_id, v_invoice.campus_id, v_invoice.principal_ref, 'accounts_receivable', v_relief.amount_kobo, 0),
    (v_posting, v_invoice.tenant_id, v_invoice.campus_id, v_invoice.principal_ref, 'fee_relief', 0, v_relief.amount_kobo);
  RETURN jsonb_build_object('posting_id', v_posting, 'amount_kobo', v_relief.amount_kobo, 'duplicate', false);
END
$$;
REVOKE ALL ON FUNCTION public.cg_fee_reverse_relief(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cg_fee_reverse_relief(uuid, uuid, text) TO authenticated;

-- Revoking is refused while a posted relief has not been reversed in the ledger.
CREATE OR REPLACE FUNCTION public.fee_relief_revoke(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.fee_adjustments;
BEGIN
  SELECT * INTO a FROM public.fee_adjustments WHERE id = p_id;
  IF a.id IS NULL OR a.school_id IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(a.school_id, 'fees.manage_plans') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF a.status NOT IN ('approved','pending') THEN RAISE EXCEPTION 'already %', a.status; END IF;
  IF EXISTS (SELECT 1 FROM public.cg_fee_ledger_posting p
              WHERE p.adjustment_id = a.id AND p.event_type = 'relief'
                AND NOT EXISTS (SELECT 1 FROM public.cg_fee_ledger_posting r WHERE r.event_type = 'relief_reversal' AND r.reverses_posting_id = p.id)) THEN
    RAISE EXCEPTION 'this relief is posted to the fee ledger; reverse it first' USING ERRCODE = '55000';
  END IF;
  UPDATE public.fee_adjustments SET status = 'revoked', decided_by = auth.uid(), decided_at = now() WHERE id = a.id;
END $$;

COMMIT;
