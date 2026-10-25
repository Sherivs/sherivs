-- SHERIVS-B05 (Track B, Day 5): teacher deployment (staffing view + two-person posting workflow) and CSV exports.
-- Depends on SHERIVS-B03 (_gov_write_guard, _gov_school_shares, gov_console_audit). Aggregates keep the <10-learner suppression.
-- Postings only touch PUBLIC schools that share with the jurisdiction; teacher identity is the minimum needed (name + TRCN/staff number).
BEGIN;

-- ===== Staffing: teachers, learners, pupil-teacher ratio per sharing school =====
CREATE OR REPLACE FUNCTION public.gov_staffing(p_jurisdiction uuid, p_ptr_threshold int DEFAULT 40) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._gov_guard(p_jurisdiction, 'staffing');
  IF p_ptr_threshold IS NULL OR p_ptr_threshold NOT BETWEEN 10 AND 100 THEN RAISE EXCEPTION 'threshold must be 10 to 100'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x->>'ptr')::numeric DESC NULLS LAST) FROM (
    SELECT jsonb_build_object('school_id', s.id, 'school', s.name, 'lga', coalesce(l.lga, 'unknown'), 'ownership', coalesce(l.ownership, 'unknown'),
      'suppressed', p.learners < 10, 'teachers', CASE WHEN p.learners >= 10 THEN p.teachers END,
      'learners', CASE WHEN p.learners >= 10 THEN p.learners END,
      'ptr', CASE WHEN p.learners >= 10 AND p.teachers > 0 THEN round(p.learners::numeric / p.teachers, 1) END,
      'understaffed', p.learners >= 10 AND (p.teachers = 0 OR p.learners::numeric / p.teachers > p_ptr_threshold)) x
    FROM public.gov_data_sharing d JOIN public.schools s ON s.id = d.school_id LEFT JOIN public.school_locations l ON l.school_id = s.id
    CROSS JOIN LATERAL (SELECT (SELECT count(*) FROM public.students st WHERE st.school_id = s.id) learners,
                               (SELECT count(*) FROM public.users u WHERE u.school_id = s.id AND u.role = 'teacher' AND coalesce(u.is_active, true)) teachers) p
    WHERE d.jurisdiction_id = p_jurisdiction AND d.withdrawn_at IS NULL) q), '[]'::jsonb);
END $$;

-- ===== Postings: propose -> approve (different officer) -> both schools acknowledge =====
CREATE TABLE IF NOT EXISTS public.gov_teacher_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id uuid NOT NULL REFERENCES public.gov_jurisdictions(id) ON DELETE CASCADE,
  teacher_name text NOT NULL CHECK (length(teacher_name) BETWEEN 3 AND 120),
  teacher_ref text NOT NULL CHECK (teacher_ref ~ '^[A-Za-z0-9/-]{3,40}$'),
  subject_area text, from_school uuid REFERENCES public.schools(id) ON DELETE SET NULL, to_school uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  effective_date date NOT NULL, reason text NOT NULL CHECK (length(reason) >= 10),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','cancelled')),
  proposed_by uuid NOT NULL, proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid, decided_at timestamptz, decision_note text,
  released_at timestamptz, released_by uuid, received_at timestamptz, received_by uuid,
  CHECK (from_school IS DISTINCT FROM to_school));
CREATE INDEX IF NOT EXISTS gov_teacher_postings_j_idx ON public.gov_teacher_postings (jurisdiction_id, proposed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS gov_teacher_postings_open_uq ON public.gov_teacher_postings (jurisdiction_id, upper(teacher_ref)) WHERE status IN ('proposed','approved') AND received_at IS NULL;
ALTER TABLE public.gov_teacher_postings ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gov_teacher_postings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.gov_teacher_postings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._gov_public_sharing(p_jurisdiction uuid, p_school uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public._gov_school_shares(p_jurisdiction, p_school) AND EXISTS (SELECT 1 FROM public.school_locations WHERE school_id = p_school AND ownership = 'public') $$;

CREATE OR REPLACE FUNCTION public.gov_posting_propose(p_jurisdiction uuid, p_teacher_name text, p_teacher_ref text, p_from uuid, p_to uuid,
  p_effective date, p_reason text, p_subject text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  PERFORM public._gov_write_guard(p_jurisdiction, ARRAY['planning_officer','director','commissioner','permanent_secretary','board_chair']);
  IF NOT public._gov_public_sharing(p_jurisdiction, p_to) OR (p_from IS NOT NULL AND NOT public._gov_public_sharing(p_jurisdiction, p_from)) THEN
    RAISE EXCEPTION 'both schools must be public schools sharing with this jurisdiction'; END IF;
  IF p_effective IS NULL OR p_effective < current_date OR p_effective > current_date + 365 THEN RAISE EXCEPTION 'effective date must be today or within a year'; END IF;
  INSERT INTO public.gov_teacher_postings (jurisdiction_id, teacher_name, teacher_ref, subject_area, from_school, to_school, effective_date, reason, proposed_by)
    VALUES (p_jurisdiction, btrim(p_teacher_name), upper(btrim(p_teacher_ref)), nullif(btrim(coalesce(p_subject,'')), ''), p_from, p_to, p_effective, btrim(p_reason), auth.uid()) RETURNING id INTO v;
  INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, ref_id, school_id, detail)
    VALUES (p_jurisdiction, auth.uid(), 'posting_propose', v, p_to, jsonb_build_object('from', p_from, 'to', p_to, 'teacher_ref', upper(btrim(p_teacher_ref)), 'effective', p_effective));
  RETURN v;
END $$;

-- Two-person rule: a director-level officer other than the proposer approves or rejects.
CREATE OR REPLACE FUNCTION public.gov_posting_decide(p_id uuid, p_approve boolean, p_note text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.gov_teacher_postings; st text := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  SELECT * INTO p FROM public.gov_teacher_postings WHERE id = p_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM public._gov_write_guard(p.jurisdiction_id, ARRAY['director','commissioner','permanent_secretary','board_chair']);
  IF p.proposed_by = auth.uid() THEN RAISE EXCEPTION 'two-person rule: another officer must decide this posting' USING ERRCODE = '42501'; END IF;
  IF p.status <> 'proposed' THEN RAISE EXCEPTION 'posting is already %', p.status; END IF;
  IF NOT p_approve AND coalesce(length(btrim(p_note)), 0) < 5 THEN RAISE EXCEPTION 'give a reason for rejecting'; END IF;
  UPDATE public.gov_teacher_postings SET status = st, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note,'')), '') WHERE id = p_id;
  INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, ref_id, school_id, detail) VALUES (p.jurisdiction_id, auth.uid(), 'posting_' || st, p_id, p.to_school, jsonb_build_object('note', p_note));
  RETURN st;
END $$;

CREATE OR REPLACE FUNCTION public.gov_posting_cancel(p_id uuid, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.gov_teacher_postings;
BEGIN
  SELECT * INTO p FROM public.gov_teacher_postings WHERE id = p_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM public._gov_write_guard(p.jurisdiction_id, ARRAY['director','commissioner','permanent_secretary','board_chair']);
  IF p.status NOT IN ('proposed','approved') OR p.received_at IS NOT NULL THEN RETURN false; END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 5 THEN RAISE EXCEPTION 'give a reason'; END IF;
  UPDATE public.gov_teacher_postings SET status = 'cancelled', decision_note = btrim(p_reason), decided_by = auth.uid(), decided_at = now() WHERE id = p_id;
  INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, ref_id, school_id) VALUES (p.jurisdiction_id, auth.uid(), 'posting_cancel', p_id, p.to_school);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.gov_postings_list(p_jurisdiction uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._gov_guard(p_jurisdiction, 'postings');
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'teacher_name', p.teacher_name, 'teacher_ref', p.teacher_ref, 'subject', p.subject_area,
      'from_school', f.name, 'to_school', t.name, 'effective_date', p.effective_date, 'reason', p.reason, 'status', p.status, 'decision_note', p.decision_note,
      'released', p.released_at IS NOT NULL, 'received', p.received_at IS NOT NULL, 'mine', p.proposed_by = auth.uid()) ORDER BY p.proposed_at DESC)
    FROM public.gov_teacher_postings p LEFT JOIN public.schools f ON f.id = p.from_school JOIN public.schools t ON t.id = p.to_school
    WHERE p.jurisdiction_id = p_jurisdiction), '[]'::jsonb);
END $$;

-- School side: approved postings into or out of my school; the releasing school releases, the receiving school receives.
CREATE OR REPLACE FUNCTION public.school_postings_mine() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id();
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'authority', j.name, 'teacher_name', p.teacher_name, 'teacher_ref', p.teacher_ref, 'subject', p.subject_area,
      'direction', CASE WHEN p.to_school = s THEN 'incoming' ELSE 'outgoing' END, 'other_school', CASE WHEN p.to_school = s THEN f.name ELSE t.name END,
      'effective_date', p.effective_date, 'released', p.released_at IS NOT NULL, 'received', p.received_at IS NOT NULL) ORDER BY p.effective_date)
    FROM public.gov_teacher_postings p JOIN public.gov_jurisdictions j ON j.id = p.jurisdiction_id
    LEFT JOIN public.schools f ON f.id = p.from_school JOIN public.schools t ON t.id = p.to_school
    WHERE p.status = 'approved' AND (p.to_school = s OR p.from_school = s)), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.school_posting_ack(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id(); p public.gov_teacher_postings; what text;
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.gov_teacher_postings WHERE id = p_id FOR UPDATE;
  IF p.id IS NULL OR p.status <> 'approved' OR NOT (s = p.to_school OR s = p.from_school) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF s = p.from_school AND p.released_at IS NULL THEN
    UPDATE public.gov_teacher_postings SET released_at = now(), released_by = auth.uid() WHERE id = p_id; what := 'released';
  ELSIF s = p.to_school AND p.received_at IS NULL THEN
    IF p.from_school IS NOT NULL AND p.released_at IS NULL THEN RAISE EXCEPTION 'the releasing school must release the teacher first'; END IF;
    UPDATE public.gov_teacher_postings SET received_at = now(), received_by = auth.uid() WHERE id = p_id; what := 'received';
  ELSE RETURN 'already_done'; END IF;
  INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, ref_id, school_id) VALUES (p.jurisdiction_id, auth.uid(), 'posting_' || what, p_id, s);
  RETURN what;
END $$;

-- ===== Exports: CSV built server-side from the same suppressed views; every export is audited =====
CREATE OR REPLACE FUNCTION public._gov_csv(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN v IS NULL THEN '' ELSE '"' || replace(CASE WHEN v ~ '^[=+@-]' THEN '''' || v ELSE v END, '"', '""') || '"' END $$;

CREATE OR REPLACE FUNCTION public.gov_export(p_jurisdiction uuid, p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE body text; n int := 0; rows_ jsonb; sup text := '<10';
BEGIN
  PERFORM public._gov_write_guard(p_jurisdiction, ARRAY['data_officer','planning_officer','director','commissioner','permanent_secretary','board_chair']);
  IF p_kind = 'schools' THEN
    rows_ := public.gov_overview(p_jurisdiction)->'per_school';
    body := 'school,lga,ownership,enrolled,girls_pct,attendance_pct,pass_rate_pct' || E'\n' || coalesce((SELECT string_agg(concat_ws(',', public._gov_csv(r->>'school'), public._gov_csv(r->>'lga'), public._gov_csv(r->>'ownership'),
      CASE WHEN (r->>'suppressed')::boolean THEN sup ELSE r->>'enrolled' END, CASE WHEN (r->>'suppressed')::boolean THEN sup ELSE r->>'girls_pct' END,
      CASE WHEN (r->>'suppressed')::boolean THEN sup ELSE r->>'attendance_pct' END, CASE WHEN (r->>'suppressed')::boolean THEN sup ELSE r->>'pass_rate_pct' END), E'\n') FROM jsonb_array_elements(rows_) r), '');
  ELSIF p_kind = 'staffing' THEN
    rows_ := public.gov_staffing(p_jurisdiction);
    body := 'school,lga,ownership,teachers,learners,pupil_teacher_ratio,understaffed' || E'\n' || coalesce((SELECT string_agg(concat_ws(',', public._gov_csv(r->>'school'), public._gov_csv(r->>'lga'), public._gov_csv(r->>'ownership'),
      CASE WHEN (r->>'suppressed')::boolean THEN sup ELSE r->>'teachers' END, CASE WHEN (r->>'suppressed')::boolean THEN sup ELSE r->>'learners' END,
      CASE WHEN (r->>'suppressed')::boolean THEN sup ELSE r->>'ptr' END, r->>'understaffed'), E'\n') FROM jsonb_array_elements(rows_) r), '');
  ELSIF p_kind = 'inspections' THEN
    rows_ := public.gov_inspections_list(p_jurisdiction, NULL);
    body := 'school,date,kind,status,leadership,teaching,learning_environment,safety_welfare,records,community,follow_up_due,school_replied' || E'\n' || coalesce((SELECT string_agg(concat_ws(',',
      public._gov_csv(r->>'school'), r->>'scheduled_for', r->>'kind', r->>'status', r->'scores'->>'leadership', r->'scores'->>'teaching', r->'scores'->>'learning_environment',
      r->'scores'->>'safety_welfare', r->'scores'->>'records', r->'scores'->>'community', r->>'follow_up_due', (r->>'school_response' IS NOT NULL)::text), E'\n') FROM jsonb_array_elements(rows_) r), '');
  ELSIF p_kind = 'circulars' THEN
    rows_ := public.gov_circulars_list(p_jurisdiction);
    body := 'ref_no,title,published_at,lgas,recipients,acknowledged,withdrawn' || E'\n' || coalesce((SELECT string_agg(concat_ws(',', public._gov_csv(r->>'ref_no'), public._gov_csv(r->>'title'),
      r->>'published_at', public._gov_csv((SELECT string_agg(x, ';') FROM jsonb_array_elements_text(coalesce(r->'lgas', '[]'::jsonb)) x)), r->>'recipients', r->>'acked', r->>'withdrawn'), E'\n') FROM jsonb_array_elements(rows_) r), '');
  ELSIF p_kind = 'postings' THEN
    rows_ := public.gov_postings_list(p_jurisdiction);
    body := 'teacher_name,teacher_ref,subject,from_school,to_school,effective_date,status,released,received' || E'\n' || coalesce((SELECT string_agg(concat_ws(',', public._gov_csv(r->>'teacher_name'), public._gov_csv(r->>'teacher_ref'),
      public._gov_csv(r->>'subject'), public._gov_csv(r->>'from_school'), public._gov_csv(r->>'to_school'), r->>'effective_date', r->>'status', r->>'released', r->>'received'), E'\n') FROM jsonb_array_elements(rows_) r), '');
  ELSE RAISE EXCEPTION 'unknown export %', p_kind; END IF;
  n := jsonb_array_length(coalesce(rows_, '[]'::jsonb));
  INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, detail) VALUES (p_jurisdiction, auth.uid(), 'export', jsonb_build_object('kind', p_kind, 'rows', n));
  RETURN jsonb_build_object('filename', 'sherivs-' || p_kind || '-' || to_char(now() AT TIME ZONE 'Africa/Lagos', 'YYYYMMDD-HH24MI') || '.csv', 'rows', n, 'csv', body);
END $$;

REVOKE ALL ON FUNCTION public._gov_public_sharing(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gov_staffing(uuid, int), public.gov_posting_propose(uuid, text, text, uuid, uuid, date, text, text), public.gov_posting_decide(uuid, boolean, text),
  public.gov_posting_cancel(uuid, text), public.gov_postings_list(uuid), public.school_postings_mine(), public.school_posting_ack(uuid), public.gov_export(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gov_staffing(uuid, int), public.gov_posting_propose(uuid, text, text, uuid, uuid, date, text, text), public.gov_posting_decide(uuid, boolean, text),
  public.gov_posting_cancel(uuid, text), public.gov_postings_list(uuid), public.school_postings_mine(), public.school_posting_ack(uuid), public.gov_export(uuid, text) TO authenticated;
COMMIT;
