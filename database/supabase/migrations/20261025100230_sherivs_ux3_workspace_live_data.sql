-- SHERIVS-UX3: live data for workspace cards, honouring the caller's RLS and assigned scope.
-- workspace_widget_data(org, keys, scope) is SECURITY INVOKER: every count/summary runs under the caller's
-- own RLS (including the Track E restrictive read-scoping, #120), so a card can never show more than the
-- page it links to. On top of RLS it narrows to the caller's assigned scope (campus/shift/section/level/class
-- -> classes; subject -> subject), or to one focused scope the caller actually holds (?scope=dim:ref).
-- Keys the caller is not allowed to see (workspace_item_allowed) are skipped; a card whose table the caller
-- cannot read returns {"unavailable": true} instead of failing the whole call.
-- Not applied to production. Rollback: database/supabase/rollbacks/20261025100230_sherivs_ux3_workspace_live_data.sql
BEGIN;

-- Human labels for scope refs (refs are ids for campus/shift/section/level/class/house/hostel) ---------------
CREATE OR REPLACE FUNCTION public.workspace_scope_labels(p_org uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH o AS (SELECT d.key dim, r ref FROM jsonb_each(public.workspace_scope_options(p_org)) d, jsonb_array_elements_text(d.value) r)
  SELECT coalesce(jsonb_object_agg(o.dim, l.m), '{}') FROM (SELECT DISTINCT dim FROM o) o
  CROSS JOIN LATERAL (SELECT jsonb_object_agg(x.ref, coalesce(CASE x.dim
      WHEN 'campus'  THEN (SELECT name FROM public.campuses WHERE id::text = x.ref AND school_id = p_org)
      WHEN 'shift'   THEN (SELECT name FROM public.school_shifts WHERE id::text = x.ref AND school_id = p_org)
      WHEN 'section' THEN (SELECT name FROM public.school_sections WHERE id::text = x.ref AND school_id = p_org)
      WHEN 'level'   THEN (SELECT name FROM public.school_levels WHERE id::text = x.ref AND school_id = p_org)
      WHEN 'class'   THEN (SELECT name FROM public.classes WHERE id::text = x.ref AND school_id = p_org)
      WHEN 'house'   THEN (SELECT name FROM public.student_groups WHERE id::text = x.ref AND school_id = p_org)
      ELSE NULL END, x.ref)) m FROM o x WHERE x.dim = o.dim) l;
$$;

-- Effective scope for a request: the focused scope if the caller holds it, else all scopes they hold ----------
CREATE OR REPLACE FUNCTION public.workspace_effective_scope(p_org uuid, p_focus jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH mine AS (SELECT public.workspace_scope_options(p_org) s)
  SELECT CASE WHEN p_focus ? 'dim' AND p_focus ? 'ref' AND coalesce((mine.s -> (p_focus->>'dim')) ? (p_focus->>'ref'), false)
              THEN jsonb_build_object(p_focus->>'dim', jsonb_build_array(p_focus->>'ref')) ELSE mine.s END FROM mine;
$$;

-- Classes inside a scope (NULL = no class-type dimension, i.e. whole school as far as RLS allows) -------------
CREATE OR REPLACE FUNCTION public.workspace_scope_class_ids(p_org uuid, p_scope jsonb) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN NOT (coalesce(p_scope, '{}') ?| ARRAY['campus','shift','section','level','class']) THEN NULL ELSE
    coalesce(array(SELECT c.id FROM public.classes c WHERE c.school_id = p_org
      AND (NOT p_scope ? 'campus'  OR c.campus_id::text  IN (SELECT jsonb_array_elements_text(p_scope->'campus')))
      AND (NOT p_scope ? 'shift'   OR c.shift_id::text   IN (SELECT jsonb_array_elements_text(p_scope->'shift')))
      AND (NOT p_scope ? 'section' OR c.section_id::text IN (SELECT jsonb_array_elements_text(p_scope->'section')))
      AND (NOT p_scope ? 'level'   OR c.level_id::text   IN (SELECT jsonb_array_elements_text(p_scope->'level')))
      AND (NOT p_scope ? 'class'   OR c.id::text         IN (SELECT jsonb_array_elements_text(p_scope->'class')))), '{}') END;
$$;

-- For target pages honouring ?scope=dim:ref: the validated scope, its classes and labels -------------------
CREATE OR REPLACE FUNCTION public.workspace_scope_resolve(p_org uuid, p_focus jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_scope jsonb; v_held boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  v_scope := public.workspace_effective_scope(p_org, p_focus);
  v_held := p_focus ? 'dim' AND v_scope = jsonb_build_object(p_focus->>'dim', jsonb_build_array(p_focus->>'ref'));
  RETURN jsonb_build_object('focused', v_held, 'scope', CASE WHEN v_held THEN v_scope END,
    'class_ids', CASE WHEN v_held THEN to_jsonb(public.workspace_scope_class_ids(p_org, v_scope)) END,
    'subjects', CASE WHEN v_held AND v_scope ? 'subject' THEN v_scope->'subject' END,
    'labels', public.workspace_scope_labels(p_org));
END $$;

CREATE OR REPLACE FUNCTION public.workspace_widget_data(p_org uuid, p_keys text[], p_scope jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  -- timetable_slots.day_of_week is text: lowercase day names in the app (timetable-grid), ISO numbers tolerated
  v_days text[] := ARRAY[lower(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDay')), extract(isodow FROM (now() AT TIME ZONE 'Africa/Lagos'))::int::text];
  v_scope jsonb; v_cls uuid[]; v_subj text[]; v_out jsonb := '{}'; v_k text; v_r jsonb;
  n1 numeric; n2 numeric; n3 numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF cardinality(p_keys) > 40 THEN RAISE EXCEPTION 'too many cards' USING ERRCODE = '22023'; END IF;
  v_scope := public.workspace_effective_scope(p_org, p_scope);
  v_cls := public.workspace_scope_class_ids(p_org, v_scope);
  v_subj := CASE WHEN v_scope ? 'subject' THEN array(SELECT jsonb_array_elements_text(v_scope->'subject')) END;

  FOREACH v_k IN ARRAY p_keys LOOP
    CONTINUE WHEN v_out ? v_k OR NOT public.workspace_item_allowed(p_org, v_k);
    v_r := NULL;
    BEGIN
      CASE v_k
      WHEN 'w.attendance_todo' THEN
        SELECT count(*) INTO n1 FROM public.classes c WHERE c.school_id = p_org
           AND (c.teacher_id = v_uid OR c.id = ANY (v_cls))
           AND NOT EXISTS (SELECT 1 FROM public.attendance a WHERE a.class_id = c.id AND a.date = v_today);
        v_r := jsonb_build_object('metric', n1::text, 'note', CASE WHEN n1 = 0 THEN 'all registers marked today' ELSE 'registers still open today' END);
      WHEN 'w.today_classes' THEN
        v_r := jsonb_build_object('list', coalesce((SELECT jsonb_agg(jsonb_build_array(to_char(s.start_time, 'HH24:MI') || ' ' || coalesce(s.subject, ''), coalesce(s.room, '')) ORDER BY s.start_time)
          FROM (SELECT * FROM public.timetable_slots s WHERE s.school_id = p_org AND s.teacher_id = v_uid AND s.day_of_week = ANY (v_days) AND NOT coalesce(s.is_break, false)
                  AND (v_subj IS NULL OR s.subject = ANY (v_subj)) ORDER BY s.start_time LIMIT 6) s), '[]'));
      WHEN 'w.grading_queue' THEN
        SELECT count(*) INTO n1 FROM public.grades g WHERE g.school_id = p_org AND g.exam_score IS NULL
           AND (g.teacher_id = v_uid OR g.class_id = ANY (v_cls)) AND (v_subj IS NULL OR g.subject = ANY (v_subj));
        v_r := jsonb_build_object('metric', n1::text, 'note', 'scores left to enter');
      WHEN 'w.lesson_note_status' THEN
        SELECT jsonb_build_object('metric', initcap(replace(status, '_', ' ')), 'note', coalesce(title, topic, '') || ' · ' || coalesce(to_char(date_planned, 'DD Mon'), ''),
                 'warn', CASE WHEN status = 'needs_revision' THEN 'needs revision' END) INTO v_r
          FROM public.lesson_plans WHERE school_id = p_org AND teacher_id = v_uid ORDER BY coalesce(date_planned, created_at::date) DESC LIMIT 1;
        v_r := coalesce(v_r, jsonb_build_object('note', 'no lesson notes yet'));
      WHEN 'w.lesson_note_approvals' THEN
        SELECT count(*) INTO n1 FROM public.lesson_plans p WHERE p.school_id = p_org AND p.status = 'submitted'
           AND (v_cls IS NULL OR p.class_id = ANY (v_cls)) AND (v_subj IS NULL OR p.subject = ANY (v_subj));
        v_r := jsonb_build_object('metric', n1::text, 'note', 'lesson notes awaiting approval');
      WHEN 'w.cbt_sessions', 'w.my_cbt' THEN
        v_r := jsonb_build_object('list', coalesce((SELECT jsonb_agg(jsonb_build_array(t.title, to_char(t.opens_at AT TIME ZONE 'Africa/Lagos', 'Dy DD Mon HH24:MI')) ORDER BY t.opens_at)
          FROM (SELECT * FROM public.cbt_tests t WHERE t.school_id = p_org AND t.closes_at > now() AND (v_cls IS NULL OR t.class_id = ANY (v_cls))
                 AND (v_k <> 'w.my_cbt' OR t.class_id IN (SELECT class_id FROM public.students WHERE user_id = v_uid)) ORDER BY t.opens_at LIMIT 4) t), '[]'));
      WHEN 'w.form_class', 'w.level_overview', 'w.campus_overview', 'w.shift_overview', 'w.section_overview', 'w.school_health' THEN
        SELECT count(*), count(*) FILTER (WHERE a.status IN ('present', 'late')), count(*) FILTER (WHERE a.status = 'absent') INTO n1, n2, n3
          FROM public.students s LEFT JOIN public.attendance a ON a.student_id = s.id AND a.date = v_today
         WHERE s.school_id = p_org AND coalesce(s.is_active, true)
           AND (CASE WHEN v_k = 'w.form_class' THEN s.class_id IN (SELECT id FROM public.classes WHERE school_id = p_org AND (teacher_id = v_uid OR id = ANY (v_cls)))
                     WHEN v_k = 'w.school_health' THEN true ELSE v_cls IS NULL OR s.class_id = ANY (v_cls) END);
        v_r := jsonb_build_object('metric', n2::text || ' / ' || n1::text, 'note', 'present today', 'bar', CASE WHEN n1 > 0 THEN round(100 * n2 / n1) END,
                 'warn', CASE WHEN n3 > 0 THEN n3::text || ' absent' END);
      WHEN 'w.at_risk' THEN
        SELECT count(*) INTO n1 FROM (SELECT a.student_id FROM public.attendance a WHERE a.school_id = p_org AND a.status = 'absent' AND a.date > v_today - 14
           AND (v_cls IS NULL OR a.class_id = ANY (v_cls)) GROUP BY 1 HAVING count(*) >= 3) x;
        v_r := jsonb_build_object('metric', n1::text, 'note', 'students absent 3+ days in the last 2 weeks');
      WHEN 'w.fee_collection' THEN
        SELECT coalesce(sum(paid_amount), 0), coalesce(sum(amount), 0) INTO n1, n2 FROM public.fees f WHERE f.school_id = p_org
           AND (v_cls IS NULL OR f.student_id IN (SELECT id FROM public.students WHERE class_id = ANY (v_cls)));
        v_r := jsonb_build_object('metric', n1, 'money', true, 'note', 'collected of ₦' || to_char(n2, 'FM999,999,999,990'), 'bar', CASE WHEN n2 > 0 THEN round(100 * n1 / n2) END);
      WHEN 'w.defaulters' THEN
        SELECT coalesce(sum(amount - coalesce(paid_amount, 0)), 0), count(DISTINCT student_id) INTO n1, n2 FROM public.fees f
         WHERE f.school_id = p_org AND f.status <> 'paid' AND (v_cls IS NULL OR f.student_id IN (SELECT id FROM public.students WHERE class_id = ANY (v_cls)));
        v_r := jsonb_build_object('metric', n1, 'money', true, 'note', 'outstanding across ' || n2::text || ' students');
      WHEN 'w.child_fees' THEN
        SELECT coalesce(sum(f.amount - coalesce(f.paid_amount, 0)), 0) INTO n1 FROM public.fees f
         WHERE f.school_id = p_org AND f.status <> 'paid' AND f.student_id IN (SELECT student_id FROM public.parent_student_map WHERE parent_id = v_uid);
        v_r := jsonb_build_object('metric', n1, 'money', true, 'note', 'balance due');
      WHEN 'w.children_summary' THEN
        v_r := jsonb_build_object('list', coalesce((SELECT jsonb_agg(jsonb_build_array(coalesce(u.full_name, s.admission_number, 'Child') || coalesce(' · ' || c.name, ''),
                   coalesce(initcap(a.status), 'Not marked yet')))
          FROM public.parent_student_map m JOIN public.students s ON s.id = m.student_id
          LEFT JOIN public.users u ON u.id = s.user_id LEFT JOIN public.classes c ON c.id = s.class_id
          LEFT JOIN public.attendance a ON a.student_id = s.id AND a.date = v_today
         WHERE m.parent_id = v_uid AND m.school_id = p_org), '[]'));
      WHEN 'w.my_results' THEN
        SELECT round(avg(total_score), 1), count(*) INTO n1, n2 FROM public.grades g WHERE g.school_id = p_org AND g.is_published
           AND g.student_id IN (SELECT id FROM public.students WHERE user_id = v_uid);
        v_r := CASE WHEN n2 > 0 THEN jsonb_build_object('metric', n1::text || '%', 'note', 'average across ' || n2::text || ' published scores') ELSE jsonb_build_object('note', 'no published results yet') END;
      WHEN 'w.my_timetable' THEN
        v_r := jsonb_build_object('list', coalesce((SELECT jsonb_agg(jsonb_build_array(to_char(s.start_time, 'HH24:MI') || ' ' || coalesce(s.subject, ''), coalesce(s.room, '')) ORDER BY s.start_time)
          FROM public.timetable_slots s JOIN public.timetables t ON t.id = s.timetable_id AND t.is_active
         WHERE s.school_id = p_org AND s.day_of_week = ANY (v_days) AND NOT coalesce(s.is_break, false)
           AND t.class_id IN (SELECT class_id FROM public.students WHERE user_id = v_uid)), '[]'));
      WHEN 'w.expense_approvals' THEN
        SELECT count(*) INTO n1 FROM public.school_expenses WHERE school_id = p_org AND approved_by IS NULL;
        v_r := jsonb_build_object('metric', n1::text, 'note', 'expenses awaiting approval');
      WHEN 'w.leave_requests' THEN
        SELECT count(*) INTO n1 FROM public.staff_leave WHERE school_id = p_org AND status = 'pending';
        v_r := jsonb_build_object('metric', n1::text, 'note', 'leave requests to review');
      WHEN 'w.admissions_funnel' THEN
        v_r := jsonb_build_object('list', coalesce((SELECT jsonb_agg(jsonb_build_array(initcap(replace(status, '_', ' ')), n::text) ORDER BY n DESC)
          FROM (SELECT status, count(*) n FROM public.admission_applications WHERE school_id = p_org GROUP BY 1) x), '[]'));
      WHEN 'w.enrolment' THEN
        SELECT count(*) INTO n1 FROM public.students WHERE school_id = p_org AND coalesce(is_active, true) AND (v_cls IS NULL OR class_id = ANY (v_cls));
        v_r := jsonb_build_object('metric', n1::text, 'note', 'active students');
      WHEN 'w.sick_bay' THEN
        SELECT count(*), count(*) FILTER (WHERE outcome ILIKE '%refer%') INTO n1, n2 FROM public.clinic_visits WHERE school_id = p_org AND visit_date = v_today;
        v_r := jsonb_build_object('metric', n1::text, 'note', 'students seen today', 'warn', CASE WHEN n2 > 0 THEN n2::text || ' referred' END);
      WHEN 'w.library_loans' THEN
        SELECT count(*) FILTER (WHERE due_date < v_today), count(*) FILTER (WHERE due_date BETWEEN v_today AND v_today + 7) INTO n1, n2
          FROM public.library_borrowings WHERE school_id = p_org AND returned_date IS NULL;
        v_r := jsonb_build_object('list', jsonb_build_array(jsonb_build_array('Overdue', n1::text), jsonb_build_array('Due this week', n2::text)));
      WHEN 'w.gate_log' THEN
        SELECT count(*) FILTER (WHERE status IN ('in', 'out')), count(*) FILTER (WHERE status = 'expected'), count(*) FILTER (WHERE status = 'denied') INTO n1, n2, n3
          FROM public.visitor_passes WHERE school_id = p_org AND valid_on = v_today;
        v_r := jsonb_build_object('list', jsonb_build_array(jsonb_build_array('Visitors signed in', n1::text), jsonb_build_array('Expected', n2::text), jsonb_build_array('Denied at gate', n3::text)));
      WHEN 'w.incidents' THEN
        SELECT count(*) INTO n1 FROM public.security_incidents WHERE school_id = p_org AND status <> 'closed';
        v_r := jsonb_build_object('metric', n1::text, 'note', 'open incidents');
      WHEN 'w.announcements' THEN
        v_r := jsonb_build_object('list', coalesce((SELECT jsonb_agg(jsonb_build_array(n.title, to_char(n.created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon')) ORDER BY n.created_at DESC)
          FROM (SELECT * FROM public.notifications WHERE user_id = v_uid ORDER BY created_at DESC LIMIT 3) n), '[]'));
      ELSE v_r := NULL;  -- not wired yet: the card shows its link only
      END CASE;
    EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_column THEN
      v_r := jsonb_build_object('unavailable', true);
    END;
    IF v_r IS NOT NULL THEN v_out := v_out || jsonb_build_object(v_k, jsonb_strip_nulls(v_r)); END IF;
  END LOOP;
  RETURN jsonb_build_object('scope', v_scope, 'labels', public.workspace_scope_labels(p_org), 'cards', v_out);
END $$;

REVOKE ALL ON FUNCTION public.workspace_scope_resolve(uuid, jsonb), public.workspace_scope_labels(uuid), public.workspace_effective_scope(uuid, jsonb),
  public.workspace_scope_class_ids(uuid, jsonb), public.workspace_widget_data(uuid, text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_scope_resolve(uuid, jsonb), public.workspace_scope_labels(uuid), public.workspace_effective_scope(uuid, jsonb),
  public.workspace_scope_class_ids(uuid, jsonb), public.workspace_widget_data(uuid, text[], jsonb) TO authenticated, service_role;
COMMIT;
