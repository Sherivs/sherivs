-- SHERIVS-024 (Wave 6): NERDC scheme of work + lesson-note review (SoD); HR appraisals, staff loans, PAYE (Nigeria Tax Act 2025 bands,
-- configurable) + pension + NHF payroll computation; inventory with append-only stock moves; fixed-asset register with depreciation;
-- visitor pre-registration with gate passes and authorised pick-ups.
BEGIN;
-- ===== Scheme of work + lesson notes =====
CREATE TABLE IF NOT EXISTS public.scheme_of_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  template_code text REFERENCES public.curriculum_templates(code), subject text NOT NULL, level text NOT NULL, term text NOT NULL,
  week int NOT NULL CHECK (week BETWEEN 1 AND 15), topic text NOT NULL, objectives text[], created_by uuid, UNIQUE (school_id, subject, level, term, week));
CREATE TABLE IF NOT EXISTS public.lesson_note_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, lesson_plan_id uuid NOT NULL REFERENCES public.lesson_plans(id) ON DELETE CASCADE,
  scheme_week_id uuid REFERENCES public.scheme_of_work(id) ON DELETE SET NULL, submitted_by uuid NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','returned')), reviewer uuid, reviewed_at timestamptz, comment text,
  CHECK (reviewer IS NULL OR reviewer <> submitted_by));
CREATE UNIQUE INDEX IF NOT EXISTS lesson_note_reviews_open ON public.lesson_note_reviews (lesson_plan_id) WHERE status = 'submitted';
CREATE OR REPLACE FUNCTION public.scheme_week_upsert(p_school uuid, p_subject text, p_level text, p_term text, p_week int, p_topic text, p_objectives text[] DEFAULT NULL, p_template text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT (public.scholar_can(p_school, 'lesson_notes.approve') OR public.scholar_can(p_school, 'settings.manage')) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.scheme_of_work (school_id, template_code, subject, level, term, week, topic, objectives, created_by) VALUES (p_school, p_template, p_subject, p_level, p_term, p_week, p_topic, p_objectives, auth.uid())
  ON CONFLICT (school_id, subject, level, term, week) DO UPDATE SET topic = EXCLUDED.topic, objectives = EXCLUDED.objectives RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.lesson_note_submit(p_plan uuid, p_scheme_week uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lp public.lesson_plans; v uuid;
BEGIN
  SELECT * INTO lp FROM public.lesson_plans WHERE id = p_plan AND teacher_id = auth.uid();
  IF lp.id IS NULL OR NOT public.scholar_can(lp.school_id, 'lesson_notes.submit') THEN RAISE EXCEPTION 'not allowed: you can only submit your own lesson notes' USING ERRCODE = '42501'; END IF;
  IF p_scheme_week IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.scheme_of_work WHERE id = p_scheme_week AND school_id = lp.school_id) THEN RAISE EXCEPTION 'scheme week not in this school'; END IF;
  INSERT INTO public.lesson_note_reviews (school_id, lesson_plan_id, scheme_week_id, submitted_by) VALUES (lp.school_id, p_plan, p_scheme_week, auth.uid()) RETURNING id INTO v;
  UPDATE public.lesson_plans SET status = 'submitted' WHERE id = p_plan;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.lesson_note_review(p_review uuid, p_approve boolean, p_comment text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.lesson_note_reviews;
BEGIN
  SELECT * INTO r FROM public.lesson_note_reviews WHERE id = p_review FOR UPDATE;
  IF r.id IS NULL OR NOT public.scholar_can(r.school_id, 'lesson_notes.approve') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF r.submitted_by = auth.uid() THEN RAISE EXCEPTION 'sod: you cannot review your own lesson note' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'submitted' THEN RAISE EXCEPTION 'already reviewed'; END IF;
  IF NOT p_approve AND coalesce(length(p_comment), 0) < 5 THEN RAISE EXCEPTION 'say what to fix when returning a note'; END IF;
  UPDATE public.lesson_note_reviews SET status = CASE WHEN p_approve THEN 'approved' ELSE 'returned' END, reviewer = auth.uid(), reviewed_at = now(), comment = p_comment WHERE id = r.id;
  UPDATE public.lesson_plans SET status = CASE WHEN p_approve THEN 'approved' ELSE 'draft' END, review_notes = p_comment, admin_viewed = true WHERE id = r.lesson_plan_id;
END $$;

-- ===== HR: appraisals =====
CREATE TABLE IF NOT EXISTS public.appraisal_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, name text NOT NULL,
  starts_on date NOT NULL, ends_on date NOT NULL, criteria jsonb NOT NULL DEFAULT '["Lesson delivery","Punctuality","Student outcomes","Teamwork","Professional development"]', UNIQUE (school_id, name));
CREATE TABLE IF NOT EXISTS public.appraisals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cycle_id uuid NOT NULL REFERENCES public.appraisal_cycles(id) ON DELETE CASCADE, school_id uuid NOT NULL,
  staff_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, appraiser_id uuid NOT NULL REFERENCES public.users(id),
  self_scores jsonb, appraiser_scores jsonb, overall numeric, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','self_done','reviewed','acknowledged')),
  staff_comment text, UNIQUE (cycle_id, staff_id), CHECK (appraiser_id <> staff_id));
CREATE OR REPLACE FUNCTION public.appraisal_open(p_cycle uuid, p_staff uuid, p_appraiser uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid; v uuid;
BEGIN
  SELECT school_id INTO s FROM public.appraisal_cycles WHERE id = p_cycle;
  IF s IS NULL OR NOT public.scholar_can(s, 'hr.appraisal') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_staff = p_appraiser THEN RAISE EXCEPTION 'sod: staff cannot appraise themselves' USING ERRCODE = '42501'; END IF;
  IF (SELECT count(*) FROM public.users WHERE id IN (p_staff, p_appraiser) AND school_id = s) <> 2 THEN RAISE EXCEPTION 'both people must be staff of this school'; END IF;
  INSERT INTO public.appraisals (cycle_id, school_id, staff_id, appraiser_id) VALUES (p_cycle, s, p_staff, p_appraiser)
  ON CONFLICT (cycle_id, staff_id) DO UPDATE SET appraiser_id = EXCLUDED.appraiser_id WHERE public.appraisals.status = 'open' RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public._scores_ok(p_scores jsonb, p_criteria jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_typeof(p_scores) = 'object' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_criteria) c WHERE NOT p_scores ? c OR (p_scores->>c)::numeric NOT BETWEEN 1 AND 5) $$;
CREATE OR REPLACE FUNCTION public.appraisal_self(p_appraisal uuid, p_scores jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.appraisals; cr jsonb;
BEGIN
  SELECT * INTO a FROM public.appraisals WHERE id = p_appraisal AND staff_id = auth.uid();
  IF a.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT criteria INTO cr FROM public.appraisal_cycles WHERE id = a.cycle_id;
  IF a.status <> 'open' THEN RAISE EXCEPTION 'self-review already submitted'; END IF;
  IF NOT public._scores_ok(p_scores, cr) THEN RAISE EXCEPTION 'score every criterion from 1 to 5'; END IF;
  UPDATE public.appraisals SET self_scores = p_scores, status = 'self_done' WHERE id = a.id;
END $$;
CREATE OR REPLACE FUNCTION public.appraisal_review(p_appraisal uuid, p_scores jsonb) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.appraisals; cr jsonb; ov numeric;
BEGIN
  SELECT * INTO a FROM public.appraisals WHERE id = p_appraisal AND appraiser_id = auth.uid();
  IF a.id IS NULL THEN RAISE EXCEPTION 'not allowed: only the assigned appraiser can review' USING ERRCODE = '42501'; END IF;
  IF a.status <> 'self_done' THEN RAISE EXCEPTION 'waiting for the self-review'; END IF;
  SELECT criteria INTO cr FROM public.appraisal_cycles WHERE id = a.cycle_id;
  IF NOT public._scores_ok(p_scores, cr) THEN RAISE EXCEPTION 'score every criterion from 1 to 5'; END IF;
  SELECT round(avg(value::numeric), 2) INTO ov FROM jsonb_each_text(p_scores);
  UPDATE public.appraisals SET appraiser_scores = p_scores, overall = ov, status = 'reviewed' WHERE id = a.id;
  RETURN ov;
END $$;
CREATE OR REPLACE FUNCTION public.appraisal_acknowledge(p_appraisal uuid, p_comment text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.appraisals SET status = 'acknowledged', staff_comment = p_comment WHERE id = p_appraisal AND staff_id = auth.uid() AND status = 'reviewed';
  IF NOT FOUND THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
END $$;

-- ===== Payroll inputs: salary profiles, loans, tax bands =====
CREATE TABLE IF NOT EXISTS public.staff_salary_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE, school_id uuid NOT NULL,
  basic_monthly numeric NOT NULL CHECK (basic_monthly >= 0), housing_monthly numeric NOT NULL DEFAULT 0, transport_monthly numeric NOT NULL DEFAULT 0,
  other_monthly numeric NOT NULL DEFAULT 0, annual_rent numeric NOT NULL DEFAULT 0, pension_enrolled boolean NOT NULL DEFAULT true, nhf_enrolled boolean NOT NULL DEFAULT false,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.tax_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), regime text NOT NULL, lower_ngn numeric NOT NULL, upper_ngn numeric, rate numeric NOT NULL,
  effective_from date NOT NULL, note text, UNIQUE (regime, lower_ngn, effective_from));
-- Nigeria Tax Act 2025 personal income bands (effective 1 Jan 2026). Assumption to confirm with the school's tax adviser; editable by Sherivs staff.
INSERT INTO public.tax_bands (regime, lower_ngn, upper_ngn, rate, effective_from, note) VALUES
  ('ng_nta_2025', 0, 800000, 0, '2026-01-01', 'first 800k tax-free'),
  ('ng_nta_2025', 800000, 3000000, 0.15, '2026-01-01', NULL), ('ng_nta_2025', 3000000, 12000000, 0.18, '2026-01-01', NULL),
  ('ng_nta_2025', 12000000, 25000000, 0.21, '2026-01-01', NULL), ('ng_nta_2025', 25000000, 50000000, 0.23, '2026-01-01', NULL),
  ('ng_nta_2025', 50000000, NULL, 0.25, '2026-01-01', NULL)
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.staff_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  principal numeric NOT NULL CHECK (principal > 0), monthly_deduction numeric NOT NULL CHECK (monthly_deduction > 0), balance numeric NOT NULL,
  purpose text, status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','active','closed','rejected')), decided_by uuid, decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (decided_by IS NULL OR decided_by <> user_id), CHECK (balance >= 0));
CREATE OR REPLACE FUNCTION public.salary_profile_set(p_user uuid, p_basic numeric, p_housing numeric DEFAULT 0, p_transport numeric DEFAULT 0, p_other numeric DEFAULT 0, p_rent numeric DEFAULT 0, p_nhf boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid;
BEGIN
  SELECT school_id INTO s FROM public.users WHERE id = p_user;
  IF s IS NULL OR NOT public.scholar_can(s, 'payroll.prepare') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'sod: you cannot set your own salary' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.staff_salary_profiles (user_id, school_id, basic_monthly, housing_monthly, transport_monthly, other_monthly, annual_rent, nhf_enrolled, updated_by)
  VALUES (p_user, s, p_basic, p_housing, p_transport, p_other, p_rent, p_nhf, auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET basic_monthly = EXCLUDED.basic_monthly, housing_monthly = EXCLUDED.housing_monthly, transport_monthly = EXCLUDED.transport_monthly,
    other_monthly = EXCLUDED.other_monthly, annual_rent = EXCLUDED.annual_rent, nhf_enrolled = EXCLUDED.nhf_enrolled, updated_by = auth.uid(), updated_at = now();
END $$;
CREATE OR REPLACE FUNCTION public.loan_request(p_principal numeric, p_monthly numeric, p_purpose text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid; s uuid := public.get_my_school_id(); basic numeric;
BEGIN
  IF auth.uid() IS NULL OR public.get_my_role() IN ('parent','student') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT basic_monthly + housing_monthly + transport_monthly + other_monthly INTO basic FROM public.staff_salary_profiles WHERE user_id = auth.uid();
  IF basic IS NULL THEN RAISE EXCEPTION 'no salary profile yet'; END IF;
  IF p_monthly > basic / 3 THEN RAISE EXCEPTION 'monthly deduction cannot exceed a third of monthly pay'; END IF;
  IF EXISTS (SELECT 1 FROM public.staff_loans WHERE user_id = auth.uid() AND status IN ('requested','active')) THEN RAISE EXCEPTION 'you already have an open loan'; END IF;
  INSERT INTO public.staff_loans (school_id, user_id, principal, monthly_deduction, balance, purpose) VALUES (s, auth.uid(), p_principal, p_monthly, p_principal, p_purpose) RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.loan_decide(p_loan uuid, p_approve boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.staff_loans;
BEGIN
  SELECT * INTO l FROM public.staff_loans WHERE id = p_loan FOR UPDATE;
  IF l.id IS NULL OR NOT public.scholar_can(l.school_id, 'payroll.approve') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF l.user_id = auth.uid() THEN RAISE EXCEPTION 'sod: you cannot approve your own loan' USING ERRCODE = '42501'; END IF;
  IF l.status <> 'requested' THEN RAISE EXCEPTION 'loan is %', l.status; END IF;
  UPDATE public.staff_loans SET status = CASE WHEN p_approve THEN 'active' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now() WHERE id = l.id;
END $$;
-- annual PAYE with rent relief (20% of rent, max 500k) and pension/NHF deductible
CREATE OR REPLACE FUNCTION public.paye_annual(p_gross_annual numeric, p_pension_annual numeric, p_nhf_annual numeric, p_rent numeric, p_on date DEFAULT current_date) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH ti AS (SELECT greatest(p_gross_annual - p_pension_annual - p_nhf_annual - least(p_rent * 0.2, 500000), 0) v),
       b AS (SELECT * FROM public.tax_bands WHERE regime = 'ng_nta_2025' AND effective_from = (SELECT max(effective_from) FROM public.tax_bands WHERE regime = 'ng_nta_2025' AND effective_from <= p_on))
  SELECT round(coalesce(sum(greatest(least(ti.v, coalesce(b.upper_ngn, ti.v)) - b.lower_ngn, 0) * b.rate), 0), 2) FROM ti, b;
$$;
CREATE OR REPLACE FUNCTION public.payroll_compute(p_school uuid, p_month int, p_year int) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p record; gross numeric; pen numeric; nhf numeric; tax numeric; loan numeric; n int := 0; tot numeric := 0;
BEGIN
  IF NOT public.scholar_can(p_school, 'payroll.prepare') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  FOR p IN SELECT sp.* FROM public.staff_salary_profiles sp JOIN public.users u ON u.id = sp.user_id WHERE sp.school_id = p_school AND coalesce(u.is_active, true) LOOP
    IF EXISTS (SELECT 1 FROM public.staff_payroll WHERE school_id = p_school AND user_id = p.user_id AND month = p_month AND year = p_year AND status <> 'draft') THEN CONTINUE; END IF;
    gross := p.basic_monthly + p.housing_monthly + p.transport_monthly + p.other_monthly;
    pen := CASE WHEN p.pension_enrolled THEN round((p.basic_monthly + p.housing_monthly + p.transport_monthly) * 0.08, 2) ELSE 0 END;
    nhf := CASE WHEN p.nhf_enrolled THEN round(p.basic_monthly * 0.025, 2) ELSE 0 END;
    tax := round(public.paye_annual(gross * 12, pen * 12, nhf * 12, p.annual_rent) / 12, 2);
    SELECT coalesce(sum(least(monthly_deduction, balance)), 0) INTO loan FROM public.staff_loans WHERE user_id = p.user_id AND status = 'active';
    INSERT INTO public.staff_payroll (school_id, user_id, month, year, basic_salary, housing_allowance, transport_allowance, other_allowances, tax_deduction, pension_deduction,
      other_deductions, loan_deduction, status, prepared_by)   -- gross_salary / net_salary are generated columns
    VALUES (p_school, p.user_id, p_month, p_year, p.basic_monthly, p.housing_monthly, p.transport_monthly, p.other_monthly, tax, pen, nhf, loan, 'draft', auth.uid())
    ON CONFLICT (school_id, user_id, month, year) DO UPDATE SET basic_salary = EXCLUDED.basic_salary, housing_allowance = EXCLUDED.housing_allowance,
      transport_allowance = EXCLUDED.transport_allowance, other_allowances = EXCLUDED.other_allowances, tax_deduction = EXCLUDED.tax_deduction,
      pension_deduction = EXCLUDED.pension_deduction, other_deductions = EXCLUDED.other_deductions, loan_deduction = EXCLUDED.loan_deduction;
    n := n + 1; tot := tot + gross - tax - pen - nhf - loan;
  END LOOP;
  RETURN jsonb_build_object('lines', n, 'net_total', tot, 'employer_pension_10pct', (SELECT round(sum((basic_monthly + housing_monthly + transport_monthly) * 0.10), 2) FROM public.staff_salary_profiles WHERE school_id = p_school AND pension_enrolled));
END $$;
-- approval runs through the existing staff_payroll SoD trigger (approver ≠ preparer ≠ payee) and then reduces loan balances
CREATE OR REPLACE FUNCTION public.payroll_approve(p_school uuid, p_month int, p_year int) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;

-- ===== Inventory =====
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, sku text NOT NULL, name text NOT NULL,
  unit text NOT NULL DEFAULT 'pcs', reorder_level numeric NOT NULL DEFAULT 0, qty numeric NOT NULL DEFAULT 0 CHECK (qty >= 0), unit_cost numeric, UNIQUE (school_id, sku));
CREATE TABLE IF NOT EXISTS public.inventory_moves (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, school_id uuid NOT NULL, item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  delta numeric NOT NULL CHECK (delta <> 0), reason text NOT NULL CHECK (reason IN ('purchase','issue','return','adjustment','write_off')), reference text, issued_to text,
  qty_after numeric NOT NULL, by_user uuid, at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.inventory_item_upsert(p_school uuid, p_sku text, p_name text, p_unit text DEFAULT 'pcs', p_reorder numeric DEFAULT 0, p_cost numeric DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'inventory.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.inventory_items (school_id, sku, name, unit, reorder_level, unit_cost) VALUES (p_school, p_sku, p_name, p_unit, p_reorder, p_cost)
  ON CONFLICT (school_id, sku) DO UPDATE SET name = EXCLUDED.name, unit = EXCLUDED.unit, reorder_level = EXCLUDED.reorder_level, unit_cost = coalesce(EXCLUDED.unit_cost, public.inventory_items.unit_cost) RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.inventory_move(p_item uuid, p_delta numeric, p_reason text, p_reference text DEFAULT NULL, p_issued_to text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE it public.inventory_items;
BEGIN
  SELECT * INTO it FROM public.inventory_items WHERE id = p_item FOR UPDATE;
  IF it.id IS NULL OR NOT public.scholar_can(it.school_id, 'inventory.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_reason IN ('issue','write_off') AND p_delta > 0 OR p_reason IN ('purchase','return') AND p_delta < 0 THEN RAISE EXCEPTION 'sign of quantity does not match %', p_reason; END IF;
  IF it.qty + p_delta < 0 THEN RAISE EXCEPTION 'insufficient stock: % % left', it.qty, it.unit; END IF;
  UPDATE public.inventory_items SET qty = qty + p_delta WHERE id = p_item;
  INSERT INTO public.inventory_moves (school_id, item_id, delta, reason, reference, issued_to, qty_after, by_user) VALUES (it.school_id, p_item, p_delta, p_reason, p_reference, p_issued_to, it.qty + p_delta, auth.uid());
  RETURN jsonb_build_object('qty', it.qty + p_delta, 'reorder', it.qty + p_delta <= it.reorder_level);
END $$;

-- ===== Fixed assets =====
CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, tag text NOT NULL, name text NOT NULL,
  category text NOT NULL, location text, custodian_id uuid REFERENCES public.users(id) ON DELETE SET NULL, cost numeric NOT NULL CHECK (cost >= 0),
  acquired_on date NOT NULL, useful_life_years int NOT NULL DEFAULT 5 CHECK (useful_life_years > 0), salvage numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_use','in_repair','disposed','lost')), disposed_on date, UNIQUE (school_id, tag));
CREATE TABLE IF NOT EXISTS public.asset_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, school_id uuid NOT NULL, asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  kind text NOT NULL, detail jsonb, by_user uuid, at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.asset_register(p_school uuid, p_tag text, p_name text, p_category text, p_cost numeric, p_acquired date, p_life int DEFAULT 5, p_location text DEFAULT NULL, p_custodian uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'assets.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.fixed_assets (school_id, tag, name, category, cost, acquired_on, useful_life_years, location, custodian_id) VALUES (p_school, p_tag, p_name, p_category, p_cost, p_acquired, p_life, p_location, p_custodian) RETURNING id INTO v;
  INSERT INTO public.asset_events (school_id, asset_id, kind, detail, by_user) VALUES (p_school, v, 'registered', jsonb_build_object('cost', p_cost), auth.uid());
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.asset_update(p_asset uuid, p_status text, p_location text DEFAULT NULL, p_custodian uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.fixed_assets;
BEGIN
  SELECT * INTO a FROM public.fixed_assets WHERE id = p_asset FOR UPDATE;
  IF a.id IS NULL OR NOT public.scholar_can(a.school_id, 'assets.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF a.status = 'disposed' THEN RAISE EXCEPTION 'asset already disposed'; END IF;
  UPDATE public.fixed_assets SET status = p_status, location = coalesce(p_location, location), custodian_id = coalesce(p_custodian, custodian_id),
    disposed_on = CASE WHEN p_status = 'disposed' THEN current_date END WHERE id = p_asset;
  INSERT INTO public.asset_events (school_id, asset_id, kind, detail, by_user) VALUES (a.school_id, p_asset, p_status, jsonb_build_object('from', a.status, 'location', p_location, 'custodian', p_custodian), auth.uid());
END $$;
CREATE OR REPLACE FUNCTION public.asset_book_value(p_asset uuid, p_on date DEFAULT current_date) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT round(greatest(cost - (cost - salvage) * least((p_on - acquired_on)::numeric / (useful_life_years * 365.25), 1), salvage), 2)
    FROM public.fixed_assets WHERE id = p_asset AND public.scholar_can(school_id, 'assets.manage') $$;

-- ===== Visitors + gate passes + authorised pick-ups =====
CREATE TABLE IF NOT EXISTS public.authorised_pickups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  full_name text NOT NULL, phone text NOT NULL, relationship text, added_by uuid NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, phone));
CREATE TABLE IF NOT EXISTS public.visitor_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, visitor_name text NOT NULL, visitor_phone text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('meeting','pickup','delivery','contractor','other')), host_user_id uuid, student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  code_hash text NOT NULL, valid_on date NOT NULL DEFAULT current_date, status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','in','out','denied','cancelled')),
  checked_in_at timestamptz, checked_out_at timestamptz, gate_user_id uuid, deny_reason text, created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.pickup_authorise(p_student uuid, p_name text, p_phone text, p_relationship text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid; v uuid;
BEGIN
  SELECT school_id INTO s FROM public.students WHERE id = p_student AND (parent_id = auth.uid() OR id IN (SELECT student_id FROM public.parent_student_map WHERE parent_id = auth.uid()));
  IF s IS NULL THEN RAISE EXCEPTION 'not allowed: only the child''s parent can authorise pick-ups' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.authorised_pickups (school_id, student_id, full_name, phone, relationship, added_by) VALUES (s, p_student, p_name, regexp_replace(p_phone, '\D', '', 'g'), p_relationship, auth.uid())
  ON CONFLICT (student_id, phone) DO UPDATE SET active = true, full_name = EXCLUDED.full_name RETURNING id INTO v;
  RETURN v;
END $$;
-- host (staff) or parent (pick-up of own child) pre-registers a visitor; returns a 6-digit gate code shown once
CREATE OR REPLACE FUNCTION public.visitor_preregister(p_name text, p_phone text, p_purpose text, p_student uuid DEFAULT NULL, p_on date DEFAULT current_date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id(); code text := lpad((floor(random() * 1000000))::int::text, 6, '0'); v uuid; ph text := regexp_replace(p_phone, '\D', '', 'g');
BEGIN
  IF auth.uid() IS NULL OR s IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_purpose = 'pickup' THEN
    IF p_student IS NULL OR NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student AND school_id = s) THEN RAISE EXCEPTION 'pick-up needs the student'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.authorised_pickups WHERE student_id = p_student AND phone = ph AND active) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_an_authorised_pickup'); END IF;
  ELSIF public.get_my_role() IN ('parent','student') THEN RAISE EXCEPTION 'not allowed: parents can only pre-register pick-ups' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.visitor_passes (school_id, visitor_name, visitor_phone, purpose, host_user_id, student_id, code_hash, valid_on)
  VALUES (s, p_name, ph, p_purpose, auth.uid(), p_student, extensions.crypt(code, extensions.gen_salt('bf', 6)), p_on) RETURNING id INTO v;
  RETURN jsonb_build_object('ok', true, 'pass_id', v, 'code', code);
END $$;
CREATE OR REPLACE FUNCTION public.visitor_check_in(p_pass uuid, p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE vp public.visitor_passes; why text;
BEGIN
  SELECT * INTO vp FROM public.visitor_passes WHERE id = p_pass FOR UPDATE;
  IF vp.id IS NULL OR NOT public.scholar_can(vp.school_id, 'visitors.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  why := CASE WHEN extensions.crypt(coalesce(p_code, ''), vp.code_hash) <> vp.code_hash THEN 'wrong_code' WHEN vp.valid_on <> current_date THEN 'not_valid_today'
              WHEN vp.status <> 'expected' THEN 'already_' || vp.status
              WHEN vp.purpose = 'pickup' AND NOT EXISTS (SELECT 1 FROM public.authorised_pickups WHERE student_id = vp.student_id AND phone = vp.visitor_phone AND active) THEN 'pickup_authorisation_revoked' END;
  IF why IS NOT NULL THEN
    IF why IN ('pickup_authorisation_revoked') THEN UPDATE public.visitor_passes SET status = 'denied', deny_reason = why, gate_user_id = auth.uid() WHERE id = p_pass; END IF;
    RETURN jsonb_build_object('ok', false, 'error', why); END IF;
  UPDATE public.visitor_passes SET status = 'in', checked_in_at = now(), gate_user_id = auth.uid() WHERE id = p_pass;
  RETURN jsonb_build_object('ok', true, 'name', vp.visitor_name, 'purpose', vp.purpose);
END $$;
CREATE OR REPLACE FUNCTION public.visitor_check_out(p_pass uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.visitor_passes SET status = 'out', checked_out_at = now() WHERE id = p_pass AND status = 'in' AND public.scholar_can(school_id, 'visitors.manage');
  IF NOT FOUND THEN RAISE EXCEPTION 'not allowed or not checked in' USING ERRCODE = '42501'; END IF;
END $$;

-- ===== RLS / grants / audit =====
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['scheme_of_work','lesson_note_reviews','appraisal_cycles','appraisals','staff_salary_profiles','tax_bands','staff_loans','inventory_items','inventory_moves',
    'fixed_assets','asset_events','authorised_pickups','visitor_passes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_read ON public.%1$I', t);
    IF t NOT IN ('tax_bands') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
      EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
    END IF;
  END LOOP; END $$;
REVOKE SELECT ON public.visitor_passes FROM authenticated, service_role;
GRANT SELECT (id, school_id, visitor_name, visitor_phone, purpose, host_user_id, student_id, valid_on, status, checked_in_at, checked_out_at, gate_user_id, deny_reason, created_at) ON public.visitor_passes TO authenticated, service_role;
CREATE POLICY scheme_of_work_read ON public.scheme_of_work FOR SELECT TO authenticated USING (school_id = public.get_my_school_id());
CREATE POLICY lesson_note_reviews_read ON public.lesson_note_reviews FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() AND (submitted_by = auth.uid() OR public.scholar_can(school_id, 'lesson_notes.approve')));
CREATE POLICY appraisal_cycles_read ON public.appraisal_cycles FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() AND public.get_my_role() NOT IN ('parent','student'));
CREATE POLICY appraisals_read ON public.appraisals FOR SELECT TO authenticated USING (staff_id = auth.uid() OR appraiser_id = auth.uid() OR public.scholar_can(school_id, 'hr.appraisal'));
CREATE POLICY staff_salary_profiles_read ON public.staff_salary_profiles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.scholar_can(school_id, 'payroll.view_all') OR public.scholar_can(school_id, 'payroll.prepare'));
CREATE POLICY tax_bands_read ON public.tax_bands FOR SELECT TO authenticated USING (true);
CREATE POLICY staff_loans_read ON public.staff_loans FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.scholar_can(school_id, 'payroll.approve') OR public.scholar_can(school_id, 'payroll.prepare'));
CREATE POLICY inventory_items_read ON public.inventory_items FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() AND public.get_my_role() NOT IN ('parent','student'));
CREATE POLICY inventory_moves_read ON public.inventory_moves FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'inventory.manage'));
CREATE POLICY fixed_assets_read ON public.fixed_assets FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'assets.manage') OR custodian_id = auth.uid());
CREATE POLICY asset_events_read ON public.asset_events FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'assets.manage'));
CREATE POLICY authorised_pickups_read ON public.authorised_pickups FOR SELECT TO authenticated USING (added_by = auth.uid() OR public.scholar_can(school_id, 'visitors.manage'));
CREATE POLICY visitor_passes_read ON public.visitor_passes FOR SELECT TO authenticated USING (host_user_id = auth.uid() OR public.scholar_can(school_id, 'visitors.manage'));
DROP TRIGGER IF EXISTS trg_inventory_moves_append_only ON public.inventory_moves;
CREATE TRIGGER trg_inventory_moves_append_only BEFORE UPDATE OR DELETE ON public.inventory_moves FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
DROP TRIGGER IF EXISTS trg_asset_events_append_only ON public.asset_events;
CREATE TRIGGER trg_asset_events_append_only BEFORE UPDATE OR DELETE ON public.asset_events FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
REVOKE ALL ON FUNCTION public._scores_ok(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scheme_week_upsert(uuid, text, text, text, int, text, text[], text), public.lesson_note_submit(uuid, uuid), public.lesson_note_review(uuid, boolean, text),
  public.appraisal_open(uuid, uuid, uuid), public.appraisal_self(uuid, jsonb), public.appraisal_review(uuid, jsonb), public.appraisal_acknowledge(uuid, text),
  public.salary_profile_set(uuid, numeric, numeric, numeric, numeric, numeric, boolean), public.loan_request(numeric, numeric, text), public.loan_decide(uuid, boolean),
  public.paye_annual(numeric, numeric, numeric, numeric, date), public.payroll_compute(uuid, int, int), public.payroll_approve(uuid, int, int),
  public.inventory_item_upsert(uuid, text, text, text, numeric, numeric), public.inventory_move(uuid, numeric, text, text, text),
  public.asset_register(uuid, text, text, text, numeric, date, int, text, uuid), public.asset_update(uuid, text, text, uuid), public.asset_book_value(uuid, date),
  public.pickup_authorise(uuid, text, text, text), public.visitor_preregister(text, text, text, uuid, date), public.visitor_check_in(uuid, text), public.visitor_check_out(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheme_week_upsert(uuid, text, text, text, int, text, text[], text), public.lesson_note_submit(uuid, uuid), public.lesson_note_review(uuid, boolean, text),
  public.appraisal_open(uuid, uuid, uuid), public.appraisal_self(uuid, jsonb), public.appraisal_review(uuid, jsonb), public.appraisal_acknowledge(uuid, text),
  public.salary_profile_set(uuid, numeric, numeric, numeric, numeric, numeric, boolean), public.loan_request(numeric, numeric, text), public.loan_decide(uuid, boolean),
  public.paye_annual(numeric, numeric, numeric, numeric, date), public.payroll_compute(uuid, int, int), public.payroll_approve(uuid, int, int),
  public.inventory_item_upsert(uuid, text, text, text, numeric, numeric), public.inventory_move(uuid, numeric, text, text, text),
  public.asset_register(uuid, text, text, text, numeric, date, int, text, uuid), public.asset_update(uuid, text, text, uuid), public.asset_book_value(uuid, date),
  public.pickup_authorise(uuid, text, text, text), public.visitor_preregister(text, text, text, uuid, date), public.visitor_check_in(uuid, text), public.visitor_check_out(uuid) TO authenticated;
COMMIT;
