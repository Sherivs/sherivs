-- Rollback for 20261117003300_sherivs_m9_finance_core.sql (ADR-150). NOT APPLIED.
-- Restores the payroll, expense, cg_fee_authorize and cg_fee_posting_balanced definitions exactly as applied before
-- (copied from 20261024000240 and 20261103130000), and removes everything M9 part A added.
-- Refuses to run once a relief posting, day close or cash reconciliation exists: those are financial records and
-- the ledger is append-only, so they are never deleted by a rollback.
BEGIN;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cg_fee_ledger_posting WHERE event_type = 'relief')
     OR (to_regclass('public.cg_fee_cash_day_close') IS NOT NULL AND EXISTS (SELECT 1 FROM public.cg_fee_cash_day_close)) THEN
    RAISE EXCEPTION 'M9 rollback refused: relief postings or cash day closes exist (append-only financial records)'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.cg_fee_post_relief(uuid, uuid);
DROP FUNCTION IF EXISTS public.cg_fee_reconcile_cash_day(uuid, text, text);
DROP FUNCTION IF EXISTS public.cg_fee_close_cash_day(text, uuid, date, bigint, bigint, text, text);
DROP TRIGGER IF EXISTS cg_fee_invoice_reversal_guard ON public.cg_fee_ledger_posting;
DROP FUNCTION IF EXISTS public.cg_fee_invoice_reversal_guard();
DROP TRIGGER IF EXISTS cg_fee_payment_day_open ON public.cg_fee_payment;
DROP FUNCTION IF EXISTS public.cg_fee_payment_day_open_guard();
DROP TABLE IF EXISTS public.cg_fee_cash_reconciliation;
DROP TABLE IF EXISTS public.cg_fee_cash_day_close;
DROP FUNCTION IF EXISTS public.cg_fee_cash_reconciliation_sod_guard();
DROP FUNCTION IF EXISTS public.cg_fee_business_date(timestamptz);
DROP TRIGGER IF EXISTS cg_fee_refund_decision_sod ON public.cg_fee_refund_decision;
DROP FUNCTION IF EXISTS public.cg_fee_refund_decision_sod_guard();
DROP TRIGGER IF EXISTS cg_financial_reversal_sod ON public.cg_financial_reversal;
DROP FUNCTION IF EXISTS public.cg_financial_reversal_sod_guard();
DROP TRIGGER IF EXISTS trg_staff_payroll_audit ON public.staff_payroll;
DROP TRIGGER IF EXISTS trg_school_expenses_audit ON public.school_expenses;

DROP INDEX IF EXISTS public.cg_fee_relief_posting_once;
ALTER TABLE public.cg_fee_ledger_line DROP CONSTRAINT IF EXISTS cg_fee_ledger_line_account_code_check;
ALTER TABLE public.cg_fee_ledger_line ADD CONSTRAINT cg_fee_ledger_line_account_code_check
  CHECK (account_code IN ('accounts_receivable', 'fee_revenue', 'cash'));
ALTER TABLE public.cg_fee_ledger_posting DROP CONSTRAINT IF EXISTS cg_fee_ledger_posting_check;
ALTER TABLE public.cg_fee_ledger_posting ADD CONSTRAINT cg_fee_ledger_posting_check CHECK (
  (event_type = 'invoice' AND payment_id IS NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NULL AND reversal_reason IS NULL)
  OR (event_type = 'payment' AND payment_id IS NOT NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NULL AND reversal_reason IS NULL)
  OR (event_type = 'reversal' AND payment_id IS NOT NULL AND refund_decision_id IS NOT NULL AND reverses_posting_id IS NOT NULL AND reversal_reason IS NULL)
  OR (event_type = 'invoice_reversal' AND payment_id IS NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NOT NULL AND reversal_reason IS NOT NULL)
);
ALTER TABLE public.cg_fee_ledger_posting DROP CONSTRAINT IF EXISTS cg_fee_ledger_posting_event_type_check;
ALTER TABLE public.cg_fee_ledger_posting ADD CONSTRAINT cg_fee_ledger_posting_event_type_check
  CHECK (event_type IN ('invoice', 'payment', 'reversal', 'invoice_reversal'));
ALTER TABLE public.cg_fee_ledger_posting DROP COLUMN IF EXISTS adjustment_id;

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

CREATE OR REPLACE FUNCTION public.cg_fee_authorize(
  p_scope_ref text,
  p_permission text,
  p_role_template text,
  p_resource_scope_type text,
  p_resource_scope_ref text
) RETURNS TABLE (tenant_id text, org_ref text, school_id uuid, actor_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_binding public.cg_financial_scope_binding%ROWTYPE;
  v_actor uuid := auth.uid();
  v_school uuid;
BEGIN
  IF v_actor IS NULL
     OR coalesce(auth.role(), '') <> 'authenticated'
     OR NOT (
       (p_permission = 'fees.manage_plans' AND p_role_template = 'bursar')
       OR (p_permission = 'payments.record_cash' AND p_role_template = 'cashier')
       OR (p_permission = 'payments.refund' AND p_role_template = 'bursar')
     )
     OR p_resource_scope_type IS NULL
     OR p_resource_scope_type NOT IN ('institution', 'campus')
     OR p_resource_scope_ref IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT b.* INTO v_binding
    FROM public.cg_financial_scope_binding b
   WHERE b.scope_ref = p_scope_ref;
  IF v_binding.scope_ref IS NULL
     OR v_binding.tenant_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'financial scope is unavailable' USING ERRCODE = '42501';
  END IF;
  v_school := v_binding.tenant_id::uuid;
  IF public.get_my_school_id() IS DISTINCT FROM v_school
     OR NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.id = v_school) THEN
    RAISE EXCEPTION 'financial tenant is unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_resource_scope_type = 'institution'
     AND p_resource_scope_ref IS DISTINCT FROM v_binding.tenant_id THEN
    RAISE EXCEPTION 'institution scope mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_resource_scope_type = 'campus'
     AND (
       p_resource_scope_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT EXISTS (
         SELECT 1 FROM public.campuses c
          WHERE c.id = p_resource_scope_ref::uuid AND c.school_id = v_school
       )
     ) THEN
    RAISE EXCEPTION 'campus scope mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.workspace_effective_permission_rows(v_school, v_actor) e
      JOIN public.role_catalog r ON r.code = e.role_code
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(e.scope_values, '[]'::jsonb)) s(value)
     WHERE e.permission_code = p_permission
       AND r.template_code = p_role_template
       AND (
         s.value->>'type' IN ('org', 'institution')
         OR (
           s.value->>'type' = p_resource_scope_type
           AND s.value->>'ref' IS NOT DISTINCT FROM p_resource_scope_ref
         )
       )
  ) THEN
    RAISE EXCEPTION 'required financial role or permission is missing' USING ERRCODE = '42501';
  END IF;
  PERFORM public.workspace_role_sod_assert(v_school, v_actor);
  RETURN QUERY SELECT v_binding.tenant_id, v_binding.org_ref, v_school, v_actor;
END
$$;
REVOKE ALL ON FUNCTION public.cg_fee_authorize(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cg_fee_authorize(text, text, text, text, text) FROM PUBLIC, anon, service_role;

CREATE OR REPLACE FUNCTION public.staff_payroll_sod_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.prepared_by := OLD.prepared_by; END IF;   -- preparer is immutable
  IF NEW.status IN ('approved', 'paid') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.approved_by IS DISTINCT FROM NEW.approved_by) THEN
    IF v_actor IS NOT NULL THEN NEW.approved_by := v_actor; END IF;
    IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.user_id THEN
      RAISE EXCEPTION 'no_self_payroll_approval: you cannot approve your own payroll line' USING ERRCODE = '42501'; END IF;
    IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.prepared_by THEN
      RAISE EXCEPTION 'no_self_payroll_approval: preparer and approver must be different people' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_staff_payroll_sod ON public.staff_payroll;
CREATE TRIGGER trg_staff_payroll_sod BEFORE INSERT OR UPDATE ON public.staff_payroll FOR EACH ROW EXECUTE FUNCTION public.staff_payroll_sod_guard();

CREATE OR REPLACE FUNCTION public.school_expenses_sod_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_limit numeric; v_has_roles boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.created_by := OLD.created_by; END IF;
  IF NEW.approved_by IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.approved_by IS DISTINCT FROM NEW.approved_by OR OLD.amount IS DISTINCT FROM NEW.amount) THEN
    IF v_actor IS NOT NULL THEN NEW.approved_by := v_actor; END IF;
    IF NEW.approved_by = NEW.created_by THEN
      RAISE EXCEPTION 'no_self_expense_approval: you cannot approve an expense you raised' USING ERRCODE = '42501'; END IF;
    SELECT bool_or(true), max(t.approval_limit_ngn) INTO v_has_roles, v_limit
      FROM public.user_role_assignments a JOIN public.role_catalog r ON r.code = a.role_code JOIN public.role_templates t ON t.code = r.template_code
     WHERE a.org_id = NEW.school_id AND a.user_id = NEW.approved_by AND a.status = 'active'
       AND EXISTS (SELECT 1 FROM public.effective_permissions(NEW.school_id, NEW.approved_by) e WHERE e.permission_code = 'expenses.approve');
    IF coalesce(v_has_roles, false) AND NEW.amount > coalesce(v_limit, 0) THEN
      RAISE EXCEPTION 'approval limit exceeded: % > %', NEW.amount, coalesce(v_limit, 0) USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_school_expenses_sod ON public.school_expenses;
CREATE TRIGGER trg_school_expenses_sod BEFORE INSERT OR UPDATE ON public.school_expenses FOR EACH ROW EXECUTE FUNCTION public.school_expenses_sod_guard();

DROP FUNCTION IF EXISTS public.cg_fee_actor_holds(uuid, uuid, text);

UPDATE public.role_template_permissions SET default_on = true
 WHERE template_code = 'accountant' AND permission_code = 'payments.record_cash' AND kind = 'optional';
DELETE FROM public.sod_permission_rules
 WHERE permission_a = 'payments.record_cash' AND permission_b = 'payments.refund';

COMMIT;
