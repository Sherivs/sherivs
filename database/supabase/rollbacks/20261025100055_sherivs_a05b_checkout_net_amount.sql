-- Rollback SHERIVS-A05b: drop per-row dues and restore the A05 fee_statement.
BEGIN;
DROP FUNCTION IF EXISTS public.fee_dues(uuid, text, text), public.fee_amount_due(uuid);
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
DROP FUNCTION IF EXISTS public._fee_row_dues(uuid, text, text);
DROP FUNCTION IF EXISTS public._fee_can_see_student(public.students);
COMMIT;
