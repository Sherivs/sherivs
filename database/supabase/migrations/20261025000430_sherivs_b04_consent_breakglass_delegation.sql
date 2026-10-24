-- SHERIVS-B04 (Track B, Day 4): minors' consent capture, break-glass review, time-limited delegation,
-- and a delegation-aware ReBAC/PBAC shadow check. Additive: authz_check / break_glass_open (SHERIVS-021) are NOT changed;
-- the live path is unchanged and the v2 check only logs (shadow).
BEGIN;

CREATE OR REPLACE FUNCTION public._sg_is_aal2() RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;

CREATE TABLE IF NOT EXISTS public.safeguard_audit (
  id bigserial PRIMARY KEY, school_id uuid NOT NULL, actor uuid, action text NOT NULL, ref_id uuid, student_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS safeguard_audit_s_idx ON public.safeguard_audit (school_id, at DESC);
ALTER TABLE public.safeguard_audit ENABLE ROW LEVEL SECURITY; ALTER TABLE public.safeguard_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.safeguard_audit FROM anon, authenticated;
DROP TRIGGER IF EXISTS trg_safeguard_audit_append_only ON public.safeguard_audit;
CREATE TRIGGER trg_safeguard_audit_append_only BEFORE UPDATE OR DELETE ON public.safeguard_audit FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

-- ===== 1. Minors' consent (NDPA s.31: a parent/guardian consents for a child under 18) =====
CREATE OR REPLACE FUNCTION public._student_is_adult(p_student uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT date_of_birth <= (current_date - interval '18 years')::date FROM public.students WHERE id = p_student), false) $$;

-- Who may set consent: a linked guardian (web form), an adult student for themselves, or a school admin recording
-- paper/verbal evidence (method + note required). core_education is not consent-based and cannot be withdrawn here.
CREATE OR REPLACE FUNCTION public.consent_set(p_student uuid, p_purpose text, p_grant boolean, p_method text DEFAULT 'web_form', p_note text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid; who text; cid uuid; method text := coalesce(p_method, 'web_form'); ver text := 'sherivs-consent-2026-10';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT school_id INTO s FROM public.students WHERE id = p_student;
  IF s IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_purpose NOT IN ('photos_media','ai_processing','messaging_sms_whatsapp','core_education') THEN RAISE EXCEPTION 'unknown purpose'; END IF;
  IF p_purpose = 'core_education' AND NOT p_grant THEN RAISE EXCEPTION 'core education is not consent-based; ask the school about withdrawal'; END IF;
  IF EXISTS (SELECT 1 FROM public.parent_student_map m WHERE m.parent_id = auth.uid() AND m.student_id = p_student AND m.school_id = s)
     OR EXISTS (SELECT 1 FROM public.students x WHERE x.id = p_student AND x.parent_id = auth.uid()) THEN
    who := 'guardian'; method := 'web_form';
  ELSIF EXISTS (SELECT 1 FROM public.students x WHERE x.id = p_student AND x.user_id = auth.uid()) THEN
    IF NOT public._student_is_adult(p_student) THEN RAISE EXCEPTION 'a parent or guardian must give consent for a learner under 18' USING ERRCODE = '42501'; END IF;
    who := 'self'; method := 'web_form';
  ELSIF s = public.get_my_school_id() AND coalesce(public.is_school_admin(), false) THEN
    IF method NOT IN ('paper_signed','verbal_recorded','admin_entered') THEN RAISE EXCEPTION 'record how consent was captured (paper, verbal or admin-entered)'; END IF;
    IF coalesce(length(btrim(p_note)), 0) < 5 THEN RAISE EXCEPTION 'add a note pointing to the evidence (e.g. form number)'; END IF;
    who := 'school';
  ELSE RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.consent_records (school_id, student_id, guardian_user_id, purpose, status, policy_version, granted_at, withdrawn_at, capture_method, captured_by, notes)
    VALUES (s, p_student, CASE WHEN who = 'guardian' THEN auth.uid() END, p_purpose, CASE WHEN p_grant THEN 'granted' ELSE 'withdrawn' END, ver,
            CASE WHEN p_grant THEN now() END, CASE WHEN NOT p_grant THEN now() END, method, auth.uid(), p_note)
  ON CONFLICT (student_id, purpose) DO UPDATE SET status = excluded.status, policy_version = excluded.policy_version,
    granted_at = CASE WHEN p_grant THEN now() ELSE public.consent_records.granted_at END, withdrawn_at = CASE WHEN p_grant THEN NULL ELSE now() END,
    guardian_user_id = coalesce(excluded.guardian_user_id, public.consent_records.guardian_user_id), capture_method = excluded.capture_method,
    captured_by = excluded.captured_by, notes = excluded.notes
  RETURNING id INTO cid;
  INSERT INTO public.consent_events (school_id, consent_id, student_id, purpose, action, policy_version, actor_id, capture_method)
    VALUES (s, cid, p_student, p_purpose, CASE WHEN p_grant THEN 'grant' ELSE 'withdraw' END, ver, auth.uid(), method);
  INSERT INTO public.safeguard_audit (school_id, actor, action, ref_id, student_id, detail)
    VALUES (s, auth.uid(), CASE WHEN p_grant THEN 'consent_grant' ELSE 'consent_withdraw' END, cid, p_student, jsonb_build_object('purpose', p_purpose, 'by', who, 'method', method));
  RETURN CASE WHEN p_grant THEN 'granted' ELSE 'withdrawn' END;
END $$;

-- Gate used by features before optional processing (photos, AI, messaging). Missing = not consented.
CREATE OR REPLACE FUNCTION public.consent_gate(p_student uuid, p_purpose text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_purpose = 'core_education' OR EXISTS (SELECT 1 FROM public.consent_records WHERE student_id = p_student AND purpose = p_purpose AND status = 'granted') $$;

CREATE OR REPLACE FUNCTION public.consent_status(p_student uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid;
BEGIN
  SELECT school_id INTO s FROM public.students WHERE id = p_student;
  IF s IS NULL OR NOT (coalesce(public.is_guardian_of_student(p_student, s), false)
      OR EXISTS (SELECT 1 FROM public.students x WHERE x.id = p_student AND (x.parent_id = auth.uid() OR x.user_id = auth.uid()))
      OR (s = public.get_my_school_id() AND coalesce(public.is_school_admin(), false))) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('adult', public._student_is_adult(p_student), 'purposes', (SELECT jsonb_object_agg(p, coalesce(
    (SELECT jsonb_build_object('status', c.status, 'method', c.capture_method, 'at', coalesce(c.withdrawn_at, c.granted_at)) FROM public.consent_records c WHERE c.student_id = p_student AND c.purpose = p),
    jsonb_build_object('status', 'not_asked'))) FROM unnest(ARRAY['photos_media','ai_processing','messaging_sms_whatsapp']) p));
END $$;

-- Guardian / adult-learner view: every learner I can consent for, with current status per optional purpose.
CREATE OR REPLACE FUNCTION public.consent_my_learners() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('student_id', st.id, 'name', coalesce(su.full_name, st.admission_number, 'Learner'),
      'adult', public._student_is_adult(st.id), 'self', st.user_id = auth.uid(),
      'purposes', (SELECT jsonb_object_agg(p, coalesce((SELECT c.status FROM public.consent_records c WHERE c.student_id = st.id AND c.purpose = p), 'not_asked'))
                   FROM unnest(ARRAY['photos_media','ai_processing','messaging_sms_whatsapp']) p)) ORDER BY su.full_name)
    FROM public.students st LEFT JOIN public.users su ON su.id = st.user_id
    WHERE st.parent_id = auth.uid() OR st.id IN (SELECT m.student_id FROM public.parent_student_map m WHERE m.parent_id = auth.uid())
       OR (st.user_id = auth.uid() AND public._student_is_adult(st.id))), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.consent_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id();
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT jsonb_object_agg(p, jsonb_build_object(
      'granted', (SELECT count(*) FROM public.consent_records c WHERE c.school_id = s AND c.purpose = p AND c.status = 'granted'),
      'withdrawn', (SELECT count(*) FROM public.consent_records c WHERE c.school_id = s AND c.purpose = p AND c.status = 'withdrawn'),
      'not_asked', (SELECT count(*) FROM public.students st WHERE st.school_id = s AND NOT EXISTS (SELECT 1 FROM public.consent_records c WHERE c.student_id = st.id AND c.purpose = p))))
    FROM unnest(ARRAY['photos_media','ai_processing','messaging_sms_whatsapp']) p);
END $$;

-- ===== 2. Break-glass: close and independent review =====
ALTER TABLE public.break_glass_grants ADD COLUMN IF NOT EXISTS closed_by uuid, ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz, ADD COLUMN IF NOT EXISTS review_outcome text, ADD COLUMN IF NOT EXISTS review_note text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'break_glass_review_outcome_chk') THEN
    ALTER TABLE public.break_glass_grants ADD CONSTRAINT break_glass_review_outcome_chk CHECK (review_outcome IS NULL OR review_outcome IN ('justified','unjustified'));
  END IF; END $$;

CREATE OR REPLACE FUNCTION public._is_school_dpo(p_school uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.ndpa_controller_profiles WHERE school_id = p_school AND dpo_user_id = auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.break_glass_close(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g public.break_glass_grants;
BEGIN
  SELECT * INTO g FROM public.break_glass_grants WHERE id = p_id FOR UPDATE;
  IF g.id IS NULL OR NOT (g.user_id = auth.uid() OR (g.school_id = public.get_my_school_id() AND coalesce(public.is_school_admin(), false))) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF g.closed_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.break_glass_grants SET closed_at = now(), closed_by = auth.uid() WHERE id = p_id;
  INSERT INTO public.safeguard_audit (school_id, actor, action, ref_id, student_id) VALUES (g.school_id, auth.uid(), 'break_glass_close', p_id, g.student_id);
  RETURN true;
END $$;

-- Review by the principal, an admin or the DPO, never the person who opened it; MFA required.
CREATE OR REPLACE FUNCTION public.break_glass_review(p_id uuid, p_outcome text, p_note text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g public.break_glass_grants;
BEGIN
  SELECT * INTO g FROM public.break_glass_grants WHERE id = p_id FOR UPDATE;
  IF g.id IS NULL OR g.school_id IS DISTINCT FROM public.get_my_school_id()
     OR NOT (coalesce(public.is_school_admin(), false) OR public.get_my_role() = 'principal' OR public._is_school_dpo(g.school_id)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF g.user_id = auth.uid() THEN RAISE EXCEPTION 'separation of duties: someone else must review your break-glass access' USING ERRCODE = '42501'; END IF;
  IF NOT public._sg_is_aal2() THEN RAISE EXCEPTION 'mfa required' USING ERRCODE = '42501'; END IF;
  IF g.reviewed_at IS NOT NULL THEN RAISE EXCEPTION 'already reviewed'; END IF;
  IF p_outcome NOT IN ('justified','unjustified') OR coalesce(length(btrim(p_note)), 0) < 10 THEN RAISE EXCEPTION 'choose an outcome and write a note of at least 10 characters'; END IF;
  UPDATE public.break_glass_grants SET reviewed_by = auth.uid(), reviewed_at = now(), review_outcome = p_outcome, review_note = btrim(p_note),
    closed_at = coalesce(closed_at, now()), closed_by = coalesce(closed_by, auth.uid()) WHERE id = p_id;
  INSERT INTO public.safeguard_audit (school_id, actor, action, ref_id, student_id, detail) VALUES (g.school_id, auth.uid(), 'break_glass_review', p_id, g.student_id, jsonb_build_object('outcome', p_outcome));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.break_glass_list() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id();
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT (coalesce(public.is_school_admin(), false) OR public.get_my_role() = 'principal' OR public._is_school_dpo(s)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'opened_by', u.full_name, 'opened_by_id', g.user_id, 'student', coalesce(su.full_name, st.admission_number, 'Learner'), 'reason', g.reason,
      'opened_at', g.opened_at, 'expires_at', g.expires_at, 'closed_at', g.closed_at, 'review_outcome', g.review_outcome, 'review_note', g.review_note,
      'state', CASE WHEN g.reviewed_at IS NOT NULL THEN 'reviewed' WHEN g.closed_at IS NULL AND g.expires_at > now() THEN 'open' ELSE 'needs_review' END,
      'overdue', g.reviewed_at IS NULL AND g.opened_at < now() - interval '72 hours') ORDER BY g.opened_at DESC)
    FROM public.break_glass_grants g LEFT JOIN public.users u ON u.id = g.user_id LEFT JOIN public.students st ON st.id = g.student_id LEFT JOIN public.users su ON su.id = st.user_id
    WHERE g.school_id = s AND g.opened_at > now() - interval '180 days'), '[]'::jsonb);
END $$;

-- ===== 3. Time-limited delegation (acting-up while someone is away) =====
CREATE TABLE IF NOT EXISTS public.authority_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  delegator uuid NOT NULL, delegate uuid NOT NULL, permissions text[] NOT NULL CHECK (cardinality(permissions) BETWEEN 1 AND 20),
  reason text NOT NULL CHECK (length(reason) >= 10), starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz NOT NULL,
  revoked_at timestamptz, revoked_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (delegator <> delegate), CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '30 days'));
CREATE INDEX IF NOT EXISTS authority_delegations_delegate_idx ON public.authority_delegations (delegate, school_id) WHERE revoked_at IS NULL;
ALTER TABLE public.authority_delegations ENABLE ROW LEVEL SECURITY; ALTER TABLE public.authority_delegations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.authority_delegations FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.delegation_grant(p_delegate uuid, p_permissions text[], p_ends_at timestamptz, p_reason text, p_starts_at timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id(); p text; v uuid; st timestamptz := coalesce(p_starts_at, now());
BEGIN
  IF auth.uid() IS NULL OR s IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT public._sg_is_aal2() THEN RAISE EXCEPTION 'mfa required' USING ERRCODE = '42501'; END IF;
  IF p_delegate = auth.uid() THEN RAISE EXCEPTION 'you cannot delegate to yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_delegate AND u.school_id = s AND coalesce(u.is_active, true) AND u.role NOT IN ('parent','student')) THEN
    RAISE EXCEPTION 'the delegate must be an active staff member of your school'; END IF;
  IF p_ends_at IS NULL OR p_ends_at <= st OR p_ends_at > st + interval '30 days' OR st < now() - interval '5 minutes' THEN RAISE EXCEPTION 'delegation must start now or later and last at most 30 days'; END IF;
  IF coalesce(cardinality(p_permissions), 0) = 0 THEN RAISE EXCEPTION 'choose at least one permission'; END IF;
  FOREACH p IN ARRAY p_permissions LOOP
    IF NOT EXISTS (SELECT 1 FROM public.permission_catalog WHERE code = p) THEN RAISE EXCEPTION 'unknown permission %', p; END IF;
    IF EXISTS (SELECT 1 FROM public.permission_catalog WHERE code = p AND protected) THEN RAISE EXCEPTION 'protected permission % cannot be delegated', p USING ERRCODE = '42501'; END IF;
    IF NOT public.scholar_can(s, p) THEN RAISE EXCEPTION 'you can only delegate what you hold yourself (%)', p USING ERRCODE = '42501'; END IF;
  END LOOP;
  INSERT INTO public.authority_delegations (school_id, delegator, delegate, permissions, reason, starts_at, ends_at)
    VALUES (s, auth.uid(), p_delegate, (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(p_permissions) x), btrim(p_reason), st, p_ends_at) RETURNING id INTO v;
  INSERT INTO public.safeguard_audit (school_id, actor, action, ref_id, detail) VALUES (s, auth.uid(), 'delegation_grant', v,
    jsonb_build_object('delegate', p_delegate, 'permissions', p_permissions, 'starts_at', st, 'ends_at', p_ends_at));
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.delegation_revoke(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.authority_delegations;
BEGIN
  SELECT * INTO d FROM public.authority_delegations WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL OR NOT (d.delegator = auth.uid() OR d.delegate = auth.uid() OR (d.school_id = public.get_my_school_id() AND coalesce(public.is_school_admin(), false))) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF d.revoked_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.authority_delegations SET revoked_at = now(), revoked_by = auth.uid() WHERE id = p_id;
  INSERT INTO public.safeguard_audit (school_id, actor, action, ref_id) VALUES (d.school_id, auth.uid(), 'delegation_revoke', p_id);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.delegations_mine() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id(); adm boolean := coalesce(public.is_school_admin(), false);
BEGIN
  IF auth.uid() IS NULL OR s IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'delegator', a.full_name, 'delegate', b.full_name, 'permissions', d.permissions, 'reason', d.reason,
      'starts_at', d.starts_at, 'ends_at', d.ends_at,
      'state', CASE WHEN d.revoked_at IS NOT NULL THEN 'revoked' WHEN d.ends_at <= now() THEN 'expired' WHEN d.starts_at > now() THEN 'scheduled' ELSE 'active' END) ORDER BY d.created_at DESC)
    FROM public.authority_delegations d LEFT JOIN public.users a ON a.id = d.delegator LEFT JOIN public.users b ON b.id = d.delegate
    WHERE d.school_id = s AND (adm OR auth.uid() IN (d.delegator, d.delegate))), '[]'::jsonb);
END $$;

-- Active delegation covering p_action for p_user in p_org (the delegator must still be an active member).
CREATE OR REPLACE FUNCTION public.delegation_allows(p_user uuid, p_org uuid, p_action text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.authority_delegations d JOIN public.users dl ON dl.id = d.delegator AND dl.school_id = d.school_id AND coalesce(dl.is_active, true)
    WHERE d.delegate = p_user AND d.school_id = p_org AND p_action = ANY (d.permissions) AND d.revoked_at IS NULL AND now() >= d.starts_at AND now() < d.ends_at) $$;

-- ===== 4. Shadow v2: SHERIVS-021 check + delegation layer. Logs only; never changes the live outcome. =====
CREATE OR REPLACE FUNCTION public.authz_check_v2(p_user uuid, p_action text, p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb := public.authz_check(p_user, p_action, p_kind, p_id); v_org uuid;
BEGIN
  IF (r->>'allow')::boolean OR (r->>'deciding_layer') NOT IN ('rbac','scope') THEN RETURN r; END IF;   -- tenant/consent/policy denials stay denials
  v_org := (public.resource_dims(p_kind, p_id)->>'org')::uuid;
  IF v_org IS NOT NULL AND public.delegation_allows(p_user, v_org, p_action) THEN
    RETURN jsonb_build_object('allow', true, 'deciding_layer', 'delegation', 'layers', coalesce(r->'layers', '[]'::jsonb) || jsonb_build_object('layer', 'delegation', 'pass', true));
  END IF;
  RETURN jsonb_set(r, '{layers}', coalesce(r->'layers', '[]'::jsonb) || jsonb_build_object('layer', 'delegation', 'pass', false));
END $$;

CREATE OR REPLACE FUNCTION public.authz_shadow_v2(p_action text, p_kind text, p_id uuid, p_legacy boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb;
BEGIN
  BEGIN
    r := public.authz_check_v2(auth.uid(), p_action, p_kind, p_id);
    INSERT INTO public.authz_shadow_log (org_id, user_id, action, resource_kind, resource_id, legacy_allow, new_allow, deciding_layer, layers)
    VALUES ((public.resource_dims(p_kind, p_id)->>'org')::uuid, auth.uid(), p_action, p_kind, p_id, p_legacy, (r->>'allow')::boolean, r->>'deciding_layer', r->'layers');
  EXCEPTION WHEN others THEN NULL; END;
  RETURN p_legacy;
END $$;

-- Shadow wiring on grade entry (sampled like attendance; sherivs.authz_shadow_rate, default 10%).
CREATE OR REPLACE FUNCTION public.grades_authz_shadow() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (random() < coalesce(nullif(current_setting('sherivs.authz_shadow_rate', true), '')::numeric, 0.1)) THEN
    PERFORM public.authz_shadow_v2('grades.enter', 'student', NEW.student_id, true); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_grades_authz_shadow ON public.grades;
CREATE TRIGGER trg_grades_authz_shadow AFTER INSERT ON public.grades FOR EACH ROW EXECUTE FUNCTION public.grades_authz_shadow();

REVOKE ALL ON FUNCTION public._student_is_adult(uuid), public._is_school_dpo(uuid), public.delegation_allows(uuid, uuid, text), public.grades_authz_shadow() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consent_set(uuid, text, boolean, text, text), public.consent_gate(uuid, text), public.consent_status(uuid), public.consent_my_learners(), public.consent_overview(),
  public.break_glass_close(uuid), public.break_glass_review(uuid, text, text), public.break_glass_list(),
  public.delegation_grant(uuid, text[], timestamptz, text, timestamptz), public.delegation_revoke(uuid), public.delegations_mine(),
  public.authz_check_v2(uuid, text, text, uuid), public.authz_shadow_v2(text, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consent_set(uuid, text, boolean, text, text), public.consent_gate(uuid, text), public.consent_status(uuid), public.consent_my_learners(), public.consent_overview(),
  public.break_glass_close(uuid), public.break_glass_review(uuid, text, text), public.break_glass_list(),
  public.delegation_grant(uuid, text[], timestamptz, text, timestamptz), public.delegation_revoke(uuid), public.delegations_mine(),
  public.authz_check_v2(uuid, text, text, uuid), public.authz_shadow_v2(text, text, uuid, boolean) TO authenticated;
COMMIT;
