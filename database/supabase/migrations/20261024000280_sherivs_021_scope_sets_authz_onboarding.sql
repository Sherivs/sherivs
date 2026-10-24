-- SHERIVS-021 (Onboarding Engine & Access Model, phases 1-3 + shadow authz):
--  * structure: org groups, shifts, section gender/residency, levels, curriculum templates
--  * multi-select scope sets per role assignment (campus, shift, section, gender, level, class, subject, house, hostel)
--  * unified authz_check (tenant/RLS gate -> consent + break-glass -> RBAC -> scope -> ReBAC -> PBAC -> audit) in SHADOW mode
--  * adaptive onboarding interview (nursery to SSS) with dry-run plan and idempotent apply
-- Additive only: no existing column, policy or function signature changes. Current checks stay authoritative.
BEGIN;

-- ============ 1. Structure ============
CREATE TABLE IF NOT EXISTS public.org_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.org_group_members (
  group_id uuid NOT NULL REFERENCES public.org_groups(id) ON DELETE CASCADE, school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (group_id, school_id), UNIQUE (school_id));
CREATE TABLE IF NOT EXISTS public.school_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  campus_id uuid REFERENCES public.campuses(id) ON DELETE CASCADE, name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('morning','afternoon','evening','weekend','full_day')), starts_at time, ends_at time,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (school_id, campus_id, name));
ALTER TABLE public.school_sections ADD COLUMN IF NOT EXISTS gender text CHECK (gender IS NULL OR gender IN ('boys','girls','mixed'));
ALTER TABLE public.school_sections ADD COLUMN IF NOT EXISTS residency text CHECK (residency IS NULL OR residency IN ('day','boarding','both'));
CREATE TABLE IF NOT EXISTS public.school_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL, band text NOT NULL CHECK (band IN ('creche','nursery','primary','jss','sss','technical','tertiary')),
  ordinal int NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (school_id, name));
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.school_shifts(id) ON DELETE SET NULL;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS level_id uuid REFERENCES public.school_levels(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.curriculum_templates (
  code text PRIMARY KEY, name text NOT NULL, band text NOT NULL, version text NOT NULL, subjects text[] NOT NULL, source_note text NOT NULL);
INSERT INTO public.curriculum_templates VALUES
 ('nerdc_2025_nursery','NERDC early childhood (template)','nursery','2025',ARRAY['Numeracy','Literacy (English)','Nigerian Language','Basic Science','Social Norms','Creative Arts','Physical & Health Education','Rhymes & Poems'],'Template: confirm against NERDC early-childhood guide'),
 ('nerdc_2025_primary','NERDC Basic Education, primary (template)','primary','2025',ARRAY['English Studies','Mathematics','Nigerian Language','Basic Science & Technology','Social & Citizenship Studies','Cultural & Creative Arts','Physical & Health Education','Christian Religious Studies / Islamic Studies','Digital Technologies','Pre-vocational Studies'],'Template: 2025 revision rolls out at Pri 1 and Pri 4 first; confirm subject list with NERDC'),
 ('nerdc_2025_jss','NERDC Basic Education, JSS (template)','jss','2025',ARRAY['English Studies','Mathematics','Nigerian Language','Basic Science','Basic Technology','Social & Citizenship Studies','Cultural & Creative Arts','Physical & Health Education','Christian Religious Studies / Islamic Studies','Digital Technologies','Business Studies','Agriculture','Home Economics','French','Arabic','Trade subject'],'Template: confirm with NERDC (2025 rollout at JSS1)'),
 ('nerdc_2025_sss','NERDC Senior Secondary (template)','sss','2025',ARRAY['English Language','General Mathematics','Citizenship & Heritage Studies','Digital Technologies','Trade subject','Biology','Chemistry','Physics','Further Mathematics','Agriculture','Literature in English','Government','History','CRS / IRS','Economics','Financial Accounting','Commerce','Geography','Technical Drawing'],'Template: confirm with NERDC (2025 rollout at SSS1); streams pick electives'),
 ('nerdc_legacy_basic','NERDC 9-year BEC (pre-2025 cohort)','primary','2014',ARRAY['English Studies','Mathematics','Basic Science & Technology','Religion & National Values','Cultural & Creative Arts','Pre-vocational Studies','Nigerian Language','French','Arabic'],'Older cohorts keep this list until they graduate'),
 ('british_igcse','British / IGCSE (template)','sss','2025',ARRAY['English First Language','Mathematics','Biology','Chemistry','Physics','Computer Science','Economics','Business Studies','Geography','History','French'],'Template; school confirms its Cambridge/Pearson syllabus'),
 ('montessori','Montessori early years (template)','nursery','2025',ARRAY['Practical Life','Sensorial','Language','Mathematics','Cultural Studies'],'Template'),
 ('islamiyya_integrated','Integrated Islamiyya (template)','primary','2025',ARRAY['Qur''an','Hadith','Fiqh','Arabic','Tawhid','Sirah'],'Template; added alongside the NERDC list')
ON CONFLICT (code) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.class_curriculum (
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE, template_code text NOT NULL REFERENCES public.curriculum_templates(code),
  school_id uuid NOT NULL, PRIMARY KEY (class_id, template_code));

-- ============ 2. Scope sets ============
ALTER TABLE public.user_role_assignments ADD COLUMN IF NOT EXISTS valid_until timestamptz;
ALTER TABLE public.user_role_assignments ADD COLUMN IF NOT EXISTS acting boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.role_assignment_scope_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assignment_id uuid NOT NULL REFERENCES public.user_role_assignments(id) ON DELETE CASCADE,
  org_id uuid NOT NULL, label text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.role_assignment_scopes (
  set_id uuid NOT NULL REFERENCES public.role_assignment_scope_sets(id) ON DELETE CASCADE, org_id uuid NOT NULL,
  dim text NOT NULL CHECK (dim IN ('campus','shift','section','gender','level','class','subject','house','hostel')),
  ref text NOT NULL, PRIMARY KEY (set_id, dim, ref));
CREATE INDEX IF NOT EXISTS role_assignment_scope_sets_assignment ON public.role_assignment_scope_sets (assignment_id);

-- validate that a reference belongs to the organisation
CREATE OR REPLACE FUNCTION public._scope_ref_ok(p_org uuid, p_dim text, p_ref text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_dim
    WHEN 'campus'  THEN EXISTS (SELECT 1 FROM public.campuses WHERE id::text = p_ref AND school_id = p_org)
    WHEN 'shift'   THEN EXISTS (SELECT 1 FROM public.school_shifts WHERE id::text = p_ref AND school_id = p_org)
    WHEN 'section' THEN EXISTS (SELECT 1 FROM public.school_sections WHERE id::text = p_ref AND school_id = p_org)
    WHEN 'level'   THEN EXISTS (SELECT 1 FROM public.school_levels WHERE id::text = p_ref AND school_id = p_org)
    WHEN 'class'   THEN EXISTS (SELECT 1 FROM public.classes WHERE id::text = p_ref AND school_id = p_org)
    WHEN 'house'   THEN EXISTS (SELECT 1 FROM public.student_groups WHERE id::text = p_ref AND school_id = p_org)
    WHEN 'hostel'  THEN EXISTS (SELECT 1 FROM public.hostel_rooms WHERE (id::text = p_ref OR block = p_ref) AND school_id = p_org)
    WHEN 'gender'  THEN p_ref IN ('boys','girls','mixed')
    WHEN 'subject' THEN length(p_ref) BETWEEN 2 AND 80
    ELSE false END;
$$;

-- assigner's own limits per dimension (NULL = unrestricted). Org admins and staff are unrestricted.
CREATE OR REPLACE FUNCTION public._assigner_limits(p_org uuid, p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH sets AS (
    SELECT ss.id FROM public.role_assignment_scope_sets ss JOIN public.user_role_assignments a ON a.id = ss.assignment_id
     WHERE a.org_id = p_org AND a.user_id = p_user AND a.status = 'active' AND (a.valid_until IS NULL OR a.valid_until > now())),
  unrestricted AS (
    SELECT EXISTS (SELECT 1 FROM public.user_role_assignments a WHERE a.org_id = p_org AND a.user_id = p_user AND a.status = 'active'
                     AND a.scope_type = 'org' AND NOT EXISTS (SELECT 1 FROM public.role_assignment_scope_sets s WHERE s.assignment_id = a.id)) u)
  SELECT CASE WHEN (SELECT u FROM unrestricted) OR NOT EXISTS (SELECT 1 FROM sets) THEN '{}'::jsonb
    ELSE coalesce((SELECT jsonb_object_agg(dim, refs) FROM (SELECT dim, jsonb_agg(DISTINCT ref) refs FROM public.role_assignment_scopes WHERE set_id IN (SELECT id FROM sets) GROUP BY dim) d), '{}'::jsonb) END;
$$;

-- Add one scope set: OR within a dimension, AND across dimensions. Never wider than the assigner's own scope.
CREATE OR REPLACE FUNCTION public.role_scope_set_add(p_assignment uuid, p_dims jsonb, p_label text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.user_role_assignments; v_set uuid; d text; r text; lim jsonb; n int := 0;
BEGIN
  SELECT * INTO a FROM public.user_role_assignments WHERE id = p_assignment AND status = 'active';
  IF a.id IS NULL OR NOT public.can_manage_roles(a.org_id, 'roles.assign') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF a.user_id = auth.uid() THEN RAISE EXCEPTION 'no_self_role_grant: you cannot widen your own operating area' USING ERRCODE = '42501'; END IF;
  IF p_dims IS NULL OR jsonb_typeof(p_dims) <> 'object' OR p_dims = '{}'::jsonb THEN RAISE EXCEPTION 'scope set needs at least one dimension'; END IF;
  lim := CASE WHEN coalesce(public.is_super_admin(), false) OR public.can_administer_org(a.org_id) THEN '{}'::jsonb ELSE public._assigner_limits(a.org_id, auth.uid()) END;
  FOR d IN SELECT jsonb_object_keys(p_dims) LOOP
    IF jsonb_typeof(p_dims->d) <> 'array' OR jsonb_array_length(p_dims->d) = 0 THEN RAISE EXCEPTION 'dimension % needs a non-empty list', d; END IF;
    FOR r IN SELECT jsonb_array_elements_text(p_dims->d) LOOP
      IF NOT public._scope_ref_ok(a.org_id, d, r) THEN RAISE EXCEPTION 'scope % % is not in this organisation', d, r; END IF;
      IF lim ? d AND NOT (lim->d) ? r THEN RAISE EXCEPTION 'scope_wider_than_assigner: % % is outside your own operating area', d, r USING ERRCODE = '42501'; END IF;
    END LOOP;
  END LOOP;
  -- an assigner restricted on a dimension cannot leave it open for the assignee
  FOR d IN SELECT jsonb_object_keys(lim) LOOP
    IF NOT p_dims ? d THEN RAISE EXCEPTION 'scope_wider_than_assigner: you must restrict % like your own scope', d USING ERRCODE = '42501'; END IF;
  END LOOP;
  INSERT INTO public.role_assignment_scope_sets (assignment_id, org_id, label, created_by) VALUES (a.id, a.org_id, p_label, auth.uid()) RETURNING id INTO v_set;
  INSERT INTO public.role_assignment_scopes (set_id, org_id, dim, ref)
  SELECT v_set, a.org_id, k, e FROM jsonb_object_keys(p_dims) k, jsonb_array_elements_text(p_dims->k) e;
  RETURN v_set;
END $$;
CREATE OR REPLACE FUNCTION public.role_scope_set_remove(p_set uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o uuid;
BEGIN
  SELECT org_id INTO o FROM public.role_assignment_scope_sets WHERE id = p_set;
  IF o IS NULL OR NOT public.can_manage_roles(o, 'roles.assign') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.role_assignment_scope_sets WHERE id = p_set;
END $$;

-- Attributes of a resource, as dimension -> values
CREATE OR REPLACE FUNCTION public.resource_dims(p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.classes; s public.students; out jsonb := '{}'::jsonb; sec public.school_sections; v_class uuid;
BEGIN
  IF p_kind = 'student' THEN SELECT * INTO s FROM public.students WHERE id = p_id; v_class := s.class_id;
    out := jsonb_build_object('org', s.school_id, 'student', s.id,
      'house', coalesce((SELECT jsonb_agg(group_id::text) FROM public.student_group_members WHERE student_id = s.id), '[]'::jsonb),
      'hostel', coalesce((SELECT jsonb_agg(DISTINCT x) FROM public.hostel_allocations ha JOIN public.hostel_rooms hr ON hr.id = ha.room_id,
                           LATERAL (VALUES (hr.id::text), (hr.block)) v(x) WHERE ha.student_id = s.id AND ha.is_active AND x IS NOT NULL), '[]'::jsonb));
  ELSIF p_kind = 'class' THEN v_class := p_id;
  ELSE RETURN jsonb_build_object('kind', p_kind); END IF;
  SELECT * INTO c FROM public.classes WHERE id = v_class;
  IF c.id IS NOT NULL THEN
    SELECT * INTO sec FROM public.school_sections WHERE id = c.section_id;
    out := out || jsonb_build_object('org', c.school_id, 'class', jsonb_build_array(c.id::text),
      'campus', CASE WHEN c.campus_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(c.campus_id::text) END,
      'shift', CASE WHEN c.shift_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(c.shift_id::text) END,
      'section', CASE WHEN c.section_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(c.section_id::text) END,
      'gender', CASE WHEN sec.gender IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(sec.gender) END,
      'level', CASE WHEN c.level_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(c.level_id::text) END);
  END IF;
  RETURN out;
END $$;

-- ============ 3. Consent gate, break-glass, policies ============
CREATE TABLE IF NOT EXISTS public.break_glass_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(reason) >= 15), opened_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour', closed_at timestamptz);
CREATE TABLE IF NOT EXISTS public.policy_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  action text NOT NULL, kind text NOT NULL CHECK (kind IN ('time_window','term_open','deny_shift_mismatch','require_consent')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb, version int NOT NULL DEFAULT 1, enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.policy_rules (org_id, action, kind, params) VALUES
  (NULL, 'ai_tutor.use', 'require_consent', '{"purpose":"ai_processing"}'),
  (NULL, 'attendance.take', 'time_window', '{"from":"05:00","to":"20:00","tz":"Africa/Lagos"}')
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.authz_shadow_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, org_id uuid, user_id uuid, action text NOT NULL, resource_kind text, resource_id uuid,
  legacy_allow boolean, new_allow boolean NOT NULL, agree boolean GENERATED ALWAYS AS (legacy_allow IS NOT DISTINCT FROM new_allow) STORED,
  deciding_layer text, layers jsonb, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS authz_shadow_log_disagree ON public.authz_shadow_log (org_id, at DESC) WHERE NOT agree;

CREATE OR REPLACE FUNCTION public.break_glass_open(p_student uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid; v uuid;
BEGIN
  SELECT school_id INTO s FROM public.students WHERE id = p_student;
  IF s IS NULL OR s IS DISTINCT FROM public.get_my_school_id() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT (public.scholar_can(s, 'welfare.pastoral') OR public.scholar_can(s, 'health.records_view') OR public.scholar_can(s, 'students.view')) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(p_reason), 0) < 15 THEN RAISE EXCEPTION 'give a reason of at least 15 characters'; END IF;
  INSERT INTO public.break_glass_grants (school_id, user_id, student_id, reason) VALUES (s, auth.uid(), p_student, p_reason) RETURNING id INTO v;
  -- alert DPO and principal(s)
  INSERT INTO public.notifications (school_id, user_id, title, message, type)
  SELECT s, u.id, 'Break-glass access opened', 'Emergency access to a student record was opened. Reason: ' || left(p_reason, 200), 'security'
    FROM public.users u WHERE u.school_id = s AND (u.role = 'principal' OR u.id = (SELECT dpo_user_id FROM public.ndpa_controller_profiles WHERE school_id = s));
  RETURN v;
END $$;

-- ============ 4. Unified access check (shadow) ============
CREATE OR REPLACE FUNCTION public.authz_check(p_user uuid, p_action text, p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE rd jsonb; v_org uuid; my_org uuid; u_role text; layers jsonb := '[]'::jsonb; allow boolean := false; deciding text;
        sensitive boolean; ok_scope boolean := false; rel boolean := false; a record; set_ok boolean; d text; pol record; t time; consent_ok boolean := true;
        prot boolean; bg boolean := false;
BEGIN
  rd := public.resource_dims(p_kind, p_id); v_org := (rd->>'org')::uuid;
  -- evaluate for yourself; org admins may evaluate for staff of their own org (access explainer); staff/service any
  IF p_user IS DISTINCT FROM auth.uid() AND NOT (coalesce(public.is_super_admin(), false) OR coalesce(auth.role(), '') = 'service_role'
       OR (v_org IS NOT NULL AND public.can_administer_org(v_org))) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT coalesce((SELECT m.school_id FROM public.organization_memberships m WHERE m.user_id = p_user AND m.is_active ORDER BY m.is_primary DESC LIMIT 1), u.school_id), u.role
    INTO my_org, u_role FROM public.users u WHERE u.id = p_user;
  -- L1 tenant gate (what RLS enforces)
  IF v_org IS NULL OR my_org IS DISTINCT FROM v_org THEN
    RETURN jsonb_build_object('allow', false, 'deciding_layer', 'tenant', 'layers', jsonb_build_array(jsonb_build_object('layer', 'tenant', 'pass', false))); END IF;
  layers := layers || jsonb_build_object('layer', 'tenant', 'pass', true);
  SELECT protected INTO prot FROM public.permission_catalog WHERE code = p_action;
  sensitive := p_action IN ('health.records_view', 'students.view_sensitive', 'counselling.notes');
  -- L2 consent + break-glass
  IF p_kind = 'student' THEN
    FOR pol IN SELECT * FROM public.policy_rules WHERE enabled AND kind = 'require_consent' AND action = p_action AND (org_id IS NULL OR org_id = v_org) LOOP
      consent_ok := consent_ok AND EXISTS (SELECT 1 FROM public.consent_records WHERE student_id = p_id AND purpose = pol.params->>'purpose' AND status = 'granted');
    END LOOP;
    bg := EXISTS (SELECT 1 FROM public.break_glass_grants WHERE user_id = p_user AND student_id = p_id AND closed_at IS NULL AND expires_at > now());
  END IF;
  layers := layers || jsonb_build_object('layer', 'consent', 'pass', consent_ok, 'break_glass', bg);
  IF NOT consent_ok THEN RETURN jsonb_build_object('allow', false, 'deciding_layer', 'consent', 'layers', layers); END IF;
  IF bg AND sensitive THEN RETURN jsonb_build_object('allow', true, 'deciding_layer', 'break_glass', 'layers', layers); END IF;
  -- L3 RBAC + L4 scope: any active, unexpired assignment carrying the permission whose scope matches the resource
  FOR a IN
    SELECT ura.id, ura.scope_type, ura.scope_ref FROM public.user_role_assignments ura
      JOIN public.role_catalog r ON r.code = ura.role_code JOIN public.role_template_permissions tp ON tp.template_code = r.template_code
      LEFT JOIN public.org_role_permission_settings s ON s.org_id = v_org AND s.role_code = ura.role_code AND s.permission_code = tp.permission_code
     WHERE ura.org_id = v_org AND ura.user_id = p_user AND ura.status = 'active' AND (ura.valid_until IS NULL OR ura.valid_until > now())
       AND tp.permission_code = p_action AND (tp.kind = 'mandatory' OR coalesce(s.enabled, tp.default_on))
  LOOP
    allow := true;
    IF NOT EXISTS (SELECT 1 FROM public.role_assignment_scope_sets WHERE assignment_id = a.id) THEN
      IF a.scope_type = 'org' OR a.scope_type = 'self' AND p_kind = 'student' AND (rd->>'student') IS NOT NULL
         OR a.scope_type = 'class' AND rd->'class' ? a.scope_ref OR a.scope_type = 'campus' AND rd->'campus' ? a.scope_ref THEN ok_scope := true; END IF;
    ELSE
      FOR set_ok IN SELECT bool_and(EXISTS (SELECT 1 FROM public.role_assignment_scopes x WHERE x.set_id = ss.id AND x.dim = dd.dim
                                            AND (rd->x.dim) ? x.ref))
                      FROM public.role_assignment_scope_sets ss, LATERAL (SELECT DISTINCT dim FROM public.role_assignment_scopes WHERE set_id = ss.id) dd
                     WHERE ss.assignment_id = a.id GROUP BY ss.id LOOP
        IF set_ok THEN ok_scope := true; END IF;
      END LOOP;
    END IF;
  END LOOP;
  -- legacy bridge counts as RBAC with org scope (same as today), never for protected permissions
  IF NOT allow AND my_org = v_org AND coalesce(prot, false) = false AND (
       u_role IN ('admin', 'principal')
    OR u_role = 'bursar' AND p_action ~ '^(fees|payments|wallet|expenses|budget|reports\.financial|inventory|assets)'
    OR u_role = 'teacher' AND p_action IN ('attendance.take', 'attendance.view', 'grades.enter', 'grades.view', 'students.view', 'timetable.view', 'comms.send_class')) THEN
    allow := true; ok_scope := u_role IN ('admin', 'principal', 'bursar'); END IF;
  layers := layers || jsonb_build_object('layer', 'rbac', 'pass', allow);
  IF NOT allow THEN
    -- L5 ReBAC may still grant child-level reads to parents/students
    rel := p_kind = 'student' AND p_action IN ('grades.view', 'attendance.view', 'children.view', 'self.view_own', 'fees.view')
           AND (EXISTS (SELECT 1 FROM public.parent_student_map m WHERE m.parent_id = p_user AND m.student_id = p_id)
                OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = p_id AND (s.parent_id = p_user OR s.user_id = p_user)));
    layers := layers || jsonb_build_object('layer', 'rebac', 'pass', rel);
    RETURN jsonb_build_object('allow', rel, 'deciding_layer', CASE WHEN rel THEN 'rebac' ELSE 'rbac' END, 'layers', layers);
  END IF;
  -- relationship can satisfy scope for teachers: form teacher / timetable teacher of the class
  IF NOT ok_scope AND (rd->'class') IS NOT NULL THEN
    rel := EXISTS (SELECT 1 FROM public.classes c WHERE c.id::text IN (SELECT jsonb_array_elements_text(rd->'class')) AND c.teacher_id = p_user)
        OR EXISTS (SELECT 1 FROM public.timetable_slots ts JOIN public.timetables tt ON tt.id = ts.timetable_id
                    WHERE ts.teacher_id = p_user AND tt.class_id::text IN (SELECT jsonb_array_elements_text(rd->'class')));
    ok_scope := rel;
  END IF;
  layers := layers || jsonb_build_object('layer', 'scope', 'pass', ok_scope) || jsonb_build_object('layer', 'rebac', 'pass', rel);
  IF NOT ok_scope THEN RETURN jsonb_build_object('allow', false, 'deciding_layer', 'scope', 'layers', layers); END IF;
  -- L6 PBAC
  FOR pol IN SELECT * FROM public.policy_rules WHERE enabled AND action = p_action AND kind = 'time_window' AND (org_id IS NULL OR org_id = v_org) LOOP
    t := (now() AT TIME ZONE coalesce(pol.params->>'tz', 'Africa/Lagos'))::time;
    IF NOT (t BETWEEN (pol.params->>'from')::time AND (pol.params->>'to')::time) THEN
      RETURN jsonb_build_object('allow', false, 'deciding_layer', 'policy:time_window', 'layers', layers || jsonb_build_object('layer', 'pbac', 'pass', false)); END IF;
  END LOOP;
  layers := layers || jsonb_build_object('layer', 'pbac', 'pass', true);
  RETURN jsonb_build_object('allow', true, 'deciding_layer', 'all', 'layers', layers);
END $$;

-- Shadow: run the legacy decision and the new one side by side and log both. Never changes the outcome.
CREATE OR REPLACE FUNCTION public.authz_shadow(p_action text, p_kind text, p_id uuid, p_legacy boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; v_org uuid;
BEGIN
  BEGIN
    r := public.authz_check(auth.uid(), p_action, p_kind, p_id);
    v_org := (public.resource_dims(p_kind, p_id)->>'org')::uuid;
    INSERT INTO public.authz_shadow_log (org_id, user_id, action, resource_kind, resource_id, legacy_allow, new_allow, deciding_layer, layers)
    VALUES (v_org, auth.uid(), p_action, p_kind, p_id, p_legacy, (r->>'allow')::boolean, r->>'deciding_layer', r->'layers');
  EXCEPTION WHEN others THEN NULL; END;   -- shadow must never break the live path
  RETURN p_legacy;
END $$;
CREATE OR REPLACE FUNCTION public.authz_shadow_report(p_org uuid, p_since interval DEFAULT interval '7 days') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb;
BEGIN
  IF NOT (public.scholar_can(p_org, 'audit.view') OR public.can_administer_org(p_org)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('checks', count(*), 'agree', count(*) FILTER (WHERE agree), 'new_stricter', count(*) FILTER (WHERE legacy_allow AND NOT new_allow),
         'new_looser', count(*) FILTER (WHERE NOT legacy_allow AND new_allow),
         'by_layer', (SELECT coalesce(jsonb_object_agg(deciding_layer, n), '{}'::jsonb) FROM (SELECT deciding_layer, count(*) n FROM public.authz_shadow_log
                      WHERE org_id = p_org AND at > now() - p_since AND NOT agree GROUP BY 1) x))
    INTO r FROM public.authz_shadow_log WHERE org_id = p_org AND at > now() - p_since;
  RETURN r;
END $$;

-- Shadow wiring next to a live check: attendance marking (sampled 10%). Live RLS decides; shadow only logs.
CREATE OR REPLACE FUNCTION public.attendance_authz_shadow() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (random() < coalesce(nullif(current_setting('sherivs.authz_shadow_rate', true), '')::numeric, 0.1)) THEN
    PERFORM public.authz_shadow('attendance.take', 'student', NEW.student_id, true); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_attendance_authz_shadow ON public.attendance;
CREATE TRIGGER trg_attendance_authz_shadow AFTER INSERT ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.attendance_authz_shadow();

-- ============ 5. Adaptive onboarding interview (nursery to SSS) ============
CREATE TABLE IF NOT EXISTS public.onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','planned','applied')),
  plan jsonb, plan_hash text, applied_at timestamptz, applied_result jsonb, created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now());

CREATE OR REPLACE FUNCTION public.onboarding_start(p_school uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v FROM public.onboarding_sessions WHERE school_id = p_school AND status <> 'applied' ORDER BY created_at DESC LIMIT 1;
  IF v IS NULL THEN INSERT INTO public.onboarding_sessions (school_id, created_by) VALUES (p_school, auth.uid()) RETURNING id INTO v; END IF;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.onboarding_answer(p_session uuid, p_stage text, p_answer jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.onboarding_sessions;
BEGIN
  SELECT * INTO s FROM public.onboarding_sessions WHERE id = p_session FOR UPDATE;
  IF s.id IS NULL OR NOT public.scholar_can(s.school_id, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF s.status = 'applied' THEN RAISE EXCEPTION 'already applied; start a new session'; END IF;
  IF p_stage NOT IN ('organisation','institution','campuses','sections','shifts','curriculum','levels','calendar','assessment','fees','people','comms') THEN RAISE EXCEPTION 'unknown stage %', p_stage; END IF;
  UPDATE public.onboarding_sessions SET answers = answers || jsonb_build_object(p_stage, p_answer), status = 'draft', plan = NULL, plan_hash = NULL, updated_at = now() WHERE id = p_session;
  RETURN public.onboarding_next(p_session);
END $$;
-- Adaptive: which stages are still needed, given the answers so far
CREATE OR REPLACE FUNCTION public.onboarding_next(p_session uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb; need text[] := ARRAY[]::text[]; st text; bands jsonb;
BEGIN
  SELECT answers INTO a FROM public.onboarding_sessions WHERE id = p_session AND public.scholar_can(school_id, 'settings.manage');
  IF a IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  bands := coalesce(a->'institution'->'bands', '[]'::jsonb);
  FOREACH st IN ARRAY ARRAY['organisation','institution','campuses','sections'] LOOP IF NOT a ? st THEN need := need || st; END IF; END LOOP;
  IF coalesce((a->'organisation'->>'has_shifts')::boolean, false) AND NOT a ? 'shifts' THEN need := need || 'shifts'::text; END IF;
  FOREACH st IN ARRAY ARRAY['curriculum','levels','calendar','assessment','fees','people','comms'] LOOP IF NOT a ? st THEN need := need || st; END IF; END LOOP;
  RETURN jsonb_build_object('remaining', to_jsonb(need), 'next', need[1],
    'follow_ups', to_jsonb(ARRAY_REMOVE(ARRAY[
      CASE WHEN bands ? 'tertiary' THEN 'Tertiary onboarding is not in v1; set up nursery to SSS now' END,
      CASE WHEN coalesce((a->'organisation'->>'is_group')::boolean, false) THEN 'Add member schools after this one is provisioned' END,
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(a->'sections'->'items', '[]'::jsonb)) x WHERE x->>'residency' IN ('boarding','both')) THEN 'Boarding: houses, hostels and exeat rules' END,
      CASE WHEN bands ? 'sss' THEN 'SSS streams: science, arts, commercial, technical' END], NULL)));
END $$;

-- Build the dry-run plan (what will be created vs what already exists)
CREATE OR REPLACE FUNCTION public.onboarding_plan(p_session uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.onboarding_sessions; a jsonb; acts jsonb := '[]'::jsonb; c jsonb; sec jsonb; sh jsonb; lv jsonb; h jsonb; n_new int := 0; n_exist int := 0; ex boolean;
        arms int; band text; tpl text;
BEGIN
  SELECT * INTO s FROM public.onboarding_sessions WHERE id = p_session FOR UPDATE;
  IF s.id IS NULL OR NOT public.scholar_can(s.school_id, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  a := s.answers;
  IF jsonb_array_length(coalesce(public.onboarding_next(p_session)->'remaining', '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'interview incomplete: %', public.onboarding_next(p_session)->'remaining'; END IF;
  IF coalesce(a->'institution'->'bands', '[]'::jsonb) ? 'tertiary' THEN RAISE EXCEPTION 'tertiary is not supported in onboarding v1 (nursery to SSS only)'; END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(a->'campuses'->'items', '[]'::jsonb)) LOOP
    ex := EXISTS (SELECT 1 FROM public.campuses WHERE school_id = s.school_id AND name = c->>'name');
    acts := acts || jsonb_build_object('op', 'campus', 'name', c->>'name', 'exists', ex); IF ex THEN n_exist := n_exist + 1; ELSE n_new := n_new + 1; END IF;
  END LOOP;
  FOR sec IN SELECT * FROM jsonb_array_elements(coalesce(a->'sections'->'items', '[]'::jsonb)) LOOP
    IF coalesce(sec->>'kind', 'other') NOT IN ('early_years','nursery','primary','junior_secondary','senior_secondary','technical','day','boarding','other') THEN
      RAISE EXCEPTION 'section % has unknown kind %', sec->>'name', sec->>'kind'; END IF;
    acts := acts || jsonb_build_object('op', 'section', 'name', sec->>'name', 'campus', sec->>'campus', 'kind', sec->>'kind', 'gender', sec->>'gender', 'residency', sec->>'residency'); n_new := n_new + 1;
  END LOOP;
  FOR sh IN SELECT * FROM jsonb_array_elements(coalesce(a->'shifts'->'items', '[]'::jsonb)) LOOP
    acts := acts || jsonb_build_object('op', 'shift', 'name', sh->>'name', 'campus', sh->>'campus', 'kind', sh->>'kind'); n_new := n_new + 1;
  END LOOP;
  FOR lv IN SELECT * FROM jsonb_array_elements(coalesce(a->'levels'->'items', '[]'::jsonb)) LOOP
    band := lv->>'band'; arms := coalesce((lv->>'arms')::int, 1);
    tpl := coalesce(a->'curriculum'->>band, CASE band WHEN 'nursery' THEN 'nerdc_2025_nursery' WHEN 'creche' THEN 'nerdc_2025_nursery' WHEN 'primary' THEN 'nerdc_2025_primary' WHEN 'jss' THEN 'nerdc_2025_jss' WHEN 'sss' THEN 'nerdc_2025_sss' END);
    IF tpl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.curriculum_templates WHERE code = tpl) THEN RAISE EXCEPTION 'unknown curriculum template %', tpl; END IF;
    acts := acts || jsonb_build_object('op', 'level', 'name', lv->>'name', 'band', band, 'ordinal', lv->>'ordinal', 'arms', arms, 'arm_style', coalesce(lv->>'arm_style', 'letters'),
                                       'arm_names', lv->'arm_names', 'section', lv->>'section', 'campus', lv->>'campus', 'shift', lv->>'shift', 'stream', lv->>'stream', 'curriculum', tpl);
    n_new := n_new + arms;
  END LOOP;
  FOR h IN SELECT * FROM jsonb_array_elements(coalesce(a->'sections'->'houses', '[]'::jsonb)) LOOP
    acts := acts || jsonb_build_object('op', 'house', 'name', h #>> '{}'); n_new := n_new + 1;
  END LOOP;
  acts := acts || jsonb_build_object('op', 'grading', 'scale', coalesce(a->'assessment'->>'scale', 'waec_a1_f9'), 'ca_weight', coalesce((a->'assessment'->>'ca_weight')::int, 40))
               || jsonb_build_object('op', 'role_pack', 'pack', CASE WHEN coalesce(a->'institution'->'bands', '[]'::jsonb) ?| ARRAY['jss','sss'] THEN 'k12_secondary' ELSE 'k12_basic' END)
               || jsonb_build_object('op', 'consent_purposes', 'purposes', coalesce(a->'comms'->'consent', '["core_education","messaging_sms_whatsapp","photos_media"]'::jsonb));
  UPDATE public.onboarding_sessions SET plan = acts, plan_hash = md5(acts::text), status = 'planned', updated_at = now() WHERE id = p_session;
  RETURN jsonb_build_object('plan_hash', md5(acts::text), 'actions', acts, 'new_items', n_new, 'existing', n_exist);
END $$;

-- Apply exactly the approved plan (hash must match). Idempotent: reuses the 019 upserts.
CREATE OR REPLACE FUNCTION public.onboarding_apply(p_session uuid, p_plan_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.onboarding_sessions; x jsonb; camp uuid; sec uuid; sh uuid; lv uuid; made int := 0; classes int := 0; v_names text[]; cls record; sch uuid;
BEGIN
  SELECT * INTO s FROM public.onboarding_sessions WHERE id = p_session FOR UPDATE;
  IF s.id IS NULL OR NOT public.scholar_can(s.school_id, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF s.status = 'applied' THEN RETURN s.applied_result || jsonb_build_object('replay', true); END IF;
  IF s.status <> 'planned' OR s.plan_hash IS DISTINCT FROM p_plan_hash THEN RAISE EXCEPTION 'plan changed since you reviewed it; re-run the dry run'; END IF;
  sch := s.school_id;
  FOR x IN SELECT * FROM jsonb_array_elements(s.plan) LOOP
    CASE x->>'op'
    WHEN 'campus' THEN PERFORM public.campus_upsert(sch, x->>'name'); made := made + 1;
    WHEN 'section' THEN
      camp := (SELECT id FROM public.campuses WHERE school_id = sch AND name = x->>'campus');
      sec := public.section_upsert(sch, camp, x->>'name', coalesce(x->>'kind', 'other'));
      UPDATE public.school_sections SET gender = x->>'gender', residency = x->>'residency' WHERE id = sec; made := made + 1;
    WHEN 'shift' THEN
      camp := (SELECT id FROM public.campuses WHERE school_id = sch AND name = x->>'campus');
      INSERT INTO public.school_shifts (school_id, campus_id, name, kind) VALUES (sch, camp, x->>'name', coalesce(x->>'kind', 'morning'))
      ON CONFLICT (school_id, campus_id, name) DO NOTHING; made := made + 1;
    WHEN 'level' THEN
      INSERT INTO public.school_levels (school_id, name, band, ordinal) VALUES (sch, x->>'name', x->>'band', coalesce((x->>'ordinal')::int, 0))
      ON CONFLICT (school_id, name) DO UPDATE SET band = EXCLUDED.band RETURNING id INTO lv;
      camp := (SELECT id FROM public.campuses WHERE school_id = sch AND name = x->>'campus');
      sec := (SELECT id FROM public.school_sections WHERE school_id = sch AND name = x->>'section' AND campus_id IS NOT DISTINCT FROM camp LIMIT 1);
      sh := (SELECT id FROM public.school_shifts WHERE school_id = sch AND name = x->>'shift' AND campus_id IS NOT DISTINCT FROM camp LIMIT 1);
      IF x ? 'arm_names' AND jsonb_typeof(x->'arm_names') = 'array' THEN SELECT array_agg(e) INTO v_names FROM jsonb_array_elements_text(x->'arm_names') e; ELSE v_names := NULL; END IF;
      classes := classes + public.generate_class_arms(sch, x->>'name', 'A', chr(64 + least(greatest(coalesce((x->>'arms')::int, 1), 1), 26)), v_names, sec, camp, x->>'stream');
      FOR cls IN SELECT id FROM public.classes WHERE school_id = sch AND grade_level = x->>'name' AND campus_id IS NOT DISTINCT FROM camp LOOP
        UPDATE public.classes SET level_id = lv, shift_id = coalesce(sh, shift_id) WHERE id = cls.id;
        IF x->>'curriculum' IS NOT NULL THEN INSERT INTO public.class_curriculum (class_id, template_code, school_id) VALUES (cls.id, x->>'curriculum', sch) ON CONFLICT DO NOTHING; END IF;
      END LOOP;
    WHEN 'house' THEN PERFORM public.group_upsert(sch, x->>'name', 'house'); made := made + 1;
    ELSE NULL;  -- grading / role pack / consent purposes recorded for the admin to confirm in their own screens
    END CASE;
  END LOOP;
  UPDATE public.schools SET onboarding_completed = true WHERE id = sch;
  UPDATE public.onboarding_sessions SET status = 'applied', applied_at = now(), applied_result = jsonb_build_object('structures', made, 'classes_created', classes) WHERE id = p_session;
  RETURN jsonb_build_object('structures', made, 'classes_created', classes);
END $$;

-- ============ RLS / grants / audit ============
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['org_groups','org_group_members','school_shifts','school_levels','curriculum_templates','class_curriculum','role_assignment_scope_sets',
    'role_assignment_scopes','break_glass_grants','policy_rules','authz_shadow_log','onboarding_sessions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_read ON public.%1$I', t);
  END LOOP; END $$;
CREATE POLICY org_groups_read ON public.org_groups FOR SELECT TO authenticated USING (owner_user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.org_group_members m WHERE m.group_id = id AND m.school_id = public.get_my_school_id()));
CREATE POLICY org_group_members_read ON public.org_group_members FOR SELECT TO authenticated USING (school_id = public.get_my_school_id());
CREATE POLICY school_shifts_read ON public.school_shifts FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() OR coalesce(public.is_super_admin(), false));
CREATE POLICY school_levels_read ON public.school_levels FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() OR coalesce(public.is_super_admin(), false));
CREATE POLICY curriculum_templates_read ON public.curriculum_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY class_curriculum_read ON public.class_curriculum FOR SELECT TO authenticated USING (school_id = public.get_my_school_id());
CREATE POLICY role_assignment_scope_sets_read ON public.role_assignment_scope_sets FOR SELECT TO authenticated
  USING (public.can_manage_roles(org_id, 'roles.assign') OR EXISTS (SELECT 1 FROM public.user_role_assignments a WHERE a.id = assignment_id AND a.user_id = auth.uid()));
CREATE POLICY role_assignment_scopes_read ON public.role_assignment_scopes FOR SELECT TO authenticated
  USING (public.can_manage_roles(org_id, 'roles.assign') OR EXISTS (SELECT 1 FROM public.role_assignment_scope_sets s JOIN public.user_role_assignments a ON a.id = s.assignment_id WHERE s.id = set_id AND a.user_id = auth.uid()));
CREATE POLICY break_glass_grants_read ON public.break_glass_grants FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.scholar_can(school_id, 'audit.view') OR public.can_administer_org(school_id));
CREATE POLICY policy_rules_read ON public.policy_rules FOR SELECT TO authenticated USING (org_id IS NULL OR org_id = public.get_my_school_id());
CREATE POLICY authz_shadow_log_read ON public.authz_shadow_log FOR SELECT TO authenticated USING (public.scholar_can(org_id, 'audit.view') OR public.can_administer_org(org_id));
CREATE POLICY onboarding_sessions_read ON public.onboarding_sessions FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'settings.manage'));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['school_shifts','school_levels','class_curriculum','break_glass_grants','onboarding_sessions','org_group_members'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['role_assignment_scope_sets','role_assignment_scopes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
  END LOOP; END $$;
DROP TRIGGER IF EXISTS trg_break_glass_append_only ON public.break_glass_grants;
CREATE TRIGGER trg_break_glass_append_only BEFORE DELETE ON public.break_glass_grants FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
DROP TRIGGER IF EXISTS trg_authz_shadow_log_append_only ON public.authz_shadow_log;
CREATE TRIGGER trg_authz_shadow_log_append_only BEFORE UPDATE OR DELETE ON public.authz_shadow_log FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

REVOKE ALL ON FUNCTION public._scope_ref_ok(uuid, text, text), public._assigner_limits(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.role_scope_set_add(uuid, jsonb, text), public.role_scope_set_remove(uuid), public.resource_dims(text, uuid),
  public.break_glass_open(uuid, text), public.authz_check(uuid, text, text, uuid), public.authz_shadow(text, text, uuid, boolean),
  public.authz_shadow_report(uuid, interval), public.onboarding_start(uuid), public.onboarding_answer(uuid, text, jsonb), public.onboarding_next(uuid),
  public.onboarding_plan(uuid), public.onboarding_apply(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.role_scope_set_add(uuid, jsonb, text), public.role_scope_set_remove(uuid),
  public.break_glass_open(uuid, text), public.authz_check(uuid, text, text, uuid),
  public.authz_shadow_report(uuid, interval), public.onboarding_start(uuid), public.onboarding_answer(uuid, text, jsonb), public.onboarding_next(uuid),
  public.onboarding_plan(uuid), public.onboarding_apply(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resource_dims(text, uuid), public.authz_shadow(text, text, uuid, boolean) FROM authenticated;
COMMIT;
