-- SHERIVS-B01 (Track B, day 1): institution head console (console.<inst>.sherivs.com).
-- One identity: heads use the same account as in the app. The console is an extra surface,
-- gated by an active head role in that institution AND step-up MFA (JWT aal = aal2).
BEGIN;
CREATE TABLE IF NOT EXISTS public.institution_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  head_role text NOT NULL CHECK (head_role IN ('proprietor','director','vc','dvc','rector','deputy_rector','provost','deputy_provost',
    'registrar','bursar','librarian','dean','hod','principal','vice_principal','head_teacher')),
  unit_ref text CHECK (unit_ref IS NULL OR length(unit_ref) BETWEEN 1 AND 120),
  granted_by uuid, starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz,
  revoked_at timestamptz, revoked_by uuid,
  CHECK (ends_at IS NULL OR ends_at > starts_at));
CREATE UNIQUE INDEX IF NOT EXISTS institution_heads_active_uniq ON public.institution_heads (school_id, user_id, head_role, coalesce(unit_ref, '')) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS institution_heads_user_idx ON public.institution_heads (user_id) WHERE revoked_at IS NULL;
ALTER TABLE public.institution_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_heads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.institution_heads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.institution_heads TO authenticated;
GRANT ALL ON public.institution_heads TO service_role;
DROP POLICY IF EXISTS institution_heads_read ON public.institution_heads;
CREATE POLICY institution_heads_read ON public.institution_heads FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (school_id = (SELECT public.get_my_school_id()) AND (SELECT public.is_school_admin())) OR (SELECT public.is_super_admin()));

CREATE TABLE IF NOT EXISTS public.head_console_audit (
  id bigserial PRIMARY KEY, school_id uuid, actor uuid, action text NOT NULL, target_user uuid, detail jsonb NOT NULL DEFAULT '{}'::jsonb, at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.head_console_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.head_console_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.head_console_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.head_console_audit TO service_role;
CREATE OR REPLACE FUNCTION public._head_console_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'head_console_audit is append-only'; END $$;
DROP TRIGGER IF EXISTS head_console_audit_immutable ON public.head_console_audit;
CREATE TRIGGER head_console_audit_immutable BEFORE UPDATE OR DELETE ON public.head_console_audit FOR EACH ROW EXECUTE FUNCTION public._head_console_audit_immutable();

CREATE OR REPLACE FUNCTION public._is_aal2() RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;

-- Grant/revoke: an admin of the institution, signed in with MFA, never to themselves.
CREATE OR REPLACE FUNCTION public.head_role_grant(p_user uuid, p_role text, p_unit text DEFAULT NULL, p_ends_at timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id(); v uuid;
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN RAISE EXCEPTION 'not allowed: institution administrators only' USING ERRCODE = '42501'; END IF;
  IF NOT public._is_aal2() THEN RAISE EXCEPTION 'mfa required: verify with your authenticator app first' USING ERRCODE = '42501'; END IF;
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'separation of duties: you cannot grant a head role to yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user AND u.school_id = s AND coalesce(u.is_active, true))
     AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id = p_user AND m.school_id = s AND m.is_active) THEN
    RAISE EXCEPTION 'this person is not a member of your institution'; END IF;
  IF p_ends_at IS NOT NULL AND p_ends_at <= now() THEN RAISE EXCEPTION 'end date must be in the future'; END IF;
  INSERT INTO public.institution_heads (school_id, user_id, head_role, unit_ref, granted_by, ends_at)
    VALUES (s, p_user, p_role, nullif(btrim(coalesce(p_unit, '')), ''), auth.uid(), p_ends_at) RETURNING id INTO v;
  INSERT INTO public.head_console_audit (school_id, actor, action, target_user, detail) VALUES (s, auth.uid(), 'grant', p_user, jsonb_build_object('role', p_role, 'unit', p_unit, 'ends_at', p_ends_at));
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.head_role_revoke(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id(); h public.institution_heads;
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT public._is_aal2() THEN RAISE EXCEPTION 'mfa required: verify with your authenticator app first' USING ERRCODE = '42501'; END IF;
  UPDATE public.institution_heads SET revoked_at = now(), revoked_by = auth.uid() WHERE id = p_id AND school_id = s AND revoked_at IS NULL RETURNING * INTO h;
  IF h.id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.head_console_audit (school_id, actor, action, target_user, detail) VALUES (s, auth.uid(), 'revoke', h.user_id, jsonb_build_object('role', h.head_role));
  RETURN true;
END $$;

-- Active head roles of the caller in the institution with this slug (no MFA needed to know you must step up).
CREATE OR REPLACE FUNCTION public._my_head_roles(p_school uuid) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(array_agg(DISTINCT h.head_role ORDER BY h.head_role), '{}') FROM public.institution_heads h
  WHERE h.school_id = p_school AND h.user_id = auth.uid() AND h.revoked_at IS NULL AND h.starts_at <= now() AND (h.ends_at IS NULL OR h.ends_at > now()) $$;

-- Console entry: {status: ok|mfa_required|not_a_head|unknown_institution, school, roles}
CREATE OR REPLACE FUNCTION public.head_console_session(p_slug text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE sc record; r text[];
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  SELECT id, name, slug, logo_url INTO sc FROM public.schools WHERE slug = lower(btrim(coalesce(p_slug, ''))) AND coalesce(is_active, true);
  IF sc.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown_institution'); END IF;
  r := public._my_head_roles(sc.id);
  IF cardinality(r) = 0 THEN RETURN jsonb_build_object('status', 'not_a_head', 'school', jsonb_build_object('name', sc.name)); END IF;
  IF NOT public._is_aal2() THEN RETURN jsonb_build_object('status', 'mfa_required', 'school', jsonb_build_object('name', sc.name)); END IF;
  RETURN jsonb_build_object('status', 'ok', 'roles', to_jsonb(r), 'school', jsonb_build_object('id', sc.id, 'name', sc.name, 'slug', sc.slug, 'logo_url', sc.logo_url));
END $$;

-- Headline figures; finance only for finance-entitled heads. Logged.
CREATE OR REPLACE FUNCTION public.head_console_overview(p_slug text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb := public.head_console_session(p_slug); sid uuid; r text[]; fin boolean; out jsonb;
BEGIN
  IF s->>'status' <> 'ok' THEN RAISE EXCEPTION 'not allowed: %', s->>'status' USING ERRCODE = '42501'; END IF;
  sid := (s->'school'->>'id')::uuid; r := ARRAY(SELECT jsonb_array_elements_text(s->'roles'));
  fin := r && ARRAY['proprietor','director','vc','rector','provost','bursar','principal','head_teacher'];
  out := jsonb_build_object('roles', s->'roles', 'school', s->'school',
    'students', (SELECT count(*) FROM public.students WHERE school_id = sid),
    'staff', (SELECT count(*) FROM public.users WHERE school_id = sid AND role IN ('teacher','admin','principal','bursar') AND coalesce(is_active, true)),
    'classes', (SELECT count(*) FROM public.classes WHERE school_id = sid),
    'finance', CASE WHEN fin THEN (SELECT jsonb_build_object('billed', coalesce(sum(amount), 0), 'paid', coalesce(sum(paid_amount), 0)) FROM public.fees WHERE school_id = sid) END);
  INSERT INTO public.head_console_audit (school_id, actor, action, detail) VALUES (sid, auth.uid(), 'view_overview', jsonb_build_object('finance', fin));
  RETURN out;
END $$;

REVOKE ALL ON FUNCTION public.head_role_grant(uuid, text, text, timestamptz), public.head_role_revoke(uuid), public._my_head_roles(uuid),
  public.head_console_session(text), public.head_console_overview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.head_role_grant(uuid, text, text, timestamptz), public.head_role_revoke(uuid),
  public.head_console_session(text), public.head_console_overview(text) TO authenticated;
COMMIT;
