-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- M9 finance core, part A (ADR-119). Rollback: database/supabase/rollbacks/20261117003300_sherivs_m9_finance_core.sql
-- Test: tests/sql/m9-finance-core.sql (reproduces every gap below before this file, proves the fix after it).
--
-- Extends what is already applied in production; creates no second fees engine and no second approval engine:
--   * M07 fees ledger (cg_fee_*, 20261103130000), A05 relief (fee_adjustments), cg_financial_* (Paystack),
--     staff_payroll / school_expenses SoD guards (017), the role engine SoD rules (sod_permission_rules).
-- Closes, in the database:
--   1. Payroll: the preparer is the caller on INSERT (it was client-sent), an approved line needs a named approver who is
--      neither the preparer nor the payee, the approver is fixed once set, and an approved or paid line's amounts are frozen.
--   2. Expenses: the raiser is the caller on INSERT (it was client-sent), so nobody can approve an expense they raised by
--      naming someone else as raiser; an approved expense needs a recorded raiser.
--   3. Payroll and expense changes are audited (scholar_audit).
--   4. Refunds: a person who holds payments.record_cash, or who recorded the payment, cannot decide a fee refund or start
--      an online (Paystack) reversal. New SoD rule payments.record_cash x payments.refund.
--   5. Cash day close (cashier counts the drawer; expected totals come from the ledger, never from the client) and cash
--      reconciliation by someone who is not the cashier for that day and recorded no payment there that day.
--   6. Accountant template: payments.record_cash is no longer on by default (it collides with the mandatory
--      payments.reconcile under the existing SoD rule, so every default accountant assignment failed).
--   7. Approved A05 relief posts into the M07 ledger (contra-revenue account fee_relief), so a term with relief balances.
-- No top-level BEGIN/COMMIT: the runner wraps the file in one transaction. Re-running the file is safe.

DO $guard$
BEGIN
  IF to_regclass('public.cg_fee_ledger_posting') IS NULL
     OR to_regclass('public.fee_adjustments') IS NULL
     OR to_regclass('public.cg_financial_reversal') IS NULL
     OR to_regclass('public.staff_payroll') IS NULL
     OR to_regclass('public.school_expenses') IS NULL
     OR to_regclass('public.sod_permission_rules') IS NULL
     OR to_regprocedure('public.workspace_effective_permission_rows(uuid,uuid)') IS NULL
     OR to_regprocedure('public.scholar_audit()') IS NULL THEN
    RAISE EXCEPTION 'M9 requires M07, A05, cg_financial, 017 payroll/expense guards and the role engine'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

-- ============ 0. Catalogue data ============
INSERT INTO public.sod_permission_rules (permission_a, permission_b, description) VALUES
  ('payments.record_cash', 'payments.refund', 'A cashier cannot decide or issue refunds')
ON CONFLICT (permission_a, permission_b) DO NOTHING;

UPDATE public.role_template_permissions
   SET default_on = false
 WHERE template_code = 'accountant'
   AND permission_code = 'payments.record_cash'
   AND kind = 'optional'
   AND default_on IS DISTINCT FROM false;

-- ============ 1. Who holds a permission (role engine; internal) ============
CREATE OR REPLACE FUNCTION public.cg_fee_actor_holds(p_org uuid, p_user uuid, p_permission text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_org IS NOT NULL AND p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_effective_permission_rows(p_org, p_user) e
     WHERE e.permission_code = p_permission
  )
$$;
REVOKE ALL ON FUNCTION public.cg_fee_actor_holds(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ============ 2. Payroll guard ============
CREATE OR REPLACE FUNCTION public.staff_payroll_sod_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_money_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NOT NULL THEN NEW.prepared_by := v_actor; END IF;          -- the preparer is the caller, never client-sent
  ELSE
    NEW.prepared_by := OLD.prepared_by;                                      -- preparer is immutable ...
    v_money_changed := (OLD.school_id, OLD.user_id, OLD.month, OLD.year, OLD.basic_salary, OLD.housing_allowance,
                        OLD.transport_allowance, OLD.other_allowances, OLD.tax_deduction, OLD.pension_deduction,
                        OLD.other_deductions, OLD.loan_deduction)
      IS DISTINCT FROM (NEW.school_id, NEW.user_id, NEW.month, NEW.year, NEW.basic_salary, NEW.housing_allowance,
                        NEW.transport_allowance, NEW.other_allowances, NEW.tax_deduction, NEW.pension_deduction,
                        NEW.other_deductions, NEW.loan_deduction);
    IF OLD.status = 'paid' AND NEW.status IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'payroll_locked: a paid payroll line is final' USING ERRCODE = '42501';
    END IF;
    IF OLD.status IN ('approved', 'paid') AND v_money_changed THEN
      RAISE EXCEPTION 'payroll_locked: return the line to draft before changing an approved line' USING ERRCODE = '42501';
    END IF;
    -- ... except that whoever changes a draft's amounts becomes its preparer, so they cannot approve their own figures
    IF OLD.status = 'draft' AND v_money_changed AND v_actor IS NOT NULL THEN NEW.prepared_by := v_actor; END IF;
  END IF;

  IF NEW.status IS NULL OR NEW.status = 'draft' THEN
    NEW.approved_by := NULL;                                                 -- a draft has no approver
  ELSIF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved' AND OLD.status IS DISTINCT FROM 'paid' THEN
    IF v_actor IS NOT NULL THEN NEW.approved_by := v_actor; END IF;
    IF NEW.approved_by IS NULL OR NEW.prepared_by IS NULL THEN
      RAISE EXCEPTION 'no_self_payroll_approval: an approved line needs a named preparer and approver' USING ERRCODE = '42501';
    END IF;
    IF NEW.approved_by = NEW.user_id THEN
      RAISE EXCEPTION 'no_self_payroll_approval: you cannot approve your own payroll line' USING ERRCODE = '42501'; END IF;
    IF NEW.approved_by = NEW.prepared_by THEN
      RAISE EXCEPTION 'no_self_payroll_approval: preparer and approver must be different people' USING ERRCODE = '42501'; END IF;
  ELSE
    NEW.approved_by := OLD.approved_by;                                      -- approved -> paid keeps the approver
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.staff_payroll_sod_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_staff_payroll_sod ON public.staff_payroll;
CREATE TRIGGER trg_staff_payroll_sod BEFORE INSERT OR UPDATE ON public.staff_payroll
  FOR EACH ROW EXECUTE FUNCTION public.staff_payroll_sod_guard();

-- ============ 3. Expense guard ============
CREATE OR REPLACE FUNCTION public.school_expenses_sod_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_limit numeric; v_has_roles boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NOT NULL THEN NEW.created_by := v_actor; END IF;           -- the raiser is the caller, never client-sent
  ELSE
    NEW.created_by := OLD.created_by;
  END IF;
  IF NEW.approved_by IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.approved_by IS DISTINCT FROM NEW.approved_by OR OLD.amount IS DISTINCT FROM NEW.amount) THEN
    IF v_actor IS NOT NULL THEN NEW.approved_by := v_actor; END IF;
    IF NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'no_self_expense_approval: an approved expense needs a recorded raiser' USING ERRCODE = '42501'; END IF;
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
REVOKE ALL ON FUNCTION public.school_expenses_sod_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_school_expenses_sod ON public.school_expenses;
CREATE TRIGGER trg_school_expenses_sod BEFORE INSERT OR UPDATE ON public.school_expenses
  FOR EACH ROW EXECUTE FUNCTION public.school_expenses_sod_guard();

-- ============ 4. Audit payroll and expenses ============
DROP TRIGGER IF EXISTS trg_staff_payroll_audit ON public.staff_payroll;
CREATE TRIGGER trg_staff_payroll_audit AFTER INSERT OR UPDATE OR DELETE ON public.staff_payroll
  FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();
DROP TRIGGER IF EXISTS trg_school_expenses_audit ON public.school_expenses;
CREATE TRIGGER trg_school_expenses_audit AFTER INSERT OR UPDATE OR DELETE ON public.school_expenses
  FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();

-- ============ 5. Refund separation of duties (table level, every caller) ============
-- BEFORE triggers use tenant_id: generated columns (school_id) are not computed yet.
CREATE OR REPLACE FUNCTION public.cg_fee_refund_decision_sod_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.cg_fee_refund_request%ROWTYPE; v_payment public.cg_fee_payment%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.cg_fee_refund_request WHERE id = NEW.request_id;
  SELECT * INTO v_payment FROM public.cg_fee_payment WHERE id = NEW.payment_id;
  IF NEW.decided_by = v_request.requested_by THEN
    RAISE EXCEPTION 'separation of duties: requester cannot approve or reject their own refund' USING ERRCODE = '42501';
  END IF;
  IF NEW.decided_by = v_payment.recorded_by THEN
    RAISE EXCEPTION 'separation of duties: the person who recorded a payment cannot decide its refund' USING ERRCODE = '42501';
  END IF;
  IF public.cg_fee_actor_holds(NEW.tenant_id::uuid, NEW.decided_by, 'payments.record_cash') THEN
    RAISE EXCEPTION 'separation of duties: a cashier cannot decide refunds' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cg_fee_refund_decision_sod_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS cg_fee_refund_decision_sod ON public.cg_fee_refund_decision;
CREATE TRIGGER cg_fee_refund_decision_sod BEFORE INSERT ON public.cg_fee_refund_decision
  FOR EACH ROW EXECUTE FUNCTION public.cg_fee_refund_decision_sod_guard();

CREATE OR REPLACE FUNCTION public.cg_financial_reversal_sod_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF NEW.requested_by !~* v_uuid OR NEW.tenant_id !~* v_uuid THEN
    RAISE EXCEPTION 'separation of duties: a refund must be requested by a named person of the organization' USING ERRCODE = '42501';
  END IF;
  IF public.cg_fee_actor_holds(NEW.tenant_id::uuid, NEW.requested_by::uuid, 'payments.record_cash') THEN
    RAISE EXCEPTION 'separation of duties: a cashier cannot issue refunds' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cg_financial_reversal_sod_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS cg_financial_reversal_sod ON public.cg_financial_reversal;
CREATE TRIGGER cg_financial_reversal_sod BEFORE INSERT ON public.cg_financial_reversal
  FOR EACH ROW EXECUTE FUNCTION public.cg_financial_reversal_sod_guard();

-- ============ 6. Authorization: add the reconciler pairs to the M07 gate (otherwise unchanged) ============
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
       OR (p_permission = 'payments.reconcile' AND p_role_template IN ('bursar', 'accountant'))
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

-- ============ 7. Cash day close and reconciliation ============
-- Business day is the organization's local day (Africa/Lagos, WAT, no DST).
CREATE OR REPLACE FUNCTION public.cg_fee_business_date(p_at timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT (p_at AT TIME ZONE 'Africa/Lagos')::date $$;
REVOKE ALL ON FUNCTION public.cg_fee_business_date(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cg_fee_business_date(timestamptz) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.cg_fee_cash_day_close (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  school_id uuid GENERATED ALWAYS AS (tenant_id::uuid) STORED REFERENCES public.schools(id) ON DELETE RESTRICT,
  campus_id uuid NOT NULL,
  business_date date NOT NULL,
  cashier_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  expected_cash_kobo bigint NOT NULL CHECK (expected_cash_kobo >= 0),
  expected_pos_kobo bigint NOT NULL CHECK (expected_pos_kobo >= 0),
  payment_count integer NOT NULL CHECK (payment_count >= 0),
  counted_cash_kobo bigint NOT NULL CHECK (counted_cash_kobo >= 0),
  counted_pos_kobo bigint NOT NULL CHECK (counted_pos_kobo >= 0),
  variance_kobo bigint GENERATED ALWAYS AS
    ((counted_cash_kobo + counted_pos_kobo) - (expected_cash_kobo + expected_pos_kobo)) STORED,
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  closed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, campus_id, business_date, cashier_id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (id, tenant_id, campus_id, business_date, cashier_id),
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT,
  FOREIGN KEY (campus_id, school_id) REFERENCES public.campuses (id, school_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.cg_fee_cash_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  school_id uuid GENERATED ALWAYS AS (tenant_id::uuid) STORED REFERENCES public.schools(id) ON DELETE RESTRICT,
  day_close_id uuid NOT NULL UNIQUE,
  campus_id uuid NOT NULL,
  business_date date NOT NULL,
  cashier_id uuid NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('matched', 'variance_accepted', 'variance_escalated')),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
  reconciled_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reconciled_by <> cashier_id),
  FOREIGN KEY (day_close_id, tenant_id, campus_id, business_date, cashier_id)
    REFERENCES public.cg_fee_cash_day_close (id, tenant_id, campus_id, business_date, cashier_id) ON DELETE RESTRICT,
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT
);

ALTER TABLE public.cg_fee_cash_day_close ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_fee_cash_day_close FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_fee_cash_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_fee_cash_reconciliation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cg_fee_cash_day_close, public.cg_fee_cash_reconciliation FROM PUBLIC, anon, authenticated, service_role;
-- Writes go only through the SECURITY DEFINER functions below; reads follow the M07 read rule
-- (own rows for the cashier, fees.view holders and organization administrators otherwise).
GRANT SELECT ON public.cg_fee_cash_day_close, public.cg_fee_cash_reconciliation TO authenticated, service_role;
DROP POLICY IF EXISTS cg_fee_cash_day_close_tenant_read ON public.cg_fee_cash_day_close;
CREATE POLICY cg_fee_cash_day_close_tenant_read ON public.cg_fee_cash_day_close FOR SELECT TO authenticated
  USING (public.cg_fee_can_read(tenant_id, school_id, campus_id, cashier_id::text));
DROP POLICY IF EXISTS cg_fee_cash_reconciliation_tenant_read ON public.cg_fee_cash_reconciliation;
CREATE POLICY cg_fee_cash_reconciliation_tenant_read ON public.cg_fee_cash_reconciliation FOR SELECT TO authenticated
  USING (public.cg_fee_can_read(tenant_id, school_id, campus_id, cashier_id::text));

DO $tables$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['cg_fee_cash_day_close', 'cg_fee_cash_reconciliation'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_table || '_append_only', v_table);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cg_fee_append_only()',
      v_table || '_append_only', v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_table || '_append_only_truncate', v_table);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.cg_fee_append_only()',
      v_table || '_append_only_truncate', v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || v_table || '_audit', v_table);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()',
      'trg_' || v_table || '_audit', v_table);
  END LOOP;
END
$tables$;

-- A closed day takes no more drawer money from that cashier at that campus.
CREATE OR REPLACE FUNCTION public.cg_fee_payment_day_open_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.method IN ('cash', 'pos') AND EXISTS (
    SELECT 1 FROM public.cg_fee_cash_day_close d
     WHERE d.tenant_id = NEW.tenant_id AND d.campus_id = NEW.campus_id AND d.cashier_id = NEW.recorded_by
       AND d.business_date = public.cg_fee_business_date(coalesce(NEW.recorded_at, now()))
  ) THEN
    RAISE EXCEPTION 'cash day is closed for this cashier at this campus' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cg_fee_payment_day_open_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS cg_fee_payment_day_open ON public.cg_fee_payment;
CREATE TRIGGER cg_fee_payment_day_open BEFORE INSERT ON public.cg_fee_payment
  FOR EACH ROW EXECUTE FUNCTION public.cg_fee_payment_day_open_guard();

-- Whoever reconciles is not the cashier for that day: not the closer, recorded no payment at that campus that day,
-- and holds no cash-recording permission. Enforced on the table, so no caller can skip it.
CREATE OR REPLACE FUNCTION public.cg_fee_cash_reconciliation_sod_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.reconciled_by = NEW.cashier_id OR EXISTS (
    SELECT 1 FROM public.cg_fee_payment p
     WHERE p.tenant_id = NEW.tenant_id AND p.campus_id = NEW.campus_id AND p.recorded_by = NEW.reconciled_by
       AND public.cg_fee_business_date(p.recorded_at) = NEW.business_date
  ) THEN
    RAISE EXCEPTION 'separation of duties: the cashier for that day cannot reconcile it' USING ERRCODE = '42501';
  END IF;
  IF public.cg_fee_actor_holds(NEW.tenant_id::uuid, NEW.reconciled_by, 'payments.record_cash') THEN
    RAISE EXCEPTION 'separation of duties: a cashier cannot reconcile' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cg_fee_cash_reconciliation_sod_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS cg_fee_cash_reconciliation_sod ON public.cg_fee_cash_reconciliation;
CREATE TRIGGER cg_fee_cash_reconciliation_sod BEFORE INSERT ON public.cg_fee_cash_reconciliation
  FOR EACH ROW EXECUTE FUNCTION public.cg_fee_cash_reconciliation_sod_guard();

CREATE OR REPLACE FUNCTION public.cg_fee_close_cash_day(
  p_scope_ref text,
  p_campus_id uuid,
  p_business_date date,
  p_counted_cash_kobo bigint,
  p_counted_pos_kobo bigint,
  p_idempotency_key text,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_ctx record;
  v_existing public.cg_fee_cash_day_close%ROWTYPE;
  v_row public.cg_fee_cash_day_close%ROWTYPE;
  v_cash bigint; v_pos bigint; v_count integer;
BEGIN
  SELECT * INTO v_ctx FROM public.cg_fee_authorize(
    p_scope_ref, 'payments.record_cash', 'cashier', 'campus', p_campus_id::text
  );
  SELECT * INTO v_existing FROM public.cg_fee_cash_day_close
   WHERE tenant_id = v_ctx.tenant_id AND idempotency_key = btrim(p_idempotency_key);
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.campus_id IS DISTINCT FROM p_campus_id
       OR v_existing.business_date IS DISTINCT FROM p_business_date
       OR v_existing.cashier_id IS DISTINCT FROM v_ctx.actor_id
       OR v_existing.counted_cash_kobo IS DISTINCT FROM p_counted_cash_kobo
       OR v_existing.counted_pos_kobo IS DISTINCT FROM p_counted_pos_kobo THEN
      RAISE EXCEPTION 'day close idempotency key conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('day_close_id', v_existing.id, 'variance_kobo', v_existing.variance_kobo, 'duplicate', true);
  END IF;
  IF p_business_date IS NULL OR p_business_date > public.cg_fee_business_date(now())
     OR p_counted_cash_kobo IS NULL OR p_counted_cash_kobo < 0
     OR p_counted_pos_kobo IS NULL OR p_counted_pos_kobo < 0
     OR p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 200
     OR (p_note IS NOT NULL AND length(btrim(p_note)) NOT BETWEEN 1 AND 500) THEN
    RAISE EXCEPTION 'invalid day close' USING ERRCODE = '22023';
  END IF;
  -- Serialize with this cashier's own payment inserts for the day (same campus).
  PERFORM pg_advisory_xact_lock(hashtextextended('cg_fee_day:' || v_ctx.tenant_id || ':' || p_campus_id || ':' || v_ctx.actor_id, 0));
  SELECT coalesce(sum(p.amount_kobo) FILTER (WHERE p.method = 'cash'), 0)::bigint,
         coalesce(sum(p.amount_kobo) FILTER (WHERE p.method = 'pos'), 0)::bigint,
         count(*)::integer
    INTO v_cash, v_pos, v_count
    FROM public.cg_fee_payment p
   WHERE p.tenant_id = v_ctx.tenant_id AND p.campus_id = p_campus_id AND p.recorded_by = v_ctx.actor_id
     AND p.method IN ('cash', 'pos') AND public.cg_fee_business_date(p.recorded_at) = p_business_date;
  INSERT INTO public.cg_fee_cash_day_close (
    scope_ref, tenant_id, org_ref, campus_id, business_date, cashier_id, expected_cash_kobo, expected_pos_kobo,
    payment_count, counted_cash_kobo, counted_pos_kobo, note, idempotency_key
  ) VALUES (
    p_scope_ref, v_ctx.tenant_id, v_ctx.org_ref, p_campus_id, p_business_date, v_ctx.actor_id, v_cash, v_pos,
    v_count, p_counted_cash_kobo, p_counted_pos_kobo, nullif(btrim(p_note), ''), btrim(p_idempotency_key)
  ) RETURNING * INTO v_row;
  RETURN jsonb_build_object('day_close_id', v_row.id, 'expected_cash_kobo', v_cash, 'expected_pos_kobo', v_pos,
    'payment_count', v_count, 'variance_kobo', v_row.variance_kobo, 'duplicate', false);
END
$$;

CREATE OR REPLACE FUNCTION public.cg_fee_reconcile_cash_day(
  p_day_close_id uuid,
  p_verdict text,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_close public.cg_fee_cash_day_close%ROWTYPE;
  v_ctx record;
  v_existing public.cg_fee_cash_reconciliation%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_close FROM public.cg_fee_cash_day_close WHERE id = p_day_close_id;
  IF v_close.id IS NULL THEN RAISE EXCEPTION 'day close is unavailable' USING ERRCODE = '42501'; END IF;
  BEGIN
    SELECT * INTO v_ctx FROM public.cg_fee_authorize(v_close.scope_ref, 'payments.reconcile', 'bursar', 'campus', v_close.campus_id::text);
  EXCEPTION WHEN insufficient_privilege THEN
    SELECT * INTO v_ctx FROM public.cg_fee_authorize(v_close.scope_ref, 'payments.reconcile', 'accountant', 'campus', v_close.campus_id::text);
  END;
  SELECT * INTO v_existing FROM public.cg_fee_cash_reconciliation WHERE day_close_id = p_day_close_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.verdict IS DISTINCT FROM p_verdict OR v_existing.reconciled_by IS DISTINCT FROM v_ctx.actor_id THEN
      RAISE EXCEPTION 'day is already reconciled differently' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('reconciliation_id', v_existing.id, 'verdict', v_existing.verdict, 'duplicate', true);
  END IF;
  IF p_verdict IS NULL OR p_verdict NOT IN ('matched', 'variance_accepted', 'variance_escalated')
     OR (v_close.variance_kobo = 0) <> (p_verdict = 'matched')
     OR (p_verdict <> 'matched' AND (p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 5 AND 500))
     OR (p_note IS NOT NULL AND length(btrim(p_note)) NOT BETWEEN 1 AND 500) THEN
    RAISE EXCEPTION 'invalid reconciliation: matched only without variance; a variance needs a note' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cg_fee_cash_reconciliation (
    scope_ref, tenant_id, org_ref, day_close_id, campus_id, business_date, cashier_id, verdict, note, reconciled_by
  ) VALUES (
    v_close.scope_ref, v_close.tenant_id, v_close.org_ref, v_close.id, v_close.campus_id, v_close.business_date,
    v_close.cashier_id, p_verdict, nullif(btrim(p_note), ''), v_ctx.actor_id
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('reconciliation_id', v_id, 'verdict', p_verdict, 'duplicate', false);
END
$$;

-- ============ 8. Relief (A05) posts into the M07 ledger ============
ALTER TABLE public.cg_fee_ledger_posting
  ADD COLUMN IF NOT EXISTS adjustment_id uuid REFERENCES public.fee_adjustments(id) ON DELETE RESTRICT;
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
ALTER TABLE public.cg_fee_ledger_line DROP CONSTRAINT IF EXISTS cg_fee_ledger_line_account_code_check;
ALTER TABLE public.cg_fee_ledger_line ADD CONSTRAINT cg_fee_ledger_line_account_code_check
  CHECK (account_code IN ('accounts_receivable', 'fee_revenue', 'cash', 'fee_relief'));
CREATE UNIQUE INDEX IF NOT EXISTS cg_fee_relief_posting_once
  ON public.cg_fee_ledger_posting (invoice_id, adjustment_id) WHERE event_type = 'relief';

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

-- An invoice that carries relief cannot be reversed in full (it would drive the receivable below zero).
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
DROP TRIGGER IF EXISTS cg_fee_invoice_reversal_guard ON public.cg_fee_ledger_posting;
CREATE TRIGGER cg_fee_invoice_reversal_guard BEFORE INSERT ON public.cg_fee_ledger_posting
  FOR EACH ROW EXECUTE FUNCTION public.cg_fee_invoice_reversal_guard();

-- Posts an approved A05 adjustment against one M07 invoice. The amount comes from the adjustment and the invoice,
-- never from the caller; fixed relief is spent once across invoices; nobody posts relief they requested.
CREATE OR REPLACE FUNCTION public.cg_fee_post_relief(p_invoice_id uuid, p_adjustment_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_invoice public.cg_fee_invoice%ROWTYPE;
  v_schedule public.cg_fee_schedule%ROWTYPE;
  v_adj public.fee_adjustments%ROWTYPE;
  v_ctx record;
  v_existing public.cg_fee_ledger_posting%ROWTYPE;
  v_balance bigint; v_used bigint; v_amount bigint; v_posting uuid;
BEGIN
  SELECT * INTO v_invoice FROM public.cg_fee_invoice WHERE id = p_invoice_id;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'fee invoice is unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ctx FROM public.cg_fee_authorize(
    v_invoice.scope_ref, 'fees.manage_plans', 'bursar', 'campus', v_invoice.campus_id::text
  );
  SELECT * INTO v_invoice FROM public.cg_fee_invoice WHERE id = p_invoice_id FOR UPDATE;
  SELECT * INTO v_adj FROM public.fee_adjustments WHERE id = p_adjustment_id FOR SHARE;
  SELECT * INTO v_existing FROM public.cg_fee_ledger_posting
   WHERE invoice_id = p_invoice_id AND adjustment_id = p_adjustment_id AND event_type = 'relief';
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('posting_id', v_existing.id, 'amount_kobo', v_existing.amount_kobo, 'duplicate', true);
  END IF;
  SELECT * INTO v_schedule FROM public.cg_fee_schedule WHERE id = v_invoice.schedule_id;
  IF v_adj.id IS NULL OR v_adj.school_id IS DISTINCT FROM v_ctx.school_id
     OR v_adj.status <> 'approved'
     OR v_adj.student_id::text IS DISTINCT FROM v_invoice.subject_ref
     OR v_adj.academic_year IS DISTINCT FROM v_schedule.academic_year
     OR v_adj.term IS DISTINCT FROM v_schedule.term
     OR (v_adj.fee_type IS NOT NULL AND v_adj.fee_type IS DISTINCT FROM v_schedule.code) THEN
    RAISE EXCEPTION 'relief does not apply to this invoice' USING ERRCODE = '22023';
  END IF;
  IF v_adj.decided_by IS NULL OR v_adj.decided_by = v_adj.created_by OR v_ctx.actor_id = v_adj.created_by THEN
    RAISE EXCEPTION 'separation of duties: relief must be decided and posted by someone other than its requester'
      USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(sum(l.debit_kobo - l.credit_kobo), 0)::bigint INTO v_balance
    FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
   WHERE p.invoice_id = p_invoice_id AND l.account_code = 'accounts_receivable';
  IF v_adj.mode = 'percent' THEN
    v_amount := round(v_invoice.amount_kobo * v_adj.value / 100)::bigint;
  ELSE
    SELECT coalesce(sum(p.amount_kobo), 0)::bigint INTO v_used
      FROM public.cg_fee_ledger_posting p WHERE p.adjustment_id = p_adjustment_id AND p.event_type = 'relief';
    v_amount := round(v_adj.value * 100)::bigint - v_used;
  END IF;
  v_amount := least(v_amount, v_balance);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'nothing left to relieve on this invoice' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.cg_fee_ledger_posting (
    scope_ref, tenant_id, org_ref, invoice_id, campus_id, subject_ref, principal_ref, event_type, amount_kobo,
    actor_id, adjustment_id
  ) VALUES (
    v_invoice.scope_ref, v_invoice.tenant_id, v_invoice.org_ref, v_invoice.id, v_invoice.campus_id,
    v_invoice.subject_ref, v_invoice.principal_ref, 'relief', v_amount, v_ctx.actor_id, v_adj.id
  ) RETURNING id INTO v_posting;
  INSERT INTO public.cg_fee_ledger_line (posting_id, tenant_id, campus_id, principal_ref, account_code, debit_kobo, credit_kobo)
  VALUES
    (v_posting, v_invoice.tenant_id, v_invoice.campus_id, v_invoice.principal_ref, 'fee_relief', v_amount, 0),
    (v_posting, v_invoice.tenant_id, v_invoice.campus_id, v_invoice.principal_ref, 'accounts_receivable', 0, v_amount);
  RETURN jsonb_build_object('posting_id', v_posting, 'amount_kobo', v_amount, 'duplicate', false);
END
$$;

-- ============ 9. Function privileges ============
REVOKE ALL ON FUNCTION public.cg_fee_close_cash_day(text, uuid, date, bigint, bigint, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cg_fee_reconcile_cash_day(uuid, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cg_fee_post_relief(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cg_fee_close_cash_day(text, uuid, date, bigint, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cg_fee_reconcile_cash_day(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cg_fee_post_relief(uuid, uuid) TO authenticated;
