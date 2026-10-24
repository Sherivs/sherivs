-- SHERIVS-B06: group console (console.<label>.sherivs.com) for proprietors running several schools.
-- Builds on 021 org_groups/org_group_members. A school joins only with its own admin's consent (MFA);
-- group staff see aggregate figures only (suppressed below 10 learners), never learner records.
BEGIN;
ALTER TABLE public.org_groups ADD COLUMN IF NOT EXISTS host_label text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_groups_host_label_chk') THEN
    ALTER TABLE public.org_groups ADD CONSTRAINT org_groups_host_label_chk CHECK (host_label IS NULL OR host_label ~ '^[a-z][a-z0-9-]{1,30}[a-z0-9]$');
  END IF; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS org_groups_host_label_uq ON public.org_groups (host_label) WHERE host_label IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.org_group_admins (
  group_id uuid NOT NULL REFERENCES public.org_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','viewer')),
  added_by uuid, added_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  PRIMARY KEY (group_id, user_id));
CREATE TABLE IF NOT EXISTS public.org_group_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES public.org_groups(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  decided_by uuid, decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS org_group_join_pending_uq ON public.org_group_join_requests (group_id, school_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS public.org_group_audit (
  id bigserial PRIMARY KEY, group_id uuid, actor uuid, action text NOT NULL, school_id uuid, detail jsonb, at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['org_group_admins','org_group_join_requests','org_group_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP; END $$;
CREATE OR REPLACE FUNCTION public._grp_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'org_group_audit is append-only'; END $$;
DROP TRIGGER IF EXISTS org_group_audit_no_change ON public.org_group_audit;
CREATE TRIGGER org_group_audit_no_change BEFORE UPDATE OR DELETE ON public.org_group_audit FOR EACH ROW EXECUTE FUNCTION public._grp_audit_append_only();

CREATE OR REPLACE FUNCTION public._grp_is_aal2() RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;
CREATE OR REPLACE FUNCTION public._grp_is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_staff s JOIN public.platform_staff_roles r ON r.staff_id = s.id
                 WHERE s.id = auth.uid() AND s.status = 'active' AND r.role_code = 'platform_admin') $$;
CREATE OR REPLACE FUNCTION public._grp_role(p_group uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role FROM public.org_group_admins WHERE group_id = p_group AND user_id = auth.uid() AND revoked_at IS NULL $$;
-- Every group-console call: active group seat + MFA; optional minimum role.
CREATE OR REPLACE FUNCTION public._grp_guard(p_group uuid, p_roles text[] DEFAULT NULL) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r text := public._grp_role(p_group);
BEGIN
  IF auth.uid() IS NULL OR r IS NULL THEN RAISE EXCEPTION 'not a member of this school group' USING ERRCODE = '42501'; END IF;
  IF NOT public._grp_is_aal2() THEN RAISE EXCEPTION 'mfa required: verify with your authenticator app first' USING ERRCODE = '42501'; END IF;
  IF p_roles IS NOT NULL AND NOT r = ANY (p_roles) THEN RAISE EXCEPTION 'your group role cannot do this' USING ERRCODE = '42501'; END IF;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public._grp_school_admin(p_school uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND school_id = p_school AND role IN ('admin','principal')) $$;

-- Platform admin (MFA) creates a group with its owner and console label.
CREATE OR REPLACE FUNCTION public.group_create(p_name text, p_label text, p_owner uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g uuid; l text := lower(btrim(p_label));
BEGIN
  IF NOT public._grp_is_platform_admin() THEN RAISE EXCEPTION 'platform admin only' USING ERRCODE = '42501'; END IF;
  IF NOT public._grp_is_aal2() THEN RAISE EXCEPTION 'mfa required' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_name, ''))) < 3 THEN RAISE EXCEPTION 'group name too short'; END IF;
  IF l IN ('www','console','api','admin','app','gov','mail','status','auth','login') THEN RAISE EXCEPTION 'reserved label'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_owner) THEN RAISE EXCEPTION 'unknown owner'; END IF;
  INSERT INTO public.org_groups (name, host_label) VALUES (btrim(p_name), l) RETURNING id INTO g;
  INSERT INTO public.org_group_admins (group_id, user_id, role, added_by) VALUES (g, p_owner, 'owner', auth.uid());
  INSERT INTO public.org_group_audit (group_id, actor, action, detail) VALUES (g, auth.uid(), 'group_create', jsonb_build_object('label', l, 'owner', p_owner));
  RETURN g;
END $$;

CREATE OR REPLACE FUNCTION public.group_admin_set(p_group uuid, p_user uuid, p_role text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._grp_guard(p_group, ARRAY['owner']);
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'you cannot change your own group role'; END IF;
  IF p_role IS NOT NULL AND p_role NOT IN ('admin','viewer','owner') THEN RAISE EXCEPTION 'invalid role'; END IF;
  IF p_role IS NULL THEN
    UPDATE public.org_group_admins SET revoked_at = now() WHERE group_id = p_group AND user_id = p_user AND revoked_at IS NULL;
  ELSE
    INSERT INTO public.org_group_admins (group_id, user_id, role, added_by) VALUES (p_group, p_user, p_role, auth.uid())
      ON CONFLICT (group_id, user_id) DO UPDATE SET role = excluded.role, revoked_at = NULL, added_by = excluded.added_by, added_at = now();
  END IF;
  INSERT INTO public.org_group_audit (group_id, actor, action, detail) VALUES (p_group, auth.uid(), 'admin_set', jsonb_build_object('user', p_user, 'role', p_role));
  RETURN coalesce(p_role, 'revoked');
END $$;

-- Group owner/admin asks a school to join; the school's own admin (MFA) accepts. Membership is unique per school (021).
CREATE OR REPLACE FUNCTION public.group_join_request(p_group uuid, p_school uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i uuid;
BEGIN
  PERFORM public._grp_guard(p_group, ARRAY['owner','admin']);
  IF EXISTS (SELECT 1 FROM public.org_group_members WHERE school_id = p_school) THEN RAISE EXCEPTION 'school already belongs to a group'; END IF;
  INSERT INTO public.org_group_join_requests (group_id, school_id, requested_by) VALUES (p_group, p_school, auth.uid()) RETURNING id INTO i;
  INSERT INTO public.org_group_audit (group_id, actor, action, school_id) VALUES (p_group, auth.uid(), 'join_request', p_school);
  RETURN i;
END $$;

CREATE OR REPLACE FUNCTION public.school_group_requests() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := (SELECT school_id FROM public.users WHERE id = auth.uid());
BEGIN
  IF s IS NULL OR NOT public._grp_school_admin(s) THEN RAISE EXCEPTION 'school admin only' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('school_id', s,
    'membership', (SELECT jsonb_build_object('group_id', g.id, 'group', g.name, 'since', m.added_at) FROM public.org_group_members m JOIN public.org_groups g ON g.id = m.group_id WHERE m.school_id = s),
    'pending', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'group', g.name, 'requested_at', r.created_at) ORDER BY r.created_at)
      FROM public.org_group_join_requests r JOIN public.org_groups g ON g.id = r.group_id WHERE r.school_id = s AND r.status = 'pending'), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.school_group_decide(p_request uuid, p_accept boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.org_group_join_requests;
BEGIN
  SELECT * INTO r FROM public.org_group_join_requests WHERE id = p_request AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found or already decided'; END IF;
  IF NOT public._grp_school_admin(r.school_id) THEN RAISE EXCEPTION 'only this school''s admin can decide' USING ERRCODE = '42501'; END IF;
  IF NOT public._grp_is_aal2() THEN RAISE EXCEPTION 'mfa required' USING ERRCODE = '42501'; END IF;
  IF p_accept THEN
    IF EXISTS (SELECT 1 FROM public.org_group_members WHERE school_id = r.school_id) THEN RAISE EXCEPTION 'school already belongs to a group'; END IF;
    INSERT INTO public.org_group_members (group_id, school_id) VALUES (r.group_id, r.school_id);
  END IF;
  UPDATE public.org_group_join_requests SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END, decided_by = auth.uid(), decided_at = now() WHERE id = p_request;
  INSERT INTO public.org_group_audit (group_id, actor, action, school_id) VALUES (r.group_id, auth.uid(), CASE WHEN p_accept THEN 'join_accept' ELSE 'join_decline' END, r.school_id);
  RETURN CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
END $$;

-- Either side may end membership: the school's admin, or the group owner.
CREATE OR REPLACE FUNCTION public.group_school_leave(p_school uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g uuid := (SELECT group_id FROM public.org_group_members WHERE school_id = p_school);
BEGIN
  IF g IS NULL THEN RETURN false; END IF;
  IF NOT public._grp_is_aal2() THEN RAISE EXCEPTION 'mfa required' USING ERRCODE = '42501'; END IF;
  IF NOT (public._grp_school_admin(p_school) OR public._grp_role(g) = 'owner') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.org_group_members WHERE school_id = p_school;
  INSERT INTO public.org_group_audit (group_id, actor, action, school_id) VALUES (g, auth.uid(), 'leave', p_school);
  RETURN true;
END $$;

-- Console session by host label: who am I in this group (no data).
CREATE OR REPLACE FUNCTION public.group_console_session(p_label text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE g public.org_groups; r text;
BEGIN
  SELECT * INTO g FROM public.org_groups WHERE host_label = lower(btrim(p_label));
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  r := public._grp_role(g.id);
  IF auth.uid() IS NULL OR r IS NULL THEN RETURN jsonb_build_object('status', 'no_access'); END IF;
  IF NOT public._grp_is_aal2() THEN RETURN jsonb_build_object('status', 'mfa_required', 'group', g.name); END IF;
  RETURN jsonb_build_object('status', 'ok', 'group_id', g.id, 'group', g.name, 'role', r);
END $$;

-- Aggregate overview across member schools (no learner-level rows). Suppressed under 10 learners.
CREATE OR REPLACE FUNCTION public.group_overview(p_group uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public._grp_guard(p_group);
  WITH per AS (
    SELECT m.school_id, (SELECT name FROM public.schools WHERE id = m.school_id) school,
      (SELECT count(*) FROM public.students st WHERE st.school_id = m.school_id) enrolled,
      (SELECT count(*) FROM public.users u WHERE u.school_id = m.school_id AND u.role = 'teacher') teachers,
      (SELECT count(*) FILTER (WHERE status IN ('present','late')) FROM public.attendance a WHERE a.school_id = m.school_id AND a.date >= current_date - 30) att_p,
      (SELECT count(*) FROM public.attendance a WHERE a.school_id = m.school_id AND a.date >= current_date - 30) att_n,
      (SELECT count(*) FILTER (WHERE total_score >= 50) FROM public.grades g WHERE g.school_id = m.school_id) pass_p,
      (SELECT count(*) FROM public.grades g WHERE g.school_id = m.school_id) pass_n
    FROM public.org_group_members m WHERE m.group_id = p_group),
  tot AS (SELECT count(*) schools, coalesce(sum(enrolled), 0) enrolled, coalesce(sum(teachers), 0) teachers, sum(att_p) att_p, sum(att_n) att_n, sum(pass_p) pass_p, sum(pass_n) pass_n FROM per)
  SELECT jsonb_build_object('schools', t.schools, 'suppressed', t.enrolled < 10,
      'enrolled', CASE WHEN t.enrolled >= 10 THEN t.enrolled END, 'teachers', CASE WHEN t.enrolled >= 10 THEN t.teachers END,
      'attendance_pct_30d', CASE WHEN t.enrolled >= 10 THEN round(100.0 * t.att_p / nullif(t.att_n, 0), 1) END,
      'pass_rate_pct', CASE WHEN t.enrolled >= 10 THEN round(100.0 * t.pass_p / nullif(t.pass_n, 0), 1) END,
      'per_school', coalesce((SELECT jsonb_agg(jsonb_build_object('school_id', p.school_id, 'school', p.school, 'suppressed', p.enrolled < 10,
          'enrolled', CASE WHEN p.enrolled >= 10 THEN p.enrolled END, 'teachers', CASE WHEN p.enrolled >= 10 THEN p.teachers END,
          'ptr', CASE WHEN p.enrolled >= 10 AND p.teachers > 0 THEN round(p.enrolled::numeric / p.teachers, 1) END,
          'attendance_pct', CASE WHEN p.enrolled >= 10 THEN round(100.0 * p.att_p / nullif(p.att_n, 0), 1) END,
          'pass_rate_pct', CASE WHEN p.enrolled >= 10 THEN round(100.0 * p.pass_p / nullif(p.pass_n, 0), 1) END) ORDER BY p.school) FROM per p), '[]'::jsonb))
    INTO res FROM tot t;
  INSERT INTO public.org_group_audit (group_id, actor, action) VALUES (p_group, auth.uid(), 'overview_view');
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.group_admins_list(p_group uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._grp_guard(p_group, ARRAY['owner','admin']);
  RETURN jsonb_build_object(
    'admins', coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', a.user_id, 'email', u.email, 'role', a.role) ORDER BY a.role, u.email)
      FROM public.org_group_admins a JOIN auth.users u ON u.id = a.user_id WHERE a.group_id = p_group AND a.revoked_at IS NULL), '[]'::jsonb),
    'pending', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'school', s.name, 'requested_at', r.created_at))
      FROM public.org_group_join_requests r JOIN public.schools s ON s.id = r.school_id WHERE r.group_id = p_group AND r.status = 'pending'), '[]'::jsonb));
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['_grp_is_platform_admin()','_grp_role(uuid)','_grp_guard(uuid, text[])','_grp_school_admin(uuid)','_grp_audit_append_only()'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM PUBLIC, anon, authenticated'; END LOOP;
  FOREACH f IN ARRAY ARRAY['group_create(text, text, uuid)','group_admin_set(uuid, uuid, text)','group_join_request(uuid, uuid)','school_group_requests()',
      'school_group_decide(uuid, boolean)','group_school_leave(uuid)','group_console_session(text)','group_overview(uuid)','group_admins_list(uuid)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM PUBLIC, anon'; EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO authenticated'; END LOOP;
END $$;
COMMIT;
