-- SHERIVS-A05 (Track A, day 3): fee relief and levies.
--  * discounts, scholarships and waivers per student (percent or fixed, per term, optional fee type), maker-checker approval:
--    the person who requests relief can never approve it; approved relief can be revoked; all audited
--  * sibling rule (nth child and later in a family get N%) applied idempotently per term
--  * levies: one-off charges for the whole school or chosen classes, created once per student (idempotent)
--  * fee_statement: gross, relief (capped at gross), net, paid and balance per student and term
-- Fee rows are not rewritten: the statement is the net view; checkout keeps charging fee rows (follow-up wires net into checkout).
BEGIN;

CREATE TABLE IF NOT EXISTS public.fee_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('discount','scholarship','waiver')),
  mode text NOT NULL CHECK (mode IN ('percent','fixed')),
  value numeric(12,2) NOT NULL CHECK (value > 0),
  term text NOT NULL, academic_year text NOT NULL, fee_type text,
  sponsor text, reason text NOT NULL, rule text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revoked')),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), decided_by uuid, decided_at timestamptz,
  CHECK (mode <> 'percent' OR value <= 100));
CREATE INDEX IF NOT EXISTS fee_adjustments_student_term ON public.fee_adjustments (student_id, academic_year, term);
CREATE UNIQUE INDEX IF NOT EXISTS fee_adjustments_rule_once ON public.fee_adjustments (student_id, academic_year, term, rule) WHERE rule IS NOT NULL AND status <> 'revoked';
CREATE TABLE IF NOT EXISTS public.fee_levies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL, amount numeric(12,2) NOT NULL CHECK (amount > 0), term text NOT NULL, academic_year text NOT NULL,
  class_ids uuid[], due_date date, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), charged int NOT NULL DEFAULT 0,
  UNIQUE (school_id, name, term, academic_year));
CREATE TABLE IF NOT EXISTS public.fee_sibling_rules (
  school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  from_child int NOT NULL CHECK (from_child BETWEEN 2 AND 10), percent numeric(5,2) NOT NULL CHECK (percent > 0 AND percent <= 100),
  updated_at timestamptz NOT NULL DEFAULT now());

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fee_adjustments','fee_levies','fee_sibling_rules'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t); EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
  END LOOP; END $$;
DROP POLICY IF EXISTS fee_adjustments_read ON public.fee_adjustments;
CREATE POLICY fee_adjustments_read ON public.fee_adjustments FOR SELECT TO authenticated
  USING ((school_id = public.get_my_school_id() AND public.scholar_can(school_id, 'fees.view'))
      OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND (s.user_id = auth.uid() OR s.parent_id = auth.uid()))
      OR public.is_guardian_of_student(student_id, school_id) OR coalesce(public.is_super_admin(), false));
DROP POLICY IF EXISTS fee_levies_read ON public.fee_levies;
CREATE POLICY fee_levies_read ON public.fee_levies FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() OR coalesce(public.is_super_admin(), false));
DROP POLICY IF EXISTS fee_sibling_rules_read ON public.fee_sibling_rules;
CREATE POLICY fee_sibling_rules_read ON public.fee_sibling_rules FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() OR coalesce(public.is_super_admin(), false));

CREATE OR REPLACE FUNCTION public.fee_relief_request(p_student uuid, p_kind text, p_mode text, p_value numeric, p_term text, p_year text,
  p_reason text, p_fee_type text DEFAULT NULL, p_sponsor text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students; v uuid;
BEGIN
  SELECT * INTO s FROM public.students WHERE id = p_student;
  IF s.id IS NULL OR s.school_id IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(s.school_id, 'fees.manage_plans') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 5 THEN RAISE EXCEPTION 'give a reason (at least 5 characters)'; END IF;
  IF p_kind = 'scholarship' AND coalesce(length(btrim(p_sponsor)), 0) < 2 THEN RAISE EXCEPTION 'scholarships need a sponsor'; END IF;
  INSERT INTO public.fee_adjustments (school_id, student_id, kind, mode, value, term, academic_year, fee_type, sponsor, reason, created_by)
  VALUES (s.school_id, s.id, p_kind, p_mode, p_value, p_term, p_year, nullif(btrim(coalesce(p_fee_type, '')), ''), p_sponsor, btrim(p_reason), auth.uid()) RETURNING id INTO v;
  RETURN v;
END $$;

-- Maker-checker: a second person with fees.manage_plans decides. The requester can never approve their own request.
CREATE OR REPLACE FUNCTION public.fee_relief_decide(p_id uuid, p_approve boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.fee_adjustments;
BEGIN
  SELECT * INTO a FROM public.fee_adjustments WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR a.school_id IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(a.school_id, 'fees.manage_plans') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF a.created_by = auth.uid() THEN RAISE EXCEPTION 'separation_of_duties: the requester cannot decide their own relief' USING ERRCODE = '42501'; END IF;
  IF a.status <> 'pending' THEN RAISE EXCEPTION 'already %', a.status; END IF;
  UPDATE public.fee_adjustments SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now() WHERE id = a.id;
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
END $$;

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

-- Levy: one fee row per active student in scope (whole school or chosen classes); re-running never double-charges.
CREATE OR REPLACE FUNCTION public.fee_levy_create(p_org uuid, p_name text, p_amount numeric, p_term text, p_year text, p_classes uuid[] DEFAULT NULL, p_due date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.fee_levies; n int;
BEGIN
  IF p_org IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(p_org, 'fees.manage_plans') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(btrim(p_name)), 0) < 3 THEN RAISE EXCEPTION 'levy name is required'; END IF;
  IF p_classes IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_classes) c WHERE NOT EXISTS (SELECT 1 FROM public.classes WHERE id = c AND school_id = p_org)) THEN
    RAISE EXCEPTION 'a class is not in this school'; END IF;
  INSERT INTO public.fee_levies (school_id, name, amount, term, academic_year, class_ids, due_date, created_by)
  VALUES (p_org, btrim(p_name), p_amount, p_term, p_year, p_classes, p_due, auth.uid())
  ON CONFLICT (school_id, name, term, academic_year) DO UPDATE SET class_ids = EXCLUDED.class_ids RETURNING * INTO l;
  IF l.amount <> p_amount THEN RAISE EXCEPTION 'levy % already exists with a different amount (₦%)', l.name, l.amount; END IF;
  INSERT INTO public.fees (school_id, student_id, fee_type, amount, due_date, term, academic_year, status)
  SELECT p_org, s.id, 'levy:' || l.name, l.amount, l.due_date, l.term, l.academic_year, 'unpaid'
    FROM public.students s
   WHERE s.school_id = p_org AND s.is_active AND (l.class_ids IS NULL OR s.class_id = ANY (l.class_ids))
     AND NOT EXISTS (SELECT 1 FROM public.fees f WHERE f.student_id = s.id AND f.fee_type = 'levy:' || l.name AND f.term = l.term AND f.academic_year = l.academic_year);
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.fee_levies SET charged = charged + n WHERE id = l.id;
  RETURN jsonb_build_object('levy', l.id, 'charged_now', n, 'charged_total', l.charged + n);
END $$;

CREATE OR REPLACE FUNCTION public.fee_sibling_rule_set(p_org uuid, p_from_child int, p_percent numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_org IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(p_org, 'fees.manage_plans') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.fee_sibling_rules (school_id, from_child, percent) VALUES (p_org, p_from_child, p_percent)
  ON CONFLICT (school_id) DO UPDATE SET from_child = EXCLUDED.from_child, percent = EXCLUDED.percent, updated_at = now();
END $$;

-- Families = active students sharing a parent account. Oldest-enrolled child first; the nth child and later get the rule's percent.
-- Rule-based relief is pre-approved by the rule (rule = 'sibling'); a manual decision is not needed, and it is applied once per term.
CREATE OR REPLACE FUNCTION public.fee_sibling_apply(p_org uuid, p_term text, p_year text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.fee_sibling_rules; n int;
BEGIN
  IF p_org IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(p_org, 'fees.manage_plans') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.fee_sibling_rules WHERE school_id = p_org;
  IF r.school_id IS NULL THEN RAISE EXCEPTION 'set a sibling rule first'; END IF;
  WITH fam AS (
    SELECT s.id, row_number() OVER (PARTITION BY s.parent_id ORDER BY coalesce(s.enrollment_date, s.created_at::date), s.created_at, s.id) k
      FROM public.students s WHERE s.school_id = p_org AND s.is_active AND s.parent_id IS NOT NULL)
  INSERT INTO public.fee_adjustments (school_id, student_id, kind, mode, value, term, academic_year, reason, rule, status, created_by, decided_by, decided_at)
  SELECT p_org, fam.id, 'discount', 'percent', r.percent, p_term, p_year, format('Sibling discount (child %s)', fam.k), 'sibling', 'approved', auth.uid(), auth.uid(), now()
    FROM fam WHERE fam.k >= r.from_child
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

-- Statement: gross from fee rows; relief from approved adjustments (fee-type specific or all), capped at gross; balance after payments.
CREATE OR REPLACE FUNCTION public.fee_statement(p_student uuid, p_term text, p_year text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students; gross numeric; paid numeric; relief numeric := 0; items jsonb := '[]'::jsonb; a record; base numeric; amt numeric;
BEGIN
  SELECT * INTO s FROM public.students WHERE id = p_student;
  IF s.id IS NULL OR NOT (s.user_id = auth.uid() OR s.parent_id = auth.uid() OR public.is_guardian_of_student(s.id, s.school_id)
     OR (s.school_id = public.get_my_school_id() AND public.scholar_can(s.school_id, 'fees.view')) OR coalesce(public.is_super_admin(), false)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(sum(amount), 0), coalesce(sum(paid_amount), 0) INTO gross, paid FROM public.fees WHERE student_id = s.id AND term = p_term AND academic_year = p_year;
  FOR a IN SELECT * FROM public.fee_adjustments WHERE student_id = s.id AND term = p_term AND academic_year = p_year AND status = 'approved' ORDER BY created_at LOOP
    SELECT coalesce(sum(amount), 0) INTO base FROM public.fees WHERE student_id = s.id AND term = p_term AND academic_year = p_year AND (a.fee_type IS NULL OR fee_type = a.fee_type);
    amt := round(CASE WHEN a.mode = 'percent' THEN base * a.value / 100 ELSE least(a.value, base) END, 2);
    amt := least(amt, gross - relief);
    relief := relief + amt;
    items := items || jsonb_build_object('id', a.id, 'kind', a.kind, 'mode', a.mode, 'value', a.value, 'fee_type', a.fee_type, 'sponsor', a.sponsor, 'reason', a.reason, 'amount', amt);
  END LOOP;
  RETURN jsonb_build_object('student', s.id, 'term', p_term, 'year', p_year, 'gross', gross, 'relief', relief, 'net', gross - relief,
    'paid', paid, 'balance', greatest(gross - relief - paid, 0), 'credit', greatest(paid - (gross - relief), 0), 'items', items,
    'fees', coalesce((SELECT jsonb_agg(jsonb_build_object('fee_type', fee_type, 'amount', amount, 'paid', paid_amount, 'status', status) ORDER BY fee_type)
                       FROM public.fees WHERE student_id = s.id AND term = p_term AND academic_year = p_year), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.fee_relief_request(uuid, text, text, numeric, text, text, text, text, text), public.fee_relief_decide(uuid, boolean), public.fee_relief_revoke(uuid),
  public.fee_levy_create(uuid, text, numeric, text, text, uuid[], date), public.fee_sibling_rule_set(uuid, int, numeric), public.fee_sibling_apply(uuid, text, text),
  public.fee_statement(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fee_relief_request(uuid, text, text, numeric, text, text, text, text, text), public.fee_relief_decide(uuid, boolean), public.fee_relief_revoke(uuid),
  public.fee_levy_create(uuid, text, numeric, text, text, uuid[], date), public.fee_sibling_rule_set(uuid, int, numeric), public.fee_sibling_apply(uuid, text, text),
  public.fee_statement(uuid, text, text) TO authenticated;

COMMIT;
