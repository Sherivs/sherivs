-- SHERIVS-A05b: checkout charges what is actually owed after approved relief.
--   * relief from approved discounts/scholarships/waivers (incl. sibling rule) is allocated to individual fee rows
--     (fee-type relief to that type; general relief pro-rata by what is left on each row; never more than the row)
--   * fee_amount_due(fee) is the single source for the checkout amount and for settlement's amount check
--   * fee_statement now sums the same per-row allocation, so statement and checkout can never disagree
--   * levies are ordinary fee rows ('levy:<name>'), so they are charged (and can be relieved) like any other fee
BEGIN;

CREATE OR REPLACE FUNCTION public._fee_row_dues(p_student uuid, p_term text, p_year text)
RETURNS TABLE (fee_id uuid, fee_type text, amount numeric, paid numeric, relief numeric, due numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; rel jsonb := '{}'::jsonb; scope_left numeric; want numeric; r record; n int; i int; give numeric; left_after numeric;
BEGIN
  FOR a IN SELECT * FROM public.fee_adjustments x WHERE x.student_id = p_student AND x.term = p_term AND x.academic_year = p_year AND x.status = 'approved'
           ORDER BY x.created_at, x.id LOOP
    SELECT coalesce(sum(f.amount - coalesce((rel->>f.id::text)::numeric, 0)), 0), coalesce(sum(f.amount), 0), count(*)
      INTO scope_left, want, n
      FROM public.fees f WHERE f.student_id = p_student AND f.term = p_term AND f.academic_year = p_year AND (a.fee_type IS NULL OR f.fee_type = a.fee_type);
    IF n = 0 OR scope_left <= 0 THEN CONTINUE; END IF;
    want := round(CASE WHEN a.mode = 'percent' THEN want * a.value / 100 ELSE least(a.value, want) END, 2);
    want := least(want, scope_left);
    left_after := want; i := 0;
    IF a.mode = 'percent' THEN
      -- percent relief is a share of each row's own amount (order-independent), capped by what is left on the row
      FOR r IN SELECT f.id, f.amount, f.amount - coalesce((rel->>f.id::text)::numeric, 0) AS room
                 FROM public.fees f WHERE f.student_id = p_student AND f.term = p_term AND f.academic_year = p_year AND (a.fee_type IS NULL OR f.fee_type = a.fee_type) LOOP
        give := greatest(least(round(r.amount * a.value / 100, 2), r.room), 0);
        rel := jsonb_set(rel, ARRAY[r.id::text], to_jsonb(coalesce((rel->>r.id::text)::numeric, 0) + give));
      END LOOP;
      CONTINUE;
    END IF;
    -- fixed relief is spread pro-rata over what is left on each row; the last row takes the rounding remainder
    FOR r IN SELECT f.id, f.amount - coalesce((rel->>f.id::text)::numeric, 0) AS room
               FROM public.fees f WHERE f.student_id = p_student AND f.term = p_term AND f.academic_year = p_year AND (a.fee_type IS NULL OR f.fee_type = a.fee_type)
                AND f.amount - coalesce((rel->>f.id::text)::numeric, 0) > 0
              ORDER BY f.amount DESC, f.id LOOP
      i := i + 1;
      give := CASE WHEN i = (SELECT count(*) FROM public.fees f2 WHERE f2.student_id = p_student AND f2.term = p_term AND f2.academic_year = p_year
                               AND (a.fee_type IS NULL OR f2.fee_type = a.fee_type) AND f2.amount - coalesce((rel->>f2.id::text)::numeric, 0) > 0)
                   THEN left_after ELSE round(want * r.room / scope_left, 2) END;
      give := least(give, r.room, left_after);
      rel := jsonb_set(rel, ARRAY[r.id::text], to_jsonb(coalesce((rel->>r.id::text)::numeric, 0) + give));
      left_after := left_after - give;
    END LOOP;
  END LOOP;
  RETURN QUERY SELECT f.id, f.fee_type, f.amount, coalesce(f.paid_amount, 0), coalesce((rel->>f.id::text)::numeric, 0),
    greatest(f.amount - coalesce((rel->>f.id::text)::numeric, 0) - coalesce(f.paid_amount, 0), 0)
    FROM public.fees f WHERE f.student_id = p_student AND f.term = p_term AND f.academic_year = p_year ORDER BY f.fee_type, f.id;
END $$;

CREATE OR REPLACE FUNCTION public._fee_can_see_student(s public.students) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.id IS NOT NULL AND (s.user_id = auth.uid() OR s.parent_id = auth.uid() OR public.is_guardian_of_student(s.id, s.school_id)
     OR (s.school_id = public.get_my_school_id() AND public.scholar_can(s.school_id, 'fees.view')) OR coalesce(public.is_super_admin(), false))
$$;

-- Amount to charge now for one fee row. Callable by people who can see the student, and by the server (service_role) for settlement.
CREATE OR REPLACE FUNCTION public.fee_amount_due(p_fee uuid) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.fees; s public.students; d numeric;
BEGIN
  SELECT * INTO f FROM public.fees WHERE id = p_fee;
  IF f.id IS NULL THEN RAISE EXCEPTION 'fee not found'; END IF;
  SELECT * INTO s FROM public.students WHERE id = f.student_id;
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR public._fee_can_see_student(s)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF f.status = 'paid' THEN RETURN 0; END IF;
  SELECT x.due INTO d FROM public._fee_row_dues(f.student_id, f.term, f.academic_year) x WHERE x.fee_id = f.id;
  RETURN coalesce(d, 0);
END $$;

-- Per-row view for the parent/bursar screens.
CREATE OR REPLACE FUNCTION public.fee_dues(p_student uuid, p_term text, p_year text)
RETURNS TABLE (fee_id uuid, fee_type text, amount numeric, paid numeric, relief numeric, due numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students;
BEGIN
  SELECT * INTO s FROM public.students WHERE id = p_student;
  IF NOT public._fee_can_see_student(s) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT * FROM public._fee_row_dues(p_student, p_term, p_year);
END $$;

CREATE OR REPLACE FUNCTION public.fee_statement(p_student uuid, p_term text, p_year text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students; gross numeric; paid numeric; relief numeric; due numeric; items jsonb;
BEGIN
  SELECT * INTO s FROM public.students WHERE id = p_student;
  IF NOT public._fee_can_see_student(s) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(sum(x.amount), 0), coalesce(sum(x.paid), 0), coalesce(sum(x.relief), 0), coalesce(sum(x.due), 0) INTO gross, paid, relief, due
    FROM public._fee_row_dues(s.id, p_term, p_year) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'mode', a.mode, 'value', a.value, 'fee_type', a.fee_type, 'sponsor', a.sponsor, 'reason', a.reason) ORDER BY a.created_at), '[]'::jsonb)
    INTO items FROM public.fee_adjustments a WHERE a.student_id = s.id AND a.term = p_term AND a.academic_year = p_year AND a.status = 'approved';
  RETURN jsonb_build_object('student', s.id, 'term', p_term, 'year', p_year, 'gross', gross, 'relief', relief, 'net', gross - relief,
    'paid', paid, 'balance', due, 'credit', greatest(paid - (gross - relief), 0), 'items', items,
    'fees', coalesce((SELECT jsonb_agg(jsonb_build_object('fee_id', x.fee_id, 'fee_type', x.fee_type, 'amount', x.amount, 'paid', x.paid, 'relief', x.relief, 'due', x.due) ORDER BY x.fee_type)
                       FROM public._fee_row_dues(s.id, p_term, p_year) x), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public._fee_row_dues(uuid, text, text), public._fee_can_see_student(public.students),
  public.fee_amount_due(uuid), public.fee_dues(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._fee_row_dues(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fee_amount_due(uuid), public.fee_dues(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._fee_can_see_student(public.students) TO authenticated;

COMMIT;
