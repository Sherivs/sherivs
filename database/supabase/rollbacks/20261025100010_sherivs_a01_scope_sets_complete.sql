-- Rollback SHERIVS-A01: restore the SHERIVS-021 scope-set functions and drop the new objects.
BEGIN;
DROP FUNCTION IF EXISTS public.role_scope_sets_list(uuid);
DROP FUNCTION IF EXISTS public.scope_class_ids(uuid);
DROP FUNCTION IF EXISTS public.my_operating_area(uuid);
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
DROP TABLE IF EXISTS public.role_scope_audit;
COMMIT;
