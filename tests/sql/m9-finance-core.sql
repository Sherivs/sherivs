-- Disposable proof for 20261117003300_sherivs_m9_finance_core.sql (ADR-119).
-- Builds a small production-shaped fixture on an EMPTY database, replays the REAL applied migrations for the money
-- tables (cg_financial_scope, Paystack refund reconciliation, M07 fees ledger, A05 relief), recreates staff_payroll,
-- school_expenses and their guards exactly as production has them (column shapes and function bodies read with a
-- read-only SELECT on 2026-11-17), reproduces every gap, applies the M9 migration, and proves each rule:
-- positive, negative, cross-organization, a second run, and the rollback.
-- The role engine is a labelled fixture: assignments resolve through the real role_template_permissions rows for the
-- finance templates and the real SoD rule loop; it is not a replay of the production role engine.
-- Run as a superuser, from the repository root:
--   psql -d m9_test -v ON_ERROR_STOP=1 -f tests/sql/m9-finance-core.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- ---------- production-shaped core ----------
CREATE TABLE public.schools (id uuid PRIMARY KEY, name text);
CREATE TABLE public.users (id uuid PRIMARY KEY, school_id uuid REFERENCES public.schools(id), role text, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.campuses (id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES public.schools(id), name text, UNIQUE (id, school_id));
CREATE TABLE public.students (id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES public.schools(id), user_id uuid, parent_id uuid);
CREATE TABLE public.audit_logs (id bigserial PRIMARY KEY, school_id uuid, user_id uuid, action text, table_name text,
  record_id uuid, old_value jsonb, new_value jsonb);
CREATE TABLE public.cg_org_unit (id text NOT NULL, tenant_id text NOT NULL, kind text, created_by text, PRIMARY KEY (id), UNIQUE (id, tenant_id));
CREATE TABLE public.permission_catalog (code text PRIMARY KEY);
CREATE TABLE public.role_templates (code text PRIMARY KEY, guardrails text[] NOT NULL DEFAULT '{}', approval_limit_ngn numeric);
CREATE TABLE public.role_catalog (code text PRIMARY KEY, template_code text NOT NULL REFERENCES public.role_templates(code), org_id uuid);
CREATE TABLE public.role_template_permissions (template_code text NOT NULL REFERENCES public.role_templates(code),
  permission_code text NOT NULL REFERENCES public.permission_catalog(code), kind text NOT NULL, default_on boolean,
  PRIMARY KEY (template_code, permission_code));
CREATE TABLE public.sod_permission_rules (permission_a text NOT NULL REFERENCES public.permission_catalog(code),
  permission_b text NOT NULL REFERENCES public.permission_catalog(code), description text NOT NULL, PRIMARY KEY (permission_a, permission_b));
CREATE TABLE public.user_role_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, user_id uuid, role_code text,
  status text, scope_type text, scope_ref text);
-- Fixture role engine: one row per assignment; extra rows are custom grants.
CREATE TABLE public.fx_assignment (org_id uuid, user_id uuid, role_code text REFERENCES public.role_catalog(code), scope jsonb NOT NULL);
CREATE TABLE public.fx_custom_grant (org_id uuid, user_id uuid, role_code text, permission_code text);

INSERT INTO public.permission_catalog VALUES ('fees.view'),('fees.manage_plans'),('payments.record_cash'),('payments.reconcile'),
  ('payments.refund'),('expenses.create'),('expenses.approve'),('payroll.prepare'),('payroll.approve'),('payroll.view_all'),
  ('reports.financial'),('audit.view'),('wallet.view'),('budget.manage');
INSERT INTO public.role_templates (code, guardrails) VALUES ('bursar','{no_self_expense_approval}'),('accountant','{}'),('cashier','{}'),
  ('payroll','{no_self_payroll_approval}'),('auditor','{auditor_independence}');
INSERT INTO public.role_catalog (code, template_code) SELECT code, code FROM public.role_templates;
-- Exactly the production rows for these templates and permissions (read-only SELECT, 2026-11-17).
INSERT INTO public.role_template_permissions VALUES
  ('accountant','budget.manage','optional',true),('accountant','expenses.create','mandatory',true),('accountant','fees.view','mandatory',true),
  ('accountant','payments.reconcile','mandatory',true),('accountant','payments.record_cash','optional',true),
  ('accountant','payroll.prepare','optional',false),('accountant','reports.financial','mandatory',true),('accountant','wallet.view','optional',true),
  ('auditor','audit.view','mandatory',true),('auditor','fees.view','mandatory',true),('auditor','payroll.view_all','mandatory',true),
  ('auditor','reports.financial','mandatory',true),
  ('bursar','budget.manage','mandatory',true),('bursar','expenses.approve','optional',true),('bursar','expenses.create','optional',false),
  ('bursar','fees.manage_plans','mandatory',true),('bursar','fees.view','mandatory',true),('bursar','payments.reconcile','mandatory',true),
  ('bursar','payments.record_cash','optional',false),('bursar','payments.refund','optional',true),('bursar','payroll.approve','optional',true),
  ('bursar','payroll.view_all','optional',true),('bursar','reports.financial','mandatory',true),('bursar','wallet.view','mandatory',true),
  ('cashier','fees.view','mandatory',true),('cashier','payments.record_cash','mandatory',true),('cashier','wallet.view','optional',true),
  ('payroll','payroll.prepare','mandatory',true),('payroll','payroll.view_all','mandatory',true),('payroll','reports.financial','optional',true);
INSERT INTO public.sod_permission_rules VALUES
  ('expenses.create','expenses.approve','Raiser and approver of the same expense must be different people'),
  ('payments.record_cash','payments.reconcile','Cash recorded by a person is reconciled by someone else'),
  ('payroll.prepare','payroll.approve','Preparer and approver of the same payroll line must be different people');

CREATE FUNCTION public.get_my_school_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT u.school_id FROM public.users u WHERE u.id = auth.uid() AND u.is_active $$;
CREATE FUNCTION public.get_my_tenant_id() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT public.get_my_school_id()::text $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT false $$;
CREATE FUNCTION public.my_active_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT u.role FROM public.users u WHERE u.id = auth.uid() $$;
CREATE FUNCTION public.is_tenant_admin(p_tenant text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.school_id::text = p_tenant AND u.role = 'admin') $$;
CREATE FUNCTION public.is_guardian_of_student(p_student uuid, p_school uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT false $$;
CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE FUNCTION public.workspace_effective_permission_rows(p_org uuid, p_user uuid)
RETURNS TABLE (permission_code text, kind text, role_code text, assignment_id uuid, scope_type text, scope_ref text, scope_values jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT tp.permission_code, tp.kind, a.role_code, NULL::uuid, a.scope->>'type', a.scope->>'ref', jsonb_build_array(a.scope)
    FROM public.fx_assignment a JOIN public.role_catalog r ON r.code = a.role_code
    JOIN public.role_template_permissions tp ON tp.template_code = r.template_code
   WHERE a.org_id = p_org AND a.user_id = p_user AND (tp.kind = 'mandatory' OR coalesce(tp.default_on, false))
  UNION ALL
  SELECT g.permission_code, 'custom', g.role_code, NULL::uuid, a.scope->>'type', a.scope->>'ref', jsonb_build_array(a.scope)
    FROM public.fx_custom_grant g JOIN public.fx_assignment a ON a.org_id = g.org_id AND a.user_id = g.user_id AND a.role_code = g.role_code
   WHERE g.org_id = p_org AND g.user_id = p_user
$$;
CREATE FUNCTION public.effective_permissions(p_org uuid, p_user uuid DEFAULT NULL)
RETURNS TABLE (permission_code text, kind text, role_codes text[], scopes jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.permission_code, min(e.kind), array_agg(e.role_code), jsonb_agg(e.scope_values)
    FROM public.workspace_effective_permission_rows(p_org, coalesce(p_user, auth.uid())) e GROUP BY e.permission_code
$$;
-- Same generic loop as production's workspace_role_sod_assert_at (the rules table decides).
CREATE FUNCTION public.workspace_role_sod_assert(p_org uuid, p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_conflict text;
BEGIN
  SELECT r.description INTO v_conflict FROM public.sod_permission_rules r
   WHERE EXISTS (SELECT 1 FROM public.workspace_effective_permission_rows(p_org, p_user) e WHERE e.permission_code = r.permission_a)
     AND EXISTS (SELECT 1 FROM public.workspace_effective_permission_rows(p_org, p_user) e WHERE e.permission_code = r.permission_b)
   LIMIT 1;
  IF v_conflict IS NOT NULL THEN RAISE EXCEPTION 'separation of duties: %', v_conflict USING ERRCODE = '42501'; END IF;
END $$;
CREATE FUNCTION public.has_permission(p_org uuid, p_perm text, p_scope_type text, p_scope_ref text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_effective_permission_rows(p_org, auth.uid()) e
                  WHERE e.permission_code = p_perm
                    AND (e.scope_type IN ('org','institution') OR (e.scope_type = p_scope_type AND e.scope_ref = p_scope_ref)))
$$;
-- Legacy bridge (as production): admin and principal hold everything; otherwise the role engine.
CREATE FUNCTION public.scholar_can(p_org uuid, p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_org = public.get_my_school_id() AND (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','principal'))
    OR EXISTS (SELECT 1 FROM public.workspace_effective_permission_rows(p_org, auth.uid()) e WHERE e.permission_code = p_perm))
$$;
-- Production scholar_audit (20261024000250).
CREATE FUNCTION public.scholar_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid; v_id uuid; v_actor uuid := auth.uid(); j jsonb := to_jsonb(coalesce(NEW, OLD));
BEGIN
  v_org := coalesce((j->>'school_id')::uuid, (j->>'org_id')::uuid);
  IF v_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.schools WHERE id = v_org) THEN RETURN NULL; END IF;
  BEGIN v_id := (j->>'id')::uuid; EXCEPTION WHEN others THEN v_id := NULL; END;
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
  VALUES (v_org, CASE WHEN EXISTS (SELECT 1 FROM public.users WHERE id = v_actor) THEN v_actor END,
          'scholar.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, v_id,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) || jsonb_build_object('actor', v_actor) END);
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION public.get_my_school_id(), public.get_my_tenant_id(), public.is_super_admin(), public.my_active_role(),
  public.is_tenant_admin(text), public.has_permission(uuid,text,text,text), public.scholar_can(uuid,text),
  public.effective_permissions(uuid,uuid) TO authenticated;
-- As production: the catalogue is readable by signed-in users; assignments are read through RLS there (no rows here).
GRANT SELECT ON public.permission_catalog, public.role_templates, public.role_catalog, public.role_template_permissions,
  public.sod_permission_rules, public.user_role_assignments TO authenticated;

-- ---------- replay the real applied money migrations ----------
\i database/supabase/migrations/20261101000060_cg_financial_scope.sql
\i database/supabase/migrations/20261102000100_sv1_paystack_refund_reconciliation.sql
\i database/supabase/migrations/20261103130000_sv1_m07_fees_ledger_receipts.sql
\i database/supabase/migrations/20261025100050_sherivs_a05_fee_relief_levies.sql

-- ---------- staff_payroll and school_expenses as production has them ----------
CREATE TABLE public.staff_payroll (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12), year integer NOT NULL,
  basic_salary numeric NOT NULL DEFAULT 0, housing_allowance numeric DEFAULT 0, transport_allowance numeric DEFAULT 0,
  other_allowances numeric DEFAULT 0, tax_deduction numeric DEFAULT 0, pension_deduction numeric DEFAULT 0,
  other_deductions numeric DEFAULT 0, loan_deduction numeric DEFAULT 0,
  gross_salary numeric GENERATED ALWAYS AS (basic_salary + COALESCE(housing_allowance,0) + COALESCE(transport_allowance,0) + COALESCE(other_allowances,0)) STORED,
  status text DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  payment_date date, approved_by uuid REFERENCES public.users(id), created_at timestamptz DEFAULT now(),
  prepared_by uuid REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  UNIQUE (school_id, user_id, month, year));
CREATE TABLE public.staff_loans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid, user_id uuid, balance numeric,
  monthly_deduction numeric, status text);
CREATE TABLE public.school_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  expense_title text NOT NULL, expense_category text NOT NULL, amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text DEFAULT 'NGN', expense_date date NOT NULL, approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_payroll, public.school_expenses TO authenticated;
GRANT ALL ON public.staff_payroll, public.school_expenses, public.staff_loans TO service_role;
ALTER TABLE public.staff_payroll ENABLE ROW LEVEL SECURITY; ALTER TABLE public.staff_payroll FORCE ROW LEVEL SECURITY;
ALTER TABLE public.school_expenses ENABLE ROW LEVEL SECURITY; ALTER TABLE public.school_expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_payroll_school_isolation ON public.staff_payroll FOR ALL TO authenticated
  USING (school_id = (SELECT public.get_my_school_id())) WITH CHECK (school_id = public.get_my_school_id());
CREATE POLICY e_read_scope ON public.staff_payroll AS RESTRICTIVE FOR SELECT TO public
  USING ((SELECT public.is_super_admin()) OR (SELECT public.my_active_role()) IN ('admin','principal','bursar','hq') OR user_id = (SELECT auth.uid()));
CREATE POLICY sv4_insert_role ON public.staff_payroll AS RESTRICTIVE FOR INSERT TO public WITH CHECK (public.is_super_admin() OR public.my_active_role() IN ('admin','principal'));
CREATE POLICY sv4_update_role ON public.staff_payroll AS RESTRICTIVE FOR UPDATE TO public USING (public.is_super_admin() OR public.my_active_role() IN ('admin','principal')) WITH CHECK (public.is_super_admin() OR public.my_active_role() IN ('admin','principal'));
CREATE POLICY expenses_school_rw ON public.school_expenses FOR ALL USING (school_id = public.get_my_school_id() OR public.is_super_admin())
  WITH CHECK (school_id = public.get_my_school_id() OR public.is_super_admin());
CREATE POLICY sv4_insert_role ON public.school_expenses AS RESTRICTIVE FOR INSERT TO public WITH CHECK (public.is_super_admin() OR public.my_active_role() IN ('admin','principal','bursar'));
CREATE POLICY sv4_update_role ON public.school_expenses AS RESTRICTIVE FOR UPDATE TO public USING (public.is_super_admin() OR public.my_active_role() IN ('admin','principal','bursar')) WITH CHECK (public.is_super_admin() OR public.my_active_role() IN ('admin','principal','bursar'));
CREATE TRIGGER trg_school_expenses_touch BEFORE UPDATE ON public.school_expenses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Production definitions (pg_get_functiondef, 2026-11-17; identical to 20261024000240 and 20261024000310).
CREATE OR REPLACE FUNCTION public.staff_payroll_sod_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.prepared_by := OLD.prepared_by; END IF;
  IF NEW.status IN ('approved', 'paid') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.approved_by IS DISTINCT FROM NEW.approved_by) THEN
    IF v_actor IS NOT NULL THEN NEW.approved_by := v_actor; END IF;
    IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.user_id THEN
      RAISE EXCEPTION 'no_self_payroll_approval: you cannot approve your own payroll line' USING ERRCODE = '42501'; END IF;
    IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.prepared_by THEN
      RAISE EXCEPTION 'no_self_payroll_approval: preparer and approver must be different people' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
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
CREATE TRIGGER trg_school_expenses_sod BEFORE INSERT OR UPDATE ON public.school_expenses FOR EACH ROW EXECUTE FUNCTION public.school_expenses_sod_guard();
CREATE OR REPLACE FUNCTION public.payroll_approve(p_school uuid, p_month integer, p_year integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE n int; r record;
BEGIN
  IF NOT public.scholar_can(p_school, 'payroll.approve') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  FOR r IN SELECT id, user_id, loan_deduction FROM public.staff_payroll WHERE school_id = p_school AND month = p_month AND year = p_year AND status = 'draft' FOR UPDATE LOOP
    UPDATE public.staff_payroll SET status = 'approved', approved_by = auth.uid() WHERE id = r.id;
    IF r.loan_deduction > 0 THEN
      UPDATE public.staff_loans SET balance = greatest(balance - least(monthly_deduction, balance), 0),
        status = CASE WHEN balance - least(monthly_deduction, balance) <= 0 THEN 'closed' ELSE status END WHERE user_id = r.user_id AND status = 'active';
    END IF;
  END LOOP;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN (SELECT count(*) FROM public.staff_payroll WHERE school_id = p_school AND month = p_month AND year = p_year AND status = 'approved');
END $function$;
REVOKE ALL ON FUNCTION public.payroll_approve(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_approve(uuid, integer, integer) TO authenticated;

-- ---------- people ----------
-- Organization A (…a1) has one campus (…c1); organization B (…b1) has one campus (…c2).
INSERT INTO public.schools VALUES ('99000000-0000-4000-8000-0000000000a1', 'M9 A'), ('99000000-0000-4000-8000-0000000000b1', 'M9 B');
INSERT INTO public.campuses VALUES ('99000000-0000-4000-8000-0000000000c1', '99000000-0000-4000-8000-0000000000a1', 'A main'),
  ('99000000-0000-4000-8000-0000000000c2', '99000000-0000-4000-8000-0000000000b1', 'B main');
INSERT INTO public.users (id, school_id, role) VALUES
  ('91000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-0000000000a1', 'admin'),     -- admin
  ('91000000-0000-4000-8000-000000000002', '99000000-0000-4000-8000-0000000000a1', 'teacher'),   -- cashier c1
  ('91000000-0000-4000-8000-000000000003', '99000000-0000-4000-8000-0000000000a1', 'teacher'),   -- cashier c2
  ('91000000-0000-4000-8000-000000000004', '99000000-0000-4000-8000-0000000000a1', 'bursar'),    -- bursar b1
  ('91000000-0000-4000-8000-000000000005', '99000000-0000-4000-8000-0000000000a1', 'bursar'),    -- bursar b2
  ('91000000-0000-4000-8000-000000000006', '99000000-0000-4000-8000-0000000000a1', 'teacher'),   -- accountant
  ('91000000-0000-4000-8000-000000000007', '99000000-0000-4000-8000-0000000000a1', 'admin'),     -- payroll preparer p1
  ('91000000-0000-4000-8000-000000000008', '99000000-0000-4000-8000-0000000000a1', 'principal'), -- payroll approver h1
  ('91000000-0000-4000-8000-000000000009', '99000000-0000-4000-8000-0000000000a1', 'teacher'),   -- auditor
  ('91000000-0000-4000-8000-00000000000a', '99000000-0000-4000-8000-0000000000a1', 'teacher'),   -- staff s1 (payee)
  ('91000000-0000-4000-8000-0000000000b4', '99000000-0000-4000-8000-0000000000b1', 'bursar');    -- bursar of B
INSERT INTO public.students VALUES ('92000000-0000-4000-8000-0000000000d1', '99000000-0000-4000-8000-0000000000a1'),
  ('92000000-0000-4000-8000-0000000000d2', '99000000-0000-4000-8000-0000000000a1')
  ON CONFLICT DO NOTHING;
INSERT INTO public.fx_assignment VALUES
  ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000002', 'cashier', '{"type":"campus","ref":"99000000-0000-4000-8000-0000000000c1"}'),
  ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000003', 'cashier', '{"type":"campus","ref":"99000000-0000-4000-8000-0000000000c1"}'),
  ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000004', 'bursar', '{"type":"org"}'),
  ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000005', 'bursar', '{"type":"org"}'),
  ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000006', 'accountant', '{"type":"org"}'),
  ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000009', 'auditor', '{"type":"org"}'),
  ('99000000-0000-4000-8000-0000000000b1', '91000000-0000-4000-8000-0000000000b4', 'bursar', '{"type":"org"}');

-- ---------- helpers ----------
CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;
-- Runs a statement as a role for a caller; returns 'ok:<rows>' or 'err:<SQLSTATE>'. Effects are kept on success.
CREATE FUNCTION pg_temp.try(p_role text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; result text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; result := 'ok:' || n;
  EXCEPTION WHEN others THEN result := 'err:' || SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN result;
END $$;
-- Runs a scalar query as a role for a caller and returns its text value (or err:<SQLSTATE>).
CREATE FUNCTION pg_temp.val(p_role text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE p_sql INTO v; EXCEPTION WHEN others THEN v := 'err:' || SQLSTATE; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v;
END $$;
CREATE TABLE pg_temp.ids (label text PRIMARY KEY, id uuid NOT NULL);
GRANT ALL ON pg_temp.ids TO PUBLIC;

\set A '''99000000-0000-4000-8000-0000000000a1'''
\set CAMPUS '''99000000-0000-4000-8000-0000000000c1'''
\set ADMIN '91000000-0000-4000-8000-000000000001'
\set C1 '91000000-0000-4000-8000-000000000002'
\set C2 '91000000-0000-4000-8000-000000000003'
\set B1 '91000000-0000-4000-8000-000000000004'
\set B2 '91000000-0000-4000-8000-000000000005'
\set ACC '91000000-0000-4000-8000-000000000006'
\set P1 '91000000-0000-4000-8000-000000000007'
\set H1 '91000000-0000-4000-8000-000000000008'
\set AUD '91000000-0000-4000-8000-000000000009'
\set S1 '91000000-0000-4000-8000-00000000000a'
\set BB '91000000-0000-4000-8000-0000000000b4'

\echo == scope binding (service role, as production provisions it) ==
INSERT INTO public.cg_org_unit VALUES ('m9-org-a', '99000000-0000-4000-8000-0000000000a1', 'organization', 'm9'),
  ('m9-org-b', '99000000-0000-4000-8000-0000000000b1', 'organization', 'm9');
SELECT pg_temp.expect('bind scope A', pg_temp.try('service_role', '',
  $q$SELECT public.cg_financial_bind_scope('m9-a', '99000000-0000-4000-8000-0000000000a1', 'm9-org-a', 'm9-fixture')$q$), 'ok:1');
SELECT pg_temp.expect('bind scope B', pg_temp.try('service_role', '',
  $q$SELECT public.cg_financial_bind_scope('m9-b', '99000000-0000-4000-8000-0000000000b1', 'm9-org-b', 'm9-fixture')$q$), 'ok:1');

-- =====================================================================================================
\echo == BEFORE M9: the gaps are real ==
BEGIN;
SELECT pg_temp.expect('gap: a payroll line can be inserted approved with a forged preparer',
  pg_temp.try('authenticated', :'P1', $q$INSERT INTO public.staff_payroll (school_id, user_id, month, year, basic_salary, status, prepared_by)
    VALUES ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-00000000000a', 1, 2027, 100000, 'approved', '91000000-0000-4000-8000-000000000008')$q$), 'ok:1');
SELECT pg_temp.expect('gap: an approved payroll line''s amount can be changed',
  pg_temp.try('authenticated', :'P1', $q$UPDATE public.staff_payroll SET basic_salary = 900000 WHERE month = 1 AND year = 2027$q$), 'ok:1');
SELECT pg_temp.expect('gap: a server path can approve a payroll line with no approver',
  pg_temp.try('service_role', '', $q$INSERT INTO public.staff_payroll (school_id, user_id, month, year, basic_salary, status)
    VALUES ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000002', 1, 2027, 1, 'approved')$q$), 'ok:1');
SELECT pg_temp.expect('gap: the raiser can approve their own expense by naming another raiser',
  pg_temp.try('authenticated', :'B1', $q$INSERT INTO public.school_expenses (school_id, expense_title, expense_category, amount, expense_date, created_by, approved_by)
    VALUES ('99000000-0000-4000-8000-0000000000a1', 'Diesel', 'utilities', 50000, current_date, '91000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000004')$q$), 'ok:1');
SELECT pg_temp.expect('gap: payroll and expense writes are not audited',
  (SELECT count(*)::text FROM public.audit_logs WHERE table_name IN ('staff_payroll', 'school_expenses')), '0');
SELECT pg_temp.expect('gap: a default accountant assignment violates the SoD rules',
  pg_temp.try('authenticated', :'ACC', $q$SELECT public.workspace_role_sod_assert('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000006')$q$), 'err:42501');
SELECT pg_temp.expect('gap: there is no cash day close at all',
  (to_regprocedure('public.cg_fee_close_cash_day(text,uuid,date,bigint,bigint,text,text)') IS NULL)::text, 'true');
ROLLBACK;

-- =====================================================================================================
\echo == apply the migration ==
\i database/supabase/migrations/20261117003300_sherivs_m9_finance_core.sql
\echo == apply it a second time (idempotent) ==
\i database/supabase/migrations/20261117003300_sherivs_m9_finance_core.sql
SELECT pg_temp.expect('the new SoD rule exists once',
  (SELECT count(*)::text FROM public.sod_permission_rules WHERE permission_a = 'payments.record_cash' AND permission_b = 'payments.refund'), '1');
SELECT pg_temp.expect('a default accountant assignment no longer violates SoD',
  pg_temp.try('authenticated', :'ACC', $q$SELECT public.workspace_role_sod_assert('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000006')$q$), 'ok:1');
BEGIN;
INSERT INTO public.fx_custom_grant VALUES ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000002', 'cashier', 'payments.refund');
SELECT pg_temp.expect('cashier + refund grant is refused by the SoD rules',
  pg_temp.try('authenticated', :'C1', $q$SELECT public.workspace_role_sod_assert('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000002')$q$), 'err:42501');
ROLLBACK;

-- =====================================================================================================
\echo == payroll: preparer is not approver, nobody approves their own line, approved lines are frozen ==
BEGIN;
SELECT pg_temp.expect('forged preparer on an approved insert is refused (preparer is the caller)',
  pg_temp.try('authenticated', :'P1', $q$INSERT INTO public.staff_payroll (school_id, user_id, month, year, basic_salary, status, prepared_by)
    VALUES ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-00000000000a', 2, 2027, 100000, 'approved', '91000000-0000-4000-8000-000000000008')$q$), 'err:42501');
SELECT pg_temp.expect('a server path cannot approve without a named approver',
  pg_temp.try('service_role', '', $q$INSERT INTO public.staff_payroll (school_id, user_id, month, year, basic_salary, status)
    VALUES ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000002', 2, 2027, 1, 'approved')$q$), 'err:42501');
SELECT pg_temp.expect('preparer drafts two lines (one is the approver''s own pay)',
  pg_temp.try('authenticated', :'P1', $q$INSERT INTO public.staff_payroll (school_id, user_id, month, year, basic_salary, prepared_by, approved_by) VALUES
    ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-00000000000a', 2, 2027, 100000, '91000000-0000-4000-8000-000000000008', '91000000-0000-4000-8000-000000000008'),
    ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000008', 2, 2027, 300000, NULL, NULL)$q$), 'ok:2');
SELECT pg_temp.expect('the drafts carry the real preparer and no approver',
  (SELECT string_agg(DISTINCT coalesce(prepared_by::text, '-') || '/' || coalesce(approved_by::text, '-'), ',') FROM public.staff_payroll WHERE month = 2),
  '91000000-0000-4000-8000-000000000007/-');
SELECT pg_temp.expect('the preparer cannot approve the month',
  pg_temp.try('authenticated', :'P1', $q$SELECT public.payroll_approve('99000000-0000-4000-8000-0000000000a1', 2, 2027)$q$), 'err:42501');
SELECT pg_temp.expect('the approver cannot approve a month that holds their own line',
  pg_temp.try('authenticated', :'H1', $q$SELECT public.payroll_approve('99000000-0000-4000-8000-0000000000a1', 2, 2027)$q$), 'err:42501');
SELECT pg_temp.expect('nobody was approved by the refused attempts',
  (SELECT count(*)::text FROM public.staff_payroll WHERE status <> 'draft'), '0');
-- someone else approves the approver's own line, then the approver approves the rest
SELECT pg_temp.expect('an admin who did not prepare approves the approver''s own line',
  pg_temp.try('authenticated', :'ADMIN', $q$UPDATE public.staff_payroll SET status = 'approved' WHERE user_id = '91000000-0000-4000-8000-000000000008' AND month = 2$q$), 'ok:1');
SELECT pg_temp.expect('the approver approves the remaining line',
  pg_temp.val('authenticated', :'H1', $q$SELECT public.payroll_approve('99000000-0000-4000-8000-0000000000a1', 2, 2027)::text$q$), '2');
SELECT pg_temp.expect('approved amounts are frozen',
  pg_temp.try('authenticated', :'P1', $q$UPDATE public.staff_payroll SET basic_salary = 900000 WHERE user_id = '91000000-0000-4000-8000-00000000000a' AND month = 2$q$), 'err:42501');
SELECT pg_temp.expect('approved -> paid keeps the approver',
  pg_temp.try('authenticated', :'P1', $q$UPDATE public.staff_payroll SET status = 'paid', approved_by = '91000000-0000-4000-8000-000000000007' WHERE user_id = '91000000-0000-4000-8000-00000000000a' AND month = 2$q$), 'ok:1');
SELECT pg_temp.expect('the paid line still names the real approver',
  (SELECT approved_by::text FROM public.staff_payroll WHERE user_id = '91000000-0000-4000-8000-00000000000a' AND month = 2), :'H1');
SELECT pg_temp.expect('a paid line is final',
  pg_temp.try('authenticated', :'ADMIN', $q$UPDATE public.staff_payroll SET status = 'draft' WHERE user_id = '91000000-0000-4000-8000-00000000000a' AND month = 2$q$), 'err:42501');
-- whoever changes a draft's figures becomes its preparer
SELECT pg_temp.expect('preparer drafts a March line',
  pg_temp.try('authenticated', :'P1', $q$INSERT INTO public.staff_payroll (school_id, user_id, month, year, basic_salary) VALUES ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-00000000000a', 3, 2027, 100000)$q$), 'ok:1');
SELECT pg_temp.expect('the approver edits the draft''s figures',
  pg_temp.try('authenticated', :'H1', $q$UPDATE public.staff_payroll SET basic_salary = 120000 WHERE month = 3$q$), 'ok:1');
SELECT pg_temp.expect('and so can no longer approve it',
  pg_temp.try('authenticated', :'H1', $q$SELECT public.payroll_approve('99000000-0000-4000-8000-0000000000a1', 3, 2027)$q$), 'err:42501');
SELECT pg_temp.expect('payroll writes are audited',
  ((SELECT count(*) FROM public.audit_logs WHERE table_name = 'staff_payroll') >= 5)::text, 'true');
SELECT pg_temp.expect('organization B''s bursar sees no payroll line of A',
  pg_temp.val('authenticated', :'BB', $q$SELECT count(*)::text FROM public.staff_payroll$q$), '0');
ROLLBACK;

\echo == expenses: nobody approves their own expense ==
BEGIN;
SELECT pg_temp.expect('forged raiser with self-approval is refused (raiser is the caller)',
  pg_temp.try('authenticated', :'B1', $q$INSERT INTO public.school_expenses (school_id, expense_title, expense_category, amount, expense_date, created_by, approved_by)
    VALUES ('99000000-0000-4000-8000-0000000000a1', 'Diesel', 'utilities', 50000, current_date, '91000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000004')$q$), 'err:42501');
SELECT pg_temp.expect('a raiser records an expense naming someone else as raiser',
  pg_temp.try('authenticated', :'B1', $q$INSERT INTO public.school_expenses (school_id, expense_title, expense_category, amount, expense_date, created_by)
    VALUES ('99000000-0000-4000-8000-0000000000a1', 'Chalk', 'supplies', 12000, current_date, '91000000-0000-4000-8000-000000000005')$q$), 'ok:1');
SELECT pg_temp.expect('the stored raiser is the caller, not the client value',
  (SELECT created_by::text FROM public.school_expenses WHERE expense_title = 'Chalk'), :'B1');
SELECT pg_temp.expect('the raiser cannot approve it',
  pg_temp.try('authenticated', :'B1', $q$UPDATE public.school_expenses SET approved_by = '91000000-0000-4000-8000-000000000005' WHERE expense_title = 'Chalk'$q$), 'err:42501');
SELECT pg_temp.expect('a second bursar approves it',
  pg_temp.try('authenticated', :'B2', $q$UPDATE public.school_expenses SET approved_by = '91000000-0000-4000-8000-000000000005' WHERE expense_title = 'Chalk'$q$), 'ok:1');
SELECT pg_temp.expect('the raiser cannot raise the amount of the approved expense',
  pg_temp.try('authenticated', :'B1', $q$UPDATE public.school_expenses SET amount = 99000 WHERE expense_title = 'Chalk'$q$), 'err:42501');
SELECT pg_temp.expect('a server path cannot store an approved expense without a raiser',
  pg_temp.try('service_role', '', $q$INSERT INTO public.school_expenses (school_id, expense_title, expense_category, amount, expense_date, approved_by)
    VALUES ('99000000-0000-4000-8000-0000000000a1', 'Ghost', 'misc', 1, current_date, '91000000-0000-4000-8000-000000000005')$q$), 'err:42501');
SELECT pg_temp.expect('expense writes are audited',
  ((SELECT count(*) FROM public.audit_logs WHERE table_name = 'school_expenses') >= 2)::text, 'true');
SELECT pg_temp.expect('organization B''s bursar sees no expense of A',
  pg_temp.val('authenticated', :'BB', $q$SELECT count(*)::text FROM public.school_expenses$q$), '0');
ROLLBACK;

-- =====================================================================================================
\echo == a synthetic term on the M07 ledger: invoices, payments, relief, refunds, reversal, day close, reconciliation ==
-- Amounts in kobo. Tuition NGN 100,000 = 10,000,000; development levy NGN 20,000 = 2,000,000.
INSERT INTO pg_temp.ids SELECT 'tuition', (pg_temp.val('authenticated', :'B1',
  $q$SELECT public.cg_fee_create_schedule('m9-a', 'TUITION', 'Tuition', '2026/2027', 'First', 10000000, current_date - 1)::text$q$))::uuid;
INSERT INTO pg_temp.ids SELECT 'levy', (pg_temp.val('authenticated', :'B1',
  $q$SELECT public.cg_fee_create_schedule('m9-a', 'DEVLEVY', 'Development levy', '2026/2027', 'First', 2000000, current_date - 1)::text$q$))::uuid;
SELECT pg_temp.expect('a cashier cannot create a fee schedule',
  pg_temp.try('authenticated', :'C1', $q$SELECT public.cg_fee_create_schedule('m9-a', 'X1', 'Cashier fee', '2026/2027', 'First', 1, current_date)$q$), 'err:42501');
SELECT pg_temp.expect('organization B''s bursar cannot write into A''s scope',
  pg_temp.try('authenticated', :'BB', $q$SELECT public.cg_fee_create_schedule('m9-a', 'X2', 'Cross fee', '2026/2027', 'First', 1, current_date)$q$), 'err:42501');

CREATE FUNCTION pg_temp.invoice(p_label text, p_schedule text, p_student text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.ids SELECT p_label, (pg_temp.val('authenticated', '91000000-0000-4000-8000-000000000004', format(
    $q$SELECT public.cg_fee_issue_invoice('m9-a', %L, '99000000-0000-4000-8000-0000000000c1', %L, 'guardian-of-' || %L, now() + interval '30 days')::text$q$,
    (SELECT id FROM pg_temp.ids WHERE label = p_schedule), p_student, p_student)))::uuid;
END $$;
SELECT pg_temp.invoice('i1', 'tuition', '92000000-0000-4000-8000-0000000000d1');
SELECT pg_temp.invoice('i2', 'levy', '92000000-0000-4000-8000-0000000000d1');
SELECT pg_temp.invoice('i3', 'tuition', '92000000-0000-4000-8000-0000000000d2');
SELECT pg_temp.invoice('i4', 'levy', '92000000-0000-4000-8000-0000000000d2');
SELECT pg_temp.expect('invoice amounts come from the schedule (no amount parameter exists)',
  (SELECT string_agg(amount_kobo::text, ',' ORDER BY amount_kobo) FROM public.cg_fee_invoice), '2000000,2000000,10000000,10000000');

\echo -- payments, replay and tampering
CREATE FUNCTION pg_temp.pay(p_uid text, p_invoice text, p_amount bigint, p_method text, p_key text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.val('authenticated', p_uid, format($q$SELECT public.cg_fee_record_payment(%L, %s, %L, %L)::text$q$,
    (SELECT id FROM pg_temp.ids WHERE label = p_invoice), p_amount, p_method, p_key))
$$;
SELECT pg_temp.expect('cashier 1 takes NGN 40,000 cash on I1',
  (pg_temp.pay(:'C1', 'i1', 4000000, 'cash', 'k-c1-1')::jsonb ->> 'duplicate'), 'false');
SELECT pg_temp.expect('the same offline submission replayed is a duplicate, not a second payment',
  (pg_temp.pay(:'C1', 'i1', 4000000, 'cash', 'k-c1-1')::jsonb ->> 'duplicate'), 'true');
SELECT pg_temp.expect('the same key with a different amount is refused',
  pg_temp.pay(:'C1', 'i1', 4500000, 'cash', 'k-c1-1'), 'err:23505');
SELECT pg_temp.expect('more than the outstanding balance is refused',
  pg_temp.pay(:'C1', 'i1', 6000001, 'cash', 'k-c1-over'), 'err:23514');
SELECT pg_temp.expect('a bursar cannot record cash (cashier role only)',
  pg_temp.pay(:'B1', 'i1', 100, 'cash', 'k-b1'), 'err:42501');
\echo -- cashier 1 closes the day
INSERT INTO pg_temp.ids SELECT 'close1', (pg_temp.val('authenticated', :'C1',
  $q$SELECT public.cg_fee_close_cash_day('m9-a', '99000000-0000-4000-8000-0000000000c1', public.cg_fee_business_date(now()), 4000000, 0, 'd-c1')->>'day_close_id'$q$))::uuid;
SELECT pg_temp.expect('cashier 1''s close: expected NGN 40,000 cash, no variance',
  (SELECT expected_cash_kobo || '/' || expected_pos_kobo || '/' || variance_kobo || '/' || cashier_id FROM public.cg_fee_cash_day_close WHERE id = (SELECT id FROM pg_temp.ids WHERE label = 'close1')),
  '4000000/0/0/' || :'C1');
SELECT pg_temp.expect('the same close replayed from the outbox is a duplicate',
  (pg_temp.val('authenticated', :'C1', $q$SELECT public.cg_fee_close_cash_day('m9-a', '99000000-0000-4000-8000-0000000000c1', public.cg_fee_business_date(now()), 4000000, 0, 'd-c1')::text$q$)::jsonb ->> 'duplicate'), 'true');
SELECT pg_temp.expect('a closed day takes no more cash from that cashier',
  pg_temp.pay(:'C1', 'i1', 100, 'cash', 'k-c1-late'), 'err:55000');
SELECT pg_temp.expect('cashier 2 takes NGN 100,000 by POS on I3',
  (pg_temp.pay(:'C2', 'i3', 10000000, 'pos', 'k-c2-1')::jsonb ->> 'duplicate'), 'false');
SELECT pg_temp.expect('exactly two payments and two receipts exist',
  (SELECT count(*)::text || '/' || (SELECT count(*) FROM public.cg_fee_receipt) FROM public.cg_fee_payment), '2/2');

\echo -- relief (A05 maker-checker, posted into the ledger)
INSERT INTO pg_temp.ids SELECT 'adj', (pg_temp.val('authenticated', :'B1',
  $q$SELECT public.fee_relief_request('92000000-0000-4000-8000-0000000000d1', 'scholarship', 'percent', 10, 'First', '2026/2027', 'Merit scholarship', 'TUITION', 'Alumni fund')::text$q$))::uuid;
SELECT pg_temp.expect('relief cannot be posted before it is approved',
  pg_temp.try('authenticated', :'B2', format($q$SELECT public.cg_fee_post_relief(%L, %L)$q$, (SELECT id FROM pg_temp.ids WHERE label = 'i1'), (SELECT id FROM pg_temp.ids WHERE label = 'adj'))), 'err:22023');
SELECT pg_temp.expect('the requester cannot approve their own relief (A05)',
  pg_temp.try('authenticated', :'B1', format($q$SELECT public.fee_relief_decide(%L, true)$q$, (SELECT id FROM pg_temp.ids WHERE label = 'adj'))), 'err:42501');
SELECT pg_temp.expect('a second bursar approves it',
  pg_temp.val('authenticated', :'B2', format($q$SELECT public.fee_relief_decide(%L, true)$q$, (SELECT id FROM pg_temp.ids WHERE label = 'adj'))), 'approved');
SELECT pg_temp.expect('the requester cannot post the relief',
  pg_temp.try('authenticated', :'B1', format($q$SELECT public.cg_fee_post_relief(%L, %L)$q$, (SELECT id FROM pg_temp.ids WHERE label = 'i1'), (SELECT id FROM pg_temp.ids WHERE label = 'adj'))), 'err:42501');
SELECT pg_temp.expect('relief does not apply to another learner''s invoice',
  pg_temp.try('authenticated', :'B2', format($q$SELECT public.cg_fee_post_relief(%L, %L)$q$, (SELECT id FROM pg_temp.ids WHERE label = 'i3'), (SELECT id FROM pg_temp.ids WHERE label = 'adj'))), 'err:22023');
SELECT pg_temp.expect('relief does not apply to another fee type',
  pg_temp.try('authenticated', :'B2', format($q$SELECT public.cg_fee_post_relief(%L, %L)$q$, (SELECT id FROM pg_temp.ids WHERE label = 'i2'), (SELECT id FROM pg_temp.ids WHERE label = 'adj'))), 'err:22023');
SELECT pg_temp.expect('10% relief on I1 is NGN 10,000, computed on the server',
  (pg_temp.val('authenticated', :'B2', format($q$SELECT public.cg_fee_post_relief(%L, %L)::text$q$, (SELECT id FROM pg_temp.ids WHERE label = 'i1'), (SELECT id FROM pg_temp.ids WHERE label = 'adj')))::jsonb ->> 'amount_kobo'), '1000000');
SELECT pg_temp.expect('posting the same relief again is a duplicate',
  (pg_temp.val('authenticated', :'B2', format($q$SELECT public.cg_fee_post_relief(%L, %L)::text$q$, (SELECT id FROM pg_temp.ids WHERE label = 'i1'), (SELECT id FROM pg_temp.ids WHERE label = 'adj')))::jsonb ->> 'duplicate'), 'true');

\echo -- refunds: a cashier may ask, never decide
INSERT INTO pg_temp.ids SELECT 'refund', (pg_temp.val('authenticated', :'C1', format(
  $q$SELECT public.cg_fee_request_refund(%L, 1000000, 'Overpaid by POS', 'r-1')::text$q$,
  (SELECT p.id FROM public.cg_fee_payment p WHERE p.idempotency_key = 'k-c2-1'))))::uuid;
SELECT pg_temp.expect('a cashier cannot decide a refund',
  pg_temp.try('authenticated', :'C2', format($q$SELECT public.cg_fee_decide_refund(%L, 'approved')$q$, (SELECT id FROM pg_temp.ids WHERE label = 'refund'))), 'err:42501');
SELECT pg_temp.expect('table rule: the cashier who recorded the payment cannot be the decider (any caller)',
  pg_temp.try('postgres', '', format($q$INSERT INTO public.cg_fee_refund_decision (scope_ref, tenant_id, org_ref, request_id, invoice_id, payment_id, campus_id, principal_ref, amount_kobo, decision, decided_by)
    SELECT r.scope_ref, r.tenant_id, r.org_ref, r.id, r.invoice_id, r.payment_id, r.campus_id, r.principal_ref, r.amount_kobo, 'approved', '91000000-0000-4000-8000-000000000003'
      FROM public.cg_fee_refund_request r WHERE r.id = %L$q$, (SELECT id FROM pg_temp.ids WHERE label = 'refund'))), 'err:42501');
BEGIN;
SELECT pg_temp.expect('control: a decider who neither recorded the payment nor holds record_cash passes the table rule',
  pg_temp.try('postgres', '', format($q$INSERT INTO public.cg_fee_refund_decision (scope_ref, tenant_id, org_ref, request_id, invoice_id, payment_id, campus_id, principal_ref, amount_kobo, decision, decided_by)
    SELECT r.scope_ref, r.tenant_id, r.org_ref, r.id, r.invoice_id, r.payment_id, r.campus_id, r.principal_ref, r.amount_kobo, 'approved', '91000000-0000-4000-8000-000000000006'
      FROM public.cg_fee_refund_request r WHERE r.id = %L$q$, (SELECT id FROM pg_temp.ids WHERE label = 'refund'))), 'ok:1');
ROLLBACK;
BEGIN;
INSERT INTO public.fx_custom_grant VALUES ('99000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000006', 'accountant', 'payments.record_cash');
SELECT pg_temp.expect('table rule: with record_cash granted, the same decider is refused',
  pg_temp.try('postgres', '', format($q$INSERT INTO public.cg_fee_refund_decision (scope_ref, tenant_id, org_ref, request_id, invoice_id, payment_id, campus_id, principal_ref, amount_kobo, decision, decided_by)
    SELECT r.scope_ref, r.tenant_id, r.org_ref, r.id, r.invoice_id, r.payment_id, r.campus_id, r.principal_ref, r.amount_kobo, 'approved', '91000000-0000-4000-8000-000000000006'
      FROM public.cg_fee_refund_request r WHERE r.id = %L$q$, (SELECT id FROM pg_temp.ids WHERE label = 'refund'))), 'err:42501');
ROLLBACK;
SELECT pg_temp.expect('a bursar approves the refund',
  (pg_temp.val('authenticated', :'B1', format($q$SELECT public.cg_fee_decide_refund(%L, 'approved')::text$q$, (SELECT id FROM pg_temp.ids WHERE label = 'refund')))::jsonb ->> 'decision'), 'approved');
SELECT pg_temp.expect('a bursar reverses the unpaid levy invoice I4',
  pg_temp.try('authenticated', :'B1', format($q$SELECT public.cg_fee_reverse_invoice(%L, 'Levy cancelled')$q$, (SELECT id FROM pg_temp.ids WHERE label = 'i4'))), 'ok:1');
BEGIN;
INSERT INTO pg_temp.ids SELECT 'i5', (pg_temp.val('authenticated', :'B1', format(
  $q$SELECT public.cg_fee_issue_invoice('m9-a', %L, '99000000-0000-4000-8000-0000000000c1', '92000000-0000-4000-8000-0000000000d1', 'second-guardian', now() + interval '30 days')::text$q$,
  (SELECT id FROM pg_temp.ids WHERE label = 'tuition'))))::uuid;
SELECT pg_temp.expect('relief on an unpaid invoice',
  (pg_temp.val('authenticated', :'B2', format($q$SELECT public.cg_fee_post_relief(%L, %L)::text$q$, (SELECT id FROM pg_temp.ids WHERE label = 'i5'), (SELECT id FROM pg_temp.ids WHERE label = 'adj')))::jsonb ->> 'amount_kobo'), '1000000');
SELECT pg_temp.expect('an invoice carrying relief cannot be reversed',
  pg_temp.try('authenticated', :'B1', format($q$SELECT public.cg_fee_reverse_invoice(%L, 'Try')$q$, (SELECT id FROM pg_temp.ids WHERE label = 'i5'))), 'err:23514');
ROLLBACK;

\echo -- settle the term
SELECT pg_temp.expect('cashier 2 settles I1 in cash', (pg_temp.pay(:'C2', 'i1', 5000000, 'cash', 'k-c2-2')::jsonb ->> 'duplicate'), 'false');
SELECT pg_temp.expect('cashier 2 settles I2 by POS', (pg_temp.pay(:'C2', 'i2', 2000000, 'pos', 'k-c2-3')::jsonb ->> 'duplicate'), 'false');
SELECT pg_temp.expect('cashier 2 settles the refunded part of I3 in cash', (pg_temp.pay(:'C2', 'i3', 1000000, 'cash', 'k-c2-4')::jsonb ->> 'duplicate'), 'false');

\echo -- the ledger balances to zero
SELECT pg_temp.expect('every posting is balanced and the ledger nets to zero',
  (SELECT (sum(debit_kobo) - sum(credit_kobo))::text FROM public.cg_fee_ledger_line), '0');
SELECT pg_temp.expect('account balances at term end (AR, cash, relief, revenue)',
  (SELECT string_agg(account_code || '=' || (sum_d - sum_c), ',' ORDER BY account_code) FROM (
     SELECT account_code, sum(debit_kobo) sum_d, sum(credit_kobo) sum_c FROM public.cg_fee_ledger_line GROUP BY account_code) t),
  'accounts_receivable=0,cash=21000000,fee_relief=1000000,fee_revenue=-22000000');
SELECT pg_temp.expect('every invoice balance is zero at term end',
  (SELECT string_agg(DISTINCT balance_kobo::text, ',') FROM public.cg_fee_invoice_balances), '0');
SELECT pg_temp.expect('receipts are gap-free',
  (SELECT gap_free::text FROM public.cg_fee_receipt_sequence_status), 'true');

\echo -- day close: expected comes from the ledger; a closed day takes no more cash
SELECT pg_temp.expect('a bursar cannot close a cashier''s day',
  pg_temp.try('authenticated', :'B1', $q$SELECT public.cg_fee_close_cash_day('m9-a', '99000000-0000-4000-8000-0000000000c1', public.cg_fee_business_date(now()), 0, 0, 'd-b1')$q$), 'err:42501');
SELECT pg_temp.expect('a day in the future cannot be closed',
  pg_temp.try('authenticated', :'C1', $q$SELECT public.cg_fee_close_cash_day('m9-a', '99000000-0000-4000-8000-0000000000c1', public.cg_fee_business_date(now()) + 1, 0, 0, 'd-c1-f')$q$), 'err:22023');
INSERT INTO pg_temp.ids SELECT 'close2', (pg_temp.val('authenticated', :'C2',
  $q$SELECT public.cg_fee_close_cash_day('m9-a', '99000000-0000-4000-8000-0000000000c1', public.cg_fee_business_date(now()), 6000000, 11999000, 'd-c2', 'One POS slip short')->>'day_close_id'$q$))::uuid;
SELECT pg_temp.expect('cashier 2''s close: expected cash 6M, POS 12M, variance -1,000 kobo',
  (SELECT expected_cash_kobo || '/' || expected_pos_kobo || '/' || variance_kobo FROM public.cg_fee_cash_day_close WHERE id = (SELECT id FROM pg_temp.ids WHERE label = 'close2')),
  '6000000/12000000/-1000');

\echo -- reconciliation: never the cashier for that day
SELECT pg_temp.expect('the cashier cannot reconcile their own day',
  pg_temp.try('authenticated', :'C1', format($q$SELECT public.cg_fee_reconcile_cash_day(%L, 'matched')$q$, (SELECT id FROM pg_temp.ids WHERE label = 'close1'))), 'err:42501');
SELECT pg_temp.expect('another cashier cannot reconcile it either',
  pg_temp.try('authenticated', :'C2', format($q$SELECT public.cg_fee_reconcile_cash_day(%L, 'matched')$q$, (SELECT id FROM pg_temp.ids WHERE label = 'close1'))), 'err:42501');
SELECT pg_temp.expect('table rule: someone who took cash at that campus that day cannot reconcile it (any caller)',
  pg_temp.try('postgres', '', format($q$INSERT INTO public.cg_fee_cash_reconciliation (scope_ref, tenant_id, org_ref, day_close_id, campus_id, business_date, cashier_id, verdict, reconciled_by)
    SELECT scope_ref, tenant_id, org_ref, id, campus_id, business_date, cashier_id, 'matched', '91000000-0000-4000-8000-000000000003' FROM public.cg_fee_cash_day_close WHERE id = %L$q$,
    (SELECT id FROM pg_temp.ids WHERE label = 'close1'))), 'err:42501');
SELECT pg_temp.expect('table rule: the closer cannot reconcile (any caller)',
  pg_temp.try('postgres', '', format($q$INSERT INTO public.cg_fee_cash_reconciliation (scope_ref, tenant_id, org_ref, day_close_id, campus_id, business_date, cashier_id, verdict, reconciled_by)
    SELECT scope_ref, tenant_id, org_ref, id, campus_id, business_date, cashier_id, 'matched', cashier_id FROM public.cg_fee_cash_day_close WHERE id = %L$q$,
    (SELECT id FROM pg_temp.ids WHERE label = 'close1'))), 'err:42501');
SELECT pg_temp.expect('organization B''s bursar cannot reconcile A''s day',
  pg_temp.try('authenticated', :'BB', format($q$SELECT public.cg_fee_reconcile_cash_day(%L, 'matched')$q$, (SELECT id FROM pg_temp.ids WHERE label = 'close1'))), 'err:42501');
SELECT pg_temp.expect('the accountant reconciles cashier 1''s day as matched',
  (pg_temp.val('authenticated', :'ACC', format($q$SELECT public.cg_fee_reconcile_cash_day(%L, 'matched')::text$q$, (SELECT id FROM pg_temp.ids WHERE label = 'close1')))::jsonb ->> 'verdict'), 'matched');
SELECT pg_temp.expect('a variance cannot be called matched',
  pg_temp.try('authenticated', :'B1', format($q$SELECT public.cg_fee_reconcile_cash_day(%L, 'matched')$q$, (SELECT id FROM pg_temp.ids WHERE label = 'close2'))), 'err:22023');
SELECT pg_temp.expect('a variance needs a note',
  pg_temp.try('authenticated', :'B1', format($q$SELECT public.cg_fee_reconcile_cash_day(%L, 'variance_accepted')$q$, (SELECT id FROM pg_temp.ids WHERE label = 'close2'))), 'err:22023');
SELECT pg_temp.expect('a bursar accepts the variance with a note',
  (pg_temp.val('authenticated', :'B1', format($q$SELECT public.cg_fee_reconcile_cash_day(%L, 'variance_accepted', 'Slip found in drawer 2')::text$q$, (SELECT id FROM pg_temp.ids WHERE label = 'close2')))::jsonb ->> 'duplicate'), 'false');
SELECT pg_temp.expect('a different verdict on a reconciled day is refused',
  pg_temp.try('authenticated', :'B2', format($q$SELECT public.cg_fee_reconcile_cash_day(%L, 'variance_escalated', 'Escalate it')$q$, (SELECT id FROM pg_temp.ids WHERE label = 'close2'))), 'err:23505');
SELECT pg_temp.expect('day closes and reconciliations are append-only',
  pg_temp.try('postgres', '', $q$UPDATE public.cg_fee_cash_day_close SET counted_cash_kobo = 0$q$), 'err:55000');
SELECT pg_temp.expect('day closes and reconciliations are audited',
  (SELECT count(*)::text FROM public.audit_logs WHERE table_name IN ('cg_fee_cash_day_close', 'cg_fee_cash_reconciliation')), '4');
SELECT pg_temp.expect('cashier 1 sees the campus day closes (fees.view at campus)',
  pg_temp.val('authenticated', :'C1', $q$SELECT count(*)::text FROM public.cg_fee_cash_day_close$q$), '2');
SELECT pg_temp.expect('organization B''s bursar sees no day close of A',
  pg_temp.val('authenticated', :'BB', $q$SELECT count(*)::text FROM public.cg_fee_cash_day_close$q$), '0');
SELECT pg_temp.expect('anon holds no privilege on the new tables',
  (has_table_privilege('anon', 'public.cg_fee_cash_day_close', 'SELECT') OR has_table_privilege('anon', 'public.cg_fee_cash_reconciliation', 'SELECT'))::text, 'false');
SELECT pg_temp.expect('authenticated cannot write the new tables directly',
  pg_temp.try('authenticated', :'C1', $q$INSERT INTO public.cg_fee_cash_day_close (scope_ref, tenant_id, org_ref, campus_id, business_date, cashier_id, expected_cash_kobo, expected_pos_kobo, payment_count, counted_cash_kobo, counted_pos_kobo, idempotency_key)
    VALUES ('m9-a', '99000000-0000-4000-8000-0000000000a1', 'm9-org-a', '99000000-0000-4000-8000-0000000000c1', current_date - 1, '91000000-0000-4000-8000-000000000002', 0, 0, 0, 0, 0, 'direct')$q$), 'err:42501');
SELECT pg_temp.expect('anon cannot execute the new functions',
  (has_function_privilege('anon', 'public.cg_fee_close_cash_day(text,uuid,date,bigint,bigint,text,text)', 'EXECUTE')
   OR has_function_privilege('anon', 'public.cg_fee_reconcile_cash_day(uuid,text,text)', 'EXECUTE')
   OR has_function_privilege('anon', 'public.cg_fee_post_relief(uuid,uuid)', 'EXECUTE'))::text, 'false');

-- =====================================================================================================
\echo == Paystack: tampered amount, replayed webhook, cashier refund (real cg_financial functions) ==
SELECT pg_temp.expect('server creates a checkout intent for NGN 20,000',
  pg_temp.try('service_role', '', $q$SELECT public.cg_financial_create_intent('uos_m9_ref_0001', 'm9-a', 'fee-x1-levy', 'guardian-x1', 2000000, 'NGN')$q$), 'ok:1');
SELECT pg_temp.expect('a settlement reporting another amount is not matched',
  (pg_temp.val('service_role', '', $q$SELECT public.cg_financial_record_reconciliation('uos_m9_ref_0001', 'charge.success:uos_m9_ref_0001', 100, 'NGN', now())::text$q$)::jsonb ->> 'verdict'), 'mismatch');
SELECT pg_temp.expect('a settlement reporting another currency is not matched',
  (pg_temp.val('service_role', '', $q$SELECT public.cg_financial_record_reconciliation('uos_m9_ref_0001', 'charge.success:uos_m9_ref_0001', 2000000, 'USD', now())::text$q$)::jsonb ->> 'verdict'), 'mismatch');
SELECT pg_temp.expect('the true settlement is recorded once',
  (pg_temp.val('service_role', '', $q$SELECT public.cg_financial_record_settlement('uos_m9_ref_0001', 'charge.success:uos_m9_ref_0001', 2000000, 'NGN', now())::text$q$)::jsonb ->> 'outcome'), 'settled');
SELECT pg_temp.expect('the replayed webhook is a duplicate',
  (pg_temp.val('service_role', '', $q$SELECT public.cg_financial_record_settlement('uos_m9_ref_0001', 'charge.success:uos_m9_ref_0001', 2000000, 'NGN', now())::text$q$)::jsonb ->> 'outcome'), 'duplicate');
SELECT pg_temp.expect('one ledger entry for the reference',
  (SELECT count(*)::text FROM public.cg_financial_entry WHERE reference = 'uos_m9_ref_0001'), '1');
SELECT pg_temp.expect('a signed-in user cannot call settlement directly',
  pg_temp.try('authenticated', :'B1', $q$SELECT public.cg_financial_record_settlement('uos_m9_ref_0001', 'x', 1, 'NGN', now())$q$), 'err:42501');
SELECT pg_temp.expect('an online refund requested by a cashier is refused',
  pg_temp.try('service_role', '', $q$SELECT public.cg_financial_request_reversal((SELECT id FROM public.cg_financial_entry WHERE reference = 'uos_m9_ref_0001'), 1000, 'Refund', 'rev-c1', '91000000-0000-4000-8000-000000000002')$q$), 'err:42501');
SELECT pg_temp.expect('an online refund requested by a bursar is accepted',
  pg_temp.try('service_role', '', $q$SELECT public.cg_financial_request_reversal((SELECT id FROM public.cg_financial_entry WHERE reference = 'uos_m9_ref_0001'), 1000, 'Refund', 'rev-b1', '91000000-0000-4000-8000-000000000004')$q$), 'ok:1');
SELECT pg_temp.expect('an online refund needs a named person',
  pg_temp.try('service_role', '', $q$SELECT public.cg_financial_request_reversal((SELECT id FROM public.cg_financial_entry WHERE reference = 'uos_m9_ref_0001'), 1000, 'Refund', 'rev-sys', 'system')$q$), 'err:42501');

-- =====================================================================================================
\echo == rollback ==
\echo -- refused while relief postings and day closes exist (append-only records)
\set ON_ERROR_STOP off
\i database/supabase/rollbacks/20261117003300_sherivs_m9_finance_core.sql
\set ON_ERROR_STOP on
SELECT pg_temp.expect('the refused rollback changed nothing',
  (to_regclass('public.cg_fee_cash_day_close') IS NOT NULL AND to_regprocedure('public.cg_fee_post_relief(uuid,uuid)') IS NOT NULL)::text, 'true');
\echo -- on a database with no M9 records it restores the applied definitions
SET session_replication_role = replica;
DELETE FROM public.cg_fee_cash_reconciliation; DELETE FROM public.cg_fee_cash_day_close;
DELETE FROM public.cg_fee_ledger_line WHERE posting_id IN (SELECT id FROM public.cg_fee_ledger_posting WHERE event_type = 'relief');
DELETE FROM public.cg_fee_ledger_posting WHERE event_type = 'relief';
DELETE FROM public.cg_financial_reversal;
SET session_replication_role = origin;
\i database/supabase/rollbacks/20261117003300_sherivs_m9_finance_core.sql
SELECT pg_temp.expect('rollback removed the new tables, functions and column',
  (to_regclass('public.cg_fee_cash_day_close') IS NULL AND to_regprocedure('public.cg_fee_post_relief(uuid,uuid)') IS NULL
   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cg_fee_ledger_posting' AND column_name = 'adjustment_id'))::text, 'true');
SELECT pg_temp.expect('rollback restored the applied guards',
  (position('NEW.prepared_by := v_actor' IN pg_get_functiondef('public.staff_payroll_sod_guard()'::regprocedure)) = 0
   AND position('payments.reconcile' IN pg_get_functiondef('public.cg_fee_authorize(text,text,text,text,text)'::regprocedure)) = 0)::text, 'true');
SELECT pg_temp.expect('rollback restored the catalogue rows',
  ((SELECT default_on FROM public.role_template_permissions WHERE template_code = 'accountant' AND permission_code = 'payments.record_cash')
   AND NOT EXISTS (SELECT 1 FROM public.sod_permission_rules WHERE permission_b = 'payments.refund'))::text, 'true');
\echo -- and the migration applies again after the rollback
\i database/supabase/migrations/20261117003300_sherivs_m9_finance_core.sql
SELECT pg_temp.expect('re-applied', (to_regprocedure('public.cg_fee_close_cash_day(text,uuid,date,bigint,bigint,text,text)') IS NOT NULL)::text, 'true');
\echo M9 finance core: ALL PASS
