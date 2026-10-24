-- SHERIVS-027 (W9): government portal. Gov viewers sign in with their own account type (no school membership needed),
-- see only opted-in schools, aggregates only, and every group under 10 students is suppressed. Each view is logged.
BEGIN;
-- Gov viewers are not school members: point the FK at auth.users instead of public.users.
ALTER TABLE public.gov_viewers DROP CONSTRAINT IF EXISTS gov_viewers_user_id_fkey;
ALTER TABLE public.gov_viewers ADD CONSTRAINT gov_viewers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.gov_view_log (id bigserial PRIMARY KEY, user_id uuid NOT NULL, jurisdiction_id uuid NOT NULL, view text NOT NULL, viewed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS gov_view_log_j_idx ON public.gov_view_log (jurisdiction_id, viewed_at DESC);

CREATE OR REPLACE FUNCTION public._gov_guard(p_jurisdiction uuid, p_view text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (EXISTS (SELECT 1 FROM public.gov_viewers WHERE user_id = auth.uid() AND jurisdiction_id = p_jurisdiction) OR coalesce(public.is_super_admin(), false)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.gov_view_log (user_id, jurisdiction_id, view) VALUES (auth.uid(), p_jurisdiction, p_view);
END $$;

-- Which jurisdictions can I see? Empty for everyone else (used for routing to the portal).
CREATE OR REPLACE FUNCTION public.gov_my_jurisdictions() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'state', j.state, 'lga', j.lga) ORDER BY j.name), '[]'::jsonb)
  FROM public.gov_viewers v JOIN public.gov_jurisdictions j ON j.id = v.jurisdiction_id WHERE v.user_id = auth.uid();
$$;

-- Overview: jurisdiction totals plus per-school rows; anything built on fewer than 10 students is null + suppressed.
CREATE OR REPLACE FUNCTION public.gov_overview(p_jurisdiction uuid, p_year text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public._gov_guard(p_jurisdiction, 'overview');
  WITH sch AS (SELECT ds.school_id FROM public.gov_data_sharing ds WHERE ds.jurisdiction_id = p_jurisdiction AND ds.withdrawn_at IS NULL),
  per AS (
    SELECT s.school_id, coalesce(l.ownership, 'unknown') ownership, coalesce(l.lga, 'unknown') lga,
      (SELECT count(*) FROM public.students st WHERE st.school_id = s.school_id) enrolled,
      (SELECT count(*) FROM public.students st WHERE st.school_id = s.school_id AND st.gender = 'female') girls,
      (SELECT count(*) FILTER (WHERE status IN ('present','late')) FROM public.attendance a WHERE a.school_id = s.school_id AND a.date >= current_date - 30) att_p,
      (SELECT count(*) FROM public.attendance a WHERE a.school_id = s.school_id AND a.date >= current_date - 30) att_n,
      (SELECT count(*) FILTER (WHERE total_score >= 50) FROM public.grades g WHERE g.school_id = s.school_id AND (p_year IS NULL OR g.academic_year = p_year)) pass_p,
      (SELECT count(*) FROM public.grades g WHERE g.school_id = s.school_id AND (p_year IS NULL OR g.academic_year = p_year)) pass_n
    FROM sch s LEFT JOIN public.school_locations l ON l.school_id = s.school_id),
  tot AS (SELECT count(*) schools, sum(enrolled) enrolled, sum(girls) girls, sum(att_p) att_p, sum(att_n) att_n, sum(pass_p) pass_p, sum(pass_n) pass_n FROM per)
  SELECT jsonb_build_object(
    'schools', t.schools,
    'suppressed', coalesce(t.enrolled, 0) < 10,
    'enrolled', CASE WHEN t.enrolled >= 10 THEN t.enrolled END,
    'girls_pct', CASE WHEN t.enrolled >= 10 THEN round(100.0 * t.girls / t.enrolled, 1) END,
    'attendance_pct_30d', CASE WHEN t.enrolled >= 10 THEN round(100.0 * t.att_p / nullif(t.att_n, 0), 1) END,
    'pass_rate_pct', CASE WHEN t.enrolled >= 10 THEN round(100.0 * t.pass_p / nullif(t.pass_n, 0), 1) END,
    'per_school', coalesce((SELECT jsonb_agg(jsonb_build_object('school', (SELECT name FROM public.schools WHERE id = p.school_id), 'lga', p.lga, 'ownership', p.ownership,
        'suppressed', p.enrolled < 10,
        'enrolled', CASE WHEN p.enrolled >= 10 THEN p.enrolled END,
        'girls_pct', CASE WHEN p.enrolled >= 10 THEN round(100.0 * p.girls / p.enrolled, 1) END,
        'attendance_pct', CASE WHEN p.enrolled >= 10 THEN round(100.0 * p.att_p / nullif(p.att_n, 0), 1) END,
        'pass_rate_pct', CASE WHEN p.enrolled >= 10 THEN round(100.0 * p.pass_p / nullif(p.pass_n, 0), 1) END) ORDER BY p.lga) FROM per p), '[]'::jsonb),
    'by_ownership', coalesce((SELECT jsonb_agg(jsonb_build_object('ownership', o.ownership, 'schools', o.n, 'suppressed', o.enr < 10, 'enrolled', CASE WHEN o.enr >= 10 THEN o.enr END,
        'attendance_pct', CASE WHEN o.enr >= 10 THEN round(100.0 * o.ap / nullif(o.an, 0), 1) END))
      FROM (SELECT ownership, count(*) n, sum(enrolled) enr, sum(att_p) ap, sum(att_n) an FROM per GROUP BY ownership) o), '[]'::jsonb),
    'by_lga', coalesce((SELECT jsonb_agg(jsonb_build_object('lga', g.lga, 'schools', g.n, 'suppressed', g.enr < 10, 'enrolled', CASE WHEN g.enr >= 10 THEN g.enr END,
        'attendance_pct', CASE WHEN g.enr >= 10 THEN round(100.0 * g.ap / nullif(g.an, 0), 1) END))
      FROM (SELECT lga, count(*) n, sum(enrolled) enr, sum(att_p) ap, sum(att_n) an FROM per GROUP BY lga) g), '[]'::jsonb))
  INTO r FROM tot t;
  RETURN r;
END $$;

-- Weekly attendance trend across opted-in schools; weeks with fewer than 10 distinct students are suppressed.
CREATE OR REPLACE FUNCTION public.gov_attendance_trend(p_jurisdiction uuid, p_weeks int DEFAULT 12) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public._gov_guard(p_jurisdiction, 'attendance_trend');
  IF p_weeks IS NULL OR p_weeks < 1 OR p_weeks > 52 THEN RAISE EXCEPTION 'weeks must be 1 to 52'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('week', w.wk, 'suppressed', w.students < 10,
      'attendance_pct', CASE WHEN w.students >= 10 THEN round(100.0 * w.p / nullif(w.n, 0), 1) END) ORDER BY w.wk), '[]'::jsonb) INTO r
  FROM (SELECT date_trunc('week', a.date)::date wk, count(DISTINCT a.student_id) students, count(*) FILTER (WHERE a.status IN ('present','late')) p, count(*) n
        FROM public.attendance a JOIN public.gov_data_sharing ds ON ds.school_id = a.school_id AND ds.jurisdiction_id = p_jurisdiction AND ds.withdrawn_at IS NULL
        WHERE a.date >= current_date - (7 * p_weeks) GROUP BY 1) w;
  RETURN r;
END $$;

ALTER TABLE public.gov_view_log ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gov_view_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.gov_view_log FROM anon, authenticated, service_role;
GRANT SELECT ON public.gov_view_log TO authenticated;
DROP POLICY IF EXISTS gov_view_log_read ON public.gov_view_log;
CREATE POLICY gov_view_log_read ON public.gov_view_log FOR SELECT TO authenticated USING (user_id = auth.uid() OR coalesce(public.is_super_admin(), false));
DROP TRIGGER IF EXISTS trg_gov_view_log_append_only ON public.gov_view_log;
CREATE TRIGGER trg_gov_view_log_append_only BEFORE UPDATE OR DELETE ON public.gov_view_log FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
REVOKE ALL ON FUNCTION public._gov_guard(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gov_my_jurisdictions(), public.gov_overview(uuid, text), public.gov_attendance_trend(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gov_my_jurisdictions(), public.gov_overview(uuid, text), public.gov_attendance_trend(uuid, int) TO authenticated;
COMMIT;
