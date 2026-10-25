-- SHERIVS-B03 (Track B, Day 3): government console modules: inspections and circulars.
-- Scope: only schools that opted in to share with the jurisdiction (gov_data_sharing, not withdrawn).
-- Writes need an active, unexpired officer seat with a permitted agency role AND MFA (aal2). Reads go through _gov_guard (logged).
-- No learner-level data is stored or returned. Every write lands in the append-only gov_console_audit.
-- Depends on SHERIVS-B02 (gov_viewers.agency_role / expires_at, _gov_is_aal2).
BEGIN;

CREATE TABLE IF NOT EXISTS public.gov_console_audit (
  id bigserial PRIMARY KEY, jurisdiction_id uuid NOT NULL, actor uuid, action text NOT NULL, ref_id uuid, school_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS gov_console_audit_j_idx ON public.gov_console_audit (jurisdiction_id, at DESC);
ALTER TABLE public.gov_console_audit ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gov_console_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.gov_console_audit FROM anon, authenticated;
DROP TRIGGER IF EXISTS trg_gov_console_audit_append_only ON public.gov_console_audit;
CREATE TRIGGER trg_gov_console_audit_append_only BEFORE UPDATE OR DELETE ON public.gov_console_audit FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

-- Active officer seat role for the caller (legacy grants without a role count as read-only 'viewer').
CREATE OR REPLACE FUNCTION public._gov_my_role(p_jurisdiction uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(agency_role, 'viewer') FROM public.gov_viewers
   WHERE user_id = auth.uid() AND jurisdiction_id = p_jurisdiction AND (expires_at IS NULL OR expires_at > now()) $$;

CREATE OR REPLACE FUNCTION public._gov_write_guard(p_jurisdiction uuid, p_roles text[]) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r text := public._gov_my_role(p_jurisdiction);
BEGIN
  IF auth.uid() IS NULL OR r IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT public._gov_is_aal2() THEN RAISE EXCEPTION 'mfa required' USING ERRCODE = '42501'; END IF;
  IF NOT (r = ANY (p_roles)) THEN RAISE EXCEPTION 'not allowed for agency role %', r USING ERRCODE = '42501'; END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public._gov_school_shares(p_jurisdiction uuid, p_school uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.gov_data_sharing WHERE jurisdiction_id = p_jurisdiction AND school_id = p_school AND withdrawn_at IS NULL) $$;

-- ===== Inspections =====
CREATE TABLE IF NOT EXISTS public.gov_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id uuid NOT NULL REFERENCES public.gov_jurisdictions(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'routine' CHECK (kind IN ('routine','follow_up','complaint','accreditation')),
  scheduled_for date NOT NULL, inspector uuid NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
  scores jsonb, summary text, recommendations text, follow_up_due date,
  completed_at timestamptz, cancelled_reason text,
  school_response text, school_responded_at timestamptz, school_responded_by uuid,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS gov_inspections_j_idx ON public.gov_inspections (jurisdiction_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS gov_inspections_s_idx ON public.gov_inspections (school_id, scheduled_for DESC);
ALTER TABLE public.gov_inspections ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gov_inspections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.gov_inspections FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.gov_inspection_schedule(p_jurisdiction uuid, p_school uuid, p_date date, p_kind text DEFAULT 'routine', p_inspector uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid; insp uuid := coalesce(p_inspector, auth.uid());
BEGIN
  PERFORM public._gov_write_guard(p_jurisdiction, ARRAY['inspector','director','commissioner','permanent_secretary','board_chair']);
  IF NOT public._gov_school_shares(p_jurisdiction, p_school) THEN RAISE EXCEPTION 'school is not sharing with this jurisdiction'; END IF;
  IF p_date IS NULL OR p_date < current_date - 30 OR p_date > current_date + 365 THEN RAISE EXCEPTION 'inspection date must be within the last 30 days or the next year'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gov_viewers WHERE user_id = insp AND jurisdiction_id = p_jurisdiction AND (expires_at IS NULL OR expires_at > now())
                 AND coalesce(agency_role,'viewer') IN ('inspector','director','commissioner','permanent_secretary','board_chair')) THEN
    RAISE EXCEPTION 'assigned inspector must be an active officer of this jurisdiction'; END IF;
  INSERT INTO public.gov_inspections (jurisdiction_id, school_id, kind, scheduled_for, inspector, created_by)
    VALUES (p_jurisdiction, p_school, p_kind, p_date, insp, auth.uid()) RETURNING id INTO v;
  INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, ref_id, school_id, detail)
    VALUES (p_jurisdiction, auth.uid(), 'inspection_schedule', v, p_school, jsonb_build_object('date', p_date, 'kind', p_kind, 'inspector', insp));
  RETURN v;
END $$;

-- Record findings once: scores 1..5 on fixed domains; the report is final after this.
CREATE OR REPLACE FUNCTION public.gov_inspection_record(p_id uuid, p_scores jsonb, p_summary text, p_recommendations text DEFAULT NULL, p_follow_up_due date DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.gov_inspections; r text; k text; n int := 0;
BEGIN
  SELECT * INTO i FROM public.gov_inspections WHERE id = p_id FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  r := public._gov_write_guard(i.jurisdiction_id, ARRAY['inspector','director','commissioner','permanent_secretary','board_chair']);
  IF r = 'inspector' AND i.inspector <> auth.uid() THEN RAISE EXCEPTION 'only the assigned inspector or a director can record this inspection' USING ERRCODE = '42501'; END IF;
  IF i.status <> 'scheduled' THEN RAISE EXCEPTION 'inspection is already %', i.status; END IF;
  IF jsonb_typeof(p_scores) <> 'object' THEN RAISE EXCEPTION 'scores must be an object'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_scores) LOOP
    IF k NOT IN ('leadership','teaching','learning_environment','safety_welfare','records','community') THEN RAISE EXCEPTION 'unknown score domain %', k; END IF;
    IF jsonb_typeof(p_scores->k) <> 'number' OR (p_scores->>k)::numeric NOT IN (1,2,3,4,5) THEN RAISE EXCEPTION 'score for % must be 1 to 5', k; END IF;
    n := n + 1;
  END LOOP;
  IF n < 3 THEN RAISE EXCEPTION 'score at least three domains'; END IF;
  IF coalesce(length(btrim(p_summary)), 0) < 20 THEN RAISE EXCEPTION 'summary must be at least 20 characters'; END IF;
  IF p_follow_up_due IS NOT NULL AND p_follow_up_due <= current_date THEN RAISE EXCEPTION 'follow-up date must be in the future'; END IF;
  UPDATE public.gov_inspections SET status = 'completed', scores = p_scores, summary = btrim(p_summary), recommendations = nullif(btrim(coalesce(p_recommendations,'')), ''),
    follow_up_due = p_follow_up_due, completed_at = now() WHERE id = p_id;
  INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, ref_id, school_id, detail)
    VALUES (i.jurisdiction_id, auth.uid(), 'inspection_record', p_id, i.school_id, jsonb_build_object('scores', p_scores, 'follow_up_due', p_follow_up_due));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.gov_inspection_cancel(p_id uuid, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.gov_inspections;
BEGIN
  SELECT * INTO i FROM public.gov_inspections WHERE id = p_id FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM public._gov_write_guard(i.jurisdiction_id, ARRAY['director','commissioner','permanent_secretary','board_chair']);
  IF i.status <> 'scheduled' THEN RETURN false; END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 5 THEN RAISE EXCEPTION 'give a reason'; END IF;
  UPDATE public.gov_inspections SET status = 'cancelled', cancelled_reason = btrim(p_reason) WHERE id = p_id;
  INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, ref_id, school_id, detail) VALUES (i.jurisdiction_id, auth.uid(), 'inspection_cancel', p_id, i.school_id, jsonb_build_object('reason', p_reason));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.gov_inspections_list(p_jurisdiction uuid, p_status text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._gov_guard(p_jurisdiction, 'inspections');
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'school', s.name, 'school_id', i.school_id, 'kind', i.kind, 'scheduled_for', i.scheduled_for,
      'status', i.status, 'scores', i.scores, 'summary', i.summary, 'recommendations', i.recommendations, 'follow_up_due', i.follow_up_due,
      'school_response', i.school_response, 'mine', i.inspector = auth.uid()) ORDER BY i.scheduled_for DESC)
    FROM public.gov_inspections i JOIN public.schools s ON s.id = i.school_id
    WHERE i.jurisdiction_id = p_jurisdiction AND (p_status IS NULL OR i.status = p_status)), '[]'::jsonb);
END $$;

-- Picker for scheduling: names and ids of sharing schools (no learner data).
CREATE OR REPLACE FUNCTION public.gov_sharing_schools(p_jurisdiction uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._gov_guard(p_jurisdiction, 'school_picker');
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'school', s.name, 'lga', l.lga) ORDER BY s.name)
    FROM public.gov_data_sharing d JOIN public.schools s ON s.id = d.school_id LEFT JOIN public.school_locations l ON l.school_id = s.id
    WHERE d.jurisdiction_id = p_jurisdiction AND d.withdrawn_at IS NULL), '[]'::jsonb);
END $$;

-- School side: admins see their own school's inspections and may respond once to a completed report.
CREATE OR REPLACE FUNCTION public.school_inspections_mine() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id();
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'authority', j.name, 'kind', i.kind, 'scheduled_for', i.scheduled_for, 'status', i.status,
      'scores', i.scores, 'summary', i.summary, 'recommendations', i.recommendations, 'follow_up_due', i.follow_up_due, 'school_response', i.school_response)
    ORDER BY i.scheduled_for DESC) FROM public.gov_inspections i JOIN public.gov_jurisdictions j ON j.id = i.jurisdiction_id
    WHERE i.school_id = s AND i.status <> 'cancelled'), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.school_inspection_respond(p_id uuid, p_response text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id(); i public.gov_inspections;
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM public.gov_inspections WHERE id = p_id AND school_id = s FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF i.status <> 'completed' OR i.school_response IS NOT NULL THEN RAISE EXCEPTION 'you can respond once to a completed report'; END IF;
  IF coalesce(length(btrim(p_response)), 0) < 10 THEN RAISE EXCEPTION 'response is too short'; END IF;
  UPDATE public.gov_inspections SET school_response = btrim(p_response), school_responded_at = now(), school_responded_by = auth.uid() WHERE id = p_id;
  INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, ref_id, school_id) VALUES (i.jurisdiction_id, auth.uid(), 'inspection_school_response', p_id, s);
  RETURN true;
END $$;

-- ===== Circulars =====
CREATE TABLE IF NOT EXISTS public.gov_circulars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id uuid NOT NULL REFERENCES public.gov_jurisdictions(id) ON DELETE CASCADE,
  ref_no text, title text NOT NULL CHECK (length(title) BETWEEN 5 AND 200), body text NOT NULL CHECK (length(body) BETWEEN 20 AND 20000),
  audience_lgas text[], requires_ack boolean NOT NULL DEFAULT true,
  published_by uuid NOT NULL, published_at timestamptz NOT NULL DEFAULT now(), withdrawn_at timestamptz, withdrawn_by uuid);
CREATE INDEX IF NOT EXISTS gov_circulars_j_idx ON public.gov_circulars (jurisdiction_id, published_at DESC);
CREATE TABLE IF NOT EXISTS public.gov_circular_acks (
  circular_id uuid NOT NULL REFERENCES public.gov_circulars(id) ON DELETE CASCADE, school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  acked_by uuid NOT NULL, acked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (circular_id, school_id));
ALTER TABLE public.gov_circulars ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gov_circulars FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gov_circular_acks ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gov_circular_acks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.gov_circulars, public.gov_circular_acks FROM anon, authenticated;

-- Is circular c addressed to school s? (school shares with the jurisdiction and, if LGAs are set, sits in one of them)
CREATE OR REPLACE FUNCTION public._gov_circular_reaches(p_circular public.gov_circulars, p_school uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public._gov_school_shares(p_circular.jurisdiction_id, p_school)
     AND (p_circular.audience_lgas IS NULL OR EXISTS (SELECT 1 FROM public.school_locations l WHERE l.school_id = p_school AND lower(l.lga) = ANY (SELECT lower(x) FROM unnest(p_circular.audience_lgas) x))) $$;

CREATE OR REPLACE FUNCTION public.gov_circular_publish(p_jurisdiction uuid, p_title text, p_body text, p_lgas text[] DEFAULT NULL, p_requires_ack boolean DEFAULT true, p_ref_no text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  PERFORM public._gov_write_guard(p_jurisdiction, ARRAY['director','commissioner','permanent_secretary','board_chair']);
  INSERT INTO public.gov_circulars (jurisdiction_id, ref_no, title, body, audience_lgas, requires_ack, published_by)
    VALUES (p_jurisdiction, nullif(btrim(coalesce(p_ref_no,'')), ''), btrim(p_title), btrim(p_body), CASE WHEN cardinality(p_lgas) > 0 THEN p_lgas END, coalesce(p_requires_ack, true), auth.uid()) RETURNING id INTO v;
  INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, ref_id, detail) VALUES (p_jurisdiction, auth.uid(), 'circular_publish', v, jsonb_build_object('title', p_title, 'lgas', p_lgas));
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.gov_circular_withdraw(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.gov_circulars;
BEGIN
  SELECT * INTO c FROM public.gov_circulars WHERE id = p_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM public._gov_write_guard(c.jurisdiction_id, ARRAY['director','commissioner','permanent_secretary','board_chair']);
  IF c.withdrawn_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.gov_circulars SET withdrawn_at = now(), withdrawn_by = auth.uid() WHERE id = p_id;
  INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, ref_id) VALUES (c.jurisdiction_id, auth.uid(), 'circular_withdraw', p_id);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.gov_circulars_list(p_jurisdiction uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._gov_guard(p_jurisdiction, 'circulars');
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'ref_no', c.ref_no, 'title', c.title, 'body', c.body, 'lgas', c.audience_lgas, 'requires_ack', c.requires_ack,
      'published_at', c.published_at, 'withdrawn', c.withdrawn_at IS NOT NULL,
      'recipients', (SELECT count(*) FROM public.gov_data_sharing d WHERE d.jurisdiction_id = c.jurisdiction_id AND d.withdrawn_at IS NULL AND public._gov_circular_reaches(c, d.school_id)),
      'acked', (SELECT count(*) FROM public.gov_circular_acks a WHERE a.circular_id = c.id)) ORDER BY c.published_at DESC)
    FROM public.gov_circulars c WHERE c.jurisdiction_id = p_jurisdiction), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.school_circulars_mine() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id();
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'authority', j.name, 'ref_no', c.ref_no, 'title', c.title, 'body', c.body, 'published_at', c.published_at,
      'requires_ack', c.requires_ack, 'acked_at', (SELECT a.acked_at FROM public.gov_circular_acks a WHERE a.circular_id = c.id AND a.school_id = s)) ORDER BY c.published_at DESC)
    FROM public.gov_circulars c JOIN public.gov_jurisdictions j ON j.id = c.jurisdiction_id
    WHERE c.withdrawn_at IS NULL AND public._gov_circular_reaches(c, s)), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.school_circular_ack(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id(); c public.gov_circulars; n int;
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.gov_circulars WHERE id = p_id;
  IF c.id IS NULL OR c.withdrawn_at IS NOT NULL OR NOT public._gov_circular_reaches(c, s) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.gov_circular_acks (circular_id, school_id, acked_by) VALUES (p_id, s, auth.uid()) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN INSERT INTO public.gov_console_audit (jurisdiction_id, actor, action, ref_id, school_id) VALUES (c.jurisdiction_id, auth.uid(), 'circular_ack', p_id, s); END IF;
  RETURN n > 0;
END $$;

REVOKE ALL ON FUNCTION public._gov_my_role(uuid), public._gov_write_guard(uuid, text[]), public._gov_school_shares(uuid, uuid), public._gov_circular_reaches(public.gov_circulars, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gov_inspection_schedule(uuid, uuid, date, text, uuid), public.gov_inspection_record(uuid, jsonb, text, text, date), public.gov_inspection_cancel(uuid, text),
  public.gov_inspections_list(uuid, text), public.gov_sharing_schools(uuid), public.school_inspections_mine(), public.school_inspection_respond(uuid, text),
  public.gov_circular_publish(uuid, text, text, text[], boolean, text), public.gov_circular_withdraw(uuid), public.gov_circulars_list(uuid),
  public.school_circulars_mine(), public.school_circular_ack(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gov_inspection_schedule(uuid, uuid, date, text, uuid), public.gov_inspection_record(uuid, jsonb, text, text, date), public.gov_inspection_cancel(uuid, text),
  public.gov_inspections_list(uuid, text), public.gov_sharing_schools(uuid), public.school_inspections_mine(), public.school_inspection_respond(uuid, text),
  public.gov_circular_publish(uuid, text, text, text[], boolean, text), public.gov_circular_withdraw(uuid), public.gov_circulars_list(uuid),
  public.school_circulars_mine(), public.school_circular_ack(uuid) TO authenticated;
COMMIT;
